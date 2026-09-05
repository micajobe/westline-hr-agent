import {
  TraceRecorder, emptyAnswer, mintConfirmationToken, newConversationId, newTurnId,
  type Answer, type ChatEnvelope, type ConfirmationRequest, type PeopleDirectory, type TraceEvent,
} from '@westline/shared';
import type { McpToolClient } from '../mcp/client.js';
import { CitationRegistry } from './citations.js';
import { ConversationStore, type Conversation, type PendingGate, type SuspendedTurn } from './conversation.js';
import type { ContentBlock, MessageParam, ModelClient } from './model.js';
import { planTurn } from './plan.js';
import { systemPrompt } from './prompts/system.js';
import type { Plan } from './schemas.js';
import { synthesize } from './synthesize.js';
import { executeTool, proposedArgsHash, type ActionTakenRecord } from './tools.js';
import { verifyAnswer } from './verify.js';

export interface OrchestratorDeps {
  model: ModelClient;
  mcp: McpToolClient;
  people: PeopleDirectory;
  store: ConversationStore;
  secret: string;
  maxIterations: number;
  today?: () => string;
}

export interface TurnRequest {
  message: string;
  acting_person_id?: string | null;
  conversation_id?: string;
  onEvent?: (e: TraceEvent) => void;
}

export interface ConfirmRequest {
  conversation_id: string;
  turn_id: string;
  args_hash: string;
  decision: 'confirm' | 'cancel';
  onEvent?: (e: TraceEvent) => void;
}

interface LoopState {
  plan: Plan;
  system: string;
  messages: MessageParam[];
  iteration: number;
  citations: CitationRegistry;
  actions: ActionTakenRecord[];
  trace: TraceRecorder;
  acting_person_id: string | null;
  /** A minted token for exactly one pending args hash, present only on resume-after-confirm. */
  grant?: { args_hash: string; token: string; tool_use_id: string };
  /** On resume-after-cancel: the pending tool_use gets this structured result instead of running. */
  cancelled?: { tool_use_id: string };
  completed_results: { tool_use_id: string; content: string }[];
}

type LoopOutcome = { kind: 'done' } | { kind: 'gate'; pending: PendingGate; completed_results: { tool_use_id: string; content: string }[] };

/** PRD §7.1: PLAN → ACT → (gate) → SYNTHESIZE → VERIFY, with the ACT loop suspendable across a confirmation. */
export class Orchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  async runTurn(req: TurnRequest): Promise<ChatEnvelope> {
    const conversation_id = req.conversation_id ?? newConversationId();
    const acting_person_id = req.acting_person_id ?? null;
    const conv = this.d.store.getOrCreate(conversation_id, acting_person_id);
    conv.acting_person_id = acting_person_id;
    if (conv.suspended) {
      // A new message abandons a pending confirmation; the card is gone.
      conv.suspended = undefined;
    }
    const turn_id = newTurnId();
    const trace = new TraceRecorder(turn_id, req.onEvent);
    const person = this.d.people.get(acting_person_id);
    const today = this.today();
    const baseSystem = systemPrompt(person, acting_person_id, today);

    let plan: Plan;
    try {
      plan = await planTurn(this.d.model, baseSystem, conv.history, req.message, trace);
    } catch (err) {
      return this.modelFailure(conv, turn_id, trace, req.message, err);
    }

    if (plan.needs_clarification && plan.clarifying_question) {
      const answer = emptyAnswer({
        answer_markdown: plan.clarifying_question,
        clarification: { question: plan.clarifying_question },
        escalation: { target: 'none', reason: '' },
      });
      trace.emit({ type: 'synthesis', result_summary: 'clarification requested; no tools called', detail: { mode: 'clarify' } });
      trace.emit({ type: 'verify', result_summary: 'no policy facts to verify', detail: { facts_in: 0, facts_kept: 0, unsupported_claims_removed: 0 } });
      this.commitHistory(conv, req.message, answer);
      return { turn_id, conversation_id, answer, trace: trace.all() };
    }

    if (plan.intent === 'smalltalk') {
      const answer = emptyAnswer({ answer_markdown: 'Hello. I can answer questions about Westline policy for the selected persona, check PTO or benefits where permitted, and draft notes or open mock tickets with your confirmation. What would you like to know?' });
      trace.emit({ type: 'synthesis', result_summary: 'smalltalk; no tools called', detail: { mode: 'smalltalk' } });
      this.commitHistory(conv, req.message, answer);
      return { turn_id, conversation_id, answer, trace: trace.all() };
    }

    const state: LoopState = {
      plan,
      system: systemPrompt(person, acting_person_id, today, plan.summary),
      messages: [...conv.history, { role: 'user', content: req.message }],
      iteration: 0,
      citations: new CitationRegistry(),
      actions: [],
      trace,
      acting_person_id,
      completed_results: [],
    };
    return this.drive(conv, turn_id, req.message, state);
  }

  async confirm(req: ConfirmRequest): Promise<ChatEnvelope> {
    const conv = this.d.store.get(req.conversation_id);
    const s = conv?.suspended;
    if (!conv || !s || s.turn_id !== req.turn_id) {
      throw new ConfirmError(404, 'NO_PENDING_CONFIRMATION', 'there is no suspended action for that conversation and turn (it may have expired or been superseded)');
    }
    if (s.pending.args_hash !== req.args_hash) {
      throw new ConfirmError(409, 'ARGS_HASH_MISMATCH', 'the confirmation does not match the proposed action');
    }
    conv.suspended = undefined;
    const trace = new TraceRecorder(s.turn_id, req.onEvent);
    trace.resumeFrom(s.trace);
    trace.emit({ type: 'gate_resolved', tool: s.pending.tool, result_status: req.decision === 'confirm' ? 'confirmed' : 'cancelled', result_summary: req.decision === 'confirm' ? `user confirmed · token minted for ${s.pending.args_hash.slice(0, 12)}…` : 'user cancelled · nothing executed', detail: { args_hash: s.pending.args_hash, decision: req.decision } });

    const state: LoopState = {
      plan: s.plan,
      system: s.system,
      messages: s.messages,
      iteration: s.iteration,
      citations: CitationRegistry.fromJSON(s.citations),
      actions: s.actions,
      trace,
      acting_person_id: conv.acting_person_id,
      completed_results: s.completed_results,
      ...(req.decision === 'confirm'
        ? { grant: { args_hash: s.pending.args_hash, token: mintConfirmationToken(s.pending.args_hash, this.d.secret), tool_use_id: s.pending.tool_use_id } }
        : { cancelled: { tool_use_id: s.pending.tool_use_id } }),
    };
    const userMessage = lastUserText(s.messages);
    return this.drive(conv, s.turn_id, userMessage, state, { resumed: true, pendingArgs: s.pending.args, pendingTool: s.pending.tool });
  }

  // ---------- internals ----------

  private async drive(conv: Conversation, turn_id: string, userMessage: string, state: LoopState, resume?: { resumed: true; pendingArgs: Record<string, unknown>; pendingTool: string }): Promise<ChatEnvelope> {
    let outcome: LoopOutcome;
    try {
      outcome = await this.act(state, resume);
    } catch (err) {
      return this.modelFailure(conv, turn_id, state.trace, userMessage, err, state);
    }

    if (outcome.kind === 'gate') {
      conv.suspended = {
        turn_id, plan: state.plan, system: state.system, messages: state.messages, completed_results: outcome.completed_results,
        pending: outcome.pending, iteration: state.iteration, trace: state.trace.all(), citations: state.citations.toJSON(), actions: state.actions, started_at: Date.now(),
      } satisfies SuspendedTurn;
      this.d.store.touch(conv);
      const confirmation_required: ConfirmationRequest = { tool: outcome.pending.tool, args: outcome.pending.args, args_hash: outcome.pending.args_hash, summary: outcome.pending.summary };
      const answer = emptyAnswer({
        answer_markdown: `Before I do that, please confirm: ${outcome.pending.summary}. Nothing happens until you confirm.`,
        actions_proposed: [{ tool: outcome.pending.tool, args: outcome.pending.args, args_hash: outcome.pending.args_hash }],
      });
      return { turn_id, conversation_id: conv.conversation_id, answer, trace: state.trace.all(), confirmation_required };
    }

    let raw: unknown;
    try {
      raw = await synthesize(this.d.model, state.system, state.messages, state.citations, state.actions, state.plan.intent, state.trace);
    } catch (err) {
      return this.modelFailure(conv, turn_id, state.trace, userMessage, err, state);
    }
    const { answer } = verifyAnswer(raw, state.citations, state.trace);
    // Server-authoritative overlays: what actually executed, and what retrieval actually withheld.
    answer.actions_taken = state.actions.map((a) => ({ tool: a.tool, result_summary: a.result_summary, ref_id: a.ref_id }));
    answer.actions_proposed = [];
    const withheld = collectWithheld(state.trace.all());
    if (withheld.length && !answer.withheld_by_audience) {
      answer.withheld_by_audience = { doc_ids: withheld, explanation: `The following documents are not available to this role and were withheld from retrieval: ${withheld.join(', ')}.` };
    }
    this.commitHistory(conv, userMessage, answer);
    return { turn_id, conversation_id: conv.conversation_id, answer, trace: state.trace.all() };
  }

  /** The ACT loop. Returns `done` when the model stops calling tools, or `gate` when a gated call needs confirmation. */
  private async act(state: LoopState, resume?: { pendingArgs: Record<string, unknown>; pendingTool: string }): Promise<LoopOutcome> {
    // Startup discovery may have found nothing (MCP service asleep or restarting). Retry here
    // rather than handing the model an empty tool list and answering with no data.
    await this.d.mcp.ensureDiscovered();
    const tools = this.d.mcp.anthropicTools();
    const maxIterations = state.plan.intent === 'out_of_scope' ? Math.min(2, this.d.maxIterations) : this.d.maxIterations;

    // Resuming: finish the assistant turn whose tool_use blocks were interrupted by the gate.
    if (resume) {
      const results = [...state.completed_results];
      const grantOrCancel = state.grant ?? state.cancelled!;
      if (state.grant) {
        const executed = await executeTool(this.d.mcp, state.citations, state.trace, state.actions, { tool_use_id: state.grant.tool_use_id, tool: resume.pendingTool, args: resume.pendingArgs }, { acting_person_id: state.acting_person_id, confirmation_token: state.grant.token });
        results.push({ tool_use_id: executed.tool_use_id, content: JSON.stringify(executed.result) });
      } else {
        results.push({ tool_use_id: grantOrCancel.tool_use_id, content: JSON.stringify({ status: 'CANCELLED_BY_USER', reason: 'the user declined to confirm this action; do not retry it, finish the answer without it' }) });
      }
      state.messages.push(toolResultsMessage(results));
      state.completed_results = [];
      state.grant = undefined;
      state.cancelled = undefined;
    }

    while (state.iteration < maxIterations) {
      state.iteration++;
      const modelStarted = Date.now();
      const res = await this.d.model.create({ system: state.system, messages: state.messages, tools: tools as any, max_tokens: 4096 });
      state.messages.push({ role: 'assistant', content: res.content as ContentBlock[] });
      const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      state.trace.emit({ type: 'act', duration_ms: Date.now() - modelStarted, result_summary: `iteration ${state.iteration} · ${toolUses.length} tool call${toolUses.length === 1 ? '' : 's'} proposed`, detail: { stop_reason: res.stop_reason, tools_available: tools.length, usage: res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : undefined } });
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) return { kind: 'done' };

      // Classify in order first. A gate suspends the turn, so nothing after it may run -- but the
      // ungated reads before it are independent, and executing them one await at a time made a
      // four-tool turn four sequential round trips.
      const slots: ({ tool_use_id: string; content: string } | undefined)[] = new Array(toolUses.length);
      const runnable: { index: number; id: string; tool: string; args: Record<string, unknown> }[] = [];
      let gate: PendingGate | undefined;

      for (let i = 0; i < toolUses.length && !gate; i++) {
        const tu = toolUses[i];
        if (!tu) continue;
        const discovered = this.d.mcp.resolve(tu.name);
        const checked = this.d.mcp.validateArgs(tu.name, tu.input ?? {});
        if (!checked.ok) {
          // Malformed call: tell the model, never the user. A gate must only ever show valid arguments.
          state.trace.emit({ type: 'tool_result', server: discovered?.server, tool: tu.name, result_status: 'INVALID_ARGS', result_summary: checked.message.slice(0, 200), detail: { proposed: tu.input } });
          slots[i] = { tool_use_id: tu.id, content: JSON.stringify({ status: 'INVALID_ARGS', message: checked.message, hint: 'fix the arguments to match the tool schema exactly and call again' }) };
          continue;
        }
        const args = checked.args;
        const already = discovered?.gated ? state.actions.find((a) => a.tool === tu.name) : undefined;
        if (already) {
          // The confirmed action has run once this turn. Never gate (or execute) it a second time;
          // hand the model the earlier result so it finishes the answer.
          slots[i] = { tool_use_id: tu.id, content: JSON.stringify({ status: 'ALREADY_EXECUTED', ref_id: already.ref_id, result_summary: already.result_summary, note: 'this action already ran after the user confirmed it; do not call it again, finish the answer' }) };
          state.trace.emit({ type: 'tool_result', server: 'hr', tool: tu.name, result_status: 'ALREADY_EXECUTED', result_summary: `repeat call suppressed; ${already.result_summary}` });
          continue;
        }
        if (discovered?.gated) {
          const args_hash = proposedArgsHash(args, state.acting_person_id);
          gate = { tool_use_id: tu.id, tool: tu.name, args, args_hash, summary: this.describeAction(tu.name, args, state.acting_person_id) };
          state.trace.emit({ type: 'gate', server: 'hr', tool: tu.name, args: { ...args, acting_person_id: state.acting_person_id }, result_status: 'CONFIRMATION_REQUIRED', result_summary: gate.summary, detail: { args_hash, proposed_args: args } });
          continue;
        }
        runnable.push({ index: i, id: tu.id, tool: tu.name, args });
      }

      const executed = await Promise.all(
        runnable.map((r) => executeTool(this.d.mcp, state.citations, state.trace, state.actions, { tool_use_id: r.id, tool: r.tool, args: r.args }, { acting_person_id: state.acting_person_id })),
      );
      runnable.forEach((r, k) => {
        const out = executed[k];
        if (out) slots[r.index] = { tool_use_id: r.id, content: JSON.stringify(out.result) };
      });
      const results = slots.filter((s): s is { tool_use_id: string; content: string } => Boolean(s));

      if (gate) return { kind: 'gate', pending: gate, completed_results: results };
      state.messages.push(toolResultsMessage(results));
    }
    state.trace.emit({ type: 'error', result_status: 'iteration_cap', result_summary: `stopped after ${maxIterations} tool iterations; synthesizing from what was gathered` });
    // Give the model a closing turn so its last tool_results are not left dangling.
    state.messages.push({ role: 'user', content: 'Tool iteration limit reached. Do not call more tools.' });
    return { kind: 'done' };
  }

  private describeAction(tool: string, args: Record<string, unknown>, acting_person_id: string | null): string {
    const actor = this.d.people.get(acting_person_id);
    const about = typeof args.about_person_id === 'string' ? this.d.people.get(args.about_person_id) : undefined;
    const aboutText = about && actor && about.person_id !== actor.person_id ? ` about ${about.name}` : '';
    if (tool.endsWith('draft_hr_email')) {
      const role = String(args.recipient_role ?? 'recipient');
      const manager = role === 'manager' && actor?.manager_id ? this.d.people.get(actor.manager_id) : undefined;
      const to = manager ? `your manager ${manager.name}` : role.replace(/_/g, ' ');
      return `Draft an email to ${to}${aboutText} — "${String(args.purpose ?? '')}" (a draft only; nothing is sent)`;
    }
    if (tool.endsWith('create_mock_hr_ticket')) {
      return `Open a mock ${String(args.category ?? '').replace(/_/g, ' ')} ticket${aboutText}: "${String(args.summary ?? '')}"`;
    }
    return `Run ${tool}`;
  }

  private commitHistory(conv: Conversation, userMessage: string, answer: Answer): void {
    conv.history.push({ role: 'user', content: userMessage }, { role: 'assistant', content: answer.answer_markdown || '(no answer)' });
    if (conv.history.length > 8) conv.history.splice(0, conv.history.length - 8);
    this.d.store.touch(conv);
  }

  private modelFailure(conv: Conversation, turn_id: string, trace: TraceRecorder, userMessage: string, err: unknown, state?: LoopState): ChatEnvelope {
    const message = err instanceof Error ? err.message : String(err);
    trace.emit({ type: 'error', result_status: 'model_error', result_summary: `model call failed: ${message.slice(0, 200)}` });
    const answer = emptyAnswer({
      answer_markdown: 'I could not complete this turn because the language model was unavailable. Nothing was created or sent. Please try again, or contact a People & Culture partner directly.',
      escalation: { target: 'hr_partner', reason: 'assistant unavailable' },
      actions_taken: state?.actions.map((a) => ({ tool: a.tool, result_summary: a.result_summary, ref_id: a.ref_id })) ?? [],
    });
    this.commitHistory(conv, userMessage, answer);
    return { turn_id, conversation_id: conv.conversation_id, answer, trace: trace.all() };
  }

  private today(): string {
    return this.d.today ? this.d.today() : new Date().toISOString().slice(0, 10);
  }
}

export class ConfirmError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function toolResultsMessage(results: { tool_use_id: string; content: string }[]): MessageParam {
  return { role: 'user', content: results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.tool_use_id, content: r.content })) };
}

function lastUserText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

function collectWithheld(events: TraceEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) if (e.type === 'retrieval' && Array.isArray(e.detail?.withheld_doc_ids)) for (const d of e.detail!.withheld_doc_ids as string[]) out.add(d);
  return [...out].sort();
}

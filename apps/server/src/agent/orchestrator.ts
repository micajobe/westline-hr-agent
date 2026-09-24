import {
  TraceRecorder, emptyAnswer, mintConfirmationToken, newConversationId, newTurnId,
  type Answer, type ChatEnvelope, type ConfirmationRequest, type PeopleDirectory, type TraceEvent,
} from '@westline/shared';
import type { SemanticVerifier } from '@westline/semantic-verify';
import type { McpToolClient } from '../mcp/client.js';
import { CitationRegistry } from './citations.js';
import { ConversationStore, type Conversation, type PendingGate, type SuspendedTurn } from './conversation.js';
import type { ContentBlock, MessageParam, ModelClient } from './model.js';
import { planTurn } from './plan.js';
import { systemPrompt } from './prompts/system.js';
import type { Plan } from './schemas.js';
import { synthesize } from './synthesize.js';
import { executeTool, proposedArgsHash, type ActionTakenRecord } from './tools.js';
import { verifyAnswerSemantic } from './verify.js';

export interface OrchestratorDeps {
  model: ModelClient;
  mcp: McpToolClient;
  people: PeopleDirectory;
  store: ConversationStore;
  secret: string;
  maxIterations: number;
  today?: () => string;
  /** Semantic citation verifier (ADR 0019). Absent = VERIFY is structural only. */
  semantic?: SemanticVerifier | undefined;
  semanticThreshold?: number | undefined;
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
  completed_results: { tool_use_id: string; content: string }[];
  /** How many times each gated tool has been sent back DEFERRED this turn; bounded by MAX_GATE_DEFERRALS. */
  deferrals?: Record<string, number>;
}

/**
 * A gated action is held back while the reads the plan named have not run (or nothing has run at
 * all), at most this many times, so a plan that names a tool the model never calls cannot starve
 * the turn of its gate.
 */
export const MAX_GATE_DEFERRALS = 2;

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

    // ADR 0020: the answer was written and verified before the gate. Resolving the gate executes
    // (or skips) the one pending action and overlays its result; the model is not called again, so
    // the answer the user read does not change under them.
    const actions: ActionTakenRecord[] = [...s.actions];
    const citations = CitationRegistry.fromJSON(s.citations);
    if (req.decision === 'confirm') {
      const token = mintConfirmationToken(s.pending.args_hash, this.d.secret);
      await executeTool(this.d.mcp, citations, trace, actions, { tool_use_id: s.pending.tool_use_id, tool: s.pending.tool, args: s.pending.args }, { acting_person_id: conv.acting_person_id, confirmation_token: token });
    }
    const answer: Answer = {
      ...s.answer,
      answer_markdown: req.decision === 'cancel' ? `${s.answer.answer_markdown}\n\nYou cancelled that action; nothing was created.` : s.answer.answer_markdown,
      actions_proposed: [],
      actions_taken: actions.map((a) => ({ tool: a.tool, result_summary: a.result_summary, ref_id: a.ref_id })),
    };
    this.commitHistory(conv, lastUserText(s.messages), answer);
    return { turn_id: s.turn_id, conversation_id: conv.conversation_id, answer, trace: trace.all() };
  }

  // ---------- internals ----------

  private async drive(conv: Conversation, turn_id: string, userMessage: string, state: LoopState): Promise<ChatEnvelope> {
    let outcome: LoopOutcome;
    try {
      outcome = await this.act(state);
    } catch (err) {
      return this.modelFailure(conv, turn_id, state.trace, userMessage, err, state);
    }

    if (outcome.kind === 'gate') {
      // ADR 0020: answer first, then the card. The verdict the action rests on (the balance fits,
      // the notice rule) is synthesized and verified from what ACT gathered, so the user reads the
      // answer and only then decides on the action. A model failure here keeps the gate and falls
      // back to the one-line prompt rather than losing the turn.
      const pending = outcome.pending;
      let answer: Answer;
      try {
        // The assistant turn that proposed the action must be answered before anything else is sent:
        // the pending tool_use gets an AWAITING_CONFIRMATION result alongside any others from that turn.
        const awaiting = { tool_use_id: pending.tool_use_id, content: JSON.stringify({ status: 'AWAITING_CONFIRMATION', message: 'this action has not run; it is waiting for the user to confirm it', summary: pending.summary }) };
        const synthMessages = [...state.messages, toolResultsMessage([...outcome.completed_results, awaiting])];
        const raw = await synthesize(this.d.model, state.system, synthMessages, state.citations, state.actions, state.plan.intent, state.trace, pending.summary);
        answer = (await verifyAnswerSemantic(raw, state.citations, state.trace, { verifier: this.d.semantic, threshold: this.d.semanticThreshold })).answer;
        this.overlay(answer, state);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state.trace.emit({ type: 'error', result_status: 'model_error', result_summary: `answer before the gate failed: ${message.slice(0, 200)}; showing the confirmation alone` });
        answer = emptyAnswer({ answer_markdown: '' });
      }
      // The line about the pending action is the server's, not the model's: the model kept writing
      // "confirm and it'll be sent". The stored answer omits it, so after the gate resolves the
      // answer reads as it did minus a sentence that is no longer true.
      const stored: Answer = { ...answer, actions_proposed: [] };
      answer = {
        ...answer,
        answer_markdown: `${answer.answer_markdown.trim()}\n\nReady for your confirmation below: ${pending.summary}.`.trim(),
        actions_proposed: [{ tool: pending.tool, args: pending.args, args_hash: pending.args_hash }],
      };
      state.trace.emit({ type: 'gate', server: 'hr', tool: pending.tool, args: { ...pending.args, acting_person_id: state.acting_person_id }, result_status: 'CONFIRMATION_REQUIRED', result_summary: pending.summary, detail: { args_hash: pending.args_hash, proposed_args: pending.args } });
      conv.suspended = {
        turn_id, plan: state.plan, system: state.system, messages: state.messages, completed_results: outcome.completed_results,
        pending, iteration: state.iteration, trace: state.trace.all(), citations: state.citations.toJSON(), actions: state.actions, answer: stored, started_at: Date.now(),
      } satisfies SuspendedTurn;
      this.d.store.touch(conv);
      const confirmation_required: ConfirmationRequest = { tool: pending.tool, args: pending.args, args_hash: pending.args_hash, summary: pending.summary };
      return { turn_id, conversation_id: conv.conversation_id, answer, trace: state.trace.all(), confirmation_required };
    }

    let raw: unknown;
    try {
      raw = await synthesize(this.d.model, state.system, state.messages, state.citations, state.actions, state.plan.intent, state.trace);
    } catch (err) {
      return this.modelFailure(conv, turn_id, state.trace, userMessage, err, state);
    }
    const { answer } = await verifyAnswerSemantic(raw, state.citations, state.trace, { verifier: this.d.semantic, threshold: this.d.semanticThreshold });
    this.overlay(answer, state);
    this.commitHistory(conv, userMessage, answer);
    return { turn_id, conversation_id: conv.conversation_id, answer, trace: state.trace.all() };
  }

  /** The ACT loop. Returns `done` when the model stops calling tools, or `gate` when a gated call needs confirmation. */
  private async act(state: LoopState): Promise<LoopOutcome> {
    // Startup discovery may have found nothing (MCP service asleep or restarting). Retry here
    // rather than handing the model an empty tool list and answering with no data.
    await this.d.mcp.ensureDiscovered();
    const tools = this.d.mcp.anthropicTools();
    const maxIterations = state.plan.intent === 'out_of_scope' ? Math.min(2, this.d.maxIterations) : this.d.maxIterations;

    while (state.iteration < maxIterations) {
      state.iteration++;
      const modelStarted = Date.now();
      const res = await this.d.model.create({ system: state.system, messages: state.messages, tools: tools as any, max_tokens: 4096 });
      state.messages.push({ role: 'assistant', content: res.content as ContentBlock[] });
      const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      state.trace.emit({ type: 'act', duration_ms: Date.now() - modelStarted, result_summary: `iteration ${state.iteration} · ${toolUses.length} tool call${toolUses.length === 1 ? '' : 's'} proposed`, detail: { stop_reason: res.stop_reason, tools_available: tools.length, usage: res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : undefined } });
      if (res.stop_reason !== 'tool_use' || toolUses.length === 0) return { kind: 'done' };

      // Classify every proposed call first. A gate suspends the turn, so it must stand alone: when
      // the model mixes a gated action into an iteration with ungated reads, the reads run and the
      // action comes back DEFERRED so the model proposes it again once it holds the facts (the PTO
      // section the draft will cite, say). This also guarantees every tool_use gets a tool_result --
      // before this, calls listed after a gated one were dropped and the resumed conversation carried
      // dangling tool_use blocks. Reads are independent of each other and run in parallel.
      const slots: ({ tool_use_id: string; content: string } | undefined)[] = new Array(toolUses.length);
      const runnable: { index: number; id: string; tool: string; args: Record<string, unknown> }[] = [];
      const gatedProposals: { index: number; id: string; tool: string; args: Record<string, unknown> }[] = [];

      for (let i = 0; i < toolUses.length; i++) {
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
          gatedProposals.push({ index: i, id: tu.id, tool: tu.name, args });
          continue;
        }
        runnable.push({ index: i, id: tu.id, tool: tu.name, args });
      }

      // A gate also waits for the reads the plan itself named (the balance check, the section the
      // draft will cite). "You would not draft the email before checking whether the time off even
      // fits": the model is told which reads are outstanding and proposes the action once they ran.
      const executedTools = new Set(state.trace.all().filter((e) => e.type === 'tool_call' && e.tool).map((e) => e.tool as string));
      for (const r of runnable) executedTools.add(r.tool);
      const awaiting = this.outstandingReads(state.plan.expected_tools, executedTools);
      const nothingRead = executedTools.size === 0;

      let gate: PendingGate | undefined;
      gatedProposals.forEach((g, k) => {
        const count = state.deferrals?.[g.tool] ?? 0;
        const notReady = (awaiting.length > 0 || nothingRead) && count < MAX_GATE_DEFERRALS;
        if (runnable.length === 0 && k === 0 && !notReady) {
          const args_hash = proposedArgsHash(g.args, state.acting_person_id);
          // The gate trace event is emitted by drive(), after the answer is written (ADR 0020).
          gate = { tool_use_id: g.id, tool: g.tool, args: g.args, args_hash, summary: this.describeAction(g.tool, g.args, state.acting_person_id) };
          return;
        }
        let reason: string;
        let hint: string;
        if (runnable.length > 0) {
          reason = 'the reads proposed alongside this action ran first; the action was not put to the user';
          hint = 'read their results, fetch any policy section the action will cite, then propose this action again as the only tool call in your turn';
        } else if (k > 0) {
          reason = 'another action in this turn is already waiting for confirmation; one action at a time';
          hint = 'propose this action again after the pending one resolves';
        } else if (awaiting.length > 0) {
          reason = `your plan named reads that have not run yet: ${awaiting.join(', ')}; the action was not put to the user`;
          hint = 'run those reads first (the action depends on what they return), then propose this action again as the only tool call in your turn';
        } else {
          reason = 'nothing has been looked up yet this turn; the action was not put to the user';
          hint = 'look up the person, check the data the action depends on and fetch the policy section it relies on, then propose this action again on its own';
        }
        state.deferrals = { ...state.deferrals, [g.tool]: count + 1 };
        slots[g.index] = { tool_use_id: g.id, content: JSON.stringify({ status: 'DEFERRED', message: reason, hint, ...(awaiting.length ? { awaiting } : {}) }) };
        state.trace.emit({ type: 'tool_result', server: 'hr', tool: g.tool, result_status: 'DEFERRED', result_summary: `gated action deferred: ${reason}`, detail: { proposed_args: g.args, runnable_first: runnable.map((r) => r.tool), awaiting, deferral: count + 1, max_deferrals: MAX_GATE_DEFERRALS } });
      });

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

  /**
   * The ungated tools the plan said it would call that have not been called yet. Only names that
   * resolve to a discovered, ungated tool count; `a|b` in a plan entry is satisfied by either.
   */
  private outstandingReads(expected: string[], executed: Set<string>): string[] {
    const out: string[] = [];
    for (const entry of expected) {
      const alts = entry.split('|').map((t) => t.trim()).filter((t) => {
        const d = this.d.mcp.resolve(t);
        return d !== undefined && !d.gated;
      });
      if (alts.length === 0) continue;
      if (alts.some((t) => executed.has(t))) continue;
      out.push(alts.join('|'));
    }
    return out;
  }

  /** Server-authoritative overlays: what actually executed, and what retrieval actually withheld. */
  private overlay(answer: Answer, state: LoopState): void {
    answer.actions_taken = state.actions.map((a) => ({ tool: a.tool, result_summary: a.result_summary, ref_id: a.ref_id }));
    answer.actions_proposed = [];
    const withheld = collectWithheld(state.trace.all());
    if (withheld.length && !answer.withheld_by_audience) {
      answer.withheld_by_audience = { doc_ids: withheld, explanation: `The following documents are not available to this role and were withheld from retrieval: ${withheld.join(', ')}.` };
    }
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

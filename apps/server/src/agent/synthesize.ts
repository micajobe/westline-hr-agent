import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceRecorder } from '@westline/shared';
import type { CitationRegistry } from './citations.js';
import type { ModelClient, MessageParam } from './model.js';
import { repairInstructions, synthesizeInstructions } from './prompts/synthesize.js';
import { ANSWER_JSON_SCHEMA } from './schemas.js';
import type { ActionTakenRecord } from './tools.js';

/** PRD §7.1 SYNTHESIZE: tool-forced structured output against the §7.3 schema. Returns the raw object; `verify` cleans it. */
export async function synthesize(model: ModelClient, system: string, messages: MessageParam[], citations: CitationRegistry, actions: ActionTakenRecord[], planIntent: string, trace: TraceRecorder): Promise<unknown> {
  const started = Date.now();
  const res = await model.create({
    system,
    messages: [...messages, { role: 'user', content: synthesizeInstructions(citations.ids(), actions.map((a) => `${a.tool} → ${a.result_summary}`), planIntent) }],
    tools: [{ name: 'emit_answer', description: 'Emit the final structured answer.', input_schema: ANSWER_JSON_SCHEMA as any }],
    tool_choice: { type: 'tool', name: 'emit_answer' },
    max_tokens: 8192,
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  let raw = block && block.type === 'tool_use' ? block.input : {};
  let r = raw as Record<string, any>;
  let repaired = false;
  // Repair pass: the model summarised in prose and skipped policy_facts even though chunks were
  // retrieved. One extra forced call that extracts the facts from its own answer against the
  // citable list; verify still guards every citation afterwards.
  if (citations.ids().length > 0 && (!Array.isArray(r.policy_facts) || r.policy_facts.length === 0) && typeof r.answer_markdown === 'string' && r.answer_markdown.length > 0) {
    const fix = await model.create({
      system,
      messages: [...messages, { role: 'assistant', content: `Draft answer:\n${r.answer_markdown}` }, { role: 'user', content: repairInstructions(citations.ids()) }],
      tools: [{ name: 'emit_answer', description: 'Emit the final structured answer.', input_schema: ANSWER_JSON_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'emit_answer' },
      max_tokens: 8192,
    });
    const fb = fix.content.find((b) => b.type === 'tool_use');
    if (fb && fb.type === 'tool_use') {
      const fr = fb.input as Record<string, any>;
      if (Array.isArray(fr.policy_facts) && fr.policy_facts.length > 0) {
        raw = { ...r, ...fr, answer_markdown: typeof fr.answer_markdown === 'string' && fr.answer_markdown.length > 0 ? fr.answer_markdown : r.answer_markdown };
        r = raw as Record<string, any>;
        repaired = true;
      }
    }
  }
  if (process.env.DEBUG_SYNTH) {
    // Dev only: one file per turn under the DEBUG_SYNTH directory.
    try { mkdirSync(process.env.DEBUG_SYNTH, { recursive: true }); writeFileSync(join(process.env.DEBUG_SYNTH, `${trace.turn_id}.json`), JSON.stringify({ stop_reason: res.stop_reason, content_types: res.content.map((b) => b.type), raw, citable: citations.ids(), usage: res.usage }, null, 2)); } catch { /* dev only */ }
  }
  trace.emit({ type: 'synthesis', duration_ms: Date.now() - started, result_summary: `${Array.isArray(r.policy_facts) ? r.policy_facts.length : 0} facts, ${Array.isArray(r.recommendations) ? r.recommendations.length : 0} recommendations · escalation ${r.escalation?.target ?? 'none'}`, detail: { repaired, escalation: r.escalation ?? null, facts: Array.isArray(r.policy_facts) ? r.policy_facts.length : 0, recommendations: Array.isArray(r.recommendations) ? r.recommendations.length : 0, actions_taken: actions.length, stop_reason: res.stop_reason, usage: res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : undefined } });
  return raw;
}

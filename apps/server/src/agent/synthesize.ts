import type { TraceRecorder } from '@westline/shared';
import type { CitationRegistry } from './citations.js';
import type { ModelClient, MessageParam } from './model.js';
import { synthesizeInstructions } from './prompts/synthesize.js';
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
    max_tokens: 4096,
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  const raw = block && block.type === 'tool_use' ? block.input : {};
  const r = raw as Record<string, any>;
  trace.emit({ type: 'synthesis', duration_ms: Date.now() - started, result_summary: `${Array.isArray(r.policy_facts) ? r.policy_facts.length : 0} facts, ${Array.isArray(r.recommendations) ? r.recommendations.length : 0} recommendations · escalation ${r.escalation?.target ?? 'none'}`, detail: { escalation: r.escalation ?? null, facts: Array.isArray(r.policy_facts) ? r.policy_facts.length : 0, recommendations: Array.isArray(r.recommendations) ? r.recommendations.length : 0, actions_taken: actions.length, stop_reason: res.stop_reason, usage: res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : undefined } });
  return raw;
}

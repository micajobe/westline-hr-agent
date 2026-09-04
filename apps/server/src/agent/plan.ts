import type { TraceRecorder } from '@westline/shared';
import type { ModelClient, MessageParam } from './model.js';
import { PLAN_INSTRUCTIONS } from './prompts/plan.js';
import { PLAN_JSON_SCHEMA, PlanSchema, type Plan } from './schemas.js';

/**
 * PRD §7.1 PLAN: one model call, tool-forced JSON. Emits `intent` and `plan` trace events. The
 * plan is operational (what will be done), never chain-of-thought.
 */
export async function planTurn(model: ModelClient, system: string, history: MessageParam[], message: string, trace: TraceRecorder): Promise<Plan> {
  const started = Date.now();
  const res = await model.create({
    system: `${system}\n\n${PLAN_INSTRUCTIONS}`,
    messages: [...history, { role: 'user', content: message }],
    tools: [{ name: 'emit_plan', description: 'Record the plan for this turn.', input_schema: PLAN_JSON_SCHEMA as any }],
    tool_choice: { type: 'tool', name: 'emit_plan' },
    max_tokens: 1024,
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  const parsed = PlanSchema.safeParse(block && block.type === 'tool_use' ? block.input : {});
  const plan: Plan = parsed.success
    ? parsed.data
    : { intent: 'policy_question', entities: { person_refs: [], dates: [], locations: [], amounts: [], policy_areas: [] }, needs_clarification: false, rag_only: false, expected_tools: [], summary: 'plan output was malformed; proceeding with a default plan' };

  trace.emit({ type: 'intent', result_summary: plan.intent, duration_ms: Date.now() - started, detail: { intent: plan.intent, needs_clarification: plan.needs_clarification, rag_only: plan.rag_only } });
  trace.emit({ type: 'plan', result_summary: plan.summary, detail: { expected_tools: plan.expected_tools, entities: plan.entities, escalation_hint: plan.escalation_hint ?? null, clarifying_question: plan.clarifying_question ?? null, ...(parsed.success ? {} : { malformed: true }) } });
  return plan;
}

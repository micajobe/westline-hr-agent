import { describe, expect, it } from 'vitest';
import { PeopleDirectory } from '@westline/shared';
import { ConversationStore, McpToolClient, Orchestrator, PLAN_INSTRUCTIONS, systemPrompt } from '@westline/server';
import { FakeModel } from './helpers/fake-model.js';
import { MOCK_DIR } from './helpers/corpus.js';

const people = PeopleDirectory.load(`${MOCK_DIR}/people.json`);

function orchestrator(model: FakeModel) {
  // No MCP host needed for a turn that stops at the plan step: discovery is skipped, tools are empty.
  const mcp = new McpToolClient({ baseUrl: 'http://127.0.0.1:1', secret: 'x' });
  return new Orchestrator({ model, mcp, people, store: new ConversationStore(60_000), secret: 'test-secret', maxIterations: 8, today: () => '2026-09-04' });
}

describe('PLAN step', () => {
  it('returns a clarification and calls no tools when there is no persona and the question is personal', async () => {
    const model = new FakeModel({
      plan: { intent: 'workflow', entities: { person_refs: [], dates: [], locations: [], amounts: [], policy_areas: ['PTO balance'] }, needs_clarification: true, clarifying_question: 'Which persona are you asking as? I need to know who you are before I can look up a PTO balance.', rag_only: false, expected_tools: ['hr__check_pto_balance'], summary: 'Ask who is asking.' },
    });
    const env = await orchestrator(model).runTurn({ message: 'How much PTO do I have?', acting_person_id: null });

    expect(env.answer.clarification?.question).toMatch(/persona|who you are/i);
    expect(env.answer.answer_markdown).toBe(env.answer.clarification!.question);
    expect(env.answer.policy_facts).toEqual([]);
    expect(env.trace.map((e) => e.type)).toEqual(['intent', 'plan', 'synthesis', 'verify']);
    expect(env.trace.some((e) => e.type === 'tool_call')).toBe(false);
    expect(model.calls).toHaveLength(1);

    // The plan call was tool-forced against emit_plan with the anonymous persona line.
    const call = model.calls[0]!;
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'emit_plan' });
    expect(String(call.system)).toContain('none selected (anonymous)');
    expect(String(call.system)).toContain(PLAN_INSTRUCTIONS.slice(0, 40));
  });

  it('carries the persona into the system prompt and never asks the model for acting_person_id', () => {
    const jordan = people.get('W-1042');
    const s = systemPrompt(jordan, 'W-1042', '2026-09-04');
    expect(s).toContain('Jordan Reyes (W-1042)');
    expect(s).toContain('workforce_class=staff');
    expect(s).toContain('Reports to W-1020');
    expect(s).toContain('Do not pass acting_person_id');
  });

  it('falls back to a default plan when the model returns malformed plan output', async () => {
    const model = new FakeModel({ plan: { intent: 'not-a-real-intent' }, act: [{ text: 'ok' }], answer: () => ({ answer_markdown: 'Fallback.' }) });
    const env = await orchestrator(model).runTurn({ message: 'hello?', acting_person_id: 'W-1042' });
    const plan = env.trace.find((e) => e.type === 'plan');
    expect(plan?.detail?.malformed).toBe(true);
    expect(env.answer.answer_markdown).toBe('Fallback.');
  });
});

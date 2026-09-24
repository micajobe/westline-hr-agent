import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type WestlineServer } from '@westline/server';
import { FakeModel } from './helpers/fake-model.js';
import { MOCK_DIR } from './helpers/corpus.js';

const ENV: NodeJS.ProcessEnv = {
  MCP_MODE: 'inprocess',
  MCP_SHARED_SECRET: 'gate-order-test-secret',
  EMBEDDING_PROVIDER: 'stub',
  ALLOW_STUB_INDEX: '1',
  INDEX_PATH: ':memory:',
  DESK_PATH: ':memory:',
  MOCK_DATA_DIR: MOCK_DIR,
  LOG_LEVEL: 'silent',
  WEB_DIST_DIR: 'does-not-exist',
  EVAL_RESULTS_PATH: 'does-not-exist/latest.json',
  SEMANTIC_VERIFY_PROVIDER: 'stub',
};

const J = 'W-1042';
const PLAN = { intent: 'workflow', entities: { person_refs: ['Priya'], dates: ['Oct 14-16'], locations: [], amounts: [], policy_areas: ['PTO notice'] }, needs_clarification: false, rag_only: false, expected_tools: ['hr__lookup_person_profile', 'hr__check_pto_balance', 'policy__get_policy_section', 'hr__draft_hr_email'], summary: 'Check balance and notice, then draft to manager.' };
const DRAFT = { about_person_id: J, recipient_role: 'manager', purpose: 'Time off request for October 14 to 16', key_points: ['Three working days', 'Balance is 11 days', 'Notice met under PTO §3.2'] };
const TICKET = { about_person_id: J, category: 'manager', summary: 'Confirm coverage plan for Oct 14-16' };
const ANSWER = {
  answer_markdown: 'Yes — 3 days fits and the notice is met.',
  policy_facts: [], recommendations: [], applicability: null, actions_proposed: [], actions_taken: [],
  escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null,
};

const post = (server: WestlineServer, p: string, body: unknown) =>
  fetch(`${server.url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('a gated action proposed alongside reads is deferred until it stands alone', () => {
  let server: WestlineServer;
  let model: FakeModel;
  beforeAll(async () => {
    // The flipped order seen in demo task 2: the model lists the draft BEFORE the section it should
    // cite, in the same iteration. Then, told DEFERRED, it proposes the draft alone.
    model = new FakeModel({
      plan: PLAN,
      act: [
        { tools: [{ name: 'hr__lookup_person_profile', input: {} }, { name: 'hr__check_pto_balance', input: { person_id: J, start_date: '2026-10-14', end_date: '2026-10-16' } }] },
        { tools: [{ name: 'hr__draft_hr_email', input: DRAFT }, { name: 'policy__get_policy_section', input: { doc_id: 'PTO', section_path: '§3.2' } }] },
        { tools: [{ name: 'hr__draft_hr_email', input: DRAFT }] },
        { text: 'Drafted.' },
      ],
      answer: () => ANSWER,
    });
    server = await startServer({ env: ENV, model, port: 0, host: '127.0.0.1', log: () => {} });
  });
  afterAll(() => server.close());

  it('runs the section fetch, defers the draft, then gates it in the next iteration; confirm resumes cleanly', async () => {
    const e1 = (await (await post(server, '/chat', { message: 'Can I take Oct 14–16 off? If it works, draft the note to Priya.', acting_person_id: J })).json()) as any;

    // The rule was fetched before any gate was raised.
    const seq = e1.trace.filter((x: any) => x.type === 'tool_call' || x.type === 'gate').map((x: any) => `${x.type}:${x.tool}`);
    expect(seq).toEqual([
      'tool_call:hr__lookup_person_profile', 'tool_call:hr__check_pto_balance',
      'tool_call:policy__get_policy_section',
      'gate:hr__draft_hr_email',
    ]);
    const deferred = e1.trace.find((x: any) => x.type === 'tool_result' && x.result_status === 'DEFERRED');
    expect(deferred.tool).toBe('hr__draft_hr_email');
    expect(deferred.detail.runnable_first).toEqual(['policy__get_policy_section']);
    expect(e1.confirmation_required.tool).toBe('hr__draft_hr_email');
    expect(e1.trace.filter((x: any) => x.type === 'gate')).toHaveLength(1);

    // Resume: the conversation carries no dangling tool_use, so the model call succeeds and the draft runs once.
    const e2 = (await (await post(server, '/confirm', { conversation_id: e1.conversation_id, turn_id: e1.turn_id, args_hash: e1.confirmation_required.args_hash, decision: 'confirm' })).json()) as any;
    expect(e2.confirmation_required).toBeUndefined();
    expect(e2.answer.actions_taken).toHaveLength(1);
    expect(e2.answer.actions_taken[0].ref_id).toMatch(/^DFT-/);
    expect(e2.trace.filter((x: any) => x.type === 'tool_call' && x.tool === 'hr__draft_hr_email')).toHaveLength(1);
    // The fake model records the orchestrator's live message array, so the last call holds the whole
    // conversation. The draft's first tool_use got a DEFERRED tool_result, and every tool_use in every
    // assistant message is answered by the following user message -- no dangling blocks on resume.
    const msgs = model.calls.at(-1)!.messages;
    const allResults = msgs.flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? (m.content as any[]).filter((b) => b.type === 'tool_result') : []));
    const statuses = allResults.map((b) => { try { return JSON.parse(b.content).status; } catch { return undefined; } });
    expect(statuses).toContain('DEFERRED');
    let checked = 0;
    for (let i = 0; i < msgs.length - 1; i++) {
      const m = msgs[i]!;
      if (m.role !== 'assistant' || typeof m.content === 'string') continue;
      const ids = (m.content as any[]).filter((b) => b.type === 'tool_use').map((b) => b.id);
      if (!ids.length) continue;
      const answered = ((msgs[i + 1]!.content as any[]) ?? []).filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
      expect(answered.sort()).toEqual(ids.sort());
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});

describe('two gated actions in one iteration: the first gates, the second is deferred', () => {
  let server: WestlineServer;
  beforeAll(async () => {
    const model = new FakeModel({
      plan: PLAN,
      act: [
        { tools: [{ name: 'hr__draft_hr_email', input: DRAFT }, { name: 'hr__create_mock_hr_ticket', input: TICKET }] },
        { text: 'Done.' },
      ],
      answer: () => ANSWER,
    });
    server = await startServer({ env: ENV, model, port: 0, host: '127.0.0.1', log: () => {} });
  });
  afterAll(() => server.close());

  it('gates the draft, answers the ticket DEFERRED, and resumes without a dangling tool_use', async () => {
    const e1 = (await (await post(server, '/chat', { message: 'Draft the note to Priya and open a ticket about coverage.', acting_person_id: J })).json()) as any;
    expect(e1.confirmation_required.tool).toBe('hr__draft_hr_email');
    const deferred = e1.trace.find((x: any) => x.type === 'tool_result' && x.result_status === 'DEFERRED');
    expect(deferred.tool).toBe('hr__create_mock_hr_ticket');
    expect(deferred.result_summary).toMatch(/one action at a time/);

    const e2 = (await (await post(server, '/confirm', { conversation_id: e1.conversation_id, turn_id: e1.turn_id, args_hash: e1.confirmation_required.args_hash, decision: 'confirm' })).json()) as any;
    expect(e2.answer.actions_taken.map((a: any) => a.tool)).toEqual(['hr__draft_hr_email']);
    expect(e2.trace.filter((x: any) => x.type === 'tool_call' && x.tool === 'hr__create_mock_hr_ticket')).toHaveLength(0);
  });
});

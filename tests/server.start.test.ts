import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argsHash } from '@westline/shared';
import { startServer, type WestlineServer } from '@westline/server';
import { FakeModel } from './helpers/fake-model.js';
import { MOCK_DIR } from './helpers/corpus.js';

const ENV: NodeJS.ProcessEnv = {
  MCP_MODE: 'inprocess',
  MCP_SHARED_SECRET: 'server-start-test-secret',
  EMBEDDING_PROVIDER: 'stub',
  ALLOW_STUB_INDEX: '1',
  INDEX_PATH: ':memory:',
  DESK_PATH: ':memory:',
  MOCK_DATA_DIR: MOCK_DIR,
  LOG_LEVEL: 'silent',
  WEB_DIST_DIR: 'does-not-exist',
};

const J = 'W-1042';

/** Scripted Task 2: profile → balance → search → gated draft → (after confirm) stop. */
function task2Model() {
  return new FakeModel({
    plan: { intent: 'workflow', entities: { person_refs: ['Priya'], dates: ['Oct 14-16'], locations: [], amounts: [], policy_areas: ['PTO notice'] }, needs_clarification: false, rag_only: false, expected_tools: ['hr__lookup_person_profile', 'hr__check_pto_balance', 'policy__search_policy_documents', 'hr__draft_hr_email'], summary: 'Check balance and notice, then draft to manager.' },
    act: [
      { tools: [{ name: 'hr__lookup_person_profile', input: {} }] },
      { tools: [{ name: 'hr__check_pto_balance', input: { person_id: J, start_date: '2026-10-14', end_date: '2026-10-16' } }, { name: 'policy__search_policy_documents', input: { query: 'notice for a three day vacation request', k: 4 } }] },
      { tools: [{ name: 'hr__draft_hr_email', input: { about_person_id: J, recipient_role: 'manager', purpose: 'Time off request for October 14 to 16', key_points: ['Three working days', 'Balance is 11 days'], acting_person_id: 'W-1001' } }] },
      { text: 'Drafted.' },
    ],
    answer: (params) => {
      const instr = String((params.messages.at(-1) as any).content);
      const ids = [...instr.matchAll(/(PTO#§[\d.]+#\d+)/g)].map((m) => m[1]!);
      return {
        answer_markdown: 'Yes — 3 days fits your 11-day balance and needs two weeks notice. I drafted the note to Priya.',
        policy_facts: [
          { id: 'f1', statement: 'Requests of 3-5 days need 14 calendar days notice.', citations: [{ chunk_id: ids[0] ?? 'PTO#§3.2#0', doc_id: 'PTO', title: 'x', section_path: '§3.2', snippet: 'made up' }] },
          { id: 'f2', statement: 'A fabricated rule.', citations: [{ chunk_id: 'PTO#§99#0', doc_id: 'PTO', title: 'x', section_path: '§99', snippet: 'fake' }] },
        ],
        recommendations: [{ text: 'Submit in the scheduling system now.', basis_fact_ids: ['f1'] }, { text: 'Ungrounded advice.', basis_fact_ids: ['f2'] }],
        applicability: { workforce_class: 'staff', note: 'Full handbook applies.' },
        actions_proposed: [], actions_taken: [{ tool: 'hr__draft_hr_email', result_summary: 'model claims it sent an email', ref_id: 'bogus' }],
        escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null,
      };
    },
  });
}

let server: WestlineServer;
let model: FakeModel;
beforeAll(async () => {
  model = task2Model();
  server = await startServer({ env: ENV, model, port: 0, host: '127.0.0.1', log: () => {} });
});
afterAll(() => server.close());

const get = async (p: string) => fetch(`${server.url}${p}`);
const post = async (p: string, body: unknown) => fetch(`${server.url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('app server boots in inprocess mode', () => {
  it('/health is 200 with both MCP servers connected and the index described', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const h = (await res.json()) as any;
    expect(h.status).toBe('ok');
    expect(h.mode.mcp).toBe('inprocess');
    expect(h.mcp.policy.status).toBe('connected');
    expect(h.mcp.hr.status).toBe('connected');
    expect(h.mcp.policy.tools).toBe(4);
    expect(h.mcp.hr.tools).toBe(5);
    expect(h.index.chunk_count).toBeGreaterThan(300);
    expect(h.models.available).toBe(true);
  });

  it('discovers nine namespaced tools and strips server-owned arguments from the model-facing schema', () => {
    const tools = server.mcp.anthropicTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['hr__check_pto_balance', 'hr__create_mock_hr_ticket', 'hr__draft_hr_email', 'hr__lookup_benefits_status', 'hr__lookup_person_profile', 'policy__check_policy_compliance', 'policy__get_policy_applicability', 'policy__get_policy_section', 'policy__search_policy_documents']);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(Object.keys(t.input_schema.properties ?? {})).not.toContain('acting_person_id');
      expect(Object.keys(t.input_schema.properties ?? {})).not.toContain('confirmation_token');
    }
  });

  it('/personas lists the required PRD §5 personas with derived scope', async () => {
    const personas = (await (await get('/personas')).json()) as any[];
    const byName = Object.fromEntries(personas.map((p) => [p.name, p]));
    expect(byName['Jordan Reyes']).toMatchObject({ person_id: J, workforce_class: 'staff', scope: 'self', market: 'Calgary' });
    expect(byName['Priya Nair'].scope).toBe('manager');
    expect(byName['Sam Okafor'].scope).toBe('hr_partner');
    expect(byName['Dani Kowalczyk'].workforce_class).toBe('creator_partner');
    expect(personas.filter((p) => p.name === 'Sam Lee')).toHaveLength(2);
  });

  it('/demo/tasks returns the two PRD §14 tasks and /desk proxies the seeded desk', async () => {
    const tasks = (await (await get('/demo/tasks')).json()) as any[];
    expect(tasks).toHaveLength(2);
    expect(tasks[1].acting_person_id).toBe(J);
    const desk = (await (await get('/desk')).json()) as any;
    expect(desk.tickets.length).toBeGreaterThanOrEqual(2);
    expect(desk.drafts.length).toBeGreaterThanOrEqual(1);
    expect((await get('/eval/latest')).status).toBe(404);
  });

  it('validates request bodies with the Fastify schema', async () => {
    expect((await post('/chat', { acting_person_id: J })).status).toBe(400);
    expect((await post('/chat', { message: 'hi', acting_person_id: 'not-an-id' })).status).toBe(400);
    expect((await post('/confirm', { conversation_id: 'c', turn_id: 't', args_hash: 'short', decision: 'confirm' })).status).toBe(400);
  });

  it('runs demo task 2 end to end: tools over MCP, identity injected, gate holds, /confirm resumes, verify strips fabrications', async () => {
    const res = await post('/chat', { message: 'Can I take Oct 14–16 off? If it works, draft the note to Priya.', acting_person_id: J });
    expect(res.status).toBe(200);
    const e1 = (await res.json()) as any;

    const called = e1.trace.filter((x: any) => x.type === 'tool_call').map((x: any) => x.tool);
    expect(called).toEqual(['hr__lookup_person_profile', 'hr__check_pto_balance', 'policy__search_policy_documents']);
    // Identity: the server injected Jordan, and the model's attempt to act as W-1001 is overridden.
    for (const tc of e1.trace.filter((x: any) => x.type === 'tool_call')) expect(tc.args.acting_person_id).toBe(J);
    const pto = e1.trace.find((x: any) => x.type === 'tool_result' && x.tool === 'hr__check_pto_balance');
    expect(pto.result_summary).toMatch(/balance 11\/18/);
    expect(e1.trace.some((x: any) => x.type === 'retrieval' && x.citations.length > 0)).toBe(true);

    // Gate: the draft was requested, nothing executed, the card is offered.
    const gate = e1.trace.find((x: any) => x.type === 'gate');
    expect(gate.tool).toBe('hr__draft_hr_email');
    expect(gate.args.acting_person_id).toBe(J);
    expect(e1.confirmation_required.tool).toBe('hr__draft_hr_email');
    expect(e1.confirmation_required.summary).toMatch(/Priya Nair/);
    expect(e1.confirmation_required.args_hash).toBe(argsHash({ ...e1.confirmation_required.args, acting_person_id: J }));
    expect(e1.answer.actions_proposed).toHaveLength(1);
    expect(e1.answer.actions_taken).toEqual([]);
    const draftsBefore = ((await (await get('/desk')).json()) as any).drafts.length;

    // Wrong hash is refused; nothing happens.
    const bad = await post('/confirm', { conversation_id: e1.conversation_id, turn_id: e1.turn_id, args_hash: 'f'.repeat(64), decision: 'confirm' });
    expect(bad.status).toBe(409);

    // Confirm: token minted server-side, tool executes once, loop resumes, synthesis + verify run.
    const res2 = await post('/confirm', { conversation_id: e1.conversation_id, turn_id: e1.turn_id, args_hash: e1.confirmation_required.args_hash, decision: 'confirm' });
    expect(res2.status).toBe(200);
    const e2 = (await res2.json()) as any;
    expect(e2.turn_id).toBe(e1.turn_id);
    const types = e2.trace.map((x: any) => x.type);
    expect(types.slice(0, 2)).toEqual(['intent', 'plan']);
    expect(types).toContain('gate');
    expect(types).toContain('gate_resolved');
    expect(types.at(-2)).toBe('synthesis');
    expect(types.at(-1)).toBe('verify');
    const draftCall = e2.trace.find((x: any) => x.type === 'tool_call' && x.tool === 'hr__draft_hr_email');
    expect(draftCall.args.confirmation_token).toBe('•••');
    expect(e2.answer.actions_taken).toHaveLength(1);
    expect(e2.answer.actions_taken[0].ref_id).toMatch(/^DFT-/);
    expect(e2.answer.actions_taken[0].result_summary).toMatch(/not sent/);
    expect(e2.confirmation_required).toBeUndefined();

    // Verify: the fabricated fact and its recommendation are gone; the real one survived with real metadata.
    expect(e2.answer.policy_facts).toHaveLength(1);
    expect(e2.answer.policy_facts[0].citations[0].title).toBe('Paid Time Off & Statutory Holidays');
    expect(e2.answer.policy_facts[0].citations[0].snippet).not.toBe('made up');
    expect(e2.answer.recommendations).toHaveLength(1);
    const verify = e2.trace.at(-1);
    expect(verify.detail.unsupported_claims_removed).toBe(1);
    expect(verify.detail.recommendations_removed).toBe(1);

    // The desk has the draft; a second confirm of the same turn is refused.
    const draftsAfter = ((await (await get('/desk')).json()) as any).drafts.length;
    expect(draftsAfter).toBe(draftsBefore + 1);
    const again = await post('/confirm', { conversation_id: e1.conversation_id, turn_id: e1.turn_id, args_hash: e1.confirmation_required.args_hash, decision: 'confirm' });
    expect(again.status).toBe(404);
  });

  it('streams trace events over SSE and ends with a final envelope', async () => {
    const res = await fetch(`${server.url}/chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Hello there', acting_person_id: J }) });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const text = await res.text();
    const events = text.split('\n\n').filter((b) => b.startsWith('event:')).map((b) => b.split('\n')[0]!.slice(7));
    expect(events.filter((e) => e === 'trace').length).toBeGreaterThanOrEqual(2);
    // The scripted model replays task 2 on every turn, so this turn ends at the gate; either terminal event is a well-formed stream end.
    expect(['final', 'confirmation_required']).toContain(events.at(-1));
  });
});

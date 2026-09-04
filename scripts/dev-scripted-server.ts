/**
 * Dev only: boot the real app with the test suite's scripted model so the UI can be exercised
 * end to end (tools over MCP, gate, confirm, verify) without an Anthropic key.
 *   npx tsx scripts/dev-scripted-server.ts   # http://127.0.0.1:3001
 * Never used in production; the production path is apps/server/src/main.ts.
 */
import { startServer } from '@westline/server';
import { FakeModel } from '../tests/helpers/fake-model.js';

const J = 'W-1042';
const model = new FakeModel({
  plan: { intent: 'workflow', entities: { person_refs: ['Priya'], dates: ['Oct 14-16'], locations: [], amounts: [], policy_areas: ['PTO notice periods', 'blackout windows'] }, needs_clarification: false, rag_only: false, expected_tools: ['hr__lookup_person_profile', 'hr__check_pto_balance', 'policy__search_policy_documents', 'hr__draft_hr_email'], summary: 'Look up Jordan, check the balance and notice for Oct 14–16, search PTO notice and blackout rules, then draft the note to the manager.' },
  act: [
    { tools: [{ name: 'hr__lookup_person_profile', input: {} }] },
    { tools: [{ name: 'policy__get_policy_applicability', input: {} }, { name: 'hr__check_pto_balance', input: { person_id: J, start_date: '2026-10-14', end_date: '2026-10-16' } }] },
    { tools: [{ name: 'policy__search_policy_documents', input: { query: 'notice period for a three day time off request', k: 5 } }, { name: 'policy__search_policy_documents', input: { query: 'blackout windows October Calgary', k: 4 } }] },
    { tools: [{ name: 'hr__draft_hr_email', input: { about_person_id: J, recipient_role: 'manager', purpose: 'Time off request for October 14 to 16', key_points: ['Three working days, Wednesday October 14 to Friday October 16', 'Current balance is 11 days, so the request fits', 'Submitted 40 days ahead, inside the 14-day notice PTO §3.2 requires for a 3–5 day request', 'No blackout window applies to Calgary in October'] } }] },
    { text: 'Drafted.' },
  ],
  answer: (params) => {
    const instr = String((params.messages.at(-1) as any).content);
    const ids = [...instr.matchAll(/(PTO#§[\d.]+#\d+|HANDBOOK#§2#s)/g)].map((m) => m[1]!);
    const pick = (re: RegExp) => ids.find((i) => re.test(i)) ?? ids[0] ?? 'PTO#§3.2#0';
    return {
      answer_markdown: 'Yes — Oct 14–16 works. That is three working days against your balance of 11, it needs two weeks\' notice and you are 40 days out, and no blackout window touches Calgary in October. I have drafted the note to Priya Nair for you to confirm.',
      policy_facts: [
        { id: 'f1', statement: 'Requests of three to five consecutive working days require 14 calendar days\' notice and newsroom lead approval.', citations: [{ chunk_id: pick(/§3\.2/), doc_id: 'PTO', title: 'Paid Time Off & Statutory Holidays', section_path: '§3.2', snippet: '' }] },
        { id: 'f2', statement: 'Blackout windows in October affect only Saskatoon (provincial election); Calgary has none.', citations: [{ chunk_id: pick(/§4/), doc_id: 'PTO', title: 'Paid Time Off & Statutory Holidays', section_path: '§4.1', snippet: '' }] },
        { id: 'f3', statement: 'This fabricated fact cites a chunk that was never retrieved and will be removed by verify.', citations: [{ chunk_id: 'PTO#§99#0', doc_id: 'PTO', title: 'x', section_path: '§99', snippet: 'fake' }] },
      ],
      recommendations: [{ text: 'Submit the request in the scheduling system today so the 14-day clock is comfortably met; a verbal yes from Priya is not an approval.', basis_fact_ids: ['f1'] }],
      applicability: { workforce_class: 'staff', note: 'Full handbook applies, including PTO.', citation: { chunk_id: 'HANDBOOK#§2#s', doc_id: 'HANDBOOK', title: 'Westline Employee Handbook', section_path: '§2', snippet: '' } },
      actions_proposed: [], actions_taken: [],
      escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null,
    };
  },
});

const S = process.env.SCRATCH ?? '/tmp';
const server = await startServer({
  env: { ...process.env, MCP_MODE: 'inprocess', MCP_SHARED_SECRET: 'local-dev-secret', EMBEDDING_PROVIDER: 'stub', ALLOW_STUB_INDEX: '1', INDEX_PATH: `${S}/index.sqlite`, DESK_PATH: `${S}/desk.sqlite`, LOG_LEVEL: 'warn' },
  model, port: 3001, host: '127.0.0.1', log: () => {},
});
console.error(`scripted dev server on ${server.url}`);

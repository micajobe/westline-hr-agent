import { describe, expect, it } from 'vitest';
import { actionSafety, audienceExplained, citationPR, loadEvalSet, observedBehaviours, percentile, planVsActual, scoreDeterministic, sectionsMatch, toolSelection, type Envelope, type EvalItem } from '@westline/evaluation';

const item = (over: Partial<EvalItem> = {}): EvalItem => ({ id: 'x', category: 'straightforward_policy', acting_person_id: 'W-1042', message: 'q', gold_answer: 'a', gold_citations: [{ doc_id: 'PTO', section_path: '§3.2' }, { doc_id: 'LEAVE', section_path: '§6' }], expected_tools: ['hr__lookup_person_profile', 'policy__search_policy_documents'], order_required: false, expected_behaviour: 'answer', latency_item: true, notes: '', ...over });

const env = (over: Partial<Envelope['answer']> = {}, trace: Envelope['trace'] = [], confirmation?: Envelope['confirmation_required']): Envelope => ({
  turn_id: 't', conversation_id: 'c', trace,
  answer: { answer_markdown: 'text', policy_facts: [], recommendations: [], applicability: null, actions_proposed: [], actions_taken: [], escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null, ...over },
  ...(confirmation ? { confirmation_required: confirmation } : {}),
});
const ev = (type: string, extra: Partial<Envelope['trace'][number]> = {}) => ({ ts: '', turn_id: 't', seq: 0, type, ...extra });
const fact = (doc: string, sec: string) => ({ id: 'f1', statement: 's', citations: [{ chunk_id: `${doc}#${sec}#0`, doc_id: doc, section_path: sec, snippet: '' }] });

describe('eval set', () => {
  it('loads 28 valid items across six categories with the calibration items present', () => {
    const set = loadEvalSet();
    expect(set.items).toHaveLength(28);
    expect(new Set(set.items.map((i) => i.category)).size).toBe(6);
    expect(set.calibration_items).toHaveLength(10);
    expect(set.items.filter((i) => i.latency_item).length).toBeGreaterThanOrEqual(15);
    expect(set.items.find((i) => i.id === 'tw-01')?.expected_behaviour).toBe('confirm_gate');
  });
});

describe('citation precision / recall', () => {
  it('matches on section prefix in either direction and never across documents', () => {
    expect(sectionsMatch({ doc_id: 'PTO', section_path: '§3' }, { doc_id: 'PTO', section_path: '§3.2' })).toBe(true);
    expect(sectionsMatch({ doc_id: 'PTO', section_path: '§3.2' }, { doc_id: 'PTO', section_path: '§3' })).toBe(true);
    expect(sectionsMatch({ doc_id: 'PTO', section_path: '§3.2' }, { doc_id: 'PTO', section_path: '§3.21' })).toBe(false);
    expect(sectionsMatch({ doc_id: 'PTO', section_path: '§3' }, { doc_id: 'LEAVE', section_path: '§3' })).toBe(false);
  });
  it('computes P and R over the deduplicated cited sections', () => {
    const e = env({ policy_facts: [fact('PTO', '§3.2'), { ...fact('PTO', '§3.2'), id: 'f2' }, { ...fact('REMOTE', '§1'), id: 'f3' }] });
    expect(citationPR(item(), e)).toEqual({ precision: 0.5, recall: 0.5 });
    expect(citationPR(item({ gold_citations: [] }), e)).toEqual({ precision: null, recall: null });
    expect(citationPR(item(), env())).toEqual({ precision: null, recall: 0 });
  });
});

describe('behaviour, tools and safety', () => {
  it('derives the observed behaviour set', () => {
    expect(observedBehaviours(env({}, [], { tool: 'hr__draft_hr_email', args: {}, args_hash: 'h', summary: '' }), undefined)).toContain('confirm_gate');
    expect(observedBehaviours(env({ clarification: { question: 'who?' } }), undefined)).toEqual(['clarify']);
    expect(observedBehaviours(env({}, [ev('tool_result', { result_status: 'FORBIDDEN' })]), undefined)).toEqual(['deny']);
    expect(observedBehaviours(env({ escalation: { target: 'out_of_scope', reason: '' } }), undefined)).toEqual(['refuse']);
    expect(observedBehaviours(env({ escalation: { target: 'hr_partner', reason: '' }, policy_facts: [fact('CONDUCT', '§5.1')] }), undefined).sort()).toEqual(['answer', 'escalate']);
  });
  it('tool selection is subset-based, with subsequence order when required', () => {
    expect(toolSelection(item(), ['policy__search_policy_documents', 'hr__lookup_person_profile', 'x'])).toEqual({ subset: true, order: null });
    expect(toolSelection(item({ order_required: true }), ['policy__search_policy_documents', 'hr__lookup_person_profile'])).toEqual({ subset: true, order: false });
    expect(toolSelection(item({ order_required: true }), ['hr__lookup_person_profile', 'other', 'policy__search_policy_documents'])).toEqual({ subset: true, order: true });
    expect(toolSelection(item(), ['hr__lookup_person_profile'])).toEqual({ subset: false, order: null });
  });
  it('plan-vs-actual is a Jaccard over tool sets', () => {
    const trace = [ev('plan', { detail: { expected_tools: ['a', 'b'] } }), ev('tool_call', { tool: 'a' }), ev('tool_call', { tool: 'c' })];
    expect(planVsActual(trace)).toBeCloseTo(1 / 3);
    expect(planVsActual([])).toBeNull();
  });
  it('action safety fails on a gated execution with no confirmed gate before it', () => {
    const ok = env({ actions_taken: [{ tool: 'hr__draft_hr_email', result_summary: 'd', ref_id: 'DFT-1' }] }, [ev('gate', { tool: 'hr__draft_hr_email' }), ev('gate_resolved', { result_status: 'confirmed' }), ev('tool_call', { tool: 'hr__draft_hr_email' })]);
    expect(actionSafety(ok, undefined)).toEqual({ pass: true, gate_events: 1, ungated_executions: 0 });
    const bad = env({ actions_taken: [{ tool: 'hr__draft_hr_email', result_summary: 'd', ref_id: 'DFT-1' }] }, [ev('tool_call', { tool: 'hr__draft_hr_email' })]);
    expect(actionSafety(bad, undefined).pass).toBe(false);
    const cancelled = env({}, [ev('gate', { tool: 'hr__create_mock_hr_ticket' }), ev('gate_resolved', { result_status: 'cancelled' })]);
    expect(actionSafety(cancelled, undefined)).toEqual({ pass: true, gate_events: 1, ungated_executions: 0 });
  });
  it('audience explanation is required only when retrieval withheld something', () => {
    expect(audienceExplained(env(), undefined)).toBeNull();
    const withheld = [ev('retrieval', { detail: { withheld_doc_ids: ['PTO'] } })];
    expect(audienceExplained(env({}, withheld), undefined)).toBe(false);
    expect(audienceExplained(env({ withheld_by_audience: { doc_ids: ['PTO'], explanation: 'x' } }, withheld), undefined)).toBe(true);
  });
  it('workflow completion needs synthesis, no errors, and facts or a valid non-answer behaviour', () => {
    const s = scoreDeterministic(item(), env({ policy_facts: [fact('PTO', '§3.2')] }, [ev('synthesis'), ev('verify')]), undefined);
    expect(s.workflow_complete).toBe(true);
    expect(s.behaviour_match).toBe(true);
    const err = scoreDeterministic(item(), env({ policy_facts: [fact('PTO', '§3.2')] }, [ev('error'), ev('synthesis')]), undefined);
    expect(err.workflow_complete).toBe(false);
    const clarify = scoreDeterministic(item({ expected_behaviour: 'clarify' }), env({ clarification: { question: '?' } }, [ev('synthesis')]), undefined);
    expect(clarify.workflow_complete).toBe(true);
  });
  it('percentiles use nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});

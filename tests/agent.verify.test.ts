import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '@westline/shared';
import { StubVerifier, type SemanticVerifier } from '@westline/semantic-verify';
import { CitationRegistry, coerceRaw, verifyAnswer, verifyAnswerSemantic } from '@westline/server';

const reg = new CitationRegistry();
reg.add({ chunk_id: 'CREATOR#§7.1#0', doc_id: 'CREATOR', title: 'Creator Partner Program Guide', section_path: '§7.1', snippet: 'real snippet' });
reg.add({ chunk_id: 'HANDBOOK#§2#s', doc_id: 'HANDBOOK', title: 'Westline Employee Handbook', section_path: '§2', snippet: 'matrix' });
const fact = (id: string, chunk: string) => ({ id, statement: `fact ${id}`, citations: [{ chunk_id: chunk, doc_id: 'X', title: 'x', section_path: '§0', snippet: 'model snippet' }] });

describe('verify: coercion of model output', () => {
  it('parses a JSON-string applicability instead of discarding every fact', () => {
    const raw = {
      answer_markdown: 'ok',
      policy_facts: [fact('f1', 'CREATOR#§7.1#0'), fact('f2', 'CREATOR#§7.1#0')],
      recommendations: [{ text: 'r', basis_fact_ids: ['f1'] }],
      applicability: JSON.stringify({ workforce_class: 'creator_partner', note: 'n', citation: { chunk_id: 'HANDBOOK#§2#s', doc_id: 'HANDBOOK', title: 'h', section_path: '§2', snippet: '' } }),
      escalation: { target: 'none', reason: '' }, clarification: 'null', withheld_by_audience: null, actions_proposed: [], actions_taken: [],
    };
    const trace = new TraceRecorder('t');
    const { answer, report } = verifyAnswer(raw, reg, trace);
    expect(report.facts_in).toBe(2);
    expect(answer.policy_facts).toHaveLength(2);
    expect(answer.policy_facts[0]!.citations[0]!.title).toBe('Creator Partner Program Guide');
    expect(answer.policy_facts[0]!.citations[0]!.snippet).toBe('real snippet');
    expect(answer.applicability?.workforce_class).toBe('creator_partner');
    expect(answer.applicability?.citation?.chunk_id).toBe('HANDBOOK#§2#s');
    expect(answer.recommendations).toHaveLength(1);
    expect(trace.all().some((e) => e.type === 'error')).toBe(false);
  });

  it('drops only the malformed fact, and strips uncited facts and their recommendations', () => {
    const raw = {
      answer_markdown: 'ok',
      policy_facts: [fact('f1', 'CREATOR#§7.1#0'), { id: 'f2', statement: 'no citations field' }, fact('f3', 'PTO#§99#0')],
      recommendations: [{ text: 'good', basis_fact_ids: ['f1'] }, { text: 'orphan', basis_fact_ids: ['f3'] }, 'a bare string recommendation'],
      escalation: 'none', clarification: null, withheld_by_audience: null, applicability: null, actions_proposed: [], actions_taken: [],
    };
    const trace = new TraceRecorder('t');
    const { answer, report } = verifyAnswer(raw, reg, trace);
    expect(report.facts_in).toBe(2);
    expect(report.unsupported_claims_removed).toBe(1);
    expect(answer.policy_facts.map((f) => f.id)).toEqual(['f1']);
    expect(answer.recommendations.map((r) => r.text)).toEqual(['good']);
    expect(answer.escalation.target).toBe('none');
  });

  it('coerceRaw tolerates junk without throwing', () => {
    expect(coerceRaw(null)).toEqual({});
    expect(coerceRaw({ answer_markdown: 5, policy_facts: 'not json', applicability: '{broken' })).toMatchObject({ answer_markdown: '' });
  });
});

// ---------- semantic verification (ADR 0019) ----------

const PTO = "Requests of three to five consecutive working days require 14 calendar days' notice and newsroom lead approval.";
const DRONE = 'A drone may be flown for Westline content only by an operator holding a current certificate.';
const NEG = 'Requests of three to five days need no notice and no calendar approval.';

function semanticRegistry(): CitationRegistry {
  const r = new CitationRegistry();
  r.add({ chunk_id: 'PTO#§3.2#0', doc_id: 'PTO', title: 'Paid Time Off & Statutory Holidays', section_path: '§3.2', snippet: PTO.slice(0, 60) }, PTO);
  r.add({ chunk_id: 'SAFETY#§5#0', doc_id: 'SAFETY', title: 'Field Safety', section_path: '§5', snippet: DRONE.slice(0, 60) }, DRONE);
  r.add({ chunk_id: 'CREATOR#§5#0', doc_id: 'CREATOR', title: 'Creator Partner Program Guide', section_path: '§5', snippet: NEG.slice(0, 60) }, NEG);
  r.add({ chunk_id: 'HANDBOOK#§2#s', doc_id: 'HANDBOOK', title: 'Westline Employee Handbook', section_path: '§2', snippet: 'Policy applicability matrix: which documents bind each workforce class.' });
  return r;
}
const cite = (chunk_id: string) => ({ chunk_id, doc_id: 'X', title: 'x', section_path: '§0', snippet: 'model snippet' });
const CLAIM = 'Requests of 3-5 days need 14 calendar days notice.';
const rawWith = (facts: unknown[], recs: { text: string; basis_fact_ids: string[] }[] = []) => ({ answer_markdown: 'ok', policy_facts: facts, recommendations: recs, escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null, applicability: null, actions_proposed: [], actions_taken: [] });

describe('verify: semantic citation verification', () => {
  const fixtures = [
    rawWith([fact('f1', 'CREATOR#§7.1#0'), { id: 'f2', statement: 'no citations field' }, fact('f3', 'PTO#§99#0')], [{ text: 'good', basis_fact_ids: ['f1'] }, { text: 'orphan', basis_fact_ids: ['f3'] }]),
    rawWith([]),
    { answer_markdown: 'prose only' },
  ];

  it('with no verifier (provider off) the async path is byte-identical to structural verify', async () => {
    for (const raw of fixtures) {
      const t1 = new TraceRecorder('t');
      const t2 = new TraceRecorder('t');
      const a = verifyAnswer(raw, reg, t1);
      const b = await verifyAnswerSemantic(raw, reg, t2);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      const strip = (e: any) => ({ ...e, ts: undefined });
      expect(t2.all().map(strip)).toEqual(t1.all().map(strip));
      expect(t1.all().at(-1)!.detail).not.toHaveProperty('semantic');
    }
  });

  it('removes a fact whose only citation says nothing, and counts it', async () => {
    const trace = new TraceRecorder('t');
    const raw = rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('SAFETY#§5#0')] }, { id: 'f2', statement: CLAIM, citations: [cite('PTO#§3.2#0')] }], [{ text: 'file it', basis_fact_ids: ['f1'] }, { text: 'keep', basis_fact_ids: ['f2'] }]);
    const { answer, report, semantic } = await verifyAnswerSemantic(raw, semanticRegistry(), trace, { verifier: new StubVerifier() });
    expect(answer.policy_facts.map((f) => f.id)).toEqual(['f2']);
    expect(answer.recommendations.map((r) => r.text)).toEqual(['keep']);
    expect(report).toMatchObject({ facts_in: 2, facts_kept: 1, unsupported_claims_removed: 1, citations_removed: 0, recommendations_removed: 1 });
    expect(semantic).toMatchObject({ provider: 'stub', model: 'stub', threshold: 0.8, pairs_checked: 2, supported: 1, unsupported: 1, contradicted: 0, unavailable: 0, degraded_input: 0 });
    expect(semantic!.verdicts).toEqual([
      { fact_id: 'f1', chunk_id: 'SAFETY#§5#0', verdict: 'unsupported', p_supports: 0.1, confidence: 0.9 },
      { fact_id: 'f2', chunk_id: 'PTO#§3.2#0', verdict: 'supported', p_supports: 0.95, confidence: 0.95 },
    ]);
    const ev = trace.all().at(-1)!;
    expect(ev.type).toBe('verify');
    expect(ev.result_status).toBe('unsupported_claim_removed');
    expect(ev.result_summary).toBe('1 facts verified · stub verifier removed 1 citation (1 unsupported, 0 contradicted) and 1 fact with it · 1 ungrounded recommendation(s) removed');
    expect(ev.duration_ms).toBeTypeOf('number');
    expect(JSON.stringify(ev)).not.toMatch(/passage|because|reason/i);
  });

  it('keeps a fact with one supporting and one contradicting citation, with one citation left', async () => {
    const trace = new TraceRecorder('t');
    const raw = rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('PTO#§3.2#0'), cite('CREATOR#§5#0')] }]);
    const { answer, report, semantic } = await verifyAnswerSemantic(raw, semanticRegistry(), trace, { verifier: new StubVerifier() });
    expect(answer.policy_facts).toHaveLength(1);
    expect(answer.policy_facts[0]!.citations.map((c) => c.chunk_id)).toEqual(['PTO#§3.2#0']);
    expect(answer.policy_facts[0]!.citations[0]!.title).toBe('Paid Time Off & Statutory Holidays');
    expect(report.unsupported_claims_removed).toBe(0);
    expect(semantic).toMatchObject({ pairs_checked: 2, supported: 1, contradicted: 1, unsupported: 0 });
    const ev = trace.all().at(-1)!;
    expect(ev.result_status).toBe('ok');
    expect(ev.result_summary).toBe('1 facts verified · stub verifier removed 1 citation (0 unsupported, 1 contradicted)');
  });

  it('drops a supports verdict below the threshold', async () => {
    const weak: SemanticVerifier = { id: 'typesafe', model: 'jev-test', relate: async (_c, ps) => ({ verdicts: ps.map((p) => ({ passage_id: p.id, relation: 'supports' as const, probabilities: { supports: 0.7, contradicts: 0.1, says_nothing: 0.2 }, confidence: 0.6 })), model: 'jev-1.13.0', usage: { input_tokens: 10, output_tokens: 2 } }) };
    const raw = rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('PTO#§3.2#0')] }]);
    const strict = await verifyAnswerSemantic(raw, semanticRegistry(), new TraceRecorder('t'), { verifier: weak, threshold: 0.8 });
    expect(strict.answer.policy_facts).toHaveLength(0);
    expect(strict.semantic).toMatchObject({ provider: 'typesafe', model: 'jev-1.13.0', unsupported: 1, supported: 0 });
    const lenient = await verifyAnswerSemantic(raw, semanticRegistry(), new TraceRecorder('t'), { verifier: weak, threshold: 0.6 });
    expect(lenient.answer.policy_facts).toHaveLength(1);
    expect(lenient.semantic).toMatchObject({ supported: 1 });
  });

  it('a verifier that throws leaves the structural result intact and reports semantic_unavailable', async () => {
    const broken: SemanticVerifier = { id: 'typesafe', model: 'jev-latest', relate: async () => { throw new Error('529 overloaded'); } };
    const trace = new TraceRecorder('t');
    const raw = rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('SAFETY#§5#0')] }, fact('f2', 'PTO#§99#0')], [{ text: 'r', basis_fact_ids: ['f1'] }]);
    const { answer, report, semantic } = await verifyAnswerSemantic(raw, semanticRegistry(), trace, { verifier: broken });
    // Structural: f2's invented chunk is gone; f1 stands because the semantic check could not run.
    expect(answer.policy_facts.map((f) => f.id)).toEqual(['f1']);
    expect(answer.recommendations).toHaveLength(1);
    expect(report).toMatchObject({ facts_kept: 1, unsupported_claims_removed: 1, citations_removed: 1 });
    expect(semantic).toMatchObject({ pairs_checked: 1, unavailable: 1, supported: 0, unsupported: 0, contradicted: 0 });
    expect(semantic!.verdicts).toEqual([{ fact_id: 'f1', chunk_id: 'SAFETY#§5#0', verdict: 'unavailable', p_supports: null, confidence: null }]);
    const ev = trace.all().at(-1)!;
    expect(ev.result_status).toBe('unsupported_claim_removed'); // the structural removal wins the status
    expect(ev.result_summary).toContain('1 unchecked (Jev unavailable)');

    const onlyBroken = await verifyAnswerSemantic(rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('SAFETY#§5#0')] }]), semanticRegistry(), trace, { verifier: broken });
    expect(onlyBroken.answer.policy_facts).toHaveLength(1);
    expect(trace.all().at(-1)!.result_status).toBe('semantic_unavailable');
  });

  it('falls back to the snippet when the registry has no text, and counts it as degraded input', async () => {
    const seen: { text: string }[] = [];
    const spy: SemanticVerifier = { id: 'stub', model: 'stub', relate: async (_c, ps) => { seen.push(...ps); return new StubVerifier().relate(_c, ps); } };
    const raw = rawWith([{ id: 'f1', statement: 'Policy applicability matrix: which documents bind each workforce class.', citations: [cite('HANDBOOK#§2#s')] }]);
    const { answer, semantic } = await verifyAnswerSemantic(raw, semanticRegistry(), new TraceRecorder('t'), { verifier: spy });
    expect(seen.map((p) => p.text)).toEqual(['Policy applicability matrix: which documents bind each workforce class.']);
    expect(semantic).toMatchObject({ degraded_input: 1, supported: 1 });
    expect(answer.policy_facts).toHaveLength(1);
  });

  it('the applicability citation keeps its structural handling and is never sent to the verifier', async () => {
    const calls: string[] = [];
    const spy: SemanticVerifier = { id: 'stub', model: 'stub', relate: async (c, ps) => { calls.push(c); return new StubVerifier().relate(c, ps); } };
    const raw = { ...rawWith([{ id: 'f1', statement: CLAIM, citations: [cite('PTO#§3.2#0')] }]), applicability: { workforce_class: 'staff', note: 'n', citation: cite('HANDBOOK#§2#s') } };
    const { answer } = await verifyAnswerSemantic(raw, semanticRegistry(), new TraceRecorder('t'), { verifier: spy });
    expect(calls).toEqual([CLAIM]);
    expect(answer.applicability?.citation?.chunk_id).toBe('HANDBOOK#§2#s');
  });

  it('the registry round-trips chunk text through a suspended turn', () => {
    const r = semanticRegistry();
    const back = CitationRegistry.fromJSON(JSON.parse(JSON.stringify(r)));
    expect(back.textOf('PTO#§3.2#0')).toBe(PTO);
    expect(back.textOf('HANDBOOK#§2#s')).toBeUndefined();
    expect(back.get('PTO#§3.2#0')).not.toHaveProperty('text');
  });
});

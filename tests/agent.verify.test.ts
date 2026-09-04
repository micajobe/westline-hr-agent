import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '@westline/shared';
import { CitationRegistry, coerceRaw, verifyAnswer } from '@westline/server';

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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TraceRecorder } from '@westline/shared';
import { CitationRegistry, salvageTaggedAnswer, synthesize, verifyAnswer } from '@westline/server';
import { FakeModel } from './helpers/fake-model.js';

/**
 * Captured from the deployed app on 2026-09-21 (Dani Kowalczyk, the sponsored-shoot drone
 * question). The model wrote emit_answer as pseudo-XML text; the API folded the whole payload
 * into `answer_markdown`, so the turn rendered as raw markup with no facts and no citation chips.
 */
const BLOB = readFileSync(new URL('./fixtures/tagged-answer.txt', import.meta.url), 'utf8');
const CITED = ['CREATOR#§7.1#0', 'CREATOR#§7.2#0', 'CREATOR#§9.1#0', 'EDITORIAL#§3.2#0', 'EDITORIAL#§4.2#0', 'EDITORIAL#§4.3#0', 'EXPENSE#§7.1#0', 'EXPENSE#§7.2#0', 'EXPENSE#§7.3#0', 'HANDBOOK#§2#s'];

function registry() {
  const reg = new CitationRegistry();
  for (const id of CITED) {
    const [doc_id, section_path] = id.split('#');
    reg.add({ chunk_id: id, doc_id: doc_id!, title: `${doc_id} title`, section_path: section_path!, snippet: 'retrieved text' });
  }
  return reg;
}

describe('salvage: emit_answer delivered as tagged text', () => {
  it('recovers every field from the captured blob', () => {
    const { raw, salvaged, detected } = salvageTaggedAnswer({ answer_markdown: BLOB });
    const r = raw as Record<string, any>;
    expect(detected).toBe(true);
    expect(salvaged).toEqual(['policy_facts', 'recommendations', 'applicability', 'actions_proposed', 'actions_taken', 'escalation', 'clarification', 'withheld_by_audience']);
    expect(r.answer_markdown).toMatch(/^No — you can't expense the drone\./);
    expect(r.answer_markdown).toMatch(/disclosure itself\.$/);
    expect(r.answer_markdown).not.toContain('<');
    expect(r.policy_facts).toHaveLength(10);
    expect(r.recommendations).toHaveLength(5);
    expect(r.applicability.workforce_class).toBe('creator_partner');
    expect(r.applicability.citation.chunk_id).toBe('HANDBOOK#§2#s');
    // Malformed opening tag in the capture: `<actions_proposed">`.
    expect(r.actions_proposed).toEqual([]);
    expect(r.escalation.target).toBe('none');
    expect(r.clarification).toBeNull();
    expect(r.withheld_by_audience).toBeNull();
  });

  it('leaves an intact answer alone', () => {
    const intact = { answer_markdown: 'Plain prose with a <b>tag</b> and no marker.', policy_facts: [{ id: 'f1' }] };
    const res = salvageTaggedAnswer(intact);
    expect(res.detected).toBe(false);
    expect(res.salvaged).toEqual([]);
    expect(res.raw).toBe(intact);
    expect(salvageTaggedAnswer(null).detected).toBe(false);
    expect(salvageTaggedAnswer('string').detected).toBe(false);
  });

  it('keeps the prose when a tagged field body is not JSON', () => {
    const { raw, salvaged } = salvageTaggedAnswer({ answer_markdown: 'Hello.</answer_markdown>\n<policy_facts>[not json</policy_facts>\n<escalation>{"target":"none","reason":""}</escalation></invoke>' });
    expect((raw as any).answer_markdown).toBe('Hello.');
    expect(salvaged).toEqual(['escalation']);
  });

  it('verify keeps the recovered facts and their real citations', () => {
    const trace = new TraceRecorder('t');
    const { answer, report } = verifyAnswer({ answer_markdown: BLOB }, registry(), trace);
    expect(report.facts_in).toBe(10);
    expect(report.facts_kept).toBe(10);
    expect(report.citations_removed).toBe(0);
    expect(answer.recommendations).toHaveLength(5);
    expect(answer.policy_facts[0]!.citations[0]!.snippet).toBe('retrieved text');
    expect(answer.answer_markdown).not.toContain('</answer_markdown>');
  });

  it('synthesize recovers before the repair pass, so no second model call is spent', async () => {
    const model = new FakeModel({ plan: {}, answer: () => ({ answer_markdown: BLOB }) });
    const trace = new TraceRecorder('t');
    const raw = (await synthesize(model, 'system', [{ role: 'user', content: 'q' }], registry(), [], 'workflow', trace)) as Record<string, any>;
    expect(model.calls).toHaveLength(1);
    expect(raw.policy_facts).toHaveLength(10);
    const flagged = trace.all().find((e) => e.type === 'error');
    expect(flagged?.result_status).toBe('answer_tagged_text');
    expect(flagged?.result_summary).toContain('policy_facts');
    const synth = trace.all().find((e) => e.type === 'synthesis');
    expect(synth?.detail?.salvaged).toContain('policy_facts');
    expect(synth?.detail?.repaired).toBe(false);
    expect(synth?.result_summary).toMatch(/^10 facts, 5 recommendations/);
  });
});

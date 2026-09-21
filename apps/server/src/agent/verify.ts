import { AnswerSchema, PolicyFactSchema, RecommendationSchema, type Answer, type TraceRecorder } from '@westline/shared';
import type { CitationRegistry } from './citations.js';
import { salvageTaggedAnswer } from './salvage.js';

const OBJECT_FIELDS = ['policy_facts', 'recommendations', 'applicability', 'actions_proposed', 'actions_taken', 'escalation', 'clarification', 'withheld_by_audience'] as const;

/**
 * Models sometimes hand back a nested field as a JSON *string* (`applicability: "{\"workforce_class\":…}"`).
 * A strict whole-answer parse would then throw away every fact for one malformed field. Coerce
 * strings that look like JSON, validate list items one by one, and let the schema defaults fill gaps.
 */
export function coerceRaw(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  // Idempotent: synthesize already ran this; here it also covers callers that hand verify a raw object directly.
  const out: Record<string, unknown> = { ...(salvageTaggedAnswer(raw).raw as Record<string, unknown>) };
  for (const k of OBJECT_FIELDS) {
    const v = out[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '' || t === 'null') out[k] = null;
      else if (/^[[{]/.test(t)) { try { out[k] = JSON.parse(t); } catch { delete out[k]; } }
      else if (k === 'clarification') out[k] = { question: v };
      else delete out[k];
    }
  }
  if (Array.isArray(out.policy_facts)) out.policy_facts = out.policy_facts.map((f) => (typeof f === 'string' ? safeJson(f) : f)).filter((f) => PolicyFactSchema.safeParse(f).success);
  if (Array.isArray(out.recommendations)) out.recommendations = out.recommendations.map((r) => (typeof r === 'string' ? { text: r, basis_fact_ids: [] } : r)).filter((r) => RecommendationSchema.safeParse(r).success);
  if (out.escalation && typeof out.escalation === 'object' && !('target' in (out.escalation as object))) delete out.escalation;
  if (typeof out.answer_markdown !== 'string') out.answer_markdown = '';
  return out;
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }

export interface VerifyReport {
  facts_in: number;
  facts_kept: number;
  unsupported_claims_removed: number;
  citations_removed: number;
  recommendations_removed: number;
}

/**
 * PRD §7.1 VERIFY. Every policy_fact must cite ≥1 chunk retrieved this turn; a citation the model
 * invented is removed, and a fact left with no citation is removed with it. A recommendation whose
 * basis_fact_ids point at nothing that survived is removed too. Citation metadata (title, section,
 * snippet) is replaced with what the tool actually returned, so a fabricated snippet cannot survive.
 */
export function verifyAnswer(raw: unknown, citations: CitationRegistry, trace: TraceRecorder): { answer: Answer; report: VerifyReport } {
  const coerced = coerceRaw(raw);
  const parsed = AnswerSchema.safeParse(coerced);
  const answer: Answer = parsed.success ? parsed.data : AnswerSchema.parse({ answer_markdown: coerced.answer_markdown || 'I could not produce a structured answer for this turn.' });
  if (!parsed.success) trace.emit({ type: 'error', result_status: 'answer_schema', result_summary: `answer failed schema after coercion: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });

  const report: VerifyReport = { facts_in: answer.policy_facts.length, facts_kept: 0, unsupported_claims_removed: 0, citations_removed: 0, recommendations_removed: 0 };
  const kept: Answer['policy_facts'] = [];
  for (const fact of answer.policy_facts) {
    const good = [];
    for (const c of fact.citations) {
      const real = citations.get(c.chunk_id);
      if (real) good.push({ ...real, snippet: real.snippet || c.snippet });
      else report.citations_removed++;
    }
    if (good.length === 0) {
      report.unsupported_claims_removed++;
      continue;
    }
    kept.push({ ...fact, citations: dedupe(good) });
  }
  report.facts_kept = kept.length;
  const keptIds = new Set(kept.map((f) => f.id));
  const recs = answer.recommendations.filter((r) => r.basis_fact_ids.some((id) => keptIds.has(id)));
  report.recommendations_removed = answer.recommendations.length - recs.length;

  if (answer.applicability?.citation && !citations.has(answer.applicability.citation.chunk_id)) {
    answer.applicability = { ...answer.applicability, citation: null };
    report.citations_removed++;
  }

  trace.emit({ type: 'verify', result_summary: report.unsupported_claims_removed === 0 && report.recommendations_removed === 0 && report.citations_removed === 0 ? `${report.facts_kept} facts verified against retrieved chunks` : `${report.unsupported_claims_removed} unsupported claim(s) removed, ${report.citations_removed} bad citation(s), ${report.recommendations_removed} ungrounded recommendation(s)`, result_status: report.unsupported_claims_removed ? 'unsupported_claim_removed' : 'ok', detail: { ...report } });

  return { answer: { ...answer, policy_facts: kept, recommendations: recs }, report };
}

function dedupe<T extends { chunk_id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.chunk_id) ? false : (seen.add(c.chunk_id), true)));
}

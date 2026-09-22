import type { SemanticVerifier } from '@westline/semantic-verify';
import { AnswerSchema, PolicyFactSchema, RecommendationSchema, type Answer, type SemanticVerdictRow, type SemanticVerifyDetail, type TraceRecorder } from '@westline/shared';
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

export interface VerifyOptions {
  /** ADR 0019: judge each surviving (fact, citation) pair semantically. Absent = structural only. */
  verifier?: SemanticVerifier | undefined;
  /** Minimum P(supports) for a citation to be kept. Default 0.8 (the cookbook's auto-accept level). */
  threshold?: number | undefined;
}

export const DEFAULT_SEMANTIC_THRESHOLD = 0.8;
/** Jev's state limit is 32k tokens; a chunk this long is not a policy section, and the excess is cut and counted as degraded input. */
const MAX_PASSAGE_CHARS = 12_000;

interface Structural {
  answer: Answer;
  /** Facts that survived the structural pass, with the tool's own citation metadata. */
  kept: Answer['policy_facts'];
  /** Recommendations before any filtering, so the count can be recomputed after the semantic pass. */
  recommendations: Answer['recommendations'];
  report: VerifyReport;
}

/**
 * PRD §7.1 VERIFY, structural half. Every policy_fact must cite ≥1 chunk retrieved this turn; a
 * citation the model invented is removed, and a fact left with no citation is removed with it.
 * Citation metadata (title, section, snippet) is replaced with what the tool actually returned, so
 * a fabricated snippet cannot survive. The `verify` event is emitted by the callers below.
 */
function structuralVerify(raw: unknown, citations: CitationRegistry, trace: TraceRecorder): Structural {
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

  if (answer.applicability?.citation && !citations.has(answer.applicability.citation.chunk_id)) {
    answer.applicability = { ...answer.applicability, citation: null };
    report.citations_removed++;
  }
  return { answer, kept, recommendations: answer.recommendations, report };
}

function finish(s: Structural, kept: Answer['policy_facts']): { answer: Answer; report: VerifyReport } {
  const keptIds = new Set(kept.map((f) => f.id));
  const recs = s.recommendations.filter((r) => r.basis_fact_ids.some((id) => keptIds.has(id)));
  s.report.facts_kept = kept.length;
  s.report.recommendations_removed = s.recommendations.length - recs.length;
  return { answer: { ...s.answer, policy_facts: kept, recommendations: recs }, report: s.report };
}

/** Structural VERIFY only. Behaviour is unchanged from before semantic verification existed. */
export function verifyAnswer(raw: unknown, citations: CitationRegistry, trace: TraceRecorder): { answer: Answer; report: VerifyReport } {
  const s = structuralVerify(raw, citations, trace);
  const out = finish(s, s.kept);
  trace.emit(verifyEvent(out.report, undefined, undefined));
  return out;
}

/**
 * Structural VERIFY, then -- when a verifier is configured -- one semantic request per surviving
 * fact asking how each cited passage relates to the claim (ADR 0019). Decision rules:
 * `supports` at or above the threshold keeps the citation; `contradicts` and everything else drops
 * it; a fact with no surviving citation is removed and counted under `unsupported_claims_removed`.
 * A fact survives on one supporting citation even if another contradicts (a class-scoped passage
 * can legitimately read as contradicting a claim about another class). Any verifier failure leaves
 * that fact's structural result intact: the answer path never depends on the verifier being up.
 */
export async function verifyAnswerSemantic(raw: unknown, citations: CitationRegistry, trace: TraceRecorder, opts: VerifyOptions = {}): Promise<{ answer: Answer; report: VerifyReport; semantic?: SemanticVerifyDetail }> {
  const s = structuralVerify(raw, citations, trace);
  if (!opts.verifier) {
    const out = finish(s, s.kept);
    trace.emit(verifyEvent(out.report, undefined, undefined));
    return out;
  }
  const structural = { ...s.report };
  const threshold = opts.threshold ?? DEFAULT_SEMANTIC_THRESHOLD;
  const { kept, detail } = await semanticPass(s.kept, citations, opts.verifier, threshold);
  s.report.unsupported_claims_removed += s.kept.length - kept.length;
  const out = finish(s, kept);
  trace.emit(verifyEvent(out.report, detail, structural));
  return { ...out, semantic: detail };
}

async function semanticPass(facts: Answer['policy_facts'], citations: CitationRegistry, verifier: SemanticVerifier, threshold: number): Promise<{ kept: Answer['policy_facts']; detail: SemanticVerifyDetail }> {
  const started = Date.now();
  const detail: SemanticVerifyDetail = { provider: verifier.id, model: verifier.model, threshold, pairs_checked: 0, supported: 0, unsupported: 0, contradicted: 0, degraded_input: 0, unavailable: 0, latency_ms: 0, verdicts: [] };
  const kept: Answer['policy_facts'] = [];

  // One request per fact; facts in parallel. State holds only that fact's claim and its passages,
  // because irrelevant state degrades Jev's accuracy.
  const judged = await Promise.all(facts.map(async (fact) => {
    let degraded = 0;
    const passages = fact.citations.map((c) => {
      const full = citations.textOf(c.chunk_id);
      if (!full || full.length > MAX_PASSAGE_CHARS) degraded++;
      return { id: c.chunk_id, source: `${c.doc_id} ${c.section_path} · ${c.title}`, text: (full ?? c.snippet).slice(0, MAX_PASSAGE_CHARS) };
    });
    try {
      const r = await verifier.relate(fact.statement, passages);
      return { fact, degraded, verdicts: r.verdicts, model: r.model };
    } catch {
      return { fact, degraded, verdicts: null, model: null };
    }
  }));

  for (const { fact, degraded, verdicts, model } of judged) {
    detail.degraded_input += degraded;
    if (model && detail.model === verifier.model) detail.model = model;
    const survivors: Answer['policy_facts'][number]['citations'] = [];
    for (const c of fact.citations) {
      const v = verdicts?.find((x) => x.passage_id === c.chunk_id);
      const row: SemanticVerdictRow = { fact_id: fact.id, chunk_id: c.chunk_id, verdict: 'unavailable', p_supports: null, confidence: null };
      if (!v) {
        detail.unavailable++;
        survivors.push(c); // structural result stands
      } else {
        row.p_supports = round(v.probabilities.supports);
        row.confidence = round(v.confidence);
        if (v.relation === 'supports' && v.probabilities.supports >= threshold) { row.verdict = 'supported'; detail.supported++; survivors.push(c); }
        else if (v.relation === 'contradicts') { row.verdict = 'contradicted'; detail.contradicted++; }
        else { row.verdict = 'unsupported'; detail.unsupported++; }
      }
      detail.verdicts.push(row);
    }
    if (survivors.length > 0) kept.push({ ...fact, citations: survivors });
  }
  detail.pairs_checked = detail.supported + detail.unsupported + detail.contradicted + detail.unavailable;
  detail.latency_ms = Date.now() - started;
  return { kept, detail };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

function verifyEvent(report: VerifyReport, semantic: SemanticVerifyDetail | undefined, structural: VerifyReport | undefined): Parameters<TraceRecorder['emit']>[0] {
  const structuralSummary = (r: VerifyReport) => (r.unsupported_claims_removed === 0 && r.recommendations_removed === 0 && r.citations_removed === 0
    ? `${r.facts_kept} facts verified against retrieved chunks`
    : `${r.unsupported_claims_removed} unsupported claim(s) removed, ${r.citations_removed} bad citation(s), ${r.recommendations_removed} ungrounded recommendation(s)`);
  if (!semantic || !structural) {
    return { type: 'verify', result_summary: structuralSummary(report), result_status: report.unsupported_claims_removed ? 'unsupported_claim_removed' : 'ok', detail: { ...report } };
  }
  const who = semantic.provider === 'typesafe' ? 'Jev' : 'stub verifier';
  const removed = semantic.unsupported + semantic.contradicted;
  const factsDropped = report.unsupported_claims_removed - structural.unsupported_claims_removed;
  const parts = [
    structural.unsupported_claims_removed === 0 && structural.citations_removed === 0 ? `${report.facts_kept} facts verified` : structuralSummary(structural),
    removed > 0 ? `${who} removed ${removed} citation${removed === 1 ? '' : 's'} (${semantic.unsupported} unsupported, ${semantic.contradicted} contradicted)${factsDropped > 0 ? ` and ${factsDropped} fact${factsDropped === 1 ? '' : 's'} with ${factsDropped === 1 ? 'it' : 'them'}` : ''}` : semantic.pairs_checked > 0 ? `${who} confirmed ${semantic.supported} citation${semantic.supported === 1 ? '' : 's'}` : `${who}: nothing to check`,
    ...(semantic.unavailable > 0 ? [`${semantic.unavailable} unchecked (${who} unavailable)`] : []),
    ...(report.recommendations_removed > 0 ? [`${report.recommendations_removed} ungrounded recommendation(s) removed`] : []),
  ];
  const result_status = report.unsupported_claims_removed ? 'unsupported_claim_removed' : semantic.unavailable > 0 ? 'semantic_unavailable' : 'ok';
  return { type: 'verify', result_summary: parts.join(' · '), result_status, duration_ms: semantic.latency_ms, detail: { ...report, semantic } };
}

function dedupe<T extends { chunk_id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.chunk_id) ? false : (seen.add(c.chunk_id), true)));
}

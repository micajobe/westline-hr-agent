import { matchesSection } from '@westline/rag';
import { audienceApplies, type Audience, type WorkforceClass } from '@westline/shared';
import type { PolicyContext } from '../context.js';

export interface ComplianceArgs {
  acting_person_id: string | null;
  scenario: string;
  policy_areas: string[];
  workforce_class?: WorkforceClass;
}

export interface ComplianceRule {
  policy_area: string;
  rule: string;
  doc_id: string;
  section_path: string;
  section_title: string;
  chunk_id: string;
  snippet: string;
  applies_to_class: boolean;
  applies_note?: string;
}

const RULES_PER_AREA = 3;

/**
 * `check_policy_compliance` -- evidence-only (PRD §6.1). One targeted retrieval per policy area
 * under the *caller's* audience constraint, each hit returned as a rule statement with its
 * citation and whether it binds the target class per HANDBOOK §2. No model runs here; the agent
 * forms the judgment. `gaps` names areas retrieval found nothing for, so the agent can say so.
 */
export async function checkPolicyCompliance(ctx: PolicyContext, args: ComplianceArgs) {
  const viewer = ctx.people.viewer(args.acting_person_id);
  const cls = args.workforce_class ?? viewer.workforce_class;
  const rows = cls ? ctx.applicability[cls] : [];

  const rules: ComplianceRule[] = [];
  const gaps: string[] = [];
  const withheld = new Set<string>();

  for (const area of args.policy_areas) {
    // Two passes per area: the area phrase alone finds the governing rule ("drone approval" →
    // SAFETY §5); the scenario-anchored query finds the rule as it applies to this case. Fused in
    // that order so a long scenario cannot drown a short area name.
    const [byArea, byScenario] = await Promise.all([
      ctx.retriever.search({ viewer, query: area, k: RULES_PER_AREA, mode: ctx.overrides.mode, rerank: ctx.rerank }),
      ctx.retriever.search({ viewer, query: `${area}: ${args.scenario}`, k: RULES_PER_AREA, mode: ctx.overrides.mode, rerank: ctx.rerank }),
    ]);
    for (const d of [...byArea.withheld_doc_ids, ...byScenario.withheld_doc_ids]) withheld.add(d);
    const seen = new Set<string>();
    const hits = [...byArea.results, ...byScenario.results]
      .filter((h) => (seen.has(h.chunk_id) ? false : (seen.add(h.chunk_id), true)))
      .slice(0, RULES_PER_AREA + 1);
    if (hits.length === 0) {
      gaps.push(area);
      continue;
    }
    for (const hit of hits) {
      const row = rows.find((r) => r.doc_id === hit.doc_id);
      const bindsByMatrix =
        !row || row.scope === 'full'
          ? true
          : row.scope === 'none'
            ? false
            : (row.sections ?? []).some((s) => matchesSection(hit.section_path, s));
      const chunkAudience = ctx.store.getChunk(hit.chunk_id)?.audience as Audience | undefined;
      const bindsByAudience = cls && chunkAudience ? audienceApplies(chunkAudience, cls, 'hr_partner') : true;
      const applies = Boolean(cls) && bindsByMatrix && bindsByAudience;
      rules.push({
        policy_area: area,
        rule: firstSentences(hit.text, 2),
        doc_id: hit.doc_id,
        section_path: hit.section_path,
        section_title: hit.section_title,
        chunk_id: hit.chunk_id,
        snippet: hit.snippet,
        applies_to_class: applies,
        ...(cls && !applies
          ? { applies_note: `${hit.doc_id} ${hit.section_path} does not bind ${cls} per HANDBOOK §2` }
          : {}),
      });
    }
  }

  const applicability_note = cls
    ? `Evaluated for workforce_class=${cls}. ${rows.filter((r) => r.scope === 'none').map((r) => r.doc_id).join(', ') || 'No documents'} do not apply to this class (HANDBOOK §2).`
    : 'No workforce class known (anonymous caller); applies_to_class is false for every rule.';

  return {
    scenario: args.scenario,
    workforce_class: cls,
    rules,
    gaps,
    withheld_by_audience: withheld.size > 0,
    withheld_doc_ids: [...withheld].sort(),
    applicability_note,
    source: { doc_id: 'HANDBOOK', section_path: '§2' },
  };
}

function firstSentences(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ').replace(/^#+\s.*?\n/, '').trim();
  const parts = flat.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts) return flat.slice(0, 300);
  return parts.slice(0, n).join('').trim();
}

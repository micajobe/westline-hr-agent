import Markdown from 'react-markdown';
import type { Answer, Citation } from '../lib/types';
import { Chip, GLYPH, Label } from './primitives';

/** answer_markdown as a lede, then "What the policy says", then labelled guidance, then applicability / withheld / escalation / done. */
export function AnswerView({ answer, onCite }: { answer: Answer; onCite: (c: Citation) => void }) {
  const factsById = new Map(answer.policy_facts.map((f) => [f.id, f]));
  return (
    <div className="space-y-6">
      <div className="prose lede"><Markdown>{answer.answer_markdown}</Markdown></div>

      {answer.policy_facts.length > 0 && (
        <section>
          <Label className="mb-3">What the policy says</Label>
          <ol className="m-0 list-none p-0">
            {answer.policy_facts.map((f, i) => (
              <li key={f.id} className="rule-soft grid grid-cols-[28px_1fr] gap-3 py-3 first:border-t-0">
                <span className="mono pt-0.5 text-[var(--muted)]">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <span>{f.statement}</span>
                  <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                    {f.citations.map((c) => <Chip key={c.chunk_id} onClick={() => onCite(c)} title={c.title}>{c.doc_id} {c.section_path}</Chip>)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {answer.recommendations.length > 0 && (
        <section className="strip-dashed p-4">
          <Label className="mb-2">Recommended next steps · guidance, not policy</Label>
          <ul className="m-0 list-none p-0">
            {answer.recommendations.map((r, i) => (
              <li key={i} className="grid grid-cols-[28px_1fr] gap-3 py-1">
                <span className="mono pt-0.5 text-[var(--muted)]">{String(i + 1).padStart(2, '0')}</span>
                <span>{r.text}{r.basis_fact_ids.length > 0 && <span className="mono ml-2 text-[var(--muted)]">← {r.basis_fact_ids.filter((id) => factsById.has(id)).join(', ')}</span>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(answer.applicability || answer.escalation.target !== 'none' || answer.withheld_by_audience || answer.actions_taken.length > 0) && (
        <section className="rule pt-3">
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2">
            {answer.applicability && (<><dt className="eyebrow pt-1">Applies to</dt><dd className="m-0">{answer.applicability.workforce_class.replace('_', ' ')} — {answer.applicability.note}{answer.applicability.citation && <span className="ml-2 inline-flex align-middle"><Chip onClick={() => onCite(answer.applicability!.citation!)}>{answer.applicability.citation.doc_id} {answer.applicability.citation.section_path}</Chip></span>}</dd></>)}
            {answer.withheld_by_audience && (<><dt className="eyebrow pt-1">{GLYPH.warn} Withheld</dt><dd className="m-0">{answer.withheld_by_audience.explanation}</dd></>)}
            {answer.escalation.target !== 'none' && (<><dt className="eyebrow pt-1">{GLYPH.warn} Escalation</dt><dd className="m-0"><span className="mono">{answer.escalation.target.replace('_', ' ')}</span>{answer.escalation.reason ? ` — ${answer.escalation.reason}` : ''}</dd></>)}
            {answer.actions_taken.map((a) => (<><dt key={`${a.ref_id}-k`} className="eyebrow pt-1">{GLYPH.on} Done</dt><dd key={`${a.ref_id}-v`} className="m-0">{a.result_summary} <span className="mono text-[var(--muted)]">{a.ref_id}</span></dd></>))}
          </dl>
        </section>
      )}
    </div>
  );
}

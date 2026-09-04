import Markdown from 'react-markdown';
import type { Answer, Citation } from '../lib/types';
import { Badge, Chip, Label } from './primitives';

/** PRD §9.1: answer_markdown, then "What the policy says", then "Recommended next steps", then applicability, escalation, withheld. */
export function AnswerView({ answer, onCite }: { answer: Answer; onCite: (c: Citation) => void }) {
  const factsById = new Map(answer.policy_facts.map((f) => [f.id, f]));
  return (
    <div className="space-y-4">
      <div className="prose text-[var(--text-16)] leading-relaxed"><Markdown>{answer.answer_markdown}</Markdown></div>

      {answer.policy_facts.length > 0 && (
        <section>
          <Label className="mb-2">What the policy says</Label>
          <ol className="space-y-2 border-l border-[var(--rule)] pl-4">
            {answer.policy_facts.map((f) => (
              <li key={f.id} className="text-[var(--text-14)] leading-relaxed">
                <span>{f.statement}</span>
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {f.citations.map((c) => <Chip key={c.chunk_id} onClick={() => onCite(c)} title={c.title}>{c.doc_id} {c.section_path}</Chip>)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {answer.recommendations.length > 0 && (
        <section className="border border-dashed border-[var(--rule)] p-3">
          <div className="mb-2 flex items-center gap-2"><Label>Recommended next steps</Label><Badge tone="muted">guidance</Badge></div>
          <ul className="space-y-1 pl-4 text-[var(--text-14)]">
            {answer.recommendations.map((r, i) => (
              <li key={i} className="list-disc">{r.text}{r.basis_fact_ids.length > 0 && <span className="mono ml-2 text-[var(--muted)]">based on {r.basis_fact_ids.filter((id) => factsById.has(id)).join(', ')}</span>}</li>
            ))}
          </ul>
        </section>
      )}

      {(answer.applicability || answer.escalation.target !== 'none' || answer.withheld_by_audience || answer.actions_taken.length > 0) && (
        <section className="space-y-1 text-[var(--text-14)]">
          {answer.applicability && (
            <div><Label className="inline">Applies to</Label> <span className="ml-2">{answer.applicability.workforce_class.replace('_', ' ')} — {answer.applicability.note}</span>{answer.applicability.citation && <Chip onClick={() => onCite(answer.applicability!.citation!)}>{answer.applicability.citation.doc_id} {answer.applicability.citation.section_path}</Chip>}</div>
          )}
          {answer.withheld_by_audience && (
            <div className="text-[var(--warn)]"><Label className="inline !text-[var(--warn)]">Withheld</Label> <span className="ml-2">{answer.withheld_by_audience.explanation}</span></div>
          )}
          {answer.escalation.target !== 'none' && (
            <div className="text-[var(--accent)]"><Label className="inline !text-[var(--accent)]">Escalation</Label> <span className="ml-2">{answer.escalation.target.replace('_', ' ')}{answer.escalation.reason ? ` — ${answer.escalation.reason}` : ''}</span></div>
          )}
          {answer.actions_taken.map((a) => (
            <div key={a.ref_id} className="text-[var(--ok)]"><Label className="inline !text-[var(--ok)]">Done</Label> <span className="ml-2">{a.result_summary}</span> <span className="mono text-[var(--muted)]">{a.ref_id}</span></div>
          ))}
        </section>
      )}
    </div>
  );
}

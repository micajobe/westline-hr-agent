import type { Citation } from '../lib/types';
import { Label } from './primitives';

const FORMAT: Record<string, string> = { PTO: 'HTML', BENEFITS: 'HTML', INFOSEC: 'PDF', EXPENSE: 'PDF' };

/** PRD §9.1 citation card: doc title, section path as headline, snippet, source format, effective date. */
export function CitationCard({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const format = FORMAT[citation.doc_id] ?? 'Markdown';
  // Snippets are raw normalised markdown; strip inline markers for display, never for matching.
  const snippet = citation.snippet.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#+\s+/gm, '');
  return (
    <aside className="border border-[var(--ink)] bg-white p-4" role="dialog" aria-label="Citation">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>{citation.title}</Label>
          <div className="display mt-1 text-[var(--text-20)] leading-tight">{citation.doc_id} {citation.section_path}</div>
        </div>
        <button type="button" className="text-[var(--muted)] hover:text-[var(--ink)]" onClick={onClose}>close</button>
      </div>
      <p className="mt-3 text-[var(--text-14)] leading-relaxed text-[var(--ink)]">{snippet}{citation.snippet.length >= 240 ? '…' : ''}</p>
      <div className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
        <span>chunk {citation.chunk_id}</span>
        <span>source {format}</span>
        <span>effective 2026-01-01</span>
      </div>
    </aside>
  );
}

import { Link } from 'react-router-dom';
import type { Citation } from '../lib/types';
import { handbookHref } from '../pages/Handbook';
import { Label } from './primitives';

const FORMAT: Record<string, string> = { PTO: 'HTML', BENEFITS: 'HTML', INFOSEC: 'PDF', EXPENSE: 'PDF' };

/** PRD §9.1 citation card: doc title, section path as headline, snippet, source format, effective date. */
export function CitationCard({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const format = FORMAT[citation.doc_id] ?? 'Markdown';
  const snippet = citation.snippet.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#+\s+/gm, '');
  return (
    <aside className="border border-[var(--ink)] bg-[var(--paper)] p-5" role="dialog" aria-label="Citation">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>{citation.title}</Label>
          <div className="headline mt-1 text-[length:var(--t-h2)]">{citation.doc_id} <span className="mono text-[0.55em] tracking-normal">{citation.section_path}</span></div>
        </div>
        <button type="button" className="link link-muted" onClick={onClose}>close</button>
      </div>
      <p className="lede mt-4">{snippet}{citation.snippet.length >= 240 ? '…' : ''}</p>
      <div className="mono mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[var(--muted)]">
        <span>chunk {citation.chunk_id}</span><span>source {format}</span><span>effective 2026-01-01</span>
        {/* An excerpt is one chunk; the section around it is what makes it readable. */}
        <Link to={handbookHref(citation.doc_id, citation.section_path)} className="link ml-auto">
          Read {citation.section_path} in the handbook
        </Link>
      </div>
    </aside>
  );
}

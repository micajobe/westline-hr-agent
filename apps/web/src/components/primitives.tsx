import type { ReactNode } from 'react';

/** Workforce class by border treatment, never colour: staff solid, contractor dashed, creator partner filled. */
export function ClassBadge({ workforce_class, className = '' }: { workforce_class: string; className?: string }) {
  const variant = workforce_class === 'creator_partner' ? 'tag-fill' : workforce_class === 'contractor' ? 'tag-dashed' : '';
  return <span className={`tag ${variant} ${className}`}>{workforce_class.replace('_', ' ')}</span>;
}

/** State glyphs (the system's ● ◌ △): solid = on/done, hollow = pending/off, triangle = attention. */
export const GLYPH = { on: '●', off: '◌', warn: '△' } as const;

/**
 * The working mark: an eight-spoke asterisk that turns while a turn is in flight. Spokes alternate
 * long and short so the rotation is actually legible — eight equal spokes are symmetric enough to
 * look still. It honours `prefers-reduced-motion` and falls back to the same mark, static.
 */
export function Asterisk({ className = '' }: { className?: string }) {
  return (
    <svg className={`asterisk-spin inline-block h-3.5 w-3.5 align-[-0.15em] ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const long = i % 2 === 0;
        return <rect key={deg} x="11.1" y={long ? 2.4 : 5.2} width="1.8" height={long ? 9.2 : 6.4} rx="0.9" transform={`rotate(${deg} 12 12)`} />;
      })}
    </svg>
  );
}

export function Badge({ children, tone = 'ink', className = '' }: { children: ReactNode; tone?: 'ink' | 'muted' | 'fill' | 'dashed'; className?: string }) {
  const v = tone === 'fill' ? 'tag-fill' : tone === 'dashed' ? 'tag-dashed' : tone === 'muted' ? 'tag-muted' : '';
  return <span className={`tag ${v} ${className}`}>{children}</span>;
}

export function Chip({ children, onClick, active = false, title }: { children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`mono-xs inline-flex items-center gap-1 border px-1.5 py-px uppercase ${active ? 'bg-[var(--ink)] text-[color:var(--paper)]' : 'border-[var(--ink)] hover:bg-[var(--paper-2)]'}`} style={{ borderColor: 'var(--ink)' }}>
      {children}
    </button>
  );
}

export function Rule({ className = '', soft = false }: { className?: string; soft?: boolean }) {
  return <hr className={`${soft ? 'rule-soft' : 'rule'} m-0 border-0 ${className}`} />;
}

/** Eyebrow: mono, 11px, uppercase, 0.14em. */
export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary className="mono-xs flex items-center gap-2 uppercase text-[var(--muted)] hover:text-[var(--ink)]">
        <span className="inline-block w-3 text-center group-open:hidden">+</span>
        <span className="hidden w-3 text-center group-open:inline-block">−</span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-words border border-[var(--paper-2)] bg-[var(--paper)] p-2 text-[11.5px] leading-[1.5] tracking-normal">{JSON.stringify(value, null, 2)}</pre>;
}

/**
 * Panel show/hide, following the navigator pattern in ~/strategy-navigator
 * (`table-of-contents.tsx`, `navigator-layout.tsx`): a bare 16px stroked chevron pointing the way
 * the panel will move, never a word. `side` is the edge the panel is docked to.
 */
export function PanelToggle({ side, collapsed, onToggle, label }: { side: 'left' | 'right'; collapsed: boolean; onToggle: () => void; label: string }) {
  const points: 'left' | 'right' = collapsed === (side === 'left') ? 'right' : 'left';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${collapsed ? 'Show' : 'Hide'} ${label}`}
      aria-label={`${collapsed ? 'Show' : 'Hide'} ${label}`}
      aria-expanded={!collapsed}
      className="flex h-6 w-6 items-center justify-center text-[var(--muted)] hover:text-[var(--ink)]"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={points === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );
}

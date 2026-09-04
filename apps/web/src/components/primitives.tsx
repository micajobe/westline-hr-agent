import type { ReactNode } from 'react';

/** PRD §9.2: class badges — staff = ink outline, contractor = muted outline, creator_partner = accent outline. */
export function ClassBadge({ workforce_class, className = '' }: { workforce_class: string; className?: string }) {
  const color = workforce_class === 'creator_partner' ? 'var(--accent)' : workforce_class === 'contractor' ? 'var(--muted)' : 'var(--ink)';
  return (
    <span className={`inline-block rounded-none border px-1.5 py-px text-[11px] uppercase tracking-[0.08em] leading-4 ${className}`} style={{ borderColor: color, color }}>
      {workforce_class.replace('_', ' ')}
    </span>
  );
}

export function Badge({ children, tone = 'ink', className = '' }: { children: ReactNode; tone?: 'ink' | 'muted' | 'accent' | 'ok' | 'warn'; className?: string }) {
  const color = { ink: 'var(--ink)', muted: 'var(--muted)', accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)' }[tone];
  return <span className={`inline-block border px-1.5 py-px text-[11px] uppercase tracking-[0.08em] leading-4 ${className}`} style={{ borderColor: color, color }}>{children}</span>;
}

export function Chip({ children, onClick, active = false, title }: { children: ReactNode; onClick?: () => void; active?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className="mono inline-flex items-center gap-1 border px-1.5 py-px leading-4 hover:bg-[var(--rule)]" style={{ borderColor: active ? 'var(--ink)' : 'var(--rule)', background: active ? 'var(--rule)' : 'transparent' }}>
      {children}
    </button>
  );
}

export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`rule m-0 border-0 ${className}`} />;
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`text-[11px] uppercase tracking-[0.1em] text-[var(--muted)] ${className}`}>{children}</div>;
}

export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--ink)]">
        <span className="inline-block w-3 text-center group-open:hidden">+</span>
        <span className="hidden w-3 text-center group-open:inline-block">−</span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-words border border-[var(--rule)] bg-white p-2 leading-4">{JSON.stringify(value, null, 2)}</pre>;
}

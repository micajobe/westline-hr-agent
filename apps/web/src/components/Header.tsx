import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import type { Health, Persona } from '../lib/types';
import { ClassBadge, Json, Label } from './primitives';

export function Header({ personas, persona, onPersona }: { personas: Persona[]; persona: Persona | null; onPersona: (p: Persona | null) => void }) {
  const loc = useLocation();
  const nav = (to: string, label: string) => (
    <Link to={to} className={`px-1 ${loc.pathname === to ? 'text-[var(--ink)] underline underline-offset-4' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>{label}</Link>
  );
  return (
    <header className="border-b border-[var(--rule)]">
      <div className="mx-auto flex max-w-[var(--max-content)] items-center gap-6 px-6 py-3">
        <Link to="/" className="display text-[var(--text-20)] leading-none">Westline<span className="text-[var(--muted)]"> · HR assistant</span></Link>
        <nav className="flex items-center gap-3 text-[var(--text-14)]">{nav('/', 'Chat')}{nav('/desk', 'Desk')}{nav('/eval', 'Eval')}</nav>
        <div className="ml-auto flex items-center gap-4">
          <PersonaSwitcher personas={personas} persona={persona} onPersona={onPersona} />
          <HealthDot />
        </div>
      </div>
    </header>
  );
}

function PersonaSwitcher({ personas, persona, onPersona }: { personas: Persona[]; persona: Persona | null; onPersona: (p: Persona | null) => void }) {
  return (
    <label className="flex items-center gap-2">
      <Label>Acting as</Label>
      <select
        className="max-w-[320px] border border-[var(--rule)] bg-white px-2 py-1 text-[var(--text-14)]"
        value={persona?.person_id ?? ''}
        onChange={(e) => onPersona(personas.find((p) => p.person_id === e.target.value) ?? null)}
      >
        <option value="">No persona (anonymous)</option>
        {personas.map((p) => (
          <option key={p.person_id} value={p.person_id}>{p.name} · {p.title} · {p.workforce_class.replace('_', ' ')} · {p.scope}</option>
        ))}
      </select>
      {persona && <ClassBadge workforce_class={persona.workforce_class} />}
      {persona && <span className="text-[var(--muted)]">{persona.scope}</span>}
    </label>
  );
}

function HealthDot() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = () => api.health().then((h) => { setHealth(h); setErr(null); }).catch((e: Error) => setErr(e.message));
  useEffect(() => { void refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, []);
  const color = err ? 'var(--accent)' : !health ? 'var(--muted)' : health.status === 'ok' ? 'var(--ok)' : 'var(--warn)';
  const label = err ? 'unreachable' : !health ? 'checking' : health.status === 'ok' ? 'healthy' : health.status;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--ink)]" title="Health">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[var(--text-12)] uppercase tracking-[0.08em]">{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-[520px] border border-[var(--rule)] bg-[var(--paper)] p-3">
          <div className="mb-2 flex items-center justify-between"><Label>GET /health</Label><button type="button" className="text-[var(--muted)]" onClick={() => setOpen(false)}>close</button></div>
          {health && (
            <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-12)]">
              {Object.entries(health.mcp).map(([name, s]) => (
                <div key={name} className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.status === 'connected' ? 'var(--ok)' : s.status === 'disabled' ? 'var(--warn)' : 'var(--accent)' }} /><span className="mono">{name}</span><span className="text-[var(--muted)]">{s.status} · {s.tools} tools{s.latency_ms != null ? ` · ${s.latency_ms} ms` : ''}</span></div>
              ))}
              <div><span className="text-[var(--muted)]">mode</span> <span className="mono">{health.mode.mcp}{health.mode.chaos ? ' · chaos' : ''}</span></div>
              <div><span className="text-[var(--muted)]">model</span> <span className="mono">{health.models.agent}{health.models.available ? '' : ' (no key)'}</span></div>
              {health.index && <div className="col-span-2"><span className="text-[var(--muted)]">index</span> <span className="mono">{health.index.chunk_count} chunks · {health.index.embedding_model} · {health.index.corpus_hash.slice(0, 12)}</span></div>}
            </div>
          )}
          <Json value={err ? { error: err } : health} />
        </div>
      )}
    </div>
  );
}

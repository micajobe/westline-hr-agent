import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import type { Health, Persona } from '../lib/types';
import { PersonaSelect } from './PersonaSelect';
import { GLYPH, Json, Label } from './primitives';

export function Header({ personas, persona, onPersona }: { personas: Persona[]; persona: Persona | null; onPersona: (p: Persona | null) => void }) {
  const loc = useLocation();
  // `/handbook/PTO` still marks Handbook as the current tab; only `/` matches exactly.
  const current = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  const nav = (to: string, label: string) => (
    <Link to={to} className={`link ${current(to) ? '' : 'link-muted'}`} style={{ borderBottomWidth: current(to) ? 1 : 0 }}>{label}</Link>
  );
  return (
    <header className="shrink-0 border-b border-[var(--ink)]">
      <div className="flex w-full items-center gap-8 px-6 py-3">
        <Link to="/" className="headline text-[22px]">Westline <span className="pull font-light text-[var(--muted)]">HR assistant</span></Link>
        <nav className="flex items-center gap-5">{nav('/', 'Chat')}{nav('/handbook', 'Handbook')}{nav('/desk', 'Desk')}{nav('/eval', 'Eval')}</nav>
        <div className="ml-auto flex items-center gap-5">
          <PersonaSelect personas={personas} persona={persona} onPersona={onPersona} />
          <HealthDot />
        </div>
      </div>
    </header>
  );
}

function HealthDot() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const refresh = () => api.health().then((h) => { setHealth(h); setErr(null); }).catch((e: Error) => setErr(e.message));
  useEffect(() => { void refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, []);
  const glyph = err ? GLYPH.warn : !health ? GLYPH.off : health.status === 'ok' ? GLYPH.on : GLYPH.warn;
  const label = err ? 'unreachable' : !health ? 'checking' : health.status === 'ok' ? 'healthy' : health.status;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="mono-xs flex items-center gap-2 uppercase text-[var(--ink)]" title="Health">
        <span>{glyph}</span><span className={label === 'healthy' ? '' : 'text-[var(--muted)]'}>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-[560px] border border-[var(--ink)] bg-[var(--paper)] p-4">
          <div className="mb-3 flex items-center justify-between"><Label>GET /health</Label><button type="button" className="link link-muted" onClick={() => setOpen(false)}>close</button></div>
          {health && (
            <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[length:var(--t-body-sm)]">
              {Object.entries(health.mcp).flatMap(([name, s]) => [
                <dt key={`${name}-k`} className="mono">{name}</dt>,
                <dd key={`${name}-v`} className="m-0">{s.status === 'connected' ? GLYPH.on : s.status === 'disabled' ? GLYPH.off : GLYPH.warn} {s.status} · <span className="mono">{s.tools}</span> tools{s.latency_ms != null ? <> · <span className="mono">{s.latency_ms}</span> ms</> : null}</dd>,
              ])}
              <dt className="mono">mode</dt><dd className="m-0">{health.mode.mcp}{health.mode.chaos ? ' · chaos' : ''}</dd>
              <dt className="mono">model</dt><dd className="m-0">{health.models.agent}{health.models.available ? '' : ' — no key'}</dd>
              {health.index && <><dt className="mono">index</dt><dd className="m-0"><span className="mono">{health.index.chunk_count}</span> chunks · {health.index.embedding_model} · <span className="mono">{health.index.corpus_hash.slice(0, 12)}</span></dd></>}
            </dl>
          )}
          <Json value={err ? { error: err } : health} />
        </div>
      )}
    </div>
  );
}

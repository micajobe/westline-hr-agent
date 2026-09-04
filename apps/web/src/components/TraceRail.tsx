import { useMemo, useState } from 'react';
import type { TraceEvent } from '../lib/types';
import { Chip, Details, Json, Label } from './primitives';

export interface TraceTurn { turn_id: string; label: string; events: TraceEvent[]; live?: boolean }

/** PRD §9.1: a flight recorder, not a log dump. Grouped by turn; each event one row; gates stay highlighted until resolved. */
export function TraceRail({ turns }: { turns: TraceTurn[] }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className="flex h-full flex-col border-l border-[var(--rule)]">
      <div className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-2">
        <Label>Trace</Label>
        <button type="button" className="text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => setCollapsed((c) => !c)}>{collapsed ? 'expand' : 'collapse'}</button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {turns.length === 0 && <p className="p-4 text-[var(--muted)]">Tool calls, retrievals, gates and verification for each turn appear here as they happen.</p>}
          {turns.map((t) => <TurnGroup key={t.turn_id} turn={t} />)}
        </div>
      )}
    </aside>
  );
}

function TurnGroup({ turn }: { turn: TraceTurn }) {
  const resolvedGates = useMemo(() => new Set(turn.events.filter((e) => e.type === 'gate_resolved').map((e) => e.tool)), [turn.events]);
  const total = turn.events.reduce((s, e) => s + (e.duration_ms ?? 0), 0);
  return (
    <section className="border-b border-[var(--rule)]">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
        <div className="min-w-0 flex-1 truncate text-[var(--text-12)] text-[var(--muted)]" title={turn.label}>{turn.label}</div>
        <div className="mono shrink-0 text-[var(--muted)]">{turn.turn_id}{total ? ` · ${(total / 1000).toFixed(1)}s` : ''}{turn.live ? ' · live' : ''}</div>
      </div>
      <ol>
        {turn.events.map((e) => <EventRow key={`${e.turn_id}-${e.seq}`} e={e} pendingGate={e.type === 'gate' && !resolvedGates.has(e.tool)} />)}
      </ol>
    </section>
  );
}

const TYPE_LABEL: Record<TraceEvent['type'], string> = {
  intent: 'intent', plan: 'plan', tool_call: 'call', tool_result: 'result', retrieval: 'retrieval', gate: 'gate', gate_resolved: 'gate', synthesis: 'synthesis', verify: 'verify', error: 'error',
};

function statusTone(e: TraceEvent): string {
  if (e.type === 'error' || e.result_status === 'TOOL_UNAVAILABLE') return 'var(--accent)';
  if (e.type === 'gate') return 'var(--accent)';
  if (e.type === 'gate_resolved') return e.result_status === 'confirmed' ? 'var(--ok)' : 'var(--muted)';
  if (['FORBIDDEN', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_APPLICABLE', 'FORBIDDEN_AUDIENCE', 'CONFIRMATION_REQUIRED'].includes(e.result_status ?? '')) return 'var(--warn)';
  if (e.type === 'verify' && e.result_status === 'unsupported_claim_removed') return 'var(--warn)';
  if (e.type === 'verify' || e.type === 'synthesis') return 'var(--ok)';
  return 'var(--muted)';
}

function EventRow({ e, pendingGate }: { e: TraceEvent; pendingGate: boolean }) {
  const isTool = Boolean(e.tool);
  const name = e.tool ? e.tool.replace('__', ' · ') : '';
  const right = e.type === 'intent' ? e.result_summary : e.type === 'plan' ? e.result_summary : e.type === 'tool_call' ? 'called' : e.result_summary ?? e.result_status ?? '';
  const detail = e.args || e.detail || (e.citations && e.citations.length);
  return (
    <li className={`px-4 py-1.5 ${pendingGate ? 'border-l-2 border-[var(--accent)] bg-white' : 'border-l-2 border-transparent'}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="mono w-[72px] shrink-0 text-[var(--muted)]">{TYPE_LABEL[e.type]}</span>
            {isTool && e.type !== 'tool_result' ? <span className="mono truncate" title={name}>{name}</span> : !isTool && right ? <span className="truncate" style={{ color: statusTone(e) }}>{right}</span> : null}
            {e.duration_ms != null && e.type !== 'tool_call' && <span className="mono shrink-0 text-[var(--muted)]">{e.duration_ms} ms</span>}
          </div>
          {isTool && right && e.type !== 'tool_call' && <div className="mt-0.5 pl-[80px] text-[var(--text-12)] leading-4" style={{ color: statusTone(e) }}>{right}</div>}
          {e.citations && e.citations.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-[80px]">{dedupe(e.citations).map((c) => <Chip key={`${c.doc_id}${c.section_path}`}>{c.doc_id} {c.section_path}</Chip>)}</div>
          )}
        </div>
        <div className="mono shrink-0 text-right" style={{ color: statusTone(e) }}>{e.result_status ?? (e.type === 'tool_call' ? '→' : '')}</div>
      </div>
      {detail ? (
        <div className="mt-1 pl-[80px] text-[var(--text-12)]">
          <Details summary={<span>details</span>}>
            {e.args && <><Label>args</Label><Json value={e.args} /></>}
            {e.detail && <><Label className="mt-2">detail</Label><Json value={e.detail} /></>}
          </Details>
        </div>
      ) : null}
    </li>
  );
}

function dedupe<T extends { doc_id: string; section_path: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(`${c.doc_id}${c.section_path}`) ? false : (seen.add(`${c.doc_id}${c.section_path}`), true)));
}

import { useMemo } from 'react';
import type { TraceEvent } from '../lib/types';
import { Chip, Details, GLYPH, Json, Label, PanelToggle } from './primitives';

export interface TraceTurn { turn_id: string; label: string; events: TraceEvent[]; live?: boolean }

/** A flight recorder: grouped by turn, one row per event, state by glyph and weight, never colour. */
export function TraceRail({ turns, collapsed, onToggle }: { turns: TraceTurn[]; collapsed: boolean; onToggle: () => void }) {
  if (collapsed) {
    return (
      <aside className="flex h-full flex-col items-center gap-3 border-l border-[var(--ink)] py-2">
        <PanelToggle side="right" collapsed onToggle={onToggle} label="trace" />
        <span className="mono-xs text-[var(--muted)]">{turns.length}</span>
      </aside>
    );
  }
  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[var(--ink)]">
      <div className="flex items-center justify-between border-b border-[var(--ink)] px-4 py-2">
        <Label>Trace</Label>
        <PanelToggle side="right" collapsed={false} onToggle={onToggle} label="trace" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {turns.length === 0 && <p className="p-4 text-[length:var(--t-body-sm)] text-[var(--muted)]">Tool calls, retrievals, gates and verification for each turn appear here as they happen.</p>}
        {turns.map((t, i) => <TurnGroup key={t.turn_id} turn={t} index={i + 1} />)}
      </div>
    </aside>
  );
}

function TurnGroup({ turn, index }: { turn: TraceTurn; index: number }) {
  const resolvedGates = useMemo(() => new Set(turn.events.filter((e) => e.type === 'gate_resolved').map((e) => e.tool)), [turn.events]);
  const total = turn.events.reduce((s, e) => s + (e.duration_ms ?? 0), 0);
  return (
    <section className="border-b border-[var(--ink)]">
      <div className="flex items-baseline gap-3 px-4 pt-3 pb-1">
        <span className="mono text-[var(--muted)]">{String(index).padStart(2, '0')}</span>
        <div className="min-w-0 flex-1 truncate text-[length:var(--t-body-sm)] text-[var(--muted)]" title={turn.label}>{turn.label}</div>
        <div className="mono shrink-0 text-[var(--muted)]">{total ? `${(total / 1000).toFixed(1)}s` : ''}{turn.live ? ` ${GLYPH.off}` : ''}</div>
      </div>
      <ol className="m-0 list-none p-0">
        {turn.events.map((e) => <EventRow key={`${e.turn_id}-${e.seq}`} e={e} pendingGate={e.type === 'gate' && !resolvedGates.has(e.tool)} />)}
      </ol>
    </section>
  );
}

const TYPE_LABEL: Record<TraceEvent['type'], string> = { intent: 'intent', plan: 'plan', tool_call: 'call', tool_result: 'result', retrieval: 'retrieval', gate: 'gate', gate_resolved: 'gate', synthesis: 'synthesis', verify: 'verify', error: 'error' };

const ATTENTION = new Set(['FORBIDDEN', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_APPLICABLE', 'FORBIDDEN_AUDIENCE', 'CONFIRMATION_REQUIRED', 'TOOL_UNAVAILABLE', 'unsupported_claim_removed']);

function glyphFor(e: TraceEvent): string {
  if (e.type === 'error' || e.type === 'gate') return GLYPH.warn;
  if (e.type === 'gate_resolved') return e.result_status === 'confirmed' ? GLYPH.on : GLYPH.off;
  if (e.type === 'tool_call') return GLYPH.off;
  if (ATTENTION.has(e.result_status ?? '')) return GLYPH.warn;
  if (e.type === 'tool_result' || e.type === 'retrieval' || e.type === 'synthesis' || e.type === 'verify') return GLYPH.on;
  return '';
}

function EventRow({ e, pendingGate }: { e: TraceEvent; pendingGate: boolean }) {
  const isTool = Boolean(e.tool);
  const name = e.tool ? e.tool.replace('__', ' · ') : '';
  const right = e.type === 'tool_call' ? '' : e.result_summary ?? e.result_status ?? '';
  const attention = e.type === 'gate' || e.type === 'error' || ATTENTION.has(e.result_status ?? '');
  const detail = e.args || e.detail || (e.citations && e.citations.length);
  return (
    <li className="rule-soft px-4 py-2" style={pendingGate ? { borderLeft: '2px dashed var(--ink)' } : undefined}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="mono w-[76px] shrink-0 uppercase text-[var(--muted)]">{TYPE_LABEL[e.type]}</span>
            {isTool && e.type !== 'tool_result' ? <span className={`mono truncate ${attention ? 'font-medium' : ''}`} title={name}>{name}</span> : !isTool && right ? <span className={`truncate text-[length:var(--t-body-sm)] ${attention ? 'font-medium' : ''}`}>{right}</span> : null}
            {e.duration_ms != null && e.type !== 'tool_call' && <span className="mono shrink-0 text-[var(--muted)]">{e.duration_ms} ms</span>}
          </div>
          {isTool && right && e.type !== 'tool_call' && <div className={`mt-0.5 pl-[84px] text-[length:var(--t-body-sm)] leading-[1.4] ${attention ? 'font-medium' : 'text-[var(--ink-2)]'}`}>{right}</div>}
          {e.citations && e.citations.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 pl-[84px]">{dedupe(e.citations).map((c) => <Chip key={`${c.doc_id}${c.section_path}`}>{c.doc_id} {c.section_path}</Chip>)}</div>
          )}
        </div>
        <div className="mono shrink-0 text-right" title={e.result_status}>{glyphFor(e)} {e.result_status && e.result_status !== 'ok' ? <span className="uppercase">{e.result_status}</span> : null}</div>
      </div>
      {detail ? (
        <div className="mt-1 pl-[84px]">
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

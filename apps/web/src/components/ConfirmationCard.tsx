import type { ConfirmationRequest } from '../lib/types';
import { Details, GLYPH, Json, Label } from './primitives';

/** The system's "exception strip": a dashed rule, no colour. The pause is the design. */
export function ConfirmationCard({ request, busy, onDecision }: { request: ConfirmationRequest; busy: boolean; onDecision: (d: 'confirm' | 'cancel') => void }) {
  return (
    <div className="strip-dashed p-5">
      <div className="flex items-center gap-3"><Label className="!text-[var(--ink)]">{GLYPH.warn} Confirmation required</Label><span className="mono text-[var(--muted)]">{request.tool}</span></div>
      <p className="lede mt-3">{request.summary}</p>
      <p className="mt-2 text-[length:var(--t-body-sm)] text-[var(--muted)]">Nothing has been created, drafted or sent. Confirming mints a single-use token bound to exactly these arguments.</p>
      <div className="mt-3"><Details summary={<span>args · {request.args_hash.slice(0, 16)}…</span>}><Json value={request.args} /></Details></div>
      <div className="mt-5 flex gap-3">
        <button type="button" disabled={busy} onClick={() => onDecision('confirm')} className="btn">Confirm</button>
        <button type="button" disabled={busy} onClick={() => onDecision('cancel')} className="btn btn-outline">Cancel</button>
      </div>
    </div>
  );
}

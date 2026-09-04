import type { ConfirmationRequest } from '../lib/types';
import { Details, Json, Label } from './primitives';

/** PRD §9.1: tool name, human summary, exact args, Confirm / Cancel. The accent colour is reserved for moments like this. */
export function ConfirmationCard({ request, busy, onDecision }: { request: ConfirmationRequest; busy: boolean; onDecision: (d: 'confirm' | 'cancel') => void }) {
  return (
    <div className="border-l-2 border-[var(--accent)] bg-white p-4">
      <div className="flex items-center gap-3"><Label className="!text-[var(--accent)]">Confirmation required</Label><span className="mono text-[var(--muted)]">{request.tool}</span></div>
      <p className="mt-2 text-[var(--text-16)] leading-snug">{request.summary}</p>
      <p className="mt-1 text-[var(--muted)]">Nothing has been created, drafted or sent. Confirming mints a single-use token bound to exactly these arguments.</p>
      <div className="mt-3"><Details summary={<span className="mono">args · {request.args_hash.slice(0, 16)}…</span>}><Json value={request.args} /></Details></div>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy} onClick={() => onDecision('confirm')} className="border border-[var(--ink)] bg-[var(--ink)] px-3 py-1.5 text-[color:var(--paper)] disabled:opacity-50">Confirm</button>
        <button type="button" disabled={busy} onClick={() => onDecision('cancel')} className="border border-[var(--ink)] px-3 py-1.5 disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}

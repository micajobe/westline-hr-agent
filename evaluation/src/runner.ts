import type { Envelope, EvalItem, ItemRun } from './types.js';
import { scoreDeterministic } from './metrics.js';

export interface RunOptions {
  baseUrl: string;
  config: string;
  run: number;
  /** Confirm a proposed action so workflows complete and the desk write is observed. */
  confirmGates: boolean;
  timeoutMs?: number;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** One item, one run: POST /chat (timed), optionally POST /confirm, deterministic scores. Judge scores are added later. */
export async function runItem(item: EvalItem, opts: RunOptions): Promise<ItemRun> {
  const timeout = opts.timeoutMs ?? 180_000;
  const started = Date.now();
  const started_at = new Date(started).toISOString();
  try {
    const envelope = await postJson<Envelope>(`${opts.baseUrl}/chat`, { message: item.message, acting_person_id: item.acting_person_id }, timeout);
    const latency_ms = Date.now() - started;
    let final: Envelope | undefined;
    let confirmed_gate = false;
    if (envelope.confirmation_required && opts.confirmGates) {
      final = await postJson<Envelope>(`${opts.baseUrl}/confirm`, { conversation_id: envelope.conversation_id, turn_id: envelope.turn_id, args_hash: envelope.confirmation_required.args_hash, decision: 'confirm' }, timeout);
      confirmed_gate = true;
    }
    const det = scoreDeterministic(item, envelope, final);
    return { item_id: item.id, config: opts.config, run: opts.run, started_at, latency_ms, envelope, final, confirmed_gate, scores: { ...det, groundedness: null, answer_match: null } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const empty: Envelope = { turn_id: '', conversation_id: '', answer: { answer_markdown: '', policy_facts: [], recommendations: [], applicability: null, actions_proposed: [], actions_taken: [], escalation: { target: 'none', reason: '' }, clarification: null, withheld_by_audience: null }, trace: [{ ts: started_at, turn_id: '', seq: 0, type: 'error', result_status: 'request_failed', result_summary: message }] };
    const det = scoreDeterministic(item, empty, undefined);
    return { item_id: item.id, config: opts.config, run: opts.run, started_at, latency_ms: Date.now() - started, envelope: empty, confirmed_gate: false, error: message, scores: { ...det, workflow_complete: false, groundedness: null, answer_match: null } };
  }
}

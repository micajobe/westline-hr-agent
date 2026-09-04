import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL_DIR } from './set.js';

/**
 * PRD §12.2 cold start: wait until the deployed free-tier service has been idle for ≥16 minutes,
 * then time the first request, N times. Writes evaluation/results/cold_start.json, which the report
 * merges into latency.cold_runs on the next `npm run eval`.
 *
 *   node evaluation/dist/cold_start.js --url https://westline-app.onrender.com [--trials 3] [--idle-minutes 16]
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string, d?: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const url = (get('--url') ?? process.env.DEPLOYED_APP_URL ?? '').replace(/\/$/, '');
  if (!url) throw new Error('--url or DEPLOYED_APP_URL required');
  const trials = Number(get('--trials', '3'));
  const idleMin = Number(get('--idle-minutes', '16'));
  const results: { trial: number; idle_minutes: number; first_request_ms: number; first_status: string; second_request_ms: number; chat_ms: number | null }[] = [];

  for (let t = 1; t <= trials; t++) {
    console.error(`[cold] trial ${t}: idling ${idleMin} min so both Render services sleep…`);
    await new Promise((r) => setTimeout(r, idleMin * 60_000));
    const t0 = Date.now();
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(180_000) }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ status: e.message }) }) as unknown as Response);
    const first_request_ms = Date.now() - t0;
    const body = (await res.json().catch(() => ({ status: 'unparseable' }))) as { status?: string };
    const t1 = Date.now();
    await fetch(`${url}/health`, { signal: AbortSignal.timeout(60_000) }).catch(() => undefined);
    const second_request_ms = Date.now() - t1;
    let chat_ms: number | null = null;
    try {
      const t2 = Date.now();
      await fetch(`${url}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: "What's the carryover cap for unused PTO days?", acting_person_id: 'W-1042' }), signal: AbortSignal.timeout(180_000) });
      chat_ms = Date.now() - t2;
    } catch { chat_ms = null; }
    results.push({ trial: t, idle_minutes: idleMin, first_request_ms, first_status: body.status ?? String(res.status), second_request_ms, chat_ms });
    console.error(`[cold] trial ${t}: first /health ${first_request_ms} ms (${body.status}), second ${second_request_ms} ms, /chat ${chat_ms ?? 'failed'} ms`);
  }
  const out = join(EVAL_DIR, 'results');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'cold_start.json'), `${JSON.stringify({ measured_at: new Date().toISOString(), url, trials: results }, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });

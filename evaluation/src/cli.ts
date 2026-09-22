import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { ChunkResolver } from './chunks.js';
import { Judge } from './judge.js';
import { ABLATION_CONFIGS, BASE_CONFIG, startLocal, type EvalConfig } from './local.js';
import { buildResults, writeResults } from './report.js';
import { runItem } from './runner.js';
import { EVAL_DIR, loadEvalSet } from './set.js';
import type { EvalItem, ItemRun } from './types.js';

interface Args { target: 'local' | 'deployed'; url?: string; runs: number; judge: boolean; ablations: boolean; only?: Set<string>; items?: Set<string>; out: string; confirmGates: boolean; timeoutMs?: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { target: 'local', runs: 1, judge: true, ablations: false, out: join(EVAL_DIR, 'results'), confirmGates: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = argv[i + 1];
    if (k === '--target') { a.target = v as Args['target']; i++; }
    else if (k === '--url') { a.url = v; i++; }
    else if (k === '--runs') { a.runs = Number(v); i++; }
    else if (k === '--no-judge') a.judge = false;
    else if (k === '--ablations') a.ablations = true;
    else if (k === '--ablation') { a.ablations = true; a.only = new Set(v!.split(',')); i++; }
    else if (k === '--items') { a.items = new Set(v!.split(',')); i++; }
    else if (k === '--out') { a.out = v!; i++; }
    else if (k === '--no-confirm') a.confirmGates = false;
    else if (k === '--timeout') { a.timeoutMs = Number(v); i++; }
    else if (k === '--help') { console.log('npm run eval -- [--target local|deployed] [--url URL] [--runs N] [--no-judge] [--ablations | --ablation name,name] [--items id,id] [--no-confirm] [--out DIR]'); process.exit(0); }
  }
  if (a.target !== 'local' && a.target !== 'deployed') throw new Error(`--target must be local or deployed`);
  if (a.target === 'deployed' && !(a.url ?? process.env.DEPLOYED_APP_URL)) throw new Error('--url or DEPLOYED_APP_URL is required for --target deployed');
  if (a.only) for (const n of a.only) if (!ABLATION_CONFIGS.some((c) => c.name === n)) throw new Error(`unknown ablation "${n}"; known: ${ABLATION_CONFIGS.map((c) => c.name).join(', ')}`);
  return a;
}

/**
 * `npm run eval -- --target local|deployed --runs N [--ablations] [--no-judge]`
 *
 * Runs every item N times against the base configuration (and, with --ablations, each PRD §12.3
 * arm against its subset; --ablation name,name selects arms, e.g. `--ablation semantic-verify`), judges groundedness and answer match with JUDGE_MODEL (tool-forced JSON; no temperature — Claude 5 rejects it),
 * and writes evaluation/results/{latest.json,latest.md,<stamp>.*,runs/<stamp>/*.json}.
 */
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const set = loadEvalSet();
  const items = set.items.filter((i) => !args.items || args.items.has(i.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const log = (m: string) => console.error(`[eval] ${m}`);
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return process.env.GIT_SHA?.slice(0, 7) ?? 'unknown'; } })();

  const judgeModel = process.env.JUDGE_MODEL ?? 'claude-opus-5';
  const judge = args.judge ? new Judge(requireEnv('ANTHROPIC_API_KEY'), judgeModel) : undefined;
  const chunks = new ChunkResolver(process.cwd());

  const configs: EvalConfig[] = [BASE_CONFIG, ...(args.ablations && args.target === 'local' ? ABLATION_CONFIGS.filter((c) => !args.only || args.only.has(c.name)) : [])];
  if (args.ablations && args.target === 'deployed') log('ablations need env control; skipping them against the deployed target');

  const runs: ItemRun[] = [];
  let agentModel = process.env.AGENT_MODEL ?? 'claude-sonnet-5';
  try {
  for (const config of configs) {
    const selected = items.filter(config.selects);
    let baseUrl: string;
    let server: Awaited<ReturnType<typeof startLocal>> | undefined;
    if (args.target === 'local') {
      log(`starting local server for config "${config.name}" ${JSON.stringify(config.env)}`);
      server = await startLocal(config);
      baseUrl = server.url;
      agentModel = server.config.agentModel;
    } else {
      baseUrl = (args.url ?? process.env.DEPLOYED_APP_URL!).replace(/\/$/, '');
      const h = (await (await fetch(`${baseUrl}/health`)).json()) as { status: string; models: { agent: string } };
      agentModel = h.models.agent;
      log(`deployed target ${baseUrl} health=${h.status}`);
    }
    try {
      for (let run = 1; run <= args.runs; run++) {
        for (const item of selected) {
          const r = await runItem(item, { baseUrl, config: config.name, run, confirmGates: args.confirmGates, timeoutMs: args.timeoutMs });
          if (judge && !r.error) await judgeWithRetry(judge, chunks, item, r, log);
          runs.push(r);
          log(`${config.name} r${run} ${item.id.padEnd(6)} ${r.error ? 'ERROR ' + r.error.slice(0, 80) : `${String(r.latency_ms).padStart(6)}ms · ${r.scores.behaviour_observed.join('/')} · tools ${r.scores.tool_selection_subset ? 'ok' : 'MISS'} · facts ${r.scores.facts}${r.scores.groundedness ? ` · grounded ${(r.scores.groundedness.fully_supported_pct! * 100).toFixed(0)}%` : ''}${r.scores.answer_match != null ? ` · match ${r.scores.answer_match}` : ''}`}`);
        }
      }
    } finally {
      await server?.close();
    }
  }
  } catch (err) {
    log(`run aborted: ${err instanceof Error ? err.message : String(err)} — writing the ${runs.length} completed run(s)`);
  }
  chunks.close();

  const info = {
    timestamp: new Date().toISOString(), commit, target: args.target, runs: args.runs, items: items.length, agent_model: agentModel, judge_model: judge ? judgeModel : 'skipped', judged: Boolean(judge),
    note: `${args.runs} run(s) per configuration; means over runs. Claude 5 rejects the temperature parameter, so determinism rests on tool-forced structured output and fixed prompts (see apps/server/src/agent/model.ts). ${configs.length > 1 ? `Ablations: ${configs.filter((c) => c.ablation).map((c) => c.name).join(', ')}.` : 'Base configuration only.'}${judge ? '' : ' Judge skipped: groundedness and answer match are null.'}`,
  };
  const results = buildResults(set, runs, configs, info, join(EVAL_DIR, 'human_scores.json'));
  const out = writeResults(args.out, results, runs, stamp);
  log(`wrote ${out.latestJson}, ${out.latestMd}, ${runs.length} run files in ${out.runsDir}`);
  console.log(JSON.stringify({ ...results.headline, latency_p50_ms: results.latency.warm_p50_ms, latency_p95_ms: results.latency.warm_p95_ms, runs: runs.length, errors: runs.filter((r) => r.error).length }, null, 2));
  return runs.some((r) => r.error) ? 2 : 0;
}

/** A judge failure (network blip, 529) must never abort the run: retry once, then record the error on the item. */
async function judgeWithRetry(judge: Judge, chunks: ChunkResolver, item: EvalItem, r: ItemRun, log: (m: string) => void): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await judgeRun(judge, chunks, item, r);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`judge ${item.id} attempt ${attempt} failed: ${msg.slice(0, 120)}`);
      if (attempt === 2) (r as ItemRun & { judge_error?: string }).judge_error = msg;
      else await new Promise((res) => setTimeout(res, 5_000));
    }
  }
}

async function judgeRun(judge: Judge, chunks: ChunkResolver, item: EvalItem, r: ItemRun): Promise<void> {
  const env = r.final ?? r.envelope;
  const g = await judge.groundedness(env, chunks);
  r.scores.groundedness = { per_fact: g.per_fact, mean: g.mean, fully_supported_pct: g.fully_supported_pct };
  (r as ItemRun & { judge_rationales?: string[] }).judge_rationales = g.rationales;
  const m = await judge.answerMatch(item, r.envelope.confirmation_required && !r.final ? r.envelope : env);
  r.scores.answer_match = m.score;
  (r as ItemRun & { answer_match_rationale?: string }).answer_match_rationale = m.rationale;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required (or pass --no-judge)`);
  return v;
}

main().then((code) => process.exit(code), (err: unknown) => { console.error(`[eval] failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`); process.exit(1); });

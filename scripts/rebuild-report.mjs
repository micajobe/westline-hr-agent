/**
 * Rebuild evaluation/results/{latest.json,latest.md} from the saved per-run envelopes, without
 * re-running the harness. Use after editing evaluation/human_scores.json (judge calibration) or
 * after changing report.ts, so a 4-hour model run is not repeated to refresh a table.
 *
 * Usage: node scripts/rebuild-report.mjs [stamp [stamp…]]   (default: newest directory in results/runs)
 *
 * With several stamps, the FIRST supplies the base-configuration runs (the headline) and the run
 * info; the others contribute ablation arms only. That is how ablation 5 (semantic verify, run
 * 2026-09-22, ADR 0019) sits beside the four arms of the 2026-09-12 sweep without re-running it, and
 * without averaging two days' base runs into one headline. The merged report is written under a
 * composite stamp so no run directory gains envelopes it did not produce.
 *
 * Note: evaluation/results/runs/ is gitignored, so this works only on a machine that has run the
 * harness. A fresh clone has latest.json/latest.md but not the envelopes they were built from.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadEvalSet } from '../evaluation/dist/set.js';
import { BASE_CONFIG, ABLATION_CONFIGS } from '../evaluation/dist/local.js';
import { buildResults, writeResults } from '../evaluation/dist/report.js';

const OUT = 'evaluation/results';
const runsRoot = join(OUT, 'runs');
const stamps = process.argv.slice(2);
if (stamps.length === 0) {
  const newest = readdirSync(runsRoot).filter((d) => statSync(join(runsRoot, d)).isDirectory()).sort().pop();
  if (!newest) throw new Error(`no run directories under ${runsRoot}`);
  stamps.push(newest);
}
const loadDir = (stamp) => {
  const dir = join(runsRoot, stamp);
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};
const [primary, ...extra] = stamps;
const runs = [...loadDir(primary), ...extra.flatMap((s) => loadDir(s).filter((r) => r.config !== 'base'))];
const stamp = extra.length ? `${primary}+${extra.map((s) => s.slice(0, 10)).join('+')}` : primary;

const set = loadEvalSet();
const infoPath = existsSync(join(OUT, `${primary}.json`)) ? join(OUT, `${primary}.json`) : join(OUT, 'latest.json');
const prior = JSON.parse(readFileSync(infoPath, 'utf8'));
const info = extra.length
  ? { ...prior.run, note: `${prior.run.note} Ablation arms merged from later runs: ${extra.map((s) => `${s} (${[...new Set(loadDir(s).filter((r) => r.config !== 'base').map((r) => r.config))].join(', ')})`).join('; ')}. Their base rows are this run's base configuration, not a same-day pair; see design-and-evaluation.md §8.4 for the paired comparison.` }
  : prior.run;
const configs = [BASE_CONFIG, ...ABLATION_CONFIGS];

const results = buildResults(set, runs, configs, info, 'evaluation/human_scores.json');
const out = writeResults(OUT, results, runs, stamp);

console.log(`rebuilt from ${runs.length} run files in ${stamps.join(' + ')}`);
console.log(`  ${out.latestJson}\n  ${out.latestMd}`);
console.log(
  `calibration: ${results.calibration.scored}/${results.calibration.n} scored · ` +
    `exact ${results.calibration.exact_agreement === null ? '—' : Math.round(results.calibration.exact_agreement * 100) + '%'} · ` +
    `within ±1 ${results.calibration.within_one_agreement === null ? '—' : Math.round(results.calibration.within_one_agreement * 100) + '%'}`,
);

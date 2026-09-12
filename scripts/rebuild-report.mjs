/**
 * Rebuild evaluation/results/{latest.json,latest.md} from the saved per-run envelopes, without
 * re-running the harness. Use after editing evaluation/human_scores.json (judge calibration) or
 * after changing report.ts, so a 4-hour model run is not repeated to refresh a table.
 *
 * Usage: node scripts/rebuild-report.mjs [stamp]   (default: newest directory in results/runs)
 *
 * Note: evaluation/results/runs/ is gitignored, so this works only on a machine that has run the
 * harness. A fresh clone has latest.json/latest.md but not the envelopes they were built from.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadEvalSet } from '../evaluation/dist/set.js';
import { BASE_CONFIG, ABLATION_CONFIGS } from '../evaluation/dist/local.js';
import { buildResults, writeResults } from '../evaluation/dist/report.js';

const OUT = 'evaluation/results';
const runsRoot = join(OUT, 'runs');
const stamp =
  process.argv[2] ??
  readdirSync(runsRoot)
    .filter((d) => statSync(join(runsRoot, d)).isDirectory())
    .sort()
    .pop();
if (!stamp) throw new Error(`no run directories under ${runsRoot}`);

const dir = join(runsRoot, stamp);
const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

const set = loadEvalSet();
const prior = JSON.parse(readFileSync(join(OUT, 'latest.json'), 'utf8'));
const configs = [BASE_CONFIG, ...ABLATION_CONFIGS];

const results = buildResults(set, runs, configs, prior.run, 'evaluation/human_scores.json');
const out = writeResults(OUT, results, runs, stamp);

console.log(`rebuilt from ${runs.length} run files in ${dir}`);
console.log(`  ${out.latestJson}\n  ${out.latestMd}`);
console.log(
  `calibration: ${results.calibration.scored}/${results.calibration.n} scored · ` +
    `exact ${results.calibration.exact_agreement === null ? '—' : Math.round(results.calibration.exact_agreement * 100) + '%'} · ` +
    `within ±1 ${results.calibration.within_one_agreement === null ? '—' : Math.round(results.calibration.within_one_agreement * 100) + '%'}`,
);

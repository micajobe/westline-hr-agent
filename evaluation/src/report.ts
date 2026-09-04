import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mean, percentile } from './metrics.js';
import type { EvalConfig } from './local.js';
import type { EvalItem, EvalSet, ItemRun } from './types.js';

export interface RunInfo { timestamp: string; commit: string; target: string; runs: number; items: number; agent_model: string; judge_model: string; judged: boolean; note: string }

export interface Results {
  run: RunInfo;
  headline: Record<string, number | null>;
  by_category: Record<string, number | string | null>[];
  ablations: { name: string; metric: string; rows: Record<string, number | string | null>[] }[];
  latency: { warm_p50_ms: number | null; warm_p95_ms: number | null; warm_n: number; cold_runs: number[]; cold_p50_ms: number | null; note: string };
  calibration: { n: number; scored: number; exact_agreement: number | null; within_one_agreement: number | null; per_item: { id: string; human: number | null; judge: number | null }[]; note: string };
  items: { id: string; category: string; expected_behaviour: string; behaviour_observed: string[]; behaviour_match: number; tool_selection: number; workflow_complete: number; action_safety: number; citation_precision: number | null; citation_recall: number | null; groundedness: number | null; answer_match: number | null; latency_ms: number | null; errors: number }[];
}

const rate = (xs: (boolean | null | undefined)[]) => {
  const v = xs.filter((x): x is boolean => typeof x === 'boolean');
  return v.length ? v.filter(Boolean).length / v.length : null;
};

function summarise(items: EvalItem[], runs: ItemRun[]) {
  const s = runs.map((r) => r.scores);
  return {
    n: items.length,
    groundedness_pct: mean(s.map((x) => x.groundedness?.fully_supported_pct)),
    groundedness_mean: mean(s.map((x) => x.groundedness?.mean)),
    citation_precision: mean(s.map((x) => x.citation_precision)),
    citation_recall: mean(s.map((x) => x.citation_recall)),
    answer_match: mean(s.map((x) => x.answer_match)),
    tool_selection_accuracy: rate(s.map((x) => x.tool_selection_subset)),
    tool_order_accuracy: rate(s.map((x) => x.tool_order_match)),
    plan_vs_actual: mean(s.map((x) => x.plan_vs_actual_jaccard)),
    workflow_completion: rate(s.map((x) => x.workflow_complete)),
    escalation_accuracy: rate(s.map((x) => x.behaviour_match)),
    action_safety_pass_rate: rate(s.map((x) => x.action_safety_pass)),
    authorization_correct: rate(s.map((x) => x.authorization_correct)),
    audience_explained: rate(s.map((x) => x.audience_explained)),
    unsupported_claims_removed: s.reduce((a, x) => a + x.unsupported_claims_removed, 0),
  };
}

export function buildResults(set: EvalSet, runs: ItemRun[], configs: EvalConfig[], info: RunInfo, humanScoresPath: string): Results {
  const byId = new Map(set.items.map((i) => [i.id, i]));
  const base = runs.filter((r) => r.config === 'base');
  const head = summarise(set.items, base);

  const by_category = [...new Set(set.items.map((i) => i.category))].map((cat) => {
    const its = set.items.filter((i) => i.category === cat);
    const rs = base.filter((r) => byId.get(r.item_id)?.category === cat);
    const m = summarise(its, rs);
    return { category: cat, n: its.length, groundedness_pct: m.groundedness_pct, citation_precision: m.citation_precision, citation_recall: m.citation_recall, answer_match: m.answer_match, tool_selection_accuracy: m.tool_selection_accuracy, workflow_completion: m.workflow_completion, escalation_accuracy: m.escalation_accuracy, action_safety_pass_rate: m.action_safety_pass_rate };
  });

  const ablationNames = [...new Set(configs.filter((c) => c.ablation).map((c) => c.ablation!))];
  const ablations = ablationNames.map((name) => {
    const arms = configs.filter((c) => c.ablation === name);
    const metric = name === 'retrieval k' ? 'groundedness, citation recall' : name === 'chunking' ? 'citation precision' : name === 'retrieval mode' ? 'citation recall' : 'workflow completion, escalation accuracy';
    const baseArm = { ...BASE_LABEL_FOR(name), ...summariseFor(set, base.filter((r) => arms[0]!.selects(byId.get(r.item_id)!)), metric) };
    const rows = [baseArm, ...arms.map((c) => ({ ...c.label, ...summariseFor(set, runs.filter((r) => r.config === c.name), metric) }))];
    return { name, metric, rows };
  });

  const warm = base.filter((r) => byId.get(r.item_id)?.latency_item && !r.error).map((r) => r.latency_ms);
  const cold = readCold();

  const human = readHuman(humanScoresPath);
  const per_item = set.calibration_items.map((id) => {
    const h = human.get(id) ?? null;
    const js = base.filter((r) => r.item_id === id).map((r) => r.scores.groundedness?.mean).filter((v): v is number => typeof v === 'number');
    const j = js.length ? Math.round(js.reduce((a, b) => a + b, 0) / js.length) : null;
    return { id, human: h, judge: j };
  });
  const pairs = per_item.filter((p) => p.human !== null && p.judge !== null) as { id: string; human: number; judge: number }[];
  const calibration = {
    n: set.calibration_items.length, scored: pairs.length,
    exact_agreement: pairs.length ? pairs.filter((p) => p.human === p.judge).length / pairs.length : null,
    within_one_agreement: pairs.length ? pairs.filter((p) => Math.abs(p.human - p.judge) <= 1).length / pairs.length : null,
    per_item,
    note: pairs.length ? `Human (Micah) vs ${info.judge_model} on the 0–2 groundedness scale, judge score rounded to nearest integer per item.` : 'Human scores not yet entered in evaluation/human_scores.json.',
  };

  const items = set.items.map((it) => {
    const rs = base.filter((r) => r.item_id === it.id);
    const s = rs.map((r) => r.scores);
    return {
      id: it.id, category: it.category, expected_behaviour: it.expected_behaviour,
      behaviour_observed: [...new Set(s.flatMap((x) => x.behaviour_observed))],
      behaviour_match: rate(s.map((x) => x.behaviour_match)) ?? 0,
      tool_selection: rate(s.map((x) => x.tool_selection_subset)) ?? 0,
      workflow_complete: rate(s.map((x) => x.workflow_complete)) ?? 0,
      action_safety: rate(s.map((x) => x.action_safety_pass)) ?? 0,
      citation_precision: mean(s.map((x) => x.citation_precision)),
      citation_recall: mean(s.map((x) => x.citation_recall)),
      groundedness: mean(s.map((x) => x.groundedness?.mean)),
      answer_match: mean(s.map((x) => x.answer_match)),
      latency_ms: mean(rs.filter((r) => !r.error).map((r) => r.latency_ms)),
      errors: rs.filter((r) => r.error).length,
    };
  });

  return {
    run: info,
    headline: {
      groundedness_pct: head.groundedness_pct, citation_precision: head.citation_precision, citation_recall: head.citation_recall, answer_match: head.answer_match,
      tool_selection_accuracy: head.tool_selection_accuracy, workflow_completion: head.workflow_completion, escalation_accuracy: head.escalation_accuracy, action_safety_pass_rate: head.action_safety_pass_rate,
    },
    by_category, ablations,
    latency: { warm_p50_ms: percentile(warm, 50), warm_p95_ms: percentile(warm, 95), warm_n: warm.length, cold_runs: cold, cold_p50_ms: percentile(cold, 50), note: `Warm: /chat wall time over ${warm.length} latency-item runs (base configuration). Cold: first-request latency after ≥16 min idle against the deployed URL (cold_start.ts); ${cold.length ? `${cold.length} trial(s)` : 'not yet measured'}.` },
    calibration, items,
  };

  function summariseFor(s: EvalSet, rs: ItemRun[], metric: string) {
    const m = summarise(s.items, rs);
    const out: Record<string, number | string | null> = { n_runs: rs.length };
    if (metric.includes('groundedness')) out.groundedness_pct = m.groundedness_pct;
    if (metric.includes('citation recall')) out.citation_recall = m.citation_recall;
    if (metric.includes('citation precision')) out.citation_precision = m.citation_precision;
    if (metric.includes('workflow')) { out.workflow_completion = m.workflow_completion; out.escalation_accuracy = m.escalation_accuracy; }
    out.answer_match = m.answer_match;
    return out;
  }
  function BASE_LABEL_FOR(name: string): Record<string, string | number> {
    return name === 'retrieval k' ? { k: 6 } : name === 'chunking' ? { chunking: 'heading-aware' } : name === 'retrieval mode' ? { mode: 'hybrid' } : { hr_mcp: 'up' };
  }
  function readCold(): number[] {
    const p = join(process.cwd(), 'evaluation', 'results', 'cold_start.json');
    if (!existsSync(p)) return [];
    try { return (JSON.parse(readFileSync(p, 'utf8')) as { trials: { first_request_ms: number }[] }).trials.map((t) => t.first_request_ms); } catch { return []; }
  }
  function readHuman(p: string): Map<string, number> {
    const out = new Map<string, number>();
    if (!existsSync(p)) return out;
    const h = JSON.parse(readFileSync(p, 'utf8')) as { items: { id: string; human_groundedness: number | null }[] };
    for (const it of h.items) if (typeof it.human_groundedness === 'number') out.set(it.id, it.human_groundedness);
    return out;
  }
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d));
const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`);

export function renderMarkdown(r: Results): string {
  const L: string[] = [];
  L.push(`# Westline HR Agent — evaluation results`, '', `Run ${r.run.timestamp} · commit \`${r.run.commit}\` · target ${r.run.target} · ${r.run.runs} run(s) × ${r.run.items} items · agent \`${r.run.agent_model}\` · judge \`${r.run.judge_model}\`${r.run.judged ? '' : ' (judge skipped)'}`, '', r.run.note, '');
  L.push('## Headline', '', '| Metric | Value |', '|---|---|');
  for (const [k, v] of Object.entries(r.headline)) L.push(`| ${k.replace(/_/g, ' ')} | ${pct(v)} |`);
  L.push('', '## By category', '', '| Category | n | Groundedness | Cit. precision | Cit. recall | Answer match | Tool selection | Workflow completion | Escalation accuracy | Action safety |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const c of r.by_category) L.push(`| ${c.category} | ${c.n} | ${pct(c.groundedness_pct as number | null)} | ${pct(c.citation_precision as number | null)} | ${pct(c.citation_recall as number | null)} | ${pct(c.answer_match as number | null)} | ${pct(c.tool_selection_accuracy as number | null)} | ${pct(c.workflow_completion as number | null)} | ${pct(c.escalation_accuracy as number | null)} | ${pct(c.action_safety_pass_rate as number | null)} |`);
  for (const a of r.ablations) {
    const cols = [...new Set(a.rows.flatMap((row) => Object.keys(row)))];
    L.push('', `## Ablation — ${a.name} (${a.metric})`, '', `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
    for (const row of a.rows) L.push(`| ${cols.map((c) => { const v = row[c]; return typeof v === 'number' && v <= 1 && !/^n/.test(c) ? pct(v) : v == null ? '—' : String(v); }).join(' | ')} |`);
  }
  L.push('', '## Latency', '', `Warm p50 ${ms(r.latency.warm_p50_ms)} · p95 ${ms(r.latency.warm_p95_ms)} (n=${r.latency.warm_n}). Cold: ${r.latency.cold_runs.length ? r.latency.cold_runs.map(ms).join(', ') : 'not measured'}.`, '', r.latency.note);
  L.push('', '## Judge calibration', '', `${r.calibration.scored}/${r.calibration.n} items human-scored · exact ${pct(r.calibration.exact_agreement)} · within ±1 ${pct(r.calibration.within_one_agreement)}`, '', r.calibration.note);
  L.push('', '## Items', '', '| id | category | expected | observed | behaviour | tools | workflow | safety | cit P | cit R | grounded | match | latency | errors |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const i of r.items) L.push(`| ${i.id} | ${i.category} | ${i.expected_behaviour} | ${i.behaviour_observed.join(',')} | ${pct(i.behaviour_match)} | ${pct(i.tool_selection)} | ${pct(i.workflow_complete)} | ${pct(i.action_safety)} | ${pct(i.citation_precision)} | ${pct(i.citation_recall)} | ${num(i.groundedness)} | ${num(i.answer_match, 1)} | ${ms(i.latency_ms)} | ${i.errors} |`);
  L.push('', '_Nondeterminism: the agent runs at temperature 0 but tool selection and wording still vary between runs; figures are means over the runs stated above._', '');
  return L.join('\n');
}

export function writeResults(outDir: string, results: Results, runs: ItemRun[], stamp: string): { latestJson: string; latestMd: string; runsDir: string } {
  mkdirSync(outDir, { recursive: true });
  const runsDir = join(outDir, 'runs', stamp);
  mkdirSync(runsDir, { recursive: true });
  for (const r of runs) writeFileSync(join(runsDir, `${r.item_id}.${r.config}.r${r.run}.json`), `${JSON.stringify(r, null, 2)}\n`);
  const latestJson = join(outDir, 'latest.json');
  const latestMd = join(outDir, 'latest.md');
  writeFileSync(latestJson, `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(latestMd, renderMarkdown(results));
  writeFileSync(join(outDir, `${stamp}.json`), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(outDir, `${stamp}.md`), renderMarkdown(results));
  return { latestJson, latestMd, runsDir };
}

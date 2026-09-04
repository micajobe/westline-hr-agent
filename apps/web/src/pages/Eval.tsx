import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Json, Label } from '../components/primitives';

type Row = Record<string, unknown>;
interface EvalResults {
  sample?: boolean;
  run?: { timestamp?: string; commit?: string; target?: string; runs?: number; agent_model?: string; judge_model?: string; items?: number; note?: string };
  headline?: Record<string, number | string | null>;
  by_category?: Row[];
  ablations?: { name: string; metric?: string; rows: Row[] }[];
  latency?: { warm_p50_ms?: number; warm_p95_ms?: number; cold_p50_ms?: number | null; cold_runs?: number[]; note?: string };
  calibration?: { n?: number; exact_agreement?: number; within_one_agreement?: number; note?: string };
  [k: string]: unknown;
}

/** PRD §9.1 /eval: headline metrics, per-category table, ablations, latency, calibration, run stamp. Falls back to a labelled sample until M7 writes latest.json. */
export function EvalPage() {
  const [data, setData] = useState<EvalResults | null>(null);
  const [source, setSource] = useState<'latest' | 'sample' | 'none'>('none');
  useEffect(() => {
    api.evalLatest().then((d) => { setData(d as EvalResults); setSource('latest'); }).catch(() =>
      fetch('/sample-eval.json').then((r) => r.json()).then((d) => { setData(d as EvalResults); setSource('sample'); }).catch(() => setSource('none')),
    );
  }, []);
  return (
    <main className="mx-auto w-full max-w-[var(--max-content)] flex-1 overflow-y-auto px-6 py-8">
      <div className="flex items-end gap-4">
        <h1 className="headline text-[length:var(--t-h1)]">Evaluation</h1>
        {source === 'sample' && <Badge tone="dashed">sample data — no eval run yet</Badge>}
        {source === 'latest' && <Badge tone="fill">latest.json</Badge>}
      </div>
      {data?.run && (
        <p className="mono mt-3 text-[var(--muted)]">
          {data.run.timestamp ?? '—'} · commit {data.run.commit ?? '—'} · target {data.run.target ?? '—'} · {data.run.runs ?? '—'} run(s) · {data.run.items ?? '—'} items · agent {data.run.agent_model ?? '—'} · judge {data.run.judge_model ?? '—'}
        </p>
      )}
      {data?.run?.note && <p className="mt-2 max-w-[720px] text-[var(--muted)]">{data.run.note}</p>}
      {source === 'none' && <p className="mt-6 text-[var(--muted)]">No results yet. Run <span className="mono">npm run eval -- --target local --runs 1</span>.</p>}

      {data?.headline && (
        <section className="mt-8">
          <Label className="mb-3">Headline</Label>
          <div className="grid grid-cols-2 gap-px bg-[var(--ink)] md:grid-cols-4">
            {Object.entries(data.headline).map(([k, v]) => (
              <div key={k} className="bg-[var(--paper)] p-4">
                <div className="eyebrow">{k.replace(/_/g, ' ')}</div>
                <div className="mono mt-2 text-[28px] tracking-normal">{fmt(k, v)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data?.by_category && data.by_category.length > 0 && <Table title="By category" rows={data.by_category} />}
      {data?.ablations?.map((a) => <Table key={a.name} title={`Ablation · ${a.name}${a.metric ? ` · ${a.metric}` : ''}`} rows={a.rows} />)}

      {(data?.latency || data?.calibration) && (
        <section className="mt-10 grid gap-8 md:grid-cols-2">
          {data.latency && (
            <div>
              <Label className="mb-2">Latency</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[length:var(--t-body)]">
                <dt className="text-[var(--muted)]">warm p50</dt><dd className="mono">{ms(data.latency.warm_p50_ms)}</dd>
                <dt className="text-[var(--muted)]">warm p95</dt><dd className="mono">{ms(data.latency.warm_p95_ms)}</dd>
                <dt className="text-[var(--muted)]">cold start</dt><dd className="mono">{data.latency.cold_runs?.length ? data.latency.cold_runs.map(ms).join(' · ') : ms(data.latency.cold_p50_ms)}</dd>
              </dl>
              {data.latency.note && <p className="mt-2 text-[var(--muted)]">{data.latency.note}</p>}
            </div>
          )}
          {data.calibration && (
            <div>
              <Label className="mb-2">Judge vs human · {data.calibration.n ?? '—'} items</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[length:var(--t-body)]">
                <dt className="text-[var(--muted)]">exact agreement</dt><dd className="mono">{pct(data.calibration.exact_agreement)}</dd>
                <dt className="text-[var(--muted)]">within ±1</dt><dd className="mono">{pct(data.calibration.within_one_agreement)}</dd>
              </dl>
              {data.calibration.note && <p className="mt-2 text-[var(--muted)]">{data.calibration.note}</p>}
            </div>
          )}
        </section>
      )}

      {data && <section className="mt-10"><details><summary className="text-[var(--muted)]">raw json</summary><div className="mt-2"><Json value={data} /></div></details></section>}
    </main>
  );
}

function Table({ title, rows }: { title: string; rows: Row[] }) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return (
    <section className="mt-10">
      <Label className="mb-2">{title}</Label>
      <div className="overflow-x-auto">
        <table className="w-full border-t border-[var(--ink)] text-left text-[length:var(--t-body)]">
          <thead><tr className="eyebrow">{cols.map((c) => <th key={c} className="py-2 pr-4 font-normal">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-[var(--ink)]">{cols.map((c) => <td key={c} className={`py-2 pr-4 ${typeof r[c] === 'number' ? 'mono' : ''}`}>{fmt(c, r[c] as number | string | null | undefined)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);
const ms = (v: number | null | undefined) => (v == null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
function fmt(key: string, v: number | string | null | undefined): string {
  if (v == null) return '—';
  if (typeof v !== 'number') return String(v);
  if (/_ms$/.test(key)) return ms(v);
  if (/pct|rate|precision|recall|accuracy|completion|agreement|match|groundedness|score/.test(key) && v <= 1) return pct(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

# Status — 2026-09-12

Updated after the full evaluation run. Everything listed as done is committed on `main` with CI
green and 213 tests passing without API keys.

## Done and verified

| Milestone | State | Verified by |
|---|---|---|
| M0 Scaffold | done | `npm ci && npm run build && npm test`; CI green from the first push |
| M1 Corpus + mock data | done | 15 docs (11 md, 2 html, 2 pdf), 84.3 page-equivalents; 29 people incl. every PRD §5 persona; `pto_config` asserted against PTO §1–4 |
| M2 Ingestion / index / retrieval | done | 457 deterministic chunks (hash snapshot); sqlite-vec + BM25 + RRF; audience diff; `index:build` idempotent |
| M3 MCP servers | done | 9 tools over real Streamable HTTP; scope, audience, gate token tests |
| M4 Agent + API | done — verified against Sonnet 5 | `server.start.test.ts` end to end with a scripted model; the real-model pass fixed the Claude 5 temperature rejection, a repeat-gate loop and an uncited-fact path |
| M5 Web UI | done | Both demo buttons complete; Nimble editorial system (ADR 0012); responsive below 860px |
| M6 Deploy | done — both services live | CI-gated `deploy.yml` green on `main` through the Render REST API; live `/health` `ok`, both MCP servers `connected`, 9 tools |
| M7 Eval harness | **done — full run complete** | 447 turns (3 runs × 29 items × 7 configs), 0 errors, 4 h 22 m, ~$35.79 measured agent spend |
| M8 Documentation | done | README, design-and-evaluation.md **incl. §8.4 results**, deployed.md, 16 ADRs, ai-tooling.md |
| M9 Semantic citation verification (Jev) | **built and measured on `feat/semantic-citation-verification`** | 249 tests green with no keys; ablation 5 run 2026-09-22 against `jev-1.13.0`: citation precision 49 → 62%, groundedness 89 → 96%, recall and latency flat, 0 errors, 0 unavailable. ADR 0019; §8.4 |

## Evaluation results (2026-09-12)

Full tables in `evaluation/results/latest.md`, narrative in `design-and-evaluation.md` §8.4.

| Metric | Value |
|---|---|
| Groundedness | 92% |
| Citation precision / recall | 49% / 65% |
| Answer match | 88% |
| Tool selection accuracy | 76% (understated — see below) |
| Workflow completion | 97% |
| Escalation accuracy | 94% |
| Action-safety pass rate | 100% |
| Warm latency p50 / p95 | 26.9 s / 50.6 s |
| Judge calibration | 10/10 scored · exact 90% · within ±1 100% |

Ablations: heading-aware chunking beats fixed 400-token windows by 10 points of citation precision
and 19 s of p95 (the clearest result); k=6 is at worst no worse than k=3 or k=10 and k=10 pays
latency for nothing; hybrid+RRF ties BM25 on recall and leads by 3 points on answer match, so it is
justified but narrowly; with the HR MCP server down the agent still completes 87% of workflows and
degrades to policy-only answers rather than inventing data.

## Eval throughput — correcting the 2026-09-08 note

The earlier entry here blamed the aborted 2026-09-08 run's ~9 min/item crawl on the unlogged Opus 5
judge calls. **That diagnosis was wrong.** The 2026-09-12 run used the same command and the same
code and averaged **38 s/item**, with the judge adding roughly three seconds. The variable was the
network: the aborted run was made while travelling. The real lesson is narrower and worth keeping —
`cli.ts:78` runs the judge *before* the per-item log line, so the printed `latency_ms` covers only
the `/chat` call and judge cost is invisible in the log. That makes throughput hard to diagnose from
the log alone, which is what sent the first diagnosis off course.

## Semantic citation verification — measured (2026-09-22)

ADR 0019 puts Jev (TypeSafe) inside VERIFY to attack the 49% citation precision. Run
`2026-09-22T15-21-27`: 1 run × 29 items × 2 configurations, 58 turns, 0 errors, ~35 min.

| VERIFY | Cit. precision | Cit. recall | Groundedness | Answer match | Warm p50 | Verify p50 |
|---|---|---|---|---|---|---|
| structural only | 49% | 66% | 89% | 88% | 30.3 s | — |
| + Jev (0.8) | **62%** | 69% | **96%** | 90% | 30.6 s | 183 ms |

112 pairs judged: 100 supported, 12 unsupported, 0 contradicted, 0 unavailable. Reading and the
caveat in `design-and-evaluation.md` §8.4: ten of the twelve removals were the synthetic
`HANDBOOK#§2#s` applicability citation, judged against a placeholder snippet because that entry has
no chunk text. Follow-up: render the matrix rows as passage text at ingest and re-measure.

`evaluation/results/latest.*` now carries this run (its 1-run base is 89 / 49 / 66 / 88, within noise
of the 3-run 2026-09-12 headline). To show the 2026-09-12 headline on `/eval` again:
`git checkout 0241638 -- evaluation/results/latest.json evaluation/results/latest.md`.

## Not yet produced

- **Cold-start latency** against the deployed URL (`evaluation/src/cold_start.ts`). Warm latency is
  measured; cold is not.
- **The recorded demo video** (PRD §14.1).

## Remaining for Micah

1. `quantic-grader` was invited 2026-09-08 (read). The invitation is **pending** and GitHub expires
   invitations after 7 days — **it lapses around 2026-09-15**. Re-send if it expires before you
   submit.
2. Set Actions `default_workflow_permissions` to read+write if you want `eval.yml` to commit its own
   results; a job-level `permissions:` block cannot elevate above the repo default.
3. Run `cold_start.ts` against the deployed URL and paste the numbers into §8.4.
4. Record the video.
5. Optional but worthwhile: fix `au-02` (below) and correct the four mis-specified `expected_tools`.

## Known issues found by the eval

- **`au-02` fails reproducibly** (3/3 runs): expected `deny`, the agent asks for clarification and
  calls no tool; answer match 0.2. Main contributor to the weak `authorization_audience` row (58%
  tool selection, 58% escalation accuracy).
- **Four eval items carry gold `expected_tools` that assume a search-based path the agent does not
  take.** `md-06`, `sp-06`, `tw-03` and `sp-07` expect `search_policy_documents`; the agent uses
  `get_policy_applicability` → `get_policy_section`, which is more precise, and is marked down for
  it. Tool selection accuracy is understated until these are corrected.
- **Citation precision 49%** — the agent over-cites beyond the gold set. Groundedness stays high
  because what it cites does support the claims.
- **`tw-06`** completes its gate correctly but scores answer match 0.0.

## Deviations from the PRD, all recorded

ADR 0003 (Node 22 + `node:sqlite`), ADR 0004 (index layout and retrieval heuristics), ADR 0011
(`inprocess` = real host on loopback), ADR 0012 (design system replaces §9.2 tokens), ADRs
0013/0015/0016 (sidebar, Handbook browse, the single question field), ADR 0017 (HOURS split out of
HANDBOOK). `TAX` — a document PRD §4 cross-references but does not list — became `EXPENSE §8`.
`EMBEDDING_PROVIDER=stub` was added for CI. The eval set has 29 items with 19 latency items, rather
than §12.1's 28 and 15. ADR 0010's deploy-hook mechanism was replaced by the Render REST API before
it ever ran.

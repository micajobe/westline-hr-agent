# Blockers

Items that require Micah's accounts, values or physical presence. Everything not listed here has
been built. Update/remove entries as they are resolved.

## Open

### 0. TypeSafe (Jev) key — semantic citation verification is built but unmeasured (2026-09-22)

- `SEMANTIC_VERIFY_PROVIDER=typesafe` (ADR 0019) needs `TYPESAFE_API_KEY`. No key is present in the
  local `.env`, so the provider has been run only against a fake API in `tests/semantic-verify.
  typesafe.test.ts`; the `stub` provider covers every VERIFY branch in CI. Acceptance still needs one
  real end-to-end turn with the `semantic` block visible in the trace.
- **Render:** add `TYPESAFE_API_KEY` (secret) and `SEMANTIC_VERIFY_PROVIDER=typesafe` to the
  `westline-app` service (`srv-dadi2etg1s2s73bldagg`, hostname `westline-hr-agent.onrender.com`).
  Set both together: the server refuses to start with the provider on and no key. `render.yaml`
  declares the variables; the services are not Blueprint-driven, so this is a dashboard edit.
- **Eval spend:** the semantic-verify ablation (1 run × 29 items × 2 configurations, Sonnet 5 agent,
  Opus 5 judge, real Jev) has not been run. Roughly an hour and $2–3 of Anthropic spend at the
  2026-09-12 rate; Jev's share is cents. Command in `STATUS.md`. Fills the pending table in
  `design-and-evaluation.md` §8.4.

### 1. GitHub: grader access expires around 2026-09-15

- `quantic-grader` was invited 2026-09-08 with **read** permission (invite `332198617`). The
  invitation is **pending** — it is not access until they accept, and GitHub expires invitations
  after 7 days.
- Action: check <https://github.com/micajobe/westline-hr-agent/invitations>; re-send if it has
  lapsed. The repository is private, so without an accepted invitation the grader cannot open it.

### 2. Demo video not recorded

- PRD §14.1 / rubric: 7–10 minutes, on camera, government ID, both agentic tasks end to end with
  the MCP tool names, arguments, outputs and citations called out, plus a walkthrough of design,
  deployment, CI/CD and evaluation.
- Wake both Render services before recording — free instances sleep after 15 minutes idle and the
  first request takes 30–60 s.

### 3. Cold-start latency not measured

- §8.4 reports warm latency only (p50 26.9 s, p95 50.6 s, local). `evaluation/src/cold_start.ts`
  measures first-request latency against the deployed URL after ≥16 min idle.
- Action: `node evaluation/dist/cold_start.js --url https://westline-hr-agent.onrender.com`, then
  paste the numbers into §8.4's latency subsection.

### 4. `eval.yml` timeout is adequate for a base run, not for the ablation sweep

- Measured: the full `--runs 3 --ablations` sweep is **447 turns / 4 h 22 m**, which exceeds
  `timeout-minutes: 180`. A base-only judged run is roughly an hour and fits comfortably.
- Action: either raise the timeout above 300 for ablation runs, or run `eval.yml` without
  `--ablations` and do the full sweep locally (which is how the 2026-09-12 results were produced).
- Also still true: `eval.yml` commits its results, and Actions `default_workflow_permissions` is
  **read**. A job-level `permissions: contents: write` cannot elevate above the repo default.

### 5. Design system — decided, no action needed

- Micah (2026-09-04): follow the Nimble editorial design system from `~/strategy-navigator`
  (ADR 0012). Fraunces / Inter Tight / JetBrains Mono via Google Fonts; B&W only. The converted
  `.woff2` files in `apps/web/public/fonts/` are unused and gitignored — delete them at will.

## Resolved

### The evaluation — resolved 2026-09-12

Full run complete: 447 turns (3 runs × 29 items × 7 configurations), 0 errors, 4 h 22 m, ~$35.79
measured agent spend. Results in `evaluation/results/latest.md`; narrative in
`design-and-evaluation.md` §8.4. Judge calibration scored 10/10 by hand — exact 90%, within ±1 100%.
`scripts/rebuild-report.mjs` regenerates the report from the saved envelopes without re-running the
harness.

Note on the earlier "eval throughput" entry, now deleted: the 2026-09-08 attempt managed 4 items in
~37 minutes and the slowness was attributed to the Opus judge. That was wrong. The same command on
the same code ran at 38 s/item on 2026-09-12; the difference was network conditions while
travelling. The judge adds about three seconds per item.

### `scripts/demo.sh` against a real model — resolved 2026-09-04

Run against Sonnet 5 with Micah's key. Four failures, all fixed and recorded in `ai-tooling.md`:
Claude 5 rejects `temperature`; `demo.sh` fed its scoring script by heredoc *and* stdin so it parsed
nothing; task 2 drafted twice until a gated tool that already acted this turn began returning
`ALREADY_EXECUTED`; task 2 cited nothing until the notice rule was forced through retrieval rather
than read off `check_pto_balance`.

### Deploy secrets and the deploy path — resolved 2026-09-04

`deploy.yml` was repointed at the Render REST API via `scripts/render-deploy.sh` (commit `e149e1d`),
which needs one `RENDER_API_KEY` instead of two dashboard-only hook URLs and reports the deploy's
real outcome. Secrets set: `RENDER_API_KEY`, `DEPLOYED_APP_URL`, `ANTHROPIC_API_KEY`,
`VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL`. CI-gated deploys have run green on `main`.

Note: ADR 0010 still carries its original "deploy gating via render hooks" title; the hook mechanism
it describes was replaced before it ever ran.

### `VOYAGE_API_KEY` — resolved 2026-09-04

Key was valid but the account had no payment method, so Voyage capped it at 3 RPM / 10K TPM and the
index build died on 429s (three failed deploys). A card was added; standard limits took a few minutes
to propagate. Diagnostic note: during propagation a *single* request returns 200 while bursts still
429 — that is the 3 RPM allowance, not a lifted cap. Test with five spaced requests. The pacing knobs
(`VOYAGE_MIN_INTERVAL_MS`, `VOYAGE_BATCH_SIZE`) remain in `.env.example`, commented out; the
provider defaults to no pacing.

### Render services — resolved 2026-09-04

Both live, created through the REST API (no Blueprint attached; the API has no create/apply-Blueprint
endpoint, so `render.yaml` documents the shape rather than driving it).

| Service | ID | URL |
|---|---|---|
| `westline-app` | `srv-dadi2etg1s2s73bldagg` | <https://westline-hr-agent.onrender.com> |
| `westline-mcp` | `srv-dadi5eqd0e5s73d375tg` | <https://westline-mcp.onrender.com> |

The app's hostname keeps its creation-time subdomain despite the rename to `westline-app`.
`scripts/render-deploy.sh trigger|status|logs <service-id>` drives deploys through the API.

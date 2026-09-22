# Westline HR Agent

An agentic HR-policy assistant for **Westline Media Inc.**, a fictional Western Canadian news and
entertainment company with three workforce classes (staff, contractors, creator partners) whose
rulebooks differ. The agent resolves *who is asking and which policies bind them* before it answers,
retrieves from a 15-document corpus that is audience-filtered **before ranking**, reaches every
capability through two MCP servers over Streamable HTTP, enforces authorization inside those
servers, pauses every mutating action on a confirmation card backed by a single-use token bound to
the exact arguments, verifies that every cited fact was actually retrieved this turn, and shows the
whole thing in a trace rail that reads like a flight recorder.

Quantic MSAIE · AI Engineering Techniques and Architectures · individual submission · Micah Slavens.

**Deployed:** <https://westline-hr-agent.onrender.com> — chat UI, `/health`, `/desk`, `/eval`. The MCP service it calls lives at
<https://westline-mcp.onrender.com>. Both are free Render instances and sleep after 15 minutes idle; the first request takes
30–60s to wake. See [`deployed.md`](deployed.md).

## Documents

| File | What's in it |
|---|---|
| [`westline-prd.md`](westline-prd.md) | Source of truth: scope, locked decisions, milestones, rubric traceability (§22) |
| [`design-and-evaluation.md`](design-and-evaluation.md) | Architecture diagram, every design justification, tool and trace schemas, safety design, demo tasks, evaluation results |
| [`deployed.md`](deployed.md) | Render topology, URLs, env var table, cold-start behaviour, single-service fallback |
| [`ai-tooling.md`](ai-tooling.md) | How Claude Code was used, milestone by milestone: what was asked, what it got wrong, how that was caught |
| [`docs/adr/`](docs/adr/) | Architecture decision records (0003 SQLite binding … 0012 design system) |
| [`BLOCKERS.md`](BLOCKERS.md) / [`STATUS.md`](STATUS.md) | What needs Micah's accounts; what is done and verified |
| [`CLAUDE.md`](CLAUDE.md) | Conventions the code follows |

## Architecture in one paragraph

`apps/web` (React, static) talks to `apps/server` (Fastify). The server runs a hand-rolled
**plan → act → synthesize → verify** loop on Anthropic tool use. It never imports a tool: every call
goes through `apps/server/src/mcp/client.ts`, which discovers tools from two MCP servers at startup,
namespaces them `policy__*` / `hr__*`, strips the server-owned `acting_person_id` and
`confirmation_token` from the model-facing schemas and injects them itself. `mcp/policy-mcp` owns the
RAG index (`sqlite-vec` + BM25, reciprocal rank fusion, audience filter inside the KNN query) and the
HANDBOOK §2 applicability matrix; `mcp/hr-data-mcp` owns the mock people/PTO/benefits data, the scope
rules (`self` / `manager` / `hr_partner`) and the confirmation gate. Both are served by `mcp/host` as
stateless Streamable HTTP behind a shared-secret header — as a separate Render service in production
(`MCP_MODE=http`), or on a loopback port inside the app process locally (`MCP_MODE=inprocess`); the
client code path is identical.

### Semantic citation verification (ADR 0019)

VERIFY has two halves. The structural half checks that every cited chunk was retrieved this turn and
drops facts with no surviving citation. With `SEMANTIC_VERIFY_PROVIDER=typesafe`, a second half asks
TypeSafe's Jev -- a System One model that returns calibrated probabilities, not prose -- one Choice per
(fact, citation) pair: does the full chunk text *support*, *contradict*, or *say nothing about* the
claim? Citations below `SEMANTIC_VERIFY_THRESHOLD` (0.8) or judged contradicting are removed, and the
`verify` trace event carries a `semantic` block with per-pair probabilities. Jev is a dependency of
`apps/server` (`packages/semantic-verify`), not an MCP tool; if it is down or slow, VERIFY falls back
to the structural result for that fact. The default is `off`; `stub` is a key-free lexical test double
used by CI.

## Quick start

```bash
nvm use                 # Node 22+ (node:sqlite is required — ADR 0003)
npm ci
cp .env.example .env    # add ANTHROPIC_API_KEY and VOYAGE_API_KEY
npm run build
npm run index:build     # embeds the corpus into data/index.sqlite (idempotent; hash-gated)
npm run start:app       # http://localhost:3000
```

Without keys, everything except the chat still works: `EMBEDDING_PROVIDER=stub ALLOW_STUB_INDEX=1`
gives a deterministic test index, `/chat` returns a clear 503, and
`npx tsx scripts/dev-scripted-server.ts` boots the app on port 3001 with a scripted model so the
gate → confirm → verify flow can be exercised in the UI.

## Reproducing the two demo tasks

```bash
scripts/demo.sh                       # against http://localhost:3000
scripts/demo.sh https://<deployed-app> # against Render
```

The script reads `/demo/tasks`, posts each task to `/chat`, confirms the proposed action through
`/confirm`, checks that the expected tool sequence appears in the trace, and shows the resulting
ticket and draft on `/desk`. The same two tasks are the "Run demo task 01 / 02" buttons in the UI.

## Evaluation

```bash
npm run eval -- --target local --runs 3 --ablations   # boots the app per configuration
npm run eval -- --target local --runs 1 --ablation semantic-verify   # VERIFY structural vs + Jev (needs TYPESAFE_API_KEY)
npm run eval -- --target deployed --runs 3            # base configuration against DEPLOYED_APP_URL
node evaluation/dist/cold_start.js --url <deployed>   # ≥16 min idle, first-request latency ×3
```

29 items in six categories, an Opus judge (tool-forced JSON) for groundedness and answer match,
deterministic citation precision/recall, tool selection, workflow completion, behaviour accuracy,
action safety, warm/cold latency, and five ablations. Results land in `evaluation/results/latest.json`
and render at `/eval`. Human calibration scores go in `evaluation/human_scores.json`.

## Tests and CI

`npm test` runs 179 tests with no API keys: corpus and mock-data consistency, deterministic chunking
(hash snapshot), audience-filtered retrieval, the nine MCP tools over the real HTTP transport, the
gate (refuse / execute once / refuse replay / forged / mismatched), the app booting in `inprocess`
mode with `/health` reporting both servers connected, the full demo-task-2 gate round trip with a
scripted model, and the eval metrics. `ci.yml` runs typecheck, lint, build and tests on every push;
`deploy.yml` fires the Render hooks only after a green run on `main`; `eval.yml` is manual.

## Layout

```
corpus/            15 policy documents (11 markdown, 2 HTML, 2 PDF) with audience front matter
mock_data/         29 people, PTO ledger, benefits, creator records, markets, PTO config, desk seed
packages/shared/   domain vocabulary, trace schema, answer schema, args hash, gate tokens, people directory
packages/rag/      loaders and normalisers, heading-aware chunker, embeddings, sqlite-vec + BM25 store, retriever
packages/semantic-verify/  Jev (TypeSafe) citation verifier for VERIFY, plus the key-free stub used by tests
mcp/policy-mcp/    search_policy_documents · get_policy_section · get_policy_applicability · check_policy_compliance
mcp/hr-data-mcp/   lookup_person_profile · check_pto_balance · lookup_benefits_status · create_mock_hr_ticket · draft_hr_email
mcp/host/          Fastify host: /mcp/policy, /mcp/hr, /health, /desk; MCP_SHARED_SECRET check
apps/server/       MCP client, plan-then-act orchestrator, gate suspend/resume, verify, API, static serving
apps/web/          chat, trace rail, confirmation and citation cards, /desk, /eval
evaluation/        eval set, metrics, judge, runner, ablations, results
scripts/           demo.sh, build-pdfs.mjs, dev-scripted-server.ts
docs/adr/          decision records
```

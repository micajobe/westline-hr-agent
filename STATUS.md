# Status — 2026-09-04

Written at the end of the autonomous build (PRD §21). Everything listed as done is committed on `main`
with CI green and 179 tests passing without API keys.

## Done and verified locally

| Milestone | State | Verified by |
|---|---|---|
| M0 Scaffold | done | `npm ci && npm run build && npm test`; CI green from the first push |
| M1 Corpus + mock data | done | 15 docs (11 md, 2 html, 2 pdf), 83.3 page-equivalents; 29 people incl. every PRD §5 persona; `pto_config` asserted against PTO §1–4 |
| M2 Ingestion / index / retrieval | done | 414 deterministic chunks (hash snapshot); sqlite-vec + BM25 + RRF; audience diff; `index:build` idempotent (`up_to_date` on second run) |
| M3 MCP servers | done | 9 tools over real Streamable HTTP; scope, audience, gate token tests; `start:mcp` smoke-tested with raw JSON-RPC |
| M4 Agent + API | done (model unverified) | `server.start.test.ts` runs demo task 2 end to end with a scripted model: identity injection, gate hold, `/confirm`, replay refusal, verify stripping a fabricated citation; `MCP_MODE=http` verified with two processes |
| M5 Web UI | done | Both demo buttons complete against the scripted server; re-skinned to the Nimble editorial system (ADR 0012) at Micah's direction |
| M6 Deploy | done — both services live | `render.yaml`, `deploy.yml` (CI-gated, health-polled), `deployed.md`, ADRs 0009–0011 |
| M7 Eval harness | built; real run blocked | 28-item set, all metrics, 4 ablations, judge, cold-start probe, `eval.yml`; plumbing run: 28/28 items, 0 errors |
| M8 Documentation | done | README, design-and-evaluation.md (results section awaits a run), deployed.md, 12 ADRs, ai-tooling.md through M7 |

## Not verified — needs a model key

- Prompt quality against Sonnet: `scripts/demo.sh` and both UI demo buttons against the real agent.
- `npm run eval -- --target local --runs 3 --ablations` and the resulting §8.4 of design-and-evaluation.md.
- The PRD's manual retrieval spot check against a Voyage-built index.

## Remaining for Micah (BLOCKERS.md has the exact steps)

1. Put `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` in `.env`; run `npm run index:build`, `npm run start:app`, `scripts/demo.sh`. Expect prompt tuning.
2. Deploy hooks into GitHub secrets (`RENDER_DEPLOY_HOOK_APP/_MCP`, `DEPLOYED_APP_URL`) — or switch `deploy.yml` to the API's trigger-deploy endpoint via `scripts/render-deploy.sh` and a single `RENDER_API_KEY` secret. Services are live and the URLs are filled in.
3. Run the eval (locally or via `eval.yml`), then `cold_start.ts` against the deployed URL; paste the results into design-and-evaluation.md §8.4.
4. Score the 10 calibration items in `evaluation/human_scores.json`; re-run `npm run eval` to compute agreement.
5. Add `quantic-grader` as a collaborator; write the closing reflection in `ai-tooling.md`; record the video (PRD §14.1).

## Deviations from the PRD, all recorded

ADR 0003 (Node 22 + `node:sqlite` instead of Node 20 + `better-sqlite3`), ADR 0004 (index layout and
retrieval heuristics), ADR 0011 (`inprocess` = real host on loopback), ADR 0012 (design system replaces
§9.2 tokens). `TAX` — a document PRD §4 cross-references but does not list — became `EXPENSE §8`.
`EMBEDDING_PROVIDER=stub` was added for CI. The eval set has 18 latency items rather than 15.

# Deployed

> **Status:** both services are live as of 2026-09-04. `/health` on the app reports `ok` with both
> MCP servers `connected` and an identical corpus hash on both sides.

## URLs

| What | URL |
|---|---|
| App (chat UI, `/chat`, `/health`) | <https://westline-hr-agent.onrender.com> |
| App health | <https://westline-hr-agent.onrender.com/health> |
| MCP service health | <https://westline-mcp.onrender.com/health> |
| MCP endpoints | `…/mcp/policy`, `…/mcp/hr` (Streamable HTTP, require `x-westline-mcp-secret`) |
| Desk (mock tickets and drafts) | <https://westline-hr-agent.onrender.com/desk> |
| Eval results | <https://westline-hr-agent.onrender.com/eval> |

## Topology

Two free Render web services from this repository (PRD §10, ADR 0009):

| Service | Build | Start | Serves |
|---|---|---|---|
| `westline-mcp` | `npm ci && npm run build` | `npm run start:mcp` | `/mcp/policy`, `/mcp/hr`, `/health`, `/desk` (secret-protected). Builds the RAG index at first start if absent; owns `desk.sqlite`. |
| `westline-app` | `npm ci && npm run build && npm run index:build` | `npm run start:app` | The React app, `/chat`, `/chat/stream`, `/confirm`, `/health`, `/personas`, `/demo/tasks`, `/desk`, `/eval/latest`. Talks to `westline-mcp` over HTTPS with `MCP_MODE=http`. |

**Service names and hostnames differ for the app.** It was created by hand as `westline-hr-agent`
and later renamed to `westline-app`; Render keeps the subdomain assigned at creation, so the service
name matches `render.yaml` while the URL stays `westline-hr-agent.onrender.com`. Service IDs:
`srv-dadi2etg1s2s73bldagg` (app), `srv-dadi5eqd0e5s73d375tg` (mcp). Neither is attached to a
Blueprint — they were created through the REST API, which has no create/apply-Blueprint endpoint —
so `render.yaml` currently documents the intended shape rather than driving it.

`render.yaml` at the repo root is a Blueprint that creates both services with these commands and
env var names. Auto-deploy is **off** on both; `.github/workflows/deploy.yml` POSTs the deploy hooks
only after the `ci` workflow succeeds on `main`, then polls `/health` for up to 10 minutes.

**Node version.** PRD §10 says `NODE_VERSION=20`. This project requires **22** (`node:sqlite` is the
SQLite binding — ADR 0003). The blueprint sets 22; set it manually if you create the services by hand.

## Environment variables

| Variable | westline-app | westline-mcp | GitHub Actions | Notes |
|---|:-:|:-:|:-:|---|
| `ANTHROPIC_API_KEY` | ✓ | | ✓ (eval) | Agent and judge |
| `AGENT_MODEL` | ✓ | | ✓ | Default `claude-sonnet-5` |
| `JUDGE_MODEL` | ✓ | | ✓ | Default `claude-opus-5` |
| `VOYAGE_API_KEY` | ✓ | ✓ | ✓ | Embeddings; both services build the same index from the same corpus hash |
| `EMBEDDING_PROVIDER` | ✓ | ✓ | | `voyage` in production. `stub` is CI-only |
| `MCP_MODE` | ✓ | | | `http` on Render; `inprocess` locally |
| `MCP_BASE_URL` | ✓ | | | The `westline-mcp` public URL, no trailing slash |
| `MCP_SHARED_SECRET` | ✓ | ✓ | | `openssl rand -hex 32`; identical on both. Also signs confirmation tokens |
| `RERANK` | ✓ | | | `false`; ablation only |
| `SEMANTIC_VERIFY_PROVIDER` | ✓ | | | **Not yet set on Render.** `typesafe` to turn on Jev citation verification (ADR 0019); unset/`off` keeps VERIFY structural only. The server refuses to start with `typesafe` and no key |
| `SEMANTIC_VERIFY_THRESHOLD` | ✓ | | | `0.8`; minimum P(supports) for a citation to survive |
| `TYPESAFE_API_KEY` | ✓ | | | **Not yet set on Render.** Enter in the dashboard together with the provider |
| `TYPESAFE_MODEL` | ✓ | | | `jev-latest` |
| `CHAOS_DISABLE_HR_MCP` | ✓ | | | `false`; set `true` to demo graceful degradation (`/health` shows `hr: disabled`) |
| `PORT` | ✓ | ✓ | | Render-provided |
| `LOG_LEVEL` | ✓ | ✓ | | `info` |
| `NODE_VERSION` | ✓ | ✓ | | `22` |
| `RENDER_DEPLOY_HOOK_APP`, `RENDER_DEPLOY_HOOK_MCP`, `DEPLOYED_APP_URL` | | | ✓ | Used by `deploy.yml` |

## Cold starts

Free Render services sleep after **15 minutes** without traffic and take roughly **30–60 seconds**
to wake. Two services means a cascade: the first request to a sleeping app wakes the app, whose
`/health` then tries the MCP service, which is also asleep.

- A cold `GET /health` on the app may report `degraded` with `mcp.policy.status: "down"` for the
  first request; the second request a few seconds later is normally `ok`.
- **Voyage rate limits.** A Voyage key with no payment method is capped at 3 requests/min and 10K
  tokens/min, which is far too slow for the 414-chunk index: three deploys failed with
  `voyage: HTTP 429 … you have not yet added your payment method`, one of them before it embedded a
  single batch. A payment method was added on 2026-09-04 and the standard limits took a few minutes
  to propagate — during that window single requests succeed while bursts still 429, so a lone 200 is
  not evidence the cap has lifted; five spaced requests all returning 200 is. If a key ever runs
  uncapped-but-throttled again, set `VOYAGE_BATCH_SIZE=20` and `VOYAGE_MIN_INTERVAL_MS=21000`
  (~7 min build) rather than waiting — but note `westline-mcp` indexes in its *start* command, so a
  build that slow needs `index:build` moved into its build command or Render's port scan times out.
- `westline-mcp` opens `data/index.sqlite` on start. Render has no persistent disk, so on a
  **redeploy** the index is rebuilt from the committed corpus (~400 chunks through Voyage, typically
  under a minute). A plain **wake from sleep** does not rebuild — the filesystem survives sleep.
- `desk.sqlite` also lives on that ephemeral filesystem: **tickets and drafts reset on every
  redeploy**, by design (PRD §5). They survive sleep.
- Warm-up before a demo: `curl <mcp>/health`, wait for 200, then `curl <app>/health` until
  `"status":"ok"`. `scripts/demo.sh <app-url>` does this implicitly by starting with `/health`.
- Cold-start latency is measured, not guessed: `evaluation/src/cold_start.ts` waits ≥16 minutes
  idle and times the first request, three times, against `DEPLOYED_APP_URL` (PRD §12.2).

Memory is 512 MB per service. The index is ~15 MB on disk; the app process idles around 120 MB.

## Fallback: single service

If `westline-mcp` cannot be created or is down, `westline-app` runs alone with `MCP_MODE=inprocess`:
it starts both MCP servers on a loopback port inside its own process and talks to them over the
same Streamable HTTP client (ADR 0011). Set `MCP_MODE=inprocess`, drop `MCP_BASE_URL`, keep the
build command (it already runs `index:build`). Nothing else changes; `/health` reports
`mode.mcp: "inprocess"`.

## Verifying a deploy

```bash
curl -s "$APP/health" | python3 -m json.tool      # both MCP servers "connected", index described
scripts/demo.sh "$APP"                            # both PRD §14 tasks, expected tool sequences, gate round trip
```

# Deployed

> **Status:** the Render services have not been created yet (BLOCKERS.md item 3). Everything below
> is ready to be true the moment they exist; the placeholders are marked `TBD`.

## URLs

| What | URL |
|---|---|
| App (chat UI, `/chat`, `/health`) | `TBD` — `https://westline-app.onrender.com` once created |
| App health | `TBD/health` |
| MCP service health | `TBD` — `https://westline-mcp.onrender.com/health` |
| MCP endpoints | `…/mcp/policy`, `…/mcp/hr` (Streamable HTTP, require `x-westline-mcp-secret`) |
| Desk (mock tickets and drafts) | `TBD/desk` |
| Eval results | `TBD/eval` |

## Topology

Two free Render web services from this repository (PRD §10, ADR 0009):

| Service | Build | Start | Serves |
|---|---|---|---|
| `westline-mcp` | `npm ci && npm run build` | `npm run start:mcp` | `/mcp/policy`, `/mcp/hr`, `/health`, `/desk` (secret-protected). Builds the RAG index at first start if absent; owns `desk.sqlite`. |
| `westline-app` | `npm ci && npm run build && npm run index:build` | `npm run start:app` | The React app, `/chat`, `/chat/stream`, `/confirm`, `/health`, `/personas`, `/demo/tasks`, `/desk`, `/eval/latest`. Talks to `westline-mcp` over HTTPS with `MCP_MODE=http`. |

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
- **Voyage rate limits.** A Voyage key with no payment method is capped at 3 requests/min and 10K tokens/min; the index build then needs `VOYAGE_BATCH_SIZE=20` and `VOYAGE_MIN_INTERVAL_MS=21000` on both services (~7 min build) or Render's build step times out on 429s. Adding a card on the Voyage billing page lifts the cap; the env vars can then be removed.
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

# Blockers

Items that require Micah's accounts or values not available to the build agent.
Everything not listed here has been built. Update/remove entries as they are resolved.

## Open

### 1. `ANTHROPIC_API_KEY` — required for any model call

- Needed for: the agent loop (`/chat`), the eval harness, the LLM judge.
- Without it: everything builds and all 169 tests pass (the agent tests use a scripted model through
  the real MCP transport). `/chat` returns 503 `MODEL_UNAVAILABLE`, and `scripts/demo.sh` — written
  and exercised against the scripted model — has not yet been run against Sonnet. That run is the
  open M4 acceptance item.
- Action: put it in `.env` locally, and add it as a GitHub Actions secret + a Render env var on `westline-app`.

### 2. `VOYAGE_API_KEY` — required for production-quality embeddings

- Needed for: `npm run index:build` with `EMBEDDING_PROVIDER=voyage`.
- Without it: set `EMBEDDING_PROVIDER=local` to build the index with the bundled
  transformers.js ONNX model (slower, lower recall — this is ablation 5's "local" arm),
  or `EMBEDDING_PROVIDER=stub` for deterministic hash embeddings used by the test suite.
- Action: free-tier key from <https://voyageai.com>, then `.env` + GitHub secret + both Render services.

### 3. Render services not yet created

- Needed for: `deployed.md` URLs, `MCP_BASE_URL`, deploy hooks, the live demo, cold-start measurement.
- Everything on the repo side is done: `render.yaml` (Blueprint for both services, auto-deploy off,
  Node 22), `.github/workflows/deploy.yml` (fires hooks after green CI, polls `/health`), `deployed.md`
  (env table, cold-start notes, fallback). `MCP_MODE=http` has been verified locally with the MCP host
  and the app as separate processes.
- Steps (≈10 minutes):
  1. Render → New → **Blueprint** → this repo → apply `render.yaml`. Both services are created with the
     right build/start commands; confirm plan Free and Auto-Deploy **Off** on each.
  2. Generate one secret: `openssl rand -hex 32`. Set it as `MCP_SHARED_SECRET` on **both** services.
  3. On `westline-mcp`: set `VOYAGE_API_KEY`. Deploy once manually; copy its public URL.
  4. On `westline-app`: set `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, and `MCP_BASE_URL` = the
     `westline-mcp` URL (no trailing slash). Deploy once manually.
  5. Copy both **Deploy Hook** URLs (service → Settings → Deploy Hook) and run:
     `gh secret set RENDER_DEPLOY_HOOK_MCP`, `gh secret set RENDER_DEPLOY_HOOK_APP`,
     `gh secret set DEPLOYED_APP_URL` (the app URL). Also `gh secret set ANTHROPIC_API_KEY`,
     `VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL` for `eval.yml`.
  6. Fill the `TBD` URLs in `deployed.md` and the README; run `scripts/demo.sh <app-url>`.

### 4. GitHub repo + grader access

- Action: create `westline-hr-agent`, push, add `quantic-grader` as collaborator,
  set Actions workflow permissions to read+write (needed by `eval.yml` to commit results).

### 5. Design system — decided, no action needed

- Micah (2026-09-04): follow the Nimble editorial design system from `~/strategy-navigator`
  (ADR 0012). Fraunces / Inter Tight / JetBrains Mono via Google Fonts; B&W only. The earlier PP
  Editorial Old / PP Neue Montreal choice is superseded; the converted `.woff2` files in
  `apps/web/public/fonts/` are unused and gitignored — delete them at will.

## Resolved

_(none yet)_

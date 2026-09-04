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

### 2. Voyage — key present; payment method optional
- Key is in `.env` (2026-09-04) and works. Without a payment method Voyage caps the key at 3 requests
  per minute and 10K tokens per minute; the index build is paced under that with
  `VOYAGE_BATCH_SIZE=20 VOYAGE_MIN_INTERVAL_MS=21000` (~7 minutes). Adding a card at
  https://dashboard.voyageai.com lifts the cap (the free token grant still applies) and lets those two
  vars be dropped on Render.
- `ANTHROPIC_API_KEY` is also in `.env` (found in `~/strategy-navigator/.env.local`); both model ids verified.

### 3. Render services — created and configured; first green deploy still pending

- Both services now exist in workspace `tea-d7v0op9j2pic73cb80eg`, created via the Render REST API
  (2026-09-04). No Blueprint is connected — the API has no create/apply-Blueprint endpoint, only
  validate/retrieve/update/disconnect — so `render.yaml` is currently documentation, not the
  source of truth for these two services. Adopt it from the dashboard if that link is wanted.

  | Service | ID | URL |
  |---|---|---|
  | `westline-app` | `srv-dadi2etg1s2s73bldagg` | <https://westline-hr-agent.onrender.com> |
  | `westline-mcp` | `srv-dadi5eqd0e5s73d375tg` | <https://westline-mcp.onrender.com> |

  **Note the app's hostname.** It was created by hand as `westline-hr-agent` and renamed to
  `westline-app`; Render keeps the original `onrender.com` subdomain, so the service name matches
  `render.yaml` but the hostname does not. `deployed.md` and the README must use the URL above.

- Done: build/start commands per `render.yaml`, `healthCheckPath: /health`, plan free, region
  oregon, Node 22, auto-deploy **off** on both, one fresh 64-hex `MCP_SHARED_SECRET` shared by both,
  all 12 app env vars incl. `MCP_MODE=http` and `MCP_BASE_URL`, all 5 MCP env vars.
- Verified: the Node 22 build succeeds on Render (`Build successful`, web bundle + all workspaces).
- Remaining:
  1. Resolve item 2 — both deploys fail on Voyage rate limits, not on configuration.
  2. Redeploy both and confirm `/health` is `ok`.
  3. Copy both **Deploy Hook** URLs (dashboard → service → Settings → Deploy Hook; the API does not
     expose them) and `gh secret set RENDER_DEPLOY_HOOK_MCP`, `RENDER_DEPLOY_HOOK_APP`,
     `DEPLOYED_APP_URL`. Alternative worth considering: point `deploy.yml` at the API's
     `POST /v1/services/{id}/deploys` with a `RENDER_API_KEY` secret instead — one secret rather
     than two, and the workflow could poll real deploy status instead of curling `/health`.
  4. Also `gh secret set ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL` for `eval.yml`.
  5. Fill the URLs in `deployed.md` and the README; run `scripts/demo.sh <app-url>`.

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

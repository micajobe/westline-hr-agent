# Blockers

Items that require Micah's accounts or values not available to the build agent.
Everything not listed here has been built. Update/remove entries as they are resolved.

## Open

### 1. `scripts/demo.sh` has not been run against a real model

- `ANTHROPIC_API_KEY` is in `.env` and set on `westline-app`; deployed `/health` reports
  `models.available: true` with `claude-sonnet-5` / `claude-opus-5`. So the key is no longer the
  blocker — the open item is the M4 acceptance run itself: `scripts/demo.sh` was written and
  exercised against the scripted model only, never against Sonnet. Expect prompt tuning.
- Action: `scripts/demo.sh https://westline-hr-agent.onrender.com` (or locally), then record the
  result in `ai-tooling.md`.

### 2. GitHub: grader access and Actions write permission

- `micajobe/westline-hr-agent` exists, is private, and `main` is pushed (2026-09-04).
- Remaining: `quantic-grader` is **not** a collaborator (only `micajobe`), and Actions
  `default_workflow_permissions` is **read**, which `eval.yml` needs as read+write to commit results.
- Action: `gh api -X PUT repos/micajobe/westline-hr-agent/collaborators/quantic-grader` and set
  workflow permissions to read+write in repo settings.

### 3. Deploy secrets for `deploy.yml`

- Not yet set: `RENDER_DEPLOY_HOOK_APP`, `RENDER_DEPLOY_HOOK_MCP`, `DEPLOYED_APP_URL`, plus
  `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL` for `eval.yml`.
- Deploy hook URLs are dashboard-only (the API does not expose them). Alternative: repoint
  `deploy.yml` at `scripts/render-deploy.sh` with a single `RENDER_API_KEY` secret, which also lets
  the workflow poll real deploy status instead of curling `/health`.

### 4. Design system — decided, no action needed

- Micah (2026-09-04): follow the Nimble editorial design system from `~/strategy-navigator`
  (ADR 0012). Fraunces / Inter Tight / JetBrains Mono via Google Fonts; B&W only. The earlier PP
  Editorial Old / PP Neue Montreal choice is superseded; the converted `.woff2` files in
  `apps/web/public/fonts/` are unused and gitignored — delete them at will.

## Resolved

### `VOYAGE_API_KEY` — resolved 2026-09-04

Key was valid but the account had no payment method, so Voyage capped it at 3 RPM / 10K TPM and the
414-chunk index build died on 429s (three failed deploys). A card was added; standard limits took a
few minutes to propagate. Diagnostic note: during propagation a *single* request returns 200 while
bursts still 429 — that is the 3 RPM allowance, not a lifted cap. Test with five spaced requests.

### Render services — resolved 2026-09-04

Both live, created through the REST API (no Blueprint attached; the API has no create/apply-Blueprint
endpoint, so `render.yaml` documents the shape rather than driving it).

| Service | ID | URL |
|---|---|---|
| `westline-app` | `srv-dadi2etg1s2s73bldagg` | <https://westline-hr-agent.onrender.com> |
| `westline-mcp` | `srv-dadi5eqd0e5s73d375tg` | <https://westline-mcp.onrender.com> |

The app's hostname keeps its creation-time subdomain despite the rename to `westline-app`.
`/health` reports `ok`, both MCP servers `connected`, corpus hash `190aa9a6e9b2` on both sides.
`scripts/render-deploy.sh trigger|status|logs <service-id>` drives deploys through the API.

Still open on the deploy path: deploy hooks are not exposed by the API, so either copy both hook
URLs from the dashboard into GitHub secrets, or repoint `deploy.yml` at the trigger-deploy endpoint
with one `RENDER_API_KEY` secret.


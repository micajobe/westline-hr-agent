# ADR 0010 — Deploy only from a green CI run, via Render deploy hooks

Status: accepted · 2026-09-04

## Context

PRD §11 requires that a push to `main` deploys only when CI passes, and that Render's own
auto-deploy is off. Render's default is to deploy every push to the tracked branch, which would
ship a red build.

## Decision

- Render auto-deploy is **off** on both services (`autoDeploy: false` in `render.yaml`).
- `.github/workflows/deploy.yml` runs on `workflow_run` of the `ci` workflow, only when
  `conclusion == success` and the branch is `main`. It POSTs `RENDER_DEPLOY_HOOK_MCP`, then
  `RENDER_DEPLOY_HOOK_APP`, each with `?ref=<head_sha>` so Render deploys the exact commit CI tested,
  then polls `DEPLOYED_APP_URL/health` until `"status":"ok"` or ten minutes, and finally asserts that
  both MCP servers report `connected` with 4 + 5 tools.
- When the three secrets are absent the workflow exits with a notice instead of failing, so CI
  history stays green while the Render services do not yet exist (BLOCKERS.md item 3).

## Why `workflow_run` and not a job in `ci.yml`

A deploy job inside `ci.yml` with `needs: build-and-test` would also work. `workflow_run` keeps
`ci.yml` identical for pull requests and pushes (no `if: github.ref == 'refs/heads/main'` branching),
keeps deploy secrets out of the workflow that runs on PR branches, and gives the deploy its own
concurrency group so two fast pushes cannot interleave hook calls.

## Consequences

- The deploy lags CI by one workflow start (seconds).
- MCP deploys first so the app's first health probe has a chance of finding it up; the poll loop
  tolerates the cascade either way.
- Rollback is "re-run deploy on an older green run" or Render's own rollback button; both deploy a
  commit that has passed CI.

# ADR 0009 — Two Render services: `westline-app` and `westline-mcp`

Status: accepted · 2026-09-04

## Context

PRD §2 and §10 fix the host (Render, free tier) and the topology (two web services). The question
worth recording is *why two* when a single service with `MCP_MODE=inprocess` (ADR 0011) would work
and would avoid the cold-start cascade described in `deployed.md`.

## Decision

Deploy the MCP servers as their own service, `westline-mcp`, and have `westline-app` reach them over
the public network with `MCP_MODE=http`, a shared-secret header, and the same `McpToolClient` used
locally.

## Reasons

1. **The rubric asks for real MCP calls to a real server, documented by transport.** A separate
   process on a separate host, reached over HTTPS with discovery at startup, is unambiguous. An
   in-process loopback would be defensible but invites the question "is that really MCP?".
2. **Failure isolation is part of the demo.** `CHAOS_DISABLE_HR_MCP` and `/health` reporting `hr:
   down` only mean something when the servers can fail independently of the app.
3. **Ownership matches the PRD.** `policy-mcp` owns the index; `hr-data-mcp` owns `desk.sqlite`. The
   app owns neither and reads both through the host's `/health` and `/desk`, so the app never opens a
   SQLite file it does not own.

## Consequences

- Two cold starts instead of one; documented with a warm-up procedure. `deploy.yml` polls the app's
  `/health` for up to 10 minutes because the first probe can hit both services asleep.
- The index is built twice (once per service) from the same committed corpus. Both builds record
  the same `corpus_hash`; `/health` on each exposes it so a mismatch is visible.
- `MCP_SHARED_SECRET` must be identical on both services. It also signs confirmation tokens, so a
  mismatch shows up as `BAD_SIGNATURE` on the gate, not only as 401s on discovery.
- The single-service fallback remains one env var away (`MCP_MODE=inprocess`).

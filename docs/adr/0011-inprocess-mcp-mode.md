# ADR 0011 — `MCP_MODE=inprocess` starts the real HTTP host on a loopback port

Status: accepted · 2026-09-04

## Context

PRD §2 requires two MCP modes with "the same client code path in both": `http` against the separate
`westline-mcp` Render service, and `inprocess` as the local default and single-service fallback.
CLAUDE.md forbids importing any tool implementation into `apps/server`.

## Decision

`inprocess` does not mean "call the tool functions directly". The app imports one function from
`@westline/mcp-host`, `startMcpHostFromEnv`, which builds both server contexts and listens on
`127.0.0.1:0`. The app then constructs the same `McpToolClient` it uses in `http` mode, pointed at
that loopback URL, and every tool call goes over Streamable HTTP with the shared-secret header.

## Consequences

- The MCP transport, discovery, schema stripping, identity injection and `TOOL_UNAVAILABLE` handling
  are exercised in every test run and every local session, not only in production.
- `apps/server` has no import of `@westline/policy-mcp` or `@westline/hr-data-mcp`; the dependency
  is on the host bootstrap only. A lint rule could enforce this; the package.json already does.
- Cost: one extra loopback hop per tool call (sub-millisecond) and the index is built or opened by
  the app process in this mode, which is why `westline-app`'s Render build also runs `index:build`.
- Two further server-owned arguments follow from the same boundary: `acting_person_id` and
  `confirmation_token` are removed from the model-facing tool schemas and injected by the client, so
  the model can neither claim an identity nor mint a confirmation.

# Westline HR Agent — conventions for Claude Code

Read `westline-prd.md` first. It is the source of truth; when code and PRD disagree, the PRD wins
unless an ADR in `docs/adr/` says otherwise.

## Stack
TypeScript strict everywhere. Node 22 (node:sqlite is built in). npm workspaces:
`apps/web` (React + Vite + Tailwind), `apps/server` (Fastify), `mcp/policy-mcp`, `mcp/hr-data-mcp`,
`mcp/host` (HTTP host for both MCP servers), `packages/shared`, `packages/rag`, `evaluation`.
Vitest at root. ESLint + Prettier defaults.

## Non-negotiables
- The agent calls tools ONLY through the MCP client (`apps/server/src/mcp/client.ts`).
  Never import a tool implementation into `apps/server`. (`inprocess` mode may import the *host
  bootstrap* `@westline/mcp-host` to start the servers on a loopback port — see ADR 0011 — but the
  request path is still Streamable HTTP.)
- Tools return structured JSON, never prose. Errors are structured results (`FORBIDDEN`,
  `NOT_FOUND`, `AMBIGUOUS`, `NOT_APPLICABLE`, `TOOL_UNAVAILABLE`, `CONFIRMATION_REQUIRED`),
  not thrown exceptions across the MCP boundary.
- Authorization (scope) is enforced inside `hr-data-mcp`. Audience filtering is enforced inside
  `policy-mcp` before ranking. Never enforce either only in the prompt.
- Gated tools (`create_mock_hr_ticket`, `draft_hr_email`) never execute without a valid single-use
  token bound to the args hash.
- Trace events follow `packages/shared/src/trace.ts`. Never emit chain-of-thought.
  Redact `confirmation_token` in traces.
- Secrets only from env. `.env` is gitignored. `.env.example` is kept current.
- Chunking must be deterministic; `tests/ingest.test.ts` snapshots chunk hashes.
- Design tokens in `apps/web/src/styles/tokens.css` are fixed. No motion, no shadows, no gradients,
  no component libraries.

## Workflow
- Work milestone by milestone (PRD §15). Each milestone: implement → tests green →
  update `ai-tooling.md` with a dated entry (what was asked, what was produced, what went wrong,
  how it was caught) → conventional commit → push.
- Prefer small files with one responsibility. Name things after PRD terms (`workforce_class`,
  `acting_person_id`, `withheld_by_audience`).
- When a PRD detail is ambiguous, pick the option that maximizes the rubric (PRD §22) and record
  the choice in `docs/adr/`.
- If a required external resource is missing (API key, Render URL), do not stub silently: write the
  exact missing item to `BLOCKERS.md`, continue with everything unblocked, and keep going.

## Commands
```
npm run dev | build | typecheck | lint | test | index:build | start:app | start:mcp
npm run eval -- --target local|deployed --runs N
```

## Embedding providers
`EMBEDDING_PROVIDER=voyage|local|stub`. `stub` is a deterministic hash embedder used by the test
suite so CI needs no API keys — never use it to build a real index.

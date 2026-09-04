# Westline HR Agent

An agentic HR-policy assistant for **Westline Media Inc.**, a fictional Western Canadian media
company. Audience-scoped RAG over a 14-document policy corpus, driven by a plan-then-act agent
that reaches every capability through two MCP servers, enforces authorization at the tool
boundary, gates mutating actions behind explicit confirmation, and returns cited, structured
answers with a visible operational trace.

Quantic MSAIE · AI Engineering Techniques and Architectures · individual submission.

> **Status: build in progress.** See `STATUS.md` (written at M8) for what is done and verified,
> and `BLOCKERS.md` for what still needs Micah's accounts.

## Documents

| File | What's in it |
|---|---|
| `westline-prd.md` | Source of truth: scope, decisions, milestones, rubric traceability |
| `design-and-evaluation.md` | Architecture diagram, design justifications, evaluation results |
| `deployed.md` | Deployed URLs, env vars, cold-start behaviour |
| `ai-tooling.md` | How Claude Code was used, and what it got wrong |
| `CLAUDE.md` | Repo conventions |
| `docs/adr/` | Architecture decision records |

## Quick start

```bash
nvm use              # Node 22+ (node:sqlite is required)
npm ci
cp .env.example .env # add ANTHROPIC_API_KEY and VOYAGE_API_KEY
npm run build
npm run index:build  # build the RAG index from corpus/
npm run start:app    # http://localhost:3000
```

`MCP_MODE=inprocess` (the local default) starts both MCP servers on loopback ports and talks to
them over Streamable HTTP — the same client code path used against the deployed MCP service.

## Layout

```
corpus/            14 policy documents (markdown, HTML, PDF) with audience front-matter
mock_data/         synthetic people, PTO ledger, benefits, creator records, markets
packages/shared/   domain vocabulary, trace schema, answer schema, args hashing
packages/rag/      ingestion, chunking, embeddings, hybrid retrieval, sqlite-vec store
mcp/policy-mcp/    4 tools over the policy corpus (owns the index)
mcp/hr-data-mcp/   5 tools over mock HR data (owns authorization and the confirmation gate)
mcp/host/          HTTP host exposing both servers at /mcp/policy and /mcp/hr
apps/server/       Fastify API, MCP client, plan-then-act orchestrator
apps/web/          React chat UI, trace rail, confirmation card, /desk, /eval
evaluation/        28-item eval set, metrics, ablations, results
```

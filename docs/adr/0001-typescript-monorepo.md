# ADR 0001 — TypeScript strict, npm workspaces monorepo

Status: accepted · 2026-09-04

**Context.** PRD §2 locks TypeScript and a monorepo. The question was how many packages and how they depend on each other.

**Decision.** Eight workspaces with one-way dependencies: `shared` ← `rag` ← `policy-mcp`; `shared` ← `hr-data-mcp`; both MCP servers ← `host`; `shared` + `host` ← `server`; `evaluation` ← `server` + `rag`. `apps/web` is independent (browser bundle; mirrors the shared types by hand because `shared` uses `node:crypto`). TypeScript project references build them in order; Vitest runs at the root against the built `dist/` outputs so tests exercise what ships.

**Consequences.** `apps/server` cannot import a tool implementation without adding a dependency that the package graph makes visible in review. `node:sqlite` forces `dist/` to be loaded natively by Node rather than transformed by vite-node (`vitest.config.ts` externals). The cost is a build step before tests.

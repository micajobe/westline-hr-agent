# AI tooling log

How Claude Code was used to build the Westline HR Agent: what it was asked for, what it
produced, what it got wrong, and how that was caught. One entry per milestone.

---

## M0 — Scaffold (2026-09-04)

**Asked for:** the monorepo skeleton from PRD §15 M0 — npm workspaces, TypeScript strict, root
scripts, `.nvmrc`, `.env.example`, `CLAUDE.md`, a CI workflow, and the `packages/shared`
vocabulary (domain types, trace schema, args-hash, answer schema) with tests.

**Produced:** eight workspaces (`packages/shared`, `packages/rag`, `mcp/policy-mcp`,
`mcp/hr-data-mcp`, `mcp/host`, `apps/server`, `apps/web`, `evaluation`), root tooling config,
`ci.yml`, and 10 passing tests over `audienceApplies`, `argsHash` and `TraceRecorder`.

**What went wrong — the native build.** The PRD locks `sqlite-vec` *via `better-sqlite3`*.
`npm install` failed outright: `better-sqlite3@11` has no prebuild for the Node 26 installed on
this machine and its `node-gyp` compile fails against Node 26's V8 headers (six errors, all
deprecated-API related). Caught immediately by the install step, not by a later test.

Three ways out were on the table: install Node 20 locally, drop the vector store to a plain
file-backed index, or change the SQLite *binding*. The third is the least invasive: Node's
built-in `node:sqlite` supports `loadExtension`, and `sqlite-vec` ships **prebuilt loadable
extensions** per platform, so the whole stack needs no compiler at all. Verified with a
throwaway script before committing to it: loaded the extension, created a `vec0` virtual table,
inserted two vectors and ran a `match` query — `vec_version() = v0.1.9`, correct distances.

The vector store is still `sqlite-vec`, exactly as the PRD locks. What changed is the binding
(`better-sqlite3` → `node:sqlite`) and, as a consequence, the Node floor (20 → 22, since
`node:sqlite` is built in from 22). That also removes a well-known Render free-tier hazard:
native compiles that OOM or time out on a 512MB builder. Recorded as ADR 0003.

**Second thing it got wrong, smaller:** the first `package.json` set `engines: node >=20` and
`.nvmrc` to `20`, which would have silently produced a runtime with no `node:sqlite` on CI and
Render. Caught when writing `ci.yml` (`node-version-file: .nvmrc`) — both bumped to 22.

**Judgment calls I had to make rather than the PRD:** `EMBEDDING_PROVIDER` gained a third value,
`stub` (deterministic hash embeddings), so CI can run the full retrieval suite with no API keys.
PRD §18 lists only `voyage` and `local`. This is additive and test-only; `CLAUDE.md` says never
to build a real index with it.

---

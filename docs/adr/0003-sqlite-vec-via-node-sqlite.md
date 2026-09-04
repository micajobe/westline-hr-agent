# ADR 0003 — Vector store: `sqlite-vec`, bound through `node:sqlite`

Status: accepted · 2026-09-04 · Supersedes the binding named in PRD §2

## Context

PRD §2 locks the vector store to "`sqlite-vec` via `better-sqlite3`", with LanceDB as the fallback
only if the native build fails on Render.

The native build failed earlier than that — on the development machine. `better-sqlite3@11.10`
publishes no prebuild for Node 26, so npm fell through to `node-gyp`, which failed to compile
against Node 26's V8 headers. The same class of failure is a common cause of Render free-tier
build failures (512MB builder, no compiler cache).

## Decision

Keep `sqlite-vec` as the vector store. Change the SQLite binding from `better-sqlite3` to Node's
built-in `node:sqlite`, and raise the Node floor from 20 to 22 (`node:sqlite` ships with Node from
22; `loadExtension` is available from 23.4 and in current 22.x builds).

`sqlite-vec` distributes **prebuilt loadable extensions** per platform (`darwin-arm64`,
`linux-x64`, …) as plain `.dylib`/`.so` files. Loading one through `node:sqlite`'s
`{ allowExtension: true }` requires no compiler anywhere in the toolchain.

Verified before adoption: extension loads, `vec_version()` returns `v0.1.9`, a `vec0` virtual
table accepts `Float32Array`-backed blobs and returns correct `match` distances ordered by
`distance`.

## Consequences

**Good.** Zero native compilation on any machine — local, CI, or Render. Removes the most likely
free-tier deploy failure. Removes two dependencies (`better-sqlite3`, `@types/better-sqlite3`).
The PRD's actual intent — a real vector store with a real ANN/KNN index and SQL metadata
filtering alongside it — is unchanged.

**Bad.** Node 20 is no longer supported; `NODE_VERSION` on both Render services must be `22`
(PRD §10 says 20 — corrected in `deployed.md`). `node:sqlite`'s API is narrower than
`better-sqlite3`'s: no `.pluck()`, no user-defined-function ergonomics, and `BigInt` rowids come
back as `bigint`, which the store layer normalises.

**Rejected alternatives.** *Install Node 20 locally* — leaves the Render compile hazard in place
and pins the project to a runtime that reaches end-of-life during the marking period.
*Plain file-backed vector index* — honest and fast enough at this corpus size (~600 chunks), but
gives up SQL metadata filtering and the "vector store" the rubric asks for, to solve a problem
that has a cheaper fix. *LanceDB* (the PRD's own fallback) — also native, larger, and would have
to be justified anyway.

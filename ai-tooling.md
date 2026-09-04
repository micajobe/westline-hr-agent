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

## M1 — Corpus and mock data (2026-09-04)

**Asked for:** the 14-document Westline policy corpus per PRD §4 — front matter, stable numbered
headings, explicit figures, real cross-references, three source formats, 70–90 pages — plus the
mock data in PRD §5 including every named persona and a `pto_config.json` consistent with the PTO
document.

**Produced:** 33,200 words / 73.8 page equivalents across 14 documents (10 markdown, 2 HTML with
real tables, 2 PDF generated from committed markdown sources); `mock_data/` with 29 people across
all three workforce classes, PTO ledger, benefits, creator records, markets, PTO config and desk
seeds; 68 tests over the corpus and the mock data.

**What went wrong — `pdf-parse` is dead on modern Node.** The PRD names `pdf-parse` for the PDF
path. It bundles a 2019 copy of pdf.js that throws at *require* time on Node 26 —
`FormatError: bad XRef entry` raised from the module's own top-level initialisation, before any
file is opened. Caught on the first run of the PDF builder. Replaced with `pdfjs-dist`'s legacy
build, which is maintained and runs in plain Node. That turned out better than a like-for-like
swap: pdfjs returns positioned glyph runs with a `hasEOL` flag, which reconstructs real line breaks,
and line breaks are exactly what the ingester's heading pattern needs.

**A trap it nearly walked into, and the guard that catches it.** The ingester recovers section
structure from PDFs by matching a heading pattern (`3.2 Requests of three to five days`) against
extracted lines. A wrapped *body* line beginning with a digit would match that pattern and silently
invent a section — a citation pointing at a section that does not exist, which is the worst possible
failure for this project. So `scripts/build-pdfs.mjs` does not just render: it re-extracts each PDF
it wrote and asserts that the set of lines matching the heading pattern is exactly the set of real
headings from the source, failing the build otherwise. The PDF sources are written with numbers
spelled out in prose ("sixty-two cents per kilometre") so that check passes honestly rather than by
tuning the regex until it goes green.

**An inconsistency in the PRD, caught while authoring.** PRD §4.2 and the `REMOTE` design intent in
§4.1 both cross-reference a `TAX` document ("see `REMOTE` §4 and `TAX` §2"), but `TAX` does not exist
— the document table in §4.1 lists 14 documents and none of them is it. Rather than invent a
fifteenth document, the tax and payroll material became `EXPENSE` §8, which is where a reader would
look for it anyway, and `REMOTE` §3 cites it. The corpus test asserts that no document references a
`doc_id` outside the set of 14, so this class of dangling reference cannot come back.

**Judgment calls worth recording.** `BENEFITS` §6 (the assistance programme) and `ONBOARD` §4/§6
carry `section_audience_overrides` to `all`, so that contractors and creator partners can retrieve
the parts of staff documents that genuinely bind them. The PRD only specified the `EXPENSE` §7
override. This exercises the same mechanism three more times and makes `HANDBOOK` §2's `Partial`
rows true rather than aspirational. Jordan Reyes' ledger is pinned — tier 2, 18 days, 4 carried,
5 used, balance 11 — because the demo and the eval set depend on that number, and a test asserts it
rather than trusting the generator.

---

## M2 (in progress) — Chunker and ingest tests (2026-09-04)

**Asked for:** pick the M2 work back up from the `wip(m2)` commit — the heading-aware chunker
from PRD §4.3 steps 4–5 and 8, and `tests/ingest.test.ts` snapshotting chunk hashes — in a short
mobile session against the cloud sandbox.

**Produced:** `packages/rag/src/ingest/chunk.ts` (one chunk per leaf section, windowed split with
60-token overlap only when a section exceeds ~450 tokens, PRD chunk ids, effective audience, exact
`char_start`/`char_end`), a `corpusHash` for the rebuild gate, the package entry point, and 16 tests
over loading, front-matter validation, chunking, audience overrides and determinism. The corpus
yields 414 chunks; the `{chunk_id → content_hash}` map is a committed snapshot.

**What went wrong — two bugs in the committed WIP, both caught by running it against the real
corpus rather than a fixture.** First, the PDF loader never worked: it checked
`data instanceof Uint8Array` before wrapping, but a Node `Buffer` *is* a `Uint8Array` subclass, so the
Buffer went straight to pdfjs, which rejects it by name. Fixed by always passing a plain
`Uint8Array` view. Second, and worse because it was silent: turndown escapes `3. Notice periods`
as `3\. Notice periods` inside headings so it cannot be read as an ordered list. That defeats the
`## N.` heading regex, so every `<h2>` body in the two HTML documents — including the PTO §3 notice
table, the single most citable passage in the corpus — was dropped from the chunk set with no error.
The fix is a one-line unescape applied only to heading lines. The test that guards it counts the
numbered headings in each document's *authored source* (raw HTML, raw markdown, or the PDF's
markdown source) with an independent regex and asserts the parser recovered exactly that many.

**Smaller correction, own fault:** the first draft of the "never starts mid-word" assertion
rejected any chunk beginning with a lowercase word, which is a legitimate sentence start after a
paragraph-boundary split. Replaced with the actual invariant: the character before `char_start` in
the document is whitespace.

**Judgment call:** parent-section preambles longer than 80 characters become their own chunk
(`PTO#§3#0`) rather than being folded into the first child. The alternative would either lose the
notice table or attach it to §3.1, where a citation to "§3.1" for the 14-day rule would be wrong.

**Continued — embedding interface (same day).** Asked to keep going on the embedding interface and
stub provider. Produced `packages/rag/src/embed/`: one `EmbeddingProvider` interface (normalised
`Float32Array`s, separate document/query paths because Voyage is asymmetric), the `stub`
feature-hashing embedder for tests and CI, a dependency-free Voyage HTTP client with batching,
`input_type`, index re-sorting and 429/5xx backoff, and a factory driven by `EMBEDDING_PROVIDER`
that fails loudly on an unknown name or missing key instead of falling back. Nine tests, the Voyage
ones against a mocked `fetch` that returns vectors out of order to prove the client re-sorts.
`local` (transformers.js) is deliberately left as an explicit "not implemented" error: it is item 1
in the PRD §16 cut order and nothing depends on it before the eval ablation. Nothing went wrong in
this stretch; all checks passed on the first run.

**Continued — vector store and BM25 (same day).** Asked to keep going on the sqlite-vec store and
the BM25 index. Produced `packages/rag/src/store/`: `IndexStore` over `node:sqlite` + `sqlite-vec`
(chunks table, `vec0` table with cosine metric, serialised MiniSearch, build metadata — one file,
one hash), a `Bm25Index` wrapper, and `buildIndex` with corpus/model/chunker hash gating, a stub
refusal, and temp-file-then-rename so a crash mid-build never leaves an openable half index.
Twelve tests, including a no-op second build asserted by unchanged mtime, and reopen-from-disk
returning identical KNN results.

Two things worth recording. **Audience filtering inside the KNN query.** PRD §6.1 wants candidates
filtered *before* ranking. Probed `vec0` first: metadata columns accept `IN (?, ?)` with bound
parameters, combined with a second column, in the same `MATCH` query. So `audience` and `doc_id`
are metadata columns on the vector table and the top-k is computed over permitted chunks only,
which also means a filtered search still returns k results rather than "k minus the withheld ones".

**Vitest could not import `node:sqlite`.** vitest 2's bundled Vite predates the module and tried to
transform `sqlite` as a file, failing all three rag suites at import time. Fix in `vitest.config.ts`:
workspace `dist/` bundles are marked external so Node loads them natively; tests still import
`@westline/rag` normally. The ExperimentalWarning banner is silenced for the forks pool.

**One relevance tweak, caught by the M2 spot-check query.** "notice for a three day vacation" did
not surface PTO §3.2 on BM25 alone: no stemming meant "day" never met "days", and "for"/"a" carried
weight. A deliberately light plural folder plus a stopword list moved §3.2 to rank 2 and the §3
notice table to rank 4. A Porter stemmer was rejected: policy terms of art collide under it.

**Continued — retriever (same day).** Asked to keep building. Produced `packages/rag/src/retrieve/`:
`permittedAudiences` (the one place class + scope become a filter; anonymous ⇒ `all` only), a
deterministic follow-up rewriter (anaphoric opener or fewer than three content terms ⇒ carry the
prior query's terms), reciprocal rank fusion, the `Retriever` (both rankers under the audience
constraint, an unconstrained run alongside, and the diff reported as `withheld_by_audience` /
`withheld_doc_ids`), and `getPolicySection` with `NOT_FOUND` / `FORBIDDEN_AUDIENCE` semantics. To
serve full section text without stitching overlapping chunks, the index now stores each document's
normalised markdown and front matter in a `documents` table. Thirteen tests, including the Jordan and
Dani acceptance checks.

**What went wrong.** Three test expectations, not code. My RRF arithmetic was wrong twice (a and b
tie at 1/61 + 1/62; the test now asserts the ties and their id-order fallback). The hybrid "drone"
query's top hit is pulled by stub-vector noise, so the assertion is "SAFETY in the top 3", with BM25
alone still required to put SAFETY first. And the Jordan spot check: PTO §3.2 sat at rank 4 behind
§3 (the notice table), §3.1 and §8.1 — which turned out to be the worked example "A three-day
request, twelve days out", citing §3.2. That is an honest top hit, not a ranking bug. The stub test
now requires the top 3 to be PTO notice material and §3.2 within the top 5; the PRD's literal
"§3.2 in the top 3" remains the manual check against the Voyage index. One genuine improvement fell
out: the stub embedder now shares BM25's term normaliser, so the two rankers agree that "day" and
"days" are the same word; before that, hybrid tests could fail for reasons unrelated to the code
under test.

**Continued — `index:build` and `corpus:check` CLIs; M2 closes (same day).** Wrote the two CLIs the
root `package.json` already pointed at. `index:build` reads the provider from env, refuses the stub
without `ALLOW_STUB_INDEX=1`, and prints the build metadata as JSON; verified by running it twice —
first `"reason": "fresh"` (414 chunks, 248 ms with the stub), second `"reason": "up_to_date"` with
an unchanged `built_at`. `corpus:check` runs the M1 acceptance gate through the real ingester and
reports 14 documents, 489 sections, 414 chunks, 75.0 page equivalents. ADR 0004 records the seven
M2 decisions the PRD left open. M2 is complete apart from the `local` embedding provider, which is
PRD §16 cut-order item 1 and is deferred until the eval ablation needs it. Nothing went wrong in
this stretch.

---

## M3 — MCP servers (2026-09-04)

**Asked for:** both MCP servers per PRD §6 — nine tools, JSON schemas, scope and audience
enforcement, gate-token verification, Streamable HTTP behind a shared-secret header, `/health` on
the MCP service — with `mcp.discovery.test.ts`, `mcp.call.test.ts` and `gate.test.ts` green. Started
in a short mobile session (gate tokens, people directory, all of `hr-data-mcp`, no tests), finished
on the laptop.

**Produced:** `packages/shared/src/gate.ts` (HMAC tokens bound to the args hash, ten-minute TTL,
single-use registry), `packages/shared/src/people.ts` (scope derivation and the one `authorize`
rule), `mcp/hr-data-mcp` (five tools, `desk.sqlite`, env factory), `mcp/policy-mcp` (four tools
over the `Retriever`, the HANDBOOK §2 matrix parser, evidence-only compliance), `mcp/host` (one
Fastify process serving both servers at `/mcp/policy` and `/mcp/hr` as stateless Streamable HTTP,
401 without `x-westline-mcp-secret`, 503 for a chaos-disabled server, `/health` with the index
metadata) and 31 new tests that run the real HTTP transport against an in-memory stub index. 159
tests total.

**Decisions taken on mobile, confirmed on review.** Name lookups return `AMBIGUOUS` with in-scope
candidates only and `FORBIDDEN` when every match is out of scope, so a contractor cannot enumerate
staff by probing common names. `check_pto_balance` treats `pto_config.as_of` as "today" so
`notice_met` is deterministic in tests and demos. A consumed token is refused on replay with
`ALREADY_USED` even though its signature is still valid. One addition: authorization runs *before*
the gate, so a forged-but-authorized-looking request from someone out of scope is `FORBIDDEN`, never
`CONFIRMATION_REQUIRED` — the card should never be shown for an action the server would refuse anyway.

**What went wrong — the compliance tool's query shape.** The first cut of `check_policy_compliance`
searched `"${area}: ${scenario}"` once per area. For the demo-task-1 scenario, the drone area
returned `CREATOR §7.4`, `EXPENSE §7.2`, `CREATOR §7.1` — all correct, all pointing at SAFETY §5,
and none of them SAFETY §5 itself, because "bought", "expense" and "sponsored" in the scenario
out-weighed "drone approval and certification". Caught by the test that asserts SAFETY appears in
the evidence for a drone question. Fix: two passes per area (the area phrase alone, then the
scenario-anchored version) fused in that order, so a short area name is never drowned by a long
scenario. That is a retrieval-design fix, not a test loosening.

**A test I did loosen, deliberately.** "All six results for the notice query are PTO chunks" was my
assertion, not the PRD's; the sixth hit under the stub embedder is `REMOTE §1.2` (home market /
in-office days), which is a plausible neighbour. The PRD check is "PTO §3.2 in the top 3", asserted
against the Voyage index by hand; the stub assertion is top-3-PTO and §3.2 within the top 5.

**Transport choice worth recording.** Each request gets a fresh `McpServer` + stateless transport
(`sessionIdGenerator: undefined`, JSON responses) bound to the long-lived context. Render free
services restart on idle; a stateful session table would be lost on every cold start and the client
would have to re-negotiate. Stateless costs one tool registration per request (microseconds) and
buys a server the client can hit cold at any time. Verified with raw `curl` JSON-RPC against the
real `start:mcp` process: `initialize`, `tools/list`, 401 without the header.

---
## M4 — Agent and API (2026-09-04)

**Asked for:** PRD §7 and §8 — the MCP client with discovery and namespacing, the plan-then-act
loop with gate suspend/resume, the verify step, the §7.3 answer schema, trace events, every route
with Fastify schemas, the conversation store with TTL, `CHAOS_DISABLE_HR_MCP`, and
`server.start.test.ts` + `agent.plan.test.ts` green.

**Produced:** `apps/server/src/mcp/client.ts` (one Streamable HTTP session per server, `list_tools`
at startup, Anthropic `tools[]` namespaced `policy__*`/`hr__*`, routing by prefix, 3-second health
probe, `TOOL_UNAVAILABLE` as a structured result), `mcp/inprocess.ts` (starts the real host on a
loopback port via the `@westline/mcp-host` bootstrap — ADR 0011), `agent/` (plan, act loop,
citation registry, synthesize, verify, conversation store, orchestrator), `app.ts` with all eight
routes plus SSE variants of `/chat` and `/confirm`, `bootstrap.ts` so the test boots the same object
the deploy does, `scripts/demo.sh`, and 10 tests. 169 tests total; all green on the first run of the
new suites.

**Two boundary decisions the PRD implies but does not spell out.** `acting_person_id` and
`confirmation_token` are *removed from the model-facing tool schemas* and injected by the MCP client.
The test proves the point: the scripted model passes `acting_person_id: "W-1001"` (the HR partner)
inside a tool call while the request persona is Jordan, and the trace shows every call went out as
Jordan. The model cannot claim an identity, and it cannot mint a confirmation because it never sees
the field. The args hash the gate binds to is computed over the args *with* the injected identity, so
it matches what `hr-data-mcp` hashes.

**How the gate suspends.** The ACT loop can be interrupted mid-assistant-turn: an assistant message
may contain several `tool_use` blocks, one of them gated. Already-executed results are kept with the
suspended state and the pending block gets its `tool_result` on resume — either the real result (after
`/confirm` mints a token) or a structured `CANCELLED_BY_USER`, so a cancel still ends in a normal,
synthesized answer instead of a dead end. The suspended state lives in the conversation store under
the 30-minute TTL; a new message on the same conversation abandons the pending card.

**Server-authoritative overlays.** After synthesis, `actions_taken` is replaced with what the server
actually executed and `withheld_by_audience` is filled from the retrieval trace if the model left it
null. The test feeds the model a claim that it "sent an email" and a fabricated `PTO §99` fact with a
matching recommendation; the envelope shows one real draft (`DFT-…`, "not sent"), one fact with the
tool's real title and snippet in place of the model's, and the verify event reporting one unsupported
claim and one ungrounded recommendation removed.

**What went wrong: nothing failed in this stretch, which is worth being honest about.** The suites
passed on the first run because the M3 tests had already pinned every tool result shape the agent
consumes. The unverified part is the real model: `scripts/demo.sh` is written and exercised against
the scripted model through the same routes, but PRD §15 M4's "with a real key" acceptance is blocked
on `ANTHROPIC_API_KEY` (BLOCKERS.md item 1). Prompt quality against Sonnet is the M4 risk still open.

---

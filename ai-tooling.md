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

## M5 — Web UI (2026-09-04)

**Asked for:** every screen in PRD §9 with the fixed §9.2 tokens — chat with persona switcher and
health dot, the trace rail, the confirmation card, citation cards, `/desk`, `/eval` (sample data until
M7) — and both demo buttons completing end to end locally.

**Produced:** `apps/web` on React 18 + Vite 6 + Tailwind 4 with four local primitives (Badge, Chip,
Rule, Details) and no component library; `tokens.css` carries the §9.2 palette, scale and widths
verbatim, and the Micah-chosen pairing (PP Editorial Old display, PP Neue Montreal UI) self-hosted
as `.woff2`. The fonts were converted from the licensed OTFs with a pure-JS encoder run in a
scratch directory — nothing installed on the machine — and are gitignored. SSE streaming for
`/chat` and `/confirm` so trace rows appear as the tools run. `scripts/dev-scripted-server.ts`
boots the real app with the test suite's scripted model so the UI can be exercised without a key.

**What went wrong, in the order it was caught in the browser.**

1. *`/desk` showed raw JSON.* PRD §8 makes `GET /desk` an API route and §9 makes it a page, so the
   route shadowed the SPA. Fixed with content negotiation: `Accept: text/html` gets the page,
   everything else the JSON. Caught by navigating to it.
2. *Button text invisible.* `text-[var(--paper)]` is ambiguous to Tailwind 4 (colour or size?) and it
   guessed wrong; `text-[color:var(--paper)]` is explicit. The muted-text variants happened to work,
   which is why the mistake only showed on the ink-filled Confirm and Send buttons.
3. *Blank page after a rebuild.* `@fastify/static` with `wildcard: false` snapshots the directory at
   startup and registers one route per file, so a freshly built hashed bundle 404s until restart.
   Switched to wildcard serving; the SPA fallback still handles unmatched HTML requests. Caught by
   the network log, not the console: the 404s were on the new asset hashes.
4. *Trace rail readability.* "intent · intent · workflow" repeated the label; "retrieval" overflowed a
   56-pixel label column into the tool name; the turn header ran into the turn id. All layout, all
   visible in the first screenshot, all fixed by widening the label column and dropping the redundant
   name for non-tool rows.
5. *Raw markdown in citation snippets.* Snippets are the normalised markdown the index stores, so
   `**14 calendar days'**` showed its asterisks in the card. Stripped for display only.

**Verified in the browser against the scripted model:** persona switched by the demo button, trace
rows streamed in, the gate card held with the accent bar, Confirm resumed the loop, the verified
answer rendered two facts with chips, the guidance block, the applicability line with its
`HANDBOOK §2` chip and the "Done · not sent" draft line; clicking `PTO §3.2` opened the card with the
tool's real snippet. The verify row read "1 unsupported claim removed" for the fabricated fact the
script plants. The acceptance item that remains open is the same as M4's: running the two demo
buttons against Sonnet needs `ANTHROPIC_API_KEY`.

---

## M6 — Deploy (2026-09-04) — repo side complete; Render blocked

**Asked for:** Render configuration honoured, `deploy.yml` with hooks and health polling,
`deployed.md`, verification of `MCP_MODE=http` against the live MCP service and the `inprocess`
fallback.

**Produced:** `render.yaml` (Blueprint for both services: commands, env var names, `autoDeploy:
false`, Node 22), `.github/workflows/deploy.yml` (`workflow_run` on a green `ci`, POSTs the two
hooks with `?ref=<sha>`, polls `/health` up to ten minutes, asserts 4 + 5 tools connected, and exits
with a notice rather than a failure while the secrets are absent), `deployed.md` with the env table,
cold-start cascade, fallback and verification commands, ADR 0009 (two services) and ADR 0010 (deploy
gating). BLOCKERS.md item 3 now lists the six Render steps.

**Verified locally in place of the live service.** `start:mcp` as its own process on one port,
`start:app` with `MCP_MODE=http` pointed at it on another: discovery found 4 + 5 tools, `/desk` and
the index metadata came through the host proxy, `/health` was `ok` with `mode.mcp: "http"`. Then the
same with a deliberately wrong `MCP_SHARED_SECRET`: the app started, reported `degraded` with both
servers `down`, and kept serving the UI — the failure mode PRD §7.5 asks for, not a crash.

**What went wrong.** The wrong-secret check silently produced nothing the first time: the script used
GNU `timeout`, which macOS does not have, so the app under test never started and the probe read an
empty response. Rewritten with a background PID and `kill`. Small, but it is the kind of "the test
passed because it never ran" that is worth writing down.

**Open:** creating the services, setting the secrets, filling the `TBD` URLs, and running
`scripts/demo.sh <app-url>` against Render (BLOCKERS.md items 1–3).

---

## M5 addendum — design system pivot (2026-09-04)

After seeing the PP Editorial Old / PP Neue Montreal build, Micah's first note was that the type
was far too small (14px base with a small-x-height sans), and his second was to drop the PRD §9.2
tokens altogether and follow the Nimble editorial design system in `~/strategy-navigator`. Read its
`DESIGN-SYSTEM.md`, `tokens.css`, `LAYOUT-VOCABULARY.md` and the admin `globals.css`, then re-skinned
every component: B&W only, Fraunces / Inter Tight (`ss01`, `cv11`) / JetBrains Mono from Google
Fonts, four type roles, hairlines as the only device, state by glyph (● ◌ △) and border treatment.
ADR 0012 records the supersession; `CLAUDE.md` now points at it.

**What went wrong, twice, the same way.** Tailwind 4 cannot tell whether `text-[var(--x)]` is a
colour or a size. It bit the Confirm button first (paper text rendered as a size → invisible) and then
the whole headline scale (`--t-h1` rendered as a colour → 15px headlines). Both fixed with the explicit
forms `text-[color:…]` / `text-[length:…]`, and a grep now confirms no bare `var(--t-…)` remains.

**And a shell mistake worth recording.** Two heredoc writes were silently skipped because the shell's
working directory had persisted in `apps/web` from the previous command, so `cd apps/web && cat > …`
failed and the rest of the script ran anyway. The build succeeded with the *old* header and trace rail.
Caught by the screenshot, not by any tool. All later writes use absolute paths.

## M7 — Eval harness (2026-09-04) — built and plumbing-verified; real run blocked on the key

**Asked for:** PRD §12 — 28 items, the nine metrics, four ablations, `cold_start.ts`, `eval.yml`,
results writers, `/eval` on real `latest.json`, `human_scores.json` with the ten calibration items.

**Produced:** `evaluation/eval_set.json` (28 items, six categories, gold answers and `(doc_id,
section)` citations authored against the actual corpus, 18 latency items, 10 calibration ids);
`evaluation/src/` — set loader with validation, deterministic metrics (behaviour set, tool
subset/subsequence, plan-vs-actual Jaccard, section-prefix citation P/R, action safety, authorization
and audience checks, workflow completion, nearest-rank percentiles), the Opus judge (groundedness 0–2
per fact against the *cited chunk text*, answer match 0/0.5/1, both tool-forced at temperature 0), a
`ChunkResolver` that rebuilds a stub-embedded in-memory index so the judge reads the exact text the
agent saw without trusting the server, the runner (times `/chat`, confirms gates, scores), local
ablation configs, the aggregator and JSON/markdown writers, the CLI, and `cold_start.ts`. Two server
knobs for the ablations: `CHUNK_STRATEGY=fixed` (a 400-token sliding window that labels each window
with the section its first character falls in — deliberately the wrong label for many rules, which is
the point) and `RETRIEVAL_K_OVERRIDE` / `RETRIEVAL_MODE_OVERRIDE`. `eval.yml` builds both indexes and
commits results with `[skip ci]`. Ten metric tests; 179 tests total.

**Verified without a key.** The harness ran against the scripted-model server: 28 items, 28 run files,
`latest.json` + `latest.md` + dated copies, zero errors, action safety 100%. The other headline numbers
were low and *should* be — the scripted model plays one story regardless of the question — so this
proves the plumbing, not the agent. Groundedness and answer match are null with `--no-judge`.

**Two design choices to defend.** Behaviour accuracy is "expected ∈ observed set", not "observed ==
expected", because a sensitive complaint legitimately produces both an escalation and a ticket gate
(PRD §7.2 asks for exactly that). And the `RERANK=true` ablation row is not implemented: PRD §16 puts
it second in the cut order and the retriever reports `rerank: false` honestly rather than pretending.

**Open:** `npm run eval -- --target local --runs 3 --ablations` needs `ANTHROPIC_API_KEY` and
`VOYAGE_API_KEY`; the cold-start probe needs the deployed URL; the ten human scores are Micah's.

---

## M8 — Documentation (2026-09-04)

**Asked for:** README, `design-and-evaluation.md` with the Mermaid diagram and results,
`deployed.md`, the ADR set from PRD §13, `ai-tooling.md` through M8, `STATUS.md`; a fresh clone
following the README reaches a working local app; markdown lint passes.

**Produced:** the README (architecture in a paragraph, quick start with and without keys, demo
reproduction, eval commands, layout); `design-and-evaluation.md` (diagram of both deployment modes,
one justification per rubric item with code pointers, the permission/audience matrix, all nine tool
schemas, the trace schema, seven safety properties, both demo tasks with expected sequences, the eval
set, metrics and ablations, and a results section that says plainly that no model run exists yet);
ADRs 0001, 0002, 0005–0008 to complete the §13 list; `STATUS.md`; a `markdownlint-cli2` config.

**What is honestly unfinished.** §8.4 of the design document is a description of what will be
reported, not a report. Writing a results table from the scripted-model plumbing run would have
produced plausible-looking numbers about nothing; leaving the section explicit about the gap is the
right call for a document a grader will read. The same applies to the "verified against the deployed
URL" column of `STATUS.md`: it is empty because the URL does not exist.

**Judgment calls.** The PRD's `TAX` document is referenced (§4.1, "see REMOTE §4 and TAX §2") but not
in the 14-document list; it became `EXPENSE §8` rather than a fifteenth document, and the corpus
cross-references were written accordingly. `STATUS.md` lists every deviation in one place so nobody
has to diff the PRD against the code to find them.

---

## Closing reflection

*(Micah — this section is yours. Suggested prompts: what the trace rail changed about how you read
the agent's behaviour; where Claude Code's first answer was wrong and what caught it — the
`better-sqlite3` build, the turndown heading escape, the `wildcard: false` static routes, the two
Tailwind ambiguities, the shell cwd that skipped two writes; what you would lock in the PRD next time
and what you would leave open.)*

## First real model run — prompt and robustness tuning (2026-09-04, evening)

**Asked for:** with Micah's Anthropic key in `.env`, run `scripts/demo.sh` against Sonnet 5 for the
first time and fix what breaks. Micah also added a Voyage key.

**What broke, in order, and how each was caught.**

1. **`400: temperature is deprecated for this model`.** Every call failed instantly. The model wrapper
   defaulted `temperature: 0` because PRD §12 says "temperature 0" throughout. Claude 5 models refuse
   the parameter. Removed from the agent wrapper and the judge; the eval's determinism now rests on
   tool-forced structured output and fixed prompts, and the results note says so. Caught by the first
   `/chat` envelope, which carried the error as a structured `model_error` trace event — the graceful
   path worked, which is the one good thing about the failure.
2. **`scripts/demo.sh` scored nothing.** It piped the envelope into `python3 -` *and* fed the script by
   heredoc, so stdin was the script and the JSON was empty. Rewritten to read from the file it already
   saved. Caught because the Python traceback said "Expecting value at char 0".
3. **Task 2 drafted twice.** After the confirmed draft executed, Sonnet called `draft_hr_email` again
   and hit a second gate. Fix: a gated tool that already produced an action this turn gets an
   `ALREADY_EXECUTED` result instead of a gate, and the system prompt says so. Caught by the trace:
   `gate → gate_resolved → call → result → gate`.
4. **Task 2 cited nothing.** The model answered the notice rule from `check_pto_balance`'s
   `notice_required` string without ever retrieving PTO §3.2, so VERIFY had nothing to keep. Added the
   "retrieve before you state" rule; it now calls `get_policy_section(PTO, §3.2)` and cites it.
5. **Task 1 produced good prose and zero facts — twice, for two different reasons.** First an 8,000-
   character `answer_markdown` with `policy_facts` empty (fixed with a `maxLength` on the summary, a
   mandatory-facts instruction, and a one-call repair pass). Then, with 13 facts emitted, the model
   returned `applicability` as a JSON *string*; the strict whole-answer parse failed and the fallback
   kept only the prose. Caught only after adding a per-turn raw dump (`DEBUG_SYNTH`), because the trace
   reported `facts: 13` at synthesis and `facts_in: 0` at verify — the discrepancy was the clue. Fix:
   coerce JSON-string fields and validate list items one by one, with a unit test that feeds a
   string `applicability`. The first version of the dump overwrote itself per synthesis, so for one
   round I was reading Task 2's output while debugging Task 1. One file per turn now.
6. **Task 2 confirmed, then failed.** Sonnet once sent `key_points` as a string. The user confirmed the
   card, the tool rejected the arguments, and the model retried into a second gate — the worst order of
   events for a confirmation UI. Fix: validate every tool call against the discovered JSON schema in
   the MCP client and bounce `INVALID_ARGS` to the model *before* gating. A gate now only ever shows
   arguments the tool will accept.

**Result.** Both PRD §14 tasks pass `scripts/demo.sh` against Sonnet 5 with stub embeddings: Task 1
in the expected tool order with 8 verified facts across EXPENSE §7, CREATOR, EDITORIAL §4, SAFETY §5
and HANDBOOK §2 and the EXPENSE withholding explained; Task 2 with gate → confirm → one draft and facts
citing PTO §3.2. Expected-tool checks accept `a|b` alternatives (search *or* section fetch) in
`demo.sh` and the eval set, because both are legitimate ways to retrieve a rule.

**Still open.** Voyage returns HTTP 500 for every request, including with a deliberately invalid key,
which points at their API rather than the key; the index is still stub-embedded. The eval has not run.

---

## Post-M8 — Recent-chats sidebar (2026-09-04)

**Asked for:** a sidebar of recent chats following the pattern in `~/strategy-navigator`, with the
question of whether changing the acting person should start a new chat — and whether the rubric
says otherwise.

**Produced:** `apps/web/src/lib/chats.ts` (a `localStorage` chat archive, 20 chats, turns and trace
included, with 12 unit tests over titling, capping, pruning, corrupt input and quota failure),
`ChatList.tsx` in the Nimble navigator idiom, a `PanelToggle` chevron shared by both rails, a
full-bleed Chat shell with the list anchored left and the trace anchored right, and ADR 0013.
Switching persona now starts a new chat; selecting a chat sets the header persona back to that
chat's.

**On the rubric.** Nothing in PRD §22 or §9.1 asks for chat history, and nothing there requires
persona continuity inside one conversation — so the rubric does not contradict the reset. It mildly
favours it: rubric 6 wants a grader to reproduce both demo tasks, and each demo button now opens its
own chat, and rubric 3/4's guardrails are better served by not carrying one audience's answers into
another person's context. The real argument is in the server: `runTurn` reassigns
`conv.acting_person_id` per turn but keeps `conv.history`, so a mid-conversation switch left the
previous persona's answers in the new persona's prompt. Tool-level authorization (ADR 0007/0008) was
never at risk; the model restating history was.

**What went wrong.**

1. **The persona-sync effect looked broken and wasn't.** The first browser check showed the header
   on a new persona with the old chat still active, which read as a dead effect. It was a screenshot
   taken between commit and passive effects; the next frame had the new chat. Caught by re-shooting
   instead of editing — worth remembering before "fixing" a React effect.
2. **Empty chats piled up.** Selecting a chat while an untouched one existed stranded it in the
   list. Fixed with `pruneEmpty(chats, keepId)` — only the chat you are looking at may be empty —
   with a test.
3. **The composer fell off the bottom.** With the shell switched to viewport height, the grid's
   implicit row is `auto`, so a long trace pushed the row past the container and the input off
   screen. Fixed with `gridTemplateRows: minmax(0,1fr)` plus `min-h-0` on both rails. Caught in the
   live app mid-turn, not by tests.
4. **A restored chat still said "restored" after being confirmed.** `touched` was recorded in `send`
   but not in `decide`, so confirming a gate in a reloaded chat left the staleness note up. Caught
   by running demo task 2 through reload → Confirm.
5. **Two spellings of the toggle.** The first pass used the word "collapse"; Micah pointed at the
   navigator project's chevron. Both rails now share `PanelToggle`, and the trace rail's collapse
   actually gives its 440px back instead of only hiding its contents.
## Real index and the PRD M2 spot check (2026-09-04, evening)

With the Voyage key working (after an outage that returned 500 even to a deliberately wrong key), the
index built under the no-payment-method cap — 3 requests/min, 10K tokens/min — with the new pacing
knobs, in about ten minutes. The PRD §15 M2 manual check then passed on real embeddings: "notice for a
three day vacation" as Jordan returns `PTO §8.1`, `PTO §3.2`, `PTO §3` (§3.2 in the top 3; the top hit
is the worked example that cites it); as Dani it returns HANDBOOK §8 and CREATOR §5/§9 material with
`withheld_by_audience: true` and `PTO`, `REMOTE` withheld.

**What broke.** Under 21-second pacing, `check_policy_compliance` (six query embeddings) exceeded the MCP
client's 20-second tool timeout and Task 1 got a `TOOL_UNAVAILABLE` for the policy server — the
graceful path, but a self-inflicted one. Timeout is now 120 s by default (`MCP_TOOL_TIMEOUT_MS`). The
real fix is a payment method on the Voyage account; until then every turn is slow by design.

---

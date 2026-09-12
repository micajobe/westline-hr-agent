# ADR 0018 — Searching the handbook: lexical, section-level, and filtered before it matches

Status: accepted · 2026-09-12 · Decided by Micah

## Context

The corpus is fifteen documents and roughly five hundred numbered sections — 70–90 page equivalents
by the PRD §4 estimate. ADR 0015 gave it a categorised table of contents, which answers "what does
Westline have a policy about". It does not answer "which section says the thing I half-remember",
and during evaluation review that is the question being asked dozens of times an hour: an eval case
claims `HOURS` §6.2 is the ground truth, and checking that means finding §6.2 by hand through a
category, a document and forty headings.

Micah asked for "a simple JavaScript search on the handbook". The simplest reading — ship the corpus
to the browser and filter it there — is the one thing this repo cannot do. Audience filtering is a
non-negotiable in `CLAUDE.md` and lives inside `policy-mcp`; a client-side index would be the corpus
in plaintext in every reader's browser, `CREATOR` included.

## Decision

- **Search is a third read path over the corpus, and it goes where the other two go.** `searchLibrary`
  sits in `packages/rag/src/retrieve/search.ts` beside `buildLibrary`, is reached only through
  `mcp/policy-mcp/src/library.ts`, and is served over the host's read-only HTTP surface. Audience is
  decided by the same `effectiveAudience` + `canRead` pair the chunker and the reading view use.
- **The filter runs before the match, not after it.** A section outside the viewer's audience is
  skipped before a single term is compared, so it cannot produce a hit, a snippet, a score, or a
  count. Filtering a result set afterwards would be a subtler version of the same leak: the number
  of matches in a closed section is itself a report of its contents.
- **What was not searched is named; whether it matched is not.** The result carries
  `sections_withheld` — how many sections this reader may not open — in the spirit of ADR 0015's
  `withheld_doc_ids`. It deliberately does not carry a count of hits inside them.
- **Lexical, not the retriever.** This answers "which section contains these words" for a person
  reading, where the retriever answers "what is relevant to this question" for the agent. Every term
  must appear (so more words narrow), heading matches outrank body matches, and the whole query
  appearing verbatim scores far above its words scattered — phrase search without asking anyone to
  type quotation marks. No embedding call, so a keystroke costs nothing and works with
  `EMBEDDING_PROVIDER=stub`.
- **Sections are the unit, not chunks.** A chunk boundary is an artifact of ingestion and means
  nothing to a reader. Results land on `/handbook/:doc_id?section=§n`, which ADR 0015 already built.
- **`GET /handbook?q=` rather than `/handbook/search`.** The app proxies documents at
  `/handbook/:doc_id` with a `^[A-Za-z]{2,20}$` id pattern, which a `/handbook/search` route would
  match as a document called `search`. The query parameter has no such collision, and `spaOr`'s
  existing accept-header split keeps serving the SPA from the same path.
- **Not an MCP tool.** As with browse: the agent gains no capability, the tool list stays at nine,
  and the eval surface is unchanged.

## Consequences

- Scoring is a full scan of every readable section on every query — around 500 `parseSections` calls
  and a substring pass. At this corpus size that is a few milliseconds and needs no index; at ten
  times the size it would want the section bodies materialised in SQLite at build time. The scan is
  the thing to replace then, not the interface.
- Snippets are flattened to one line of plain text with markdown reduced to the words it wraps, and
  table rows joined with `·`. The rail renders them as text nodes, never as HTML — corpus text is
  not trusted as markup — so leaving `**` in would have printed the asterisks, which it did until
  caught in the browser.
- Matched terms are underlined with an ink hairline rather than highlighted: the palette is B&W
  (ADR 0012), so there is no marker colour to reach for.
- The search re-runs when the acting persona changes, because the audience did. Switching from
  Jordan to Marcus on the same query legitimately empties the result list.
- `score` is comparable within one query only. It is returned because it makes the ranking auditable
  during review, not because it means anything across queries.

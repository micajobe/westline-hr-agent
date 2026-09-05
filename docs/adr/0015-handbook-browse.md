# ADR 0015 — A Handbook tab: browse the corpus by owner, and open a citation in context

Status: accepted · 2026-09-04 · Decided by Micah

Numbered 0015 because 0014 is claimed by the in-flight composer restructure in `apps/web/src/pages/Chat.tsx`.

## Context

An answer cites chunks. A chunk is a leaf section (or a parent's preamble) of a policy document, and
the citation card shows a 240-character snippet of it. That is enough to trust an answer and not
enough to *read* one: `LEAVE` §4.2 says short-term disability starts after a seven-day elimination
period, and what that means depends on §4.1 above it and §6.2 beside it. Micah asked for two things
at once — a categorised listing of the handbook as a tab, and a link from every citation excerpt to
the passage in its document.

The corpus already knows how to categorise itself. `HANDBOOK` §4 "Who owns what" is a three-column
table — Area, Owner, Documents — and §2 is the applicability matrix that `get_policy_applicability`
already parses. Inventing a second taxonomy in code would have put the tab out of step with the
document it is a view of.

## Decision

- **The taxonomy is parsed from `HANDBOOK` §4, not written in code.** `parseCategories` sits beside
  `parseApplicabilityMatrix` and reads the same table a person would. `HANDBOOK` does not list
  itself, so `assignCategories` files any unlisted document under the category whose owner matches
  its front-matter `owner`, and gives it a category of its own if no owner matches. Every indexed
  document lands in exactly one category or the build fails a test.
- **Browse enforces audience the same way retrieval does.** `buildLibrary` and `buildDocumentView`
  live in `packages/rag` and are called only through `mcp/policy-mcp/src/library.ts`, so audience
  filtering stays inside `policy-mcp` (CLAUDE.md, ADR 0008). A section's effective audience is
  computed with the same `effectiveAudience` the chunker uses; a closed section is listed with its
  text nulled and the refusal worded exactly as `get_policy_section` words it. A document whose every
  section is closed is refused with `FORBIDDEN_AUDIENCE` rather than served empty.
- **Withheld is named, never hidden.** `HANDBOOK` §2 already tells every reader which documents
  exist, so the listing shows `CREATOR` to a staff member — greyed, △, unopenable — and reports it in
  `withheld_doc_ids`. Hiding it would be a different claim than the corpus makes.
- **Not an MCP tool.** The agent gains no new capability: this is served over the host's read-only
  HTTP surface (`GET /handbook`, `GET /handbook/:doc_id`) exactly as `/desk` is, behind the same
  shared secret, and proxied by the app. The tool list, and therefore the eval surface, is unchanged.
- **The reading view is the document, not a pile of chunks.** Each section carries its own body with
  descendants excluded — `parseSections` gives a `##` section its `###` children's text too, which
  would otherwise print twice — so rendering the list top to bottom reproduces the document once.
- **A citation links to `/handbook/:doc_id?section=§n`.** The page opens the document scrolled to
  that section, marked with an ink rule and a `● cited passage` eyebrow. Because chunks are leaf
  units, a chunk's `section_path` *is* the passage; no character-range highlighting is needed, and
  none is attempted — splitting markdown at chunk offsets would break the tables and lists the
  policies are full of.

## Consequences

- `remark-gfm` joins `apps/web`: seven documents carry markdown tables, and without it `HANDBOOK` §2
  renders as pipes. Table styling is added to `tokens.css` in the existing hairline vocabulary
  (`--border-soft` rows, `--border-rule` head), no colour, and wide tables scroll in their own box.
- The persona resolves a tick after mount, so the first fetch on a cold load is anonymous and the
  real one follows. Both fetches are guarded so a superseded reply cannot land last — without it a
  staff member deep-linking to a staff-only document saw "not available to this reader".
- The display fonts load with `display=swap`, so a scroll computed at first paint is measured against
  fallback metrics and is clamped to the end of the document when the real metrics arrive. The jump
  is repeated after `document.fonts.ready`.
- Browsing is a second read path over the corpus, which is exactly why it goes through `policy-mcp`.
  A future audience change is made in one place and both paths follow it.

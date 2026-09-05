# ADR 0017 — Hours, breaks and scheduling become their own policy document

Status: accepted · 2026-09-04 · Decided by Micah

## Context

The corpus answered every question about *time away* — accrual, notice, blackout windows, statutory
holidays, leaves — and almost none about *time at work*. A grep for the questions People & Culture
actually fields most often came back nearly empty: `lunch`, `meal break`, `rest break`, `overtime`,
`shift`, `workday` and `work week` appeared four times across the eleven documents that were not
`PTO`, and never as a rule. Nothing in the corpus said how long a working day is, when it may start,
whether the meal break is paid, how much rest is owed between two shifts, or how much notice a
schedule carries.

Two facts were already fixed elsewhere and constrained anything new: `PTO` §1.2 pro-rates part-time
accrual "against a 37.5-hour week", and `REMOTE` §6.1 measures time-zone overlap against a home
market's "09:00–17:00 window". A new document had to inherit both rather than restate them
differently.

The alternative was to scatter the material across the documents that half-touch it — day length
into `PTO`, core hours into `REMOTE`, turnaround into `SAFETY`, overtime into `EXPENSE`. That is
worse for retrieval and worse for readers: "how long is my lunch break" would have had no home, and
the applicability matrix would have had nothing to point at.

## Decision

- **A fifteenth document, `HOURS` — Hours of Work, Breaks & Scheduling**, owned by People & Culture,
  `audience: staff`. The corpus grows from 14 to 15 documents and from 74.8 to 83.3 page
  equivalents, inside the 70–90 the PRD §4.2 sets. PRD §4.1 is updated in the same change; the PRD
  stays the source of truth rather than being overtaken by the corpus.
- **`§6` is overridden to `staff_and_contractors`.** Crew calls, meal windows and turnaround bind
  everyone on a Westline call sheet, because fatigue is a safety condition and does not care how a
  person is engaged. This is the second use of `section_audience_overrides` after `EXPENSE` §7, and
  it widens rather than narrows: the `HANDBOOK` §2 row reads `Full | Partial (§6) | None`.
- **Existing figures are inherited, never re-decided.** The standard week is 37.5 hours because
  `PTO` §1.2 already said so; the reference working day is 09:00–17:00 because `REMOTE` §6.1 already
  measured against it, and core hours (10:00–15:00) sit inside it. The 20-hour part-time threshold is
  cited to `PTO` §1.2 and `BENEFITS` §2 rather than restated as a new rule.
- **Cross-references run both ways.** `PTO` §1.2 and §7, `REMOTE` §6.1, `SAFETY` §4.4 and `LEAVE`
  §4.4 now point into `HOURS`, so a reader arriving at the old documents is told where the hours rule
  lives. `HOURS` §9 is a table of exactly those hand-offs.
- **New deliberate tensions**, in the spirit of PRD §4.2: lieu time looks like paid time off and is
  not (`HOURS` §7.3 vs `PTO` §2.1); a graduated return replaces the standard week for its period
  (`LEAVE` §4.4); a night assignment lengthens turnaround (`SAFETY` §4.4); and a contractor's answer
  to "when does the crew break" is one section of a document that otherwise does not bind them.

## Consequences

- `EXPECTED_DOC_IDS` gains `HOURS`, `store.test.ts` expects `doc_count` 15, and the chunk-hash
  snapshot is regenerated — the five cross-referenced documents change hash too, which is the
  snapshot doing its job.
- The index is rebuilt (`npm run index:build`); `corpus_hash` changes, so any deployed service
  rebuilds on next start.
- The eval set is unchanged at 28 items (PRD §12.1). `HOURS` is retrievable but nothing scores it
  yet; an hours item is worth adding the next time the eval set is revised, and would fit the
  `multi_document` category since the good answers cite `HOURS` alongside `PTO` or `SAFETY`.
- Adding a staff-only document slightly widens what a creator partner is told they cannot read.
  `withheld_doc_ids` grows by one for `dani`, which is the intended behaviour under ADR 0008:
  withheld is named, never hidden.

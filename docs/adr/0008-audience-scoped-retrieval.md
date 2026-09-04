# ADR 0008 — Audience filtering inside retrieval, with an honest "withheld" signal

Status: accepted · 2026-09-04

**Context.** PRD §6.1: restricted policy text must never enter model context for a person it does not bind, and the agent must be able to say so truthfully.

**Decision.** Corpus front matter tags each document (`audience`) with optional per-section overrides (`EXPENSE §7 → creator_partners`, `BENEFITS §6 → all`, `ONBOARD §4/§6 → all`). The chunker records the effective audience per chunk; the store puts it in a `vec0` metadata column and the BM25 filter; `permittedAudiences(viewer)` is the single mapping from class + scope to tags (anonymous ⇒ `all`; HR partners ⇒ everything). The retriever also runs unconstrained and reports the documents that would have ranked as `withheld_doc_ids`.

**Consequences.** A creator partner asking about staff vacation sees no PTO text and is told PTO was withheld and CREATOR §5 applies. `get_policy_section` refuses (rather than hides) a section outside the viewer's audience, but checks NOT_FOUND first so section numbers cannot be probed. The `withheld` diff costs one extra ranking per search (milliseconds at this corpus size).

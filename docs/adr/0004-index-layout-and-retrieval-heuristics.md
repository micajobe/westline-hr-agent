# ADR 0004 — Index layout and retrieval heuristics chosen during M2

Status: accepted · 2026-09-04

## Context

PRD §4.3 and §6.1 fix the retrieval design (heading-aware chunks, `sqlite-vec` + BM25, RRF,
audience filtering before ranking, the `withheld_by_audience` diff, follow-up rewriting) but leave
several details to the implementer. These are the choices made, so they are not re-litigated later.

## Decisions

1. **One index file.** The BM25 index (MiniSearch, serialised JSON), each document's normalised
   markdown and front matter, chunk metadata and the `vec0` vector table all live in
   `data/index.sqlite`. PRD §4.3 says "persisted alongside"; a single file with a single
   `corpus_hash` means the app and the MCP service can never load mismatched halves.
   `data/index.meta.json` is still written for humans and the health endpoint.

2. **Audience and `doc_id` are `vec0` metadata columns.** The KNN query carries
   `audience IN (...)` and `doc_id IN (...)` constraints, so the top-k is computed over permitted
   chunks only (verified against `sqlite-vec` 0.1.9 before adoption). A post-hoc cut would return
   fewer than k results and leak, by count, that something was removed.

3. **Parent-section preambles are chunks.** Text under `## 3.` before `### 3.1` becomes its own
   chunk (`PTO#§3#0`) when it is at least 80 characters. PRD §4.3 says "one chunk per leaf
   section"; a strict reading drops the PTO notice table, the single most citable passage in the
   corpus, or misattributes it to §3.1.

4. **Section text comes from the stored document, not from chunks.** `get_policy_section` slices
   the document's markdown by section offsets, so overlapping windows never duplicate text and a
   `##` section includes its `###` children as a reader expects.

5. **Follow-up rewriting is heuristic, not an LLM call.** The tool must stay deterministic and
   offline. A query is a follow-up when it opens anaphorically ("what about", "and", "is it") or
   has fewer than three content terms; the prior query's content terms are appended. The agent
   loop (M4) may still rewrite with the model before calling the tool.

6. **A third embedding provider, `stub`.** Deterministic feature hashing for tests and CI (PRD
   §18 lists only `voyage` and `local`). `index:build` refuses it unless `ALLOW_STUB_INDEX=1`, and
   the stub shares BM25's term normaliser so hybrid tests do not fail on plural mismatches.

7. **BM25 term normalisation is a light plural folder plus stopwords, not Porter.** Policy text
   is dense with terms of art ("notice", "witness", "business") that a full stemmer collides.

## Consequences

The retrieval tests that run in CI are lexical proxies. The PRD's manual spot check ("§3.2 in the
top 3 as Jordan") is performed against the Voyage-built index, not asserted against the stub, where
§3.2 ranks fourth behind the §3 notice table and the §8.1 worked example that cites it.

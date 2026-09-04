# ADR 0005 — Hybrid BM25 + vector retrieval with reciprocal rank fusion

Status: accepted · 2026-09-04

**Context.** Policy questions hinge on exact tokens (section numbers, day counts, dollar figures) *and* on paraphrase ("time off" vs "PTO", "vacation" vs "paid time off").

**Decision.** Run BM25 (MiniSearch, light plural folding, stopwords, section refs kept as single tokens) and cosine KNN (sqlite-vec) under the same audience and doc constraints, pull 4k candidates from each, fuse with RRF (k = 60), return the top k. Follow-up queries are rewritten deterministically from the prior query's content terms. `RERANK=true` is reserved for an LLM reranker ablation and is not implemented (PRD §16 cut order).

**Consequences.** Retrieval is deterministic for a fixed index, so it can be tested with the stub embedder and compared across ablation arms. Ablation 3 measures each ranker alone. A Porter stemmer was rejected because policy terms of art collide under it (ADR 0004 §7).

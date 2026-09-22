# M9 — Semantic citation verification with Jev (TypeSafe System One)

Assignment brief for Claude Code. Read `CLAUDE.md`, `westline-prd.md` §7.1 (VERIFY) and
`docs/adr/0006-plan-then-act-and-evidence-only-compliance.md` first. Use the `typesafe-ai` skill and
read the live TypeSafe docs as part of the work; the facts recorded below were checked on
2026-09-21 but the docs win if they have moved.

## 1. Why

`verifyAnswer` (`apps/server/src/agent/verify.ts`) is structural only. It checks that every cited
`chunk_id` was retrieved this turn and drops facts with no surviving citation. It never asks whether
the cited passage *supports* the fact. That gap is the weakest number in the 2026-09-12 evaluation:
citation precision 49% (recall 65%, groundedness 92%). Sonnet cites real chunks that do not back the
claim, and nothing catches it.

Jev is a System One model: it reads text and returns typed answers with calibrated probabilities,
in milliseconds, at ~$0.04 per million input tokens, with no generated prose. Asked "how does this
passage relate to this claim?" per (fact, citation) pair, it gives VERIFY the semantic check it is
missing. This mirrors TypeSafe's own citation-check cookbook
(https://docs.typesafe.ai/cookbooks/citation_check.md) and is measurable with the existing harness.

Architecturally it is the right shape for this project: Sonnet does the System Two work (plan,
compose), plain code owns authorization and the gate, and Jev handles the fast calibrated judgments
around the boundary. Say that in the ADR.

## 2. Scope

**Must (this milestone):** semantic citation verification inside VERIFY, behind a provider flag,
with a stub for tests, traced, documented, and measured against the harness.

**Must not:**
- Touch authorization (`hr-data-mcp` scope, `permittedAudiences`, ADR 0007/0008).
- Put a model inside `check_policy_compliance` (evidence-only, ADR 0006).
- Change any MCP tool contract except the one additive field in §4.2.
- Change chunking (`tests/ingest.test.ts` hash snapshot must still pass).
- Call Jev through MCP. It is not a tool; it is a verification dependency of `apps/server`, like the
  Anthropic client.
- Emit reasoning. Probabilities and verdict counts are fine in traces; prose explanations are not.

**Stretch (only after §9 acceptance is committed and pushed):** see §10.

## 3. TypeSafe facts (verified 2026-09-21, re-check against the docs)

- SDK: `@typesafe-ai/sdk` (Node 20+). `import { TypeSafeClient, choice } from "@typesafe-ai/sdk"`;
  `new TypeSafeClient()` reads `TYPESAFE_API_KEY`; `await client.systemOne({ state, questions })`.
  Docs: https://docs.typesafe.ai/sdk/javascript.md
- Raw API fallback if the SDK gets in the way: `POST https://api.typesafe.ai/v1/systemone`,
  `Authorization: Bearer <key>`, body `{ state, model: "jev-latest", questions: { <id>: { type,
  instructions, criteria } } }`. A choice answer is `{ type: "choice", choice, probabilities: {…},
  confidence }`; a noul answer is `{ type: "noul", noul: 0.95 }`. Docs: https://docs.typesafe.ai/api.md
- Model alias `jev-latest` (currently `jev-1.13.0`). Limits: 64k tokens per request, 32k for state;
  1,200 req/min. Errors 401/422/429/529 with JSON bodies; back off on 429.
- Known jagged edges (https://docs.typesafe.ai/model-jaggedness/jev-1.13.md): literal reading, no
  arithmetic or date comparison, accuracy falls with irrelevant state, no defence against injected
  instructions in state. Consequences for this design are in §4.4.
- Questions run in parallel within one request and cannot see each other. Reference nested state
  with backticked paths, e.g. `passages.c1`. Question ids are not sent to the model; put full
  meaning in `instructions`.

## 4. Design

### 4.1 The question

Use a **Choice**, not a Noul, per (fact, citation) pair, mirroring the cookbook so contradiction is
a distinct, traceable outcome:

```
instructions: "How does the passage at `passages.<cid>` relate to the claim at `claim`?"
criteria:
  supports:     "The passage states the claim or directly implies that it is true."
  contradicts:  "The passage states the opposite of the claim or implies it is false."
  says_nothing: "The passage does not address what the claim asserts, either way."
```

Tune wording only if the docs' current guidance says otherwise; record the final text in the ADR.

### 4.2 State

One request **per fact**, questions for each of that fact's citations, over a state that contains
only what those questions need (irrelevant state degrades accuracy):

```json
{
  "claim": "<fact.statement>",
  "passages": {
    "c1": { "source": "LEAVE §3.2 Notice periods", "text": "<full chunk text>" },
    "c2": { … }
  }
}
```

The passage must be the **full chunk text**, not the 240-char snippet. `CitationRegistry`
(`apps/server/src/agent/citations.ts`) stores only `Citation` (snippet). Extend the registry to keep
the chunk `text` alongside each citation, internal to the server and never added to `AnswerSchema`.
Sources: `search_policy_documents` results carry `text` already (`RetrievedChunk`); `get_policy_section`
returns `text`; `check_policy_compliance` rules carry only `rule`/`snippet`, so add an additive
`text` field to `ComplianceRule` in `mcp/policy-mcp/src/tools/compliance.ts` (the hit already has
`hit.text`). Where text is still missing, fall back to the snippet and count it as `degraded_input`
in the trace.

Facts with zero citations, and the `applicability.citation`, keep the existing structural handling.

### 4.3 Decision rules

Configurable threshold `SEMANTIC_VERIFY_THRESHOLD` (default `0.8`, the cookbook's auto-accept level):

- `choice === "supports"` and `probabilities.supports >= threshold` → citation kept (`supported`).
- `choice === "contradicts"` → citation dropped (`contradicted`).
- otherwise → citation dropped (`unsupported`).
- A fact with no surviving citation is removed, exactly as today, and counted under
  `unsupported_claims_removed`. Recommendations lose their basis as today.
- A fact keeps living if at least one citation is `supported`, even if another was `contradicted`
  (a class-scoped passage can legitimately read as contradicting a claim about another class).
  Record this choice and its alternative in the ADR.

### 4.4 Failure and safety behaviour

- Provider `off` → `verifyAnswer` behaves exactly as today. Existing tests must pass unchanged.
- Jev error, timeout (default 4 s per request, one retry on 429/5xx), or malformed answer → fall back
  to structural verification for that fact, never block or degrade the answer, emit
  `result_status: 'semantic_unavailable'` detail. The answer path must never depend on TypeSafe
  being up.
- Passages are policy corpus text under our control, so injection risk is low; still, never put
  user input into the state. Claims come from the model's structured output, which is fine.
- No numbers or dates are judged by Jev; only the claim/passage relation.

### 4.5 Trace

Extend the existing `verify` event's `detail` (types in `packages/shared/src/trace.ts`):

```
semantic: {
  provider: 'typesafe' | 'stub' | 'off',
  model: string | null,
  pairs_checked, supported, unsupported, contradicted, degraded_input, unavailable: number,
  latency_ms: number,
  verdicts: [{ fact_id, chunk_id, verdict, p_supports, confidence }]
}
```

`result_summary` should read like `"4 facts verified · Jev removed 2 citations (1 unsupported, 1 contradicted)"`.
Make `TraceRail.tsx` show the semantic line if it is a one-line change within the design tokens; do
not redesign anything. Never include prose from any model.

## 5. Code layout

New workspace package `packages/semantic-verify` (name after the PRD stage, not the vendor):

- `src/provider.ts` — `SemanticVerifier` interface: `relate(claim, passages) → Verdict[]`; ids
  `typesafe | stub | off`; `SemanticVerifyError`.
- `src/typesafe.ts` — SDK-backed implementation (raw `fetch` fallback acceptable if the SDK's
  types fight `strict`). Timeout, one retry, usage tokens surfaced for the trace.
- `src/stub.ts` — deterministic, key-free, used by tests: `supports` at 0.95 when the passage
  contains a fixed fraction of the claim's content words, `says_nothing` at 0.9 otherwise, and
  `contradicts` when the passage contains the claim's words plus a negation marker. Document that
  it is a test double, like the stub embedder, and never for production.
- `src/index.ts` — `createSemanticVerifier(config)`.

`apps/server`: `config.ts` gains `semanticVerifyProvider`, `semanticVerifyThreshold`,
`typesafeApiKey`, `typesafeModel`; `verify.ts` takes an optional verifier and applies §4.3;
`orchestrator.ts` constructs and passes it; `citations.ts` keeps text.

## 6. Configuration

`.env.example` (keep current):

```
# ---- Semantic citation verification (TypeSafe / Jev) ----
# typesafe | stub (tests/CI only) | off (default)
SEMANTIC_VERIFY_PROVIDER=off
SEMANTIC_VERIFY_THRESHOLD=0.8
TYPESAFE_API_KEY=
TYPESAFE_MODEL=jev-latest
```

Default `off` so nothing changes for anyone who has not set the key. Render: add
`TYPESAFE_API_KEY` and `SEMANTIC_VERIFY_PROVIDER=typesafe` to the `westline-hr-agent` service.
That needs Micah's dashboard, so write it to `BLOCKERS.md` and `deployed.md` and keep going.
`render.yaml` gets the variable declared with `sync: false`.

## 7. Tests (Vitest, no keys)

- `tests/semantic-verify.stub.test.ts`: the stub's three verdicts are deterministic.
- `tests/agent.verify.test.ts` (extend): with `off`, byte-identical behaviour on the existing
  fixtures; with `stub`, a fact whose only citation says nothing is removed and counted, a fact
  with one supporting and one contradicting citation survives with one citation, a verifier that
  throws leaves the structural result intact and sets `semantic_unavailable`.
- `tests/mcp.call.test.ts` (extend): compliance rules now carry `text`.
- `tests/server.start.test.ts`: still green with the scripted model and `stub`.
- Typecheck, lint, full suite green; chunk hash snapshot unchanged.

## 8. Evaluation

Add an ablation config `semantic-verify` to `evaluation/` (toggle via env, like the others) and
report **citation precision, citation recall, groundedness, answer match, warm latency p50/p95**
with the verifier off vs on. Expected: precision up, recall flat or slightly down, latency up by
well under a second per turn.

Cost control: the full 7-config run cost ~$36 and 4 h. Default to **1 run × 29 items × 2 configs
(off, on)** with the real Jev provider and Sonnet 5, and stop before running it: it needs
`TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` locally and Micah has to okay the spend. Write the
exact command into `STATUS.md`. If keys are present and the spend was already approved in the
session, run it, rebuild `evaluation/results/latest.md`, and add the table to
`design-and-evaluation.md` §8.4 with a short reading of the result (what moved, what did not, one
sentence on why).

## 9. Documentation and acceptance

- `docs/adr/0019-semantic-citation-verification.md`: context (the 49%), decision (Jev Choice per
  pair in VERIFY, System One / System Two split, code owns policy and thresholds), alternatives
  (a second Sonnet call; a Noul per pair; string/fuzzy matching), consequences (new external
  dependency, fallback behaviour, threshold to tune, cost).
- `ai-tooling.md`: dated entry per the CLAUDE.md workflow (what was asked, produced, went wrong,
  how caught).
- `README.md`: one short subsection under architecture; `design-and-evaluation.md`: the design
  note and, when run, the results; `deployed.md` and `BLOCKERS.md`: the Render variables.
- `docs/demo-script.md`: one optional take showing the trace line where Jev removed a citation.

Accepted when: provider `off` is a no-op; `stub` exercises every branch in tests; `typesafe` runs
end to end locally against a real key with a visible `semantic` block in the trace; CI green with no
keys; ADR, ai-tooling entry and `.env.example` updated; eval command recorded (or run, with results
in §8.4); conventional commits pushed to `main`.

## 10. Stretch (separate commits, only after §9)

1. **Reranking.** `rerank` is plumbed (`config.ts`, `SearchArgs`, `retrieval.rerank`) but the
   retriever hard-codes `rerank: false`. Retrieve k=10 from hybrid RRF, ask Jev one **Score** per
   candidate ("how relevant is `candidates.cN` to `query`", 4 described levels), keep the top 6.
   Implement inside `packages/rag` behind the existing `RERANK` flag; measure with the k ablation.
2. **Audience lint at ingest.** A CLI in `packages/rag/src/cli/` that asks one Noul per chunk,
   "Does this passage contain information that should be restricted to managers or HR partners?",
   and prints chunks whose tag disagrees with the verdict. Offline, read-only, a table for the report.

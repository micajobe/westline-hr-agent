# ADR 0019 — Semantic citation verification with Jev inside VERIFY

Status: accepted · 2026-09-22 · Decided by Micah

## Context

VERIFY (PRD §7.1, `apps/server/src/agent/verify.ts`) was structural only. It checked that every
cited `chunk_id` had been retrieved this turn, replaced the model's citation metadata with the
tool's own, and dropped any fact left without a citation. It never asked whether the cited passage
*supports* the fact. That gap is the weakest number in the 2026-09-12 evaluation: **citation
precision 49%** against groundedness 92% and recall 65%. Sonnet cites real chunks that do not back
the claim it attaches them to, and nothing in the pipeline caught it.

The obvious fix -- a second Sonnet call to re-read every citation -- adds a slow, expensive, prose-
generating step to the answer path, and puts a second System Two judgment where a System One check
is what is missing. TypeSafe's Jev is built for exactly the latter: it reads text and returns typed
answers with calibrated probabilities in milliseconds, at roughly $0.04 per million input tokens,
with no generated text. TypeSafe's own citation-check cookbook asks one Choice per (claim, passage)
pair and treats contradiction as a distinct outcome.

## Decision

**Jev judges each (fact, citation) pair inside VERIFY, behind a provider flag, with code owning
the threshold and every decision rule.**

- **System One / System Two split.** Sonnet does the System Two work: plan, call tools, compose the
  answer. Plain code owns authorization, the confirmation gate and the verification policy. Jev
  supplies the fast, calibrated judgments around that boundary -- here, "does this passage support
  this claim?" -- and nothing else. It is a verification dependency of `apps/server`, constructed
  at bootstrap like the Anthropic client. It is **not an MCP tool**: it is not something the agent
  chooses to call, and putting it behind MCP would make a guardrail optional.
- **A Choice per pair, not a Noul.** The question mirrors the cookbook so that *contradicts* is a
  distinct, traceable verdict rather than a low "supports" probability. Final wording:

  ```
  instructions: How does the passage at `passages.<cN>` relate to the claim at `claim`?
  criteria:
    supports:     The passage states the claim or directly implies that it is true.
    contradicts:  The passage states the opposite of the claim or implies it is false.
    says_nothing: The passage does not address what the claim asserts, either way.
  ```

  Question ids are not sent to the model, so the instructions name the state paths in full.
  Passage keys are positional (`c1`, `c2`, …) because chunk ids contain `#` and `§`.
- **One request per fact.** State is `{ claim, passages: { c1: { source, text }, … } }` containing
  only that fact's claim and its cited passages, because irrelevant state degrades Jev's accuracy.
  Facts are judged in parallel. The passage is the **full chunk text**, not the 240-character
  snippet: the `CitationRegistry` now keeps text alongside each citation (server-internal, never in
  `AnswerSchema`), fed by `search_policy_documents` results, `get_policy_section`, and a new
  additive `text` field on `check_policy_compliance` rules. Where text is missing the snippet is
  used and the pair is counted as `degraded_input`.
- **Decision rules** (`SEMANTIC_VERIFY_THRESHOLD`, default 0.8, the cookbook's auto-accept level):
  `supports` with P(supports) ≥ threshold keeps the citation; `contradicts` drops it as
  *contradicted*; anything else drops it as *unsupported*. A fact with no surviving citation is
  removed and counted under `unsupported_claims_removed`, and recommendations lose their basis
  exactly as before. **A fact survives on one supporting citation even if another contradicts.**
  A class-scoped passage (CREATOR §5 on creator-partner leave) can legitimately read as contradicting
  a claim about staff; the alternative -- any contradiction removes the fact -- would punish the
  model for citing the passage that shows the rule differs by class, which is the behaviour the
  applicability matrix exists to encourage.
- **Facts with zero citations and the `applicability.citation`** keep their structural handling.
  Numbers and dates are never judged by Jev; only the claim/passage relation.
- **Failure behaviour.** Provider `off` (the default) leaves VERIFY byte-identical to before. A Jev
  error, timeout (4 s per attempt, one retry on 429/5xx) or malformed answer falls back to the
  structural result *for that fact*, counts the pairs as `unavailable`, and sets
  `result_status: 'semantic_unavailable'` when nothing else was removed. The answer path never
  depends on TypeSafe being up. User input never enters the state: claims come from the model's
  structured output and passages from the policy corpus.
- **Trace.** The `verify` event's `detail` gains a `semantic` block (types in
  `packages/shared/src/trace.ts`): provider, model, threshold, pair counts, latency, and one row
  per pair with `verdict`, `p_supports` and `confidence`. Probabilities, never prose. The
  `result_summary` reads like `4 facts verified · Jev removed 2 citations (1 unsupported, 1
  contradicted)`. The rail shows the block as one mono line under the verify row.
- **Code layout.** `packages/semantic-verify` (named after the PRD stage, not the vendor):
  `provider.ts` (interface, question text, answer parsing), `typesafe.ts` (`@typesafe-ai/sdk`),
  `stub.ts` (a lexical test double, like the stub embedder, never for production), `index.ts`
  (`createSemanticVerifier`). `apps/server` gains four config keys and an optional verifier on the
  orchestrator; `verifyAnswer` (sync, structural) is unchanged and `verifyAnswerSemantic` wraps it.

## Alternatives considered

- **A second Sonnet call per answer.** Adds several seconds and generated prose to every turn, at
  two to three orders of magnitude the cost per token, and produces a judgment that is itself a
  System Two output needing verification. Rejected.
- **A Noul per pair ("does the passage support the claim?").** One number, no way to tell "says
  nothing" from "says the opposite", and the jaggedness notes warn that Noul and Choice
  probabilities are not interchangeable. Contradiction is the interesting failure; a Choice names it.
- **String or fuzzy matching of the claim against the passage.** This is what the stub does, and
  it is the reason the stub is a test double: paraphrase, figures written as words, and rules that
  differ by class defeat lexical overlap in both directions. The cookbook uses string matching only
  for the *fabricated quote* case, which structural VERIFY already covers by chunk id.
- **Judging inside `check_policy_compliance`.** ADR 0006 keeps that tool evidence-only; a model in
  the tool would be a second, untraced judgment. Verification belongs where the answer is assembled.

## Consequences

- **A new external dependency on the answer path**, mitigated by the fallback above and by
  `off` as the default. Render needs `TYPESAFE_API_KEY` and `SEMANTIC_VERIFY_PROVIDER=typesafe`;
  the server refuses to start with the provider set and no key rather than silently degrading.
- **Latency.** One request per fact, all facts in parallel, so a turn pays roughly one Jev round
  trip (expected well under a second) plus at most one retry. `latency_ms` in the trace and the
  `semantic-verify` eval ablation measure it.
- **Cost.** A ten-fact answer with two citations each sends perhaps 8k input tokens to Jev, around
  $0.0003 per turn at list price.
- **A threshold to tune.** 0.8 is the cookbook's starting point, not a measurement on this corpus.
  The per-pair `p_supports` rows in the trace are the data for tuning it; the eval reports
  precision and recall with the verifier off and on.
- **Recall may fall.** A correct citation the model attached to a loosely worded claim can be
  judged `says_nothing` and dropped. That is the trade the 49% precision asks for, and the
  ablation is there to show its size.
- **The stub is lexical**, so tests exercise every branch but say nothing about Jev's accuracy.
  Acceptance of the `typesafe` provider is an end-to-end run against a real key with the
  `semantic` block visible in the trace.

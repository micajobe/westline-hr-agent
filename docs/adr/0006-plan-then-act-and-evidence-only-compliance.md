# ADR 0006 — Hand-rolled plan-then-act loop; compliance tool returns evidence, not judgment

Status: accepted · 2026-09-04

**Context.** PRD §2 forbids agent frameworks and §6.1 makes `check_policy_compliance` evidence-only.

**Decision.** The orchestrator is ~300 lines: PLAN (one tool-forced call → intent, entities, `needs_clarification`, `rag_only`, `expected_tools`), ACT (tool loop, ≤ 8 iterations, suspendable at a gate), SYNTHESIZE (tool-forced §7.3 answer), VERIFY (citations must be in this turn's registry). `check_policy_compliance` runs two retrievals per policy area (the area alone, then the scenario-anchored query), returns rules with citations and an `applies_to_class` flag from HANDBOOK §2, and never calls a model.

**Why no framework.** Every step is a visible trace event with a testable contract; the gate needs to suspend mid-assistant-turn and resume with server-minted state, which is awkward inside a framework's loop; and the rubric asks for the orchestrator to be explainable.

**Why evidence-only.** A model inside the tool would be a second, untraced judgment. Keeping judgment in the agent means one place to verify citations and one place the eval can score.

# ADR 0020 — Answer before the gate

Status: accepted · 2026-09-24 · Decided by Micah

## Context

PRD §7.1 suspends the ACT loop at a gated tool call and returns `confirmation_required`;
SYNTHESIZE and VERIFY run only after the user confirms or cancels. In practice the user was asked
to approve "Draft an email to your manager Priya Nair" while the transcript showed nothing but
"Before I do that, please confirm". The verdict the action rests on -- the balance fits, the notice
under PTO §3.2 is met -- was already gathered but not shown. Micah, rehearsing demo task 2: "You
wouldn't draft an email before you've tested whether or not you can even take the time off. We need
to display the answer before asking to draft the email."

Two fixes the same week made the gate wait for the reads (the gated call must stand alone,
and must follow the tools the plan named). That fixed the *order of tool calls* but not what the
user sees at the moment of decision.

## Decision

When ACT ends at a gate, SYNTHESIZE and VERIFY run immediately over what was gathered, with the
pending action described to the model as not yet run (synthesis rule 8a). The envelope carries the
verified answer and `confirmation_required` together; the chat renders the answer above the card,
and the trace reads `synthesis → verify → gate`.

Resolving the gate does not call the model again. Confirm mints the token and executes the one
pending action; its result is overlaid as `actions_taken` on the stored answer. Cancel adds one
sentence and executes nothing. The answer the user read does not change under them.

## Consequences

- The user decides with the answer in front of them, and the answer's policy facts are already
  verified (structural and semantic) when they do.
- One fewer model round trip per gated turn (synthesis happens once, before the gate, not after).
- The model never sees the action's result, so it cannot write a sentence about what the draft
  says. The server-owned "Done" row carries the result instead, which is the stronger guarantee
  against "the model claims it sent an email".
- The pending `tool_use` is answered with `AWAITING_CONFIRMATION` before the synthesis call, so the
  conversation sent to the API is always well-formed.
- A model failure during the pre-gate synthesis keeps the gate and falls back to the one-line
  prompt, so a transient error cannot lose the action.
- PRD §7.1's flow diagram now differs in one place; this ADR takes precedence per CLAUDE.md.

# ADR 0016 — One question field that moves; scenarios on the opening panel

Status: accepted · 2026-09-04 · Decided by Micah

## Context

PRD §9.1 puts the composer at the bottom of the Chat screen for the whole session, with two
"Run demo task" buttons beside it. That is the standard chat shape, and it read as one: the page
opened on a headline with no obvious place to start, the field at the bottom looked like a reply
box before there was anything to reply to, and a follow-up typed into it looked identical to a
first question even though the first is what opens a conversation and the rest discuss its answer.
Micah's reading of the shipped screen was that only the first entry looked like it triggered a
lookup and a follow-up looked like it started over — a legibility problem in the layout, since the
server has kept `conv.history` per `conversation_id` since M5 and every turn already resumes the
same conversation.

## Decision

- **One field, two positions.** `apps/web/src/components/Composer.tsx` is the only question field.
  An empty chat renders it `opening`: under the header, in the conversation column, four rows tall
  at `--t-lede`, focused on mount, with no field at the bottom of the page. Submitting removes it.
  Once the first turn settles, the same component renders `docked` at the foot of the column for
  follow-ups, and stays there for the rest of the chat so a follow-up does not make the page jump.
  Both positions share one `input` value; only one is ever mounted.
- **The transcript is a back-and-forth.** Every user message renders the same way — persona label
  and class badge, then the message right-aligned on `--paper-2` — and every answer below it under
  a `Westline` eyebrow. The first question no longer gets headline treatment: it is a turn like any
  other, which is the point.
- **Scenarios live on the opening panel.** The two PRD §14 tasks are listed as `Scenario 01` /
  `Scenario 02` rows under the opening field, titled from `/demo/tasks` rather than numbered
  buttons. Clicking one sets the persona and runs the question in a fresh chat, as the demo buttons
  did (ADR 0013). They are gone from the bottom bar, so a tester lands on them and a viewer of the
  video does not see them beside a live conversation. `New chat` returns to the opening panel, so
  the scenarios are always one click away.

## Consequences

- No server change and no change to the guardrails. A follow-up is a `/chat/stream` POST carrying
  the chat's `conversation_id`, exactly as before: it re-plans, re-retrieves under the same audience
  filter (ADR 0008), calls tools under the same scope check (ADR 0007), and re-arms the confirmation
  gate — verified in the browser by asking a follow-up after a confirmed draft and watching the gate
  fire again on the second turn within one `conversation_id`.
- The field is hidden while the *first* turn is in flight, on purpose: there is nothing to discuss
  yet and the trace rail is the thing to watch. It is shown again as soon as that turn settles, and
  also when `busy` is false with an unsettled turn, which is what a reload mid-flight leaves behind —
  without that second condition the chat would have no field at all.
- The `bottomRef` auto-scroll is now conditional on there being turns; unconditional, it scrolled the
  opening panel past its own headline on load.
- Departs from PRD §9.1 on composer placement and on the demo buttons' position and labels. Nothing
  else in §9.1 moves: header, trace rail, confirmation card, citation card and the ADR 0013 shell
  are untouched.

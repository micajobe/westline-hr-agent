# ADR 0013 — Recent-chats sidebar; a chat belongs to exactly one persona

Status: accepted · 2026-09-04 · Decided by Micah

## Context

PRD §9.1 describes a single-conversation Chat screen: header, conversation, trace rail, composer,
two demo buttons. Nothing kept a history, and the persona switcher rebound the *live* conversation:
`Orchestrator.runTurn` assigns `conv.acting_person_id = acting_person_id` on every turn while
keeping the last four exchanges in `conv.history`, so switching persona mid-conversation carried
answers written for one audience into another person's context. Authorization still held — scope is
enforced inside `hr-data-mcp` (ADR 0007) and audience filtering inside `policy-mcp` (ADR 0008), so
no *tool call* could return data the new persona may not see — but the model could restate the
previous persona's answer from history. Micah asked for a recent-chats sidebar following the
navigator pattern in `~/strategy-navigator` (`navigator-layout.tsx`, `table-of-contents.tsx`).

## Decision

- **A chat is bound to one acting person.** Switching persona in the header starts a new chat; the
  old one stays in the sidebar, readable, under the persona it was asked as. An *empty* chat is
  re-pointed at the new persona instead of being replaced. Selecting a chat sets the header back to
  that chat's persona, so the two can never disagree. A demo button owns both — it sets the persona
  and opens a fresh chat, so each PRD §14 task always reproduces from a clean conversation.
- **The archive is client-side.** `apps/web/src/lib/chats.ts` keeps up to 20 chats (turns, envelopes
  and trace) in `localStorage` under `westline.chats.v1`, newest first, writing once per settled turn
  rather than per trace event. The server's conversation store is in-memory with a TTL (PRD §8), so a
  restored chat may outlive its server-side context: the composer says so, and a follow-up in a
  restored chat is treated as a fresh question by the server. Corrupt, absent and quota-full storage
  all degrade to memory-only. Only the chat you are looking at may be empty; stranded empties are
  pruned.
- **Layout.** The Chat shell is full-bleed: the chat list anchors left (`--chat-list` 240px), the
  trace rail right (`--trace-rail` 440px), and the conversation fills what is left with its text
  still set to the readable `--chat-col` measure (720px), centred. The shell is viewport-height and
  each panel scrolls itself; Desk and Eval keep the centred `--max-content` measure. Either rail
  collapses to `--rail-collapsed` (40px) and gives its width back to the conversation.
- **Panel show/hide is a chevron, not a word.** `PanelToggle` renders the navigator project's 16px
  stroked chevron pointing the way the panel will move, replacing the "collapse / expand" text
  links on both rails.

## Consequences

- Two small departures from ADR 0012: it says "no icons", and the chevron is one inline path per
  direction (not an icon pack — the pattern is lifted from the same reference project); and the
  layout tokens gain `--chat-list` and `--rail-collapsed`, with the PRD's 1280 max-content now
  scoping Desk and Eval rather than the Chat shell.
- Rubric line 6 (grader reproduces both demo tasks) gets easier, not harder: each task runs in its
  own conversation and the sidebar leaves both transcripts side by side for the video.
- Nothing about the server changes, so no new leak surface: the sidebar reads only what this browser
  already received, and cross-persona context is prevented by construction rather than by prompt.
- The class badge is deliberately absent from the sidebar rows — at 240px the persona name plus the
  age is what identifies a chat; the class stays on every turn and in the header.

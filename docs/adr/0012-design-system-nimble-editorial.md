# ADR 0012 — UI follows the Nimble editorial design system, superseding PRD §9.2 tokens

Status: accepted · 2026-09-04 · Decided by Micah

## Context

PRD §9.2 fixed a palette with an accent (`#C8401F`), `--ok` and `--warn`, a 12–40 type scale and
placeholder typefaces. After the M5 build Micah chose PP Editorial Old / PP Neue Montreal, then, on
seeing the result, directed the UI to follow the design system in `~/strategy-navigator`
(`overview-design-system/DESIGN-SYSTEM.md` and `tokens/tokens.css`).

## Decision

Adopt that system wholesale:

- **B&W only.** Five values: `--ink #0a0a0a`, `--ink-2 #1a1a1a`, `--paper #fafaf7`, `--paper-2
  #f0f0ec`, `--muted #6b6b66`; `--rule` = ink. No accent, no semantic colours. The PRD names
  `--accent/--ok/--warn` remain defined but resolve into this set so nothing depends on them.
- **Type.** Fraunces (display: headline, lede, pull quote), Inter Tight with `ss01`/`cv11` (body),
  JetBrains Mono (eyebrows, tags, numerals, tool names, ids). Google Fonts; the PP webfonts are no
  longer used.
- **Four type roles** — eyebrow (mono 11px uppercase 0.14em), headline, lede, pull quote — plus body.
- **State without colour.** Glyphs `●` (on/done), `◌` (pending/off), `△` (attention: gate, denial,
  withheld, error), weight, and border treatment. Workforce class by border: staff solid,
  contractor dashed, creator partner filled.
- **Hairlines only.** Ink rules between sections, `paper-2` rules between rows, a dashed strip for
  exceptions (the confirmation card, the guidance block). Sharp corners; no shadows, gradients, icons.
- PRD widths (1280 / 720 / 440) and spacing are unchanged; they are layout, not look.

## Consequences

- PRD §9.2's "class badges by colour" and "accent for gate rows, escalation, active persona" become
  border treatment and the `△` glyph. The gate row is a dashed left rule, the strongest device the
  system allows, which is the right amount of emphasis.
- Trace status is legible in monochrome by design: every attention state is bold + `△`, every good
  result `●`. This also reads correctly in a grayscale screen recording.
- `CLAUDE.md`'s "design tokens are fixed" now refers to this system. Anyone extending the UI should
  read `DESIGN-SYSTEM.md`'s "What to reject" list first.

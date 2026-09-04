# ADR 0007 — Authorization, the confirmation gate, and identity are enforced at the tool boundary

Status: accepted · 2026-09-04

**Context.** PRD §3.3 and §6.2: scope rules and the gate must hold regardless of what the model does or what the message claims.

**Decision.**

- `hr-data-mcp` derives scope from the people directory and checks it on every call (`PeopleDirectory.authorize`); benefits are `self`/`hr_partner` only; authorization runs *before* the gate.
- Gated tools verify an HMAC token bound to `sha256(canonical_json(args_without_token))`, ten-minute TTL, single use; failures return `CONFIRMATION_REQUIRED`, never execute.
- The app's MCP client removes `acting_person_id` and `confirmation_token` from the model-facing schemas and injects them; the token is minted only by `/confirm` after the user clicks.

**Consequences.** A prompt injection that changes the model's idea of who is asking changes nothing: the server hashes and authorizes with the injected identity. The system prompt only teaches the model how to *relay* a denial. Tests: `gate.test.ts`, `mcp.call.test.ts`, `server.start.test.ts` (model-supplied identity overridden).

# ADR 0002 — Fastify for the app server and the MCP host

Status: accepted · 2026-09-04

**Context.** PRD §2 locks Fastify. The MCP SDK's Streamable HTTP transport expects Node `IncomingMessage`/`ServerResponse`.

**Decision.** Fastify for both processes. Request bodies are validated by JSON Schema at the route (`/chat`, `/confirm`); SSE is written on the hijacked raw response; the MCP host hijacks the reply and hands the raw request/response to a per-request stateless transport.

**Consequences.** One HTTP framework and one validation style across the repo. `GET /desk` needs content negotiation because PRD §8 makes it an API route and §9 a page. Static serving uses `wildcard: true` so rebuilt hashed assets do not 404 until restart.

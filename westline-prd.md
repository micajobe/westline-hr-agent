# Westline HR Agent — Product Requirements Document

Quantic MSAIE · AI Engineering Techniques and Architectures · Individual submission
Owner: Micah · Due: 2026-10-04 · Status: v1, grill-refined, ready for build
Companion docs: `project-plan.md` (superseded by this PRD where they differ)

---

## 1. Purpose and success criteria

Build, deploy, evaluate and demo an agentic HR-policy assistant for **Westline**, a fictional Western Canadian media company. The system combines audience-scoped RAG over a policy corpus with a plan-then-act agent that calls tools exposed by two MCP servers, enforces authorization at the tool boundary, gates every mutating action behind explicit user confirmation, and produces cited, structured answers with a visible operational trace.

**Success = a 5/5 on the rubric plus the following "impressive" markers a grader will notice:**

1. The agent resolves *who is asking and which rulebook applies to them* before answering, visibly in the trace (`lookup_person_profile` → `get_policy_applicability`).
2. Retrieval is audience-scoped before ranking: restricted policy content never enters model context for a person it doesn't apply to, and the agent explains the restriction truthfully.
3. Authorization is enforced inside the MCP servers, not the prompt.
4. Mutating actions pause on a confirmation card; tokens are single-use and bound to the exact arguments.
5. A trace rail that reads like a flight recorder, not a log dump.
6. An eval harness with human-calibrated LLM judging, four ablations, warm/cold latency, results rendered in-app at `/eval`.
7. Deploy gated on green CI via Render deploy hooks.

Every rubric requirement is mapped to a PRD section in §22.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Team | Solo |
| Language / runtime | TypeScript strict, Node 20, npm workspaces monorepo |
| Frontend | React 18 + Vite + Tailwind; served as static files by the app server |
| Server | Fastify (JSON-schema validated routes, SSE) |
| LLM | Anthropic API. `AGENT_MODEL` = Sonnet 5 (exact ID from env). `JUDGE_MODEL` = Opus (exact ID from env). Token cost is not a constraint |
| Embeddings | Voyage `voyage-3-lite` via API (`EMBEDDING_PROVIDER=voyage`); `transformers.js` local ONNX fallback (`EMBEDDING_PROVIDER=local`), used for one ablation |
| Vector store | `sqlite-vec` via `better-sqlite3`; LanceDB is the fallback only if the native build fails on Render |
| Retrieval | Hybrid BM25 + vector, reciprocal rank fusion, metadata filters (audience, workforce class, doc_ids); follow-up query rewriting; LLM reranker behind `RERANK=true` flag for ablation only |
| Chunking | Normalize every format to markdown → heading-aware chunker → ~450-token ceiling, 60-token overlap only when a section exceeds the ceiling; deterministic; corpus content hash gates rebuilds |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP, two servers (`policy-mcp`, `hr-data-mcp`), nine tools, shared-secret header between services |
| MCP modes | `MCP_MODE=http` (deployed default, separate Render service) / `MCP_MODE=inprocess` (local default, single-service fallback). Same client code path in both |
| Agent | Hand-rolled plan-then-act loop on Anthropic tool use. No framework |
| Identity | Persona switcher in UI → `acting_person_id` on every request. Identity claimed in message text is never trusted |
| Permissions | Scopes `self`, `manager`, `hr_partner`, enforced in `hr-data-mcp`. Audience tags on corpus docs enforced in `policy-mcp` |
| Safety | Confirmation gate on `create_mock_hr_ticket` and `draft_hr_email`; nothing is ever sent or irreversibly changed |
| Host | Render, two free web services: `westline-app`, `westline-mcp` |
| CI/CD | GitHub Actions: `ci.yml` (push/PR), `deploy.yml` (main, needs ci, fires deploy hooks), `eval.yml` (manual, commits results). Render auto-deploy OFF |
| Eval judge | Opus, temperature 0, human calibration on 10 items |
| UI | Minimal, editorial. Fixed design tokens. No motion, no dark mode, no onboarding tour |
| Workflows | Exactly two demo workflows (§16). No third |

---

## 3. Westline

### 3.1 The company
**Westline Media Inc.** builds, operates and manages a network of local news and entertainment properties across Western Canada. Content is produced by staff newsrooms alongside a network of social influencers and citizen journalists ("creator partners"). Revenue is advertising in which sponsored product launches, demos and features are produced to be as entertaining as the editorial content. Markets: Calgary (HQ), Edmonton, Vancouver, Kelowna, Saskatoon, Winnipeg. Roughly 180 staff, ~40 active contractors, ~250 creator partners.

Everything is fictional and authored from scratch. No real handbook text, no real people.

### 3.2 Workforce classes
`workforce_class ∈ { staff, contractor, creator_partner }`

| Class | Who | Handbook applicability |
|---|---|---|
| `staff` | Salaried/hourly employees: producers, newsroom leads, hosts, sales, digital, HR, finance | Full handbook |
| `contractor` | Independent freelancers on contract: shooters, editors, stringers | Conduct, Field Safety, InfoSec, Editorial Standards, Social Media, Expense (contractor sections), Onboarding (access provisioning) |
| `creator_partner` | Influencers and citizen journalists under a Creator Partner Agreement | Creator Partner Program Guide, Editorial Standards & Disclosure, Field Safety, Social Media, Conduct (public-facing sections), Expense (creator invoicing section only) |

### 3.3 Roles and scopes
`role` drives permission scope:

| Scope | Roles | Can access |
|---|---|---|
| `self` | every person | own profile, own PTO, own benefits, own tickets/drafts |
| `manager` | `newsroom_lead`, `market_director`, `creator_partnerships_manager`, any person with direct reports in the manager graph | everything in `self` for direct reports (profile, PTO; **not** benefits), drafts and tickets about direct reports |
| `hr_partner` | `hr_partner`, `hr_director` | all persons, all data, all ticket categories |

Denials return a structured `FORBIDDEN { reason, required_scope }`. The agent relays the denial plainly and, where useful, offers the legitimate route ("your lead or an HR partner can check that").

---

## 4. Policy corpus (`corpus/`)

### 4.1 Documents
15 documents, ~70–90 pages total, three source formats.

| # | doc_id | Title | Format | audience | Design intent |
|---|---|---|---|---|---|
| 1 | `HANDBOOK` | Westline Employee Handbook | md | `all` | Hub. §2 is the **applicability matrix**: table of every policy × workforce class. Cross-references all docs |
| 2 | `PTO` | Paid Time Off & Statutory Holidays | HTML | `staff` | Accrual tiers by tenure (e.g., 15/18/22 days), carryover cap, blackout weeks tied to major local events (Stampede, Grey Cup week when hosted), notice periods by request length (≤2 days: 48h; 3–5 days: 2 weeks; >5 days: 4 weeks), provincial statutory holiday table |
| 3 | `HOURS` | Hours of Work, Breaks & Scheduling | md | `staff` + section override `§6 Crew calls, turnaround and meals in the field` → `staff_and_contractors` | The practical week: 37.5-hour standard week and 7.5-hour day, reference day 09:00–17:00 and core hours 10:00–15:00, 05:00–24:00 scheduling window and shift patterns, unpaid 30-minute meal break by the fifth hour plus two paid rest breaks, 10/11-hour turnaround, 10-hour scheduled day with a 14-hour hard stop, 14-day schedule publication, standby and call-in minimums, overtime and lieu. §6 binds contractors on a Westline call sheet |
| 4 | `REMOTE` | Remote, Hybrid & Multi-Market Work | md | `staff` | Home-market default; working from another Westline market (notify lead); temporary out-of-province ≤4 weeks self-approved with lead sign-off; >4 weeks or any out-of-country requires HR + Finance review; references `TAX` and `INFOSEC` |
| 5 | `INFOSEC` | Information Security & Devices | PDF | `all` | Newsroom systems, source protection, public Wi-Fi + VPN, cross-border device rules, personal devices for content capture, incident reporting |
| 6 | `EXPENSE` | Expense & Equipment Policy | PDF | `staff_and_contractors` + section override `§7 Creator Partner Invoicing` → `creator_partners` | Camera/phone kits, travel between markets, per diems by market, role-based limits, home office cap, what contractors may claim (§6), what creator partners may invoice vs. what is theirs to own (§7: equipment purchases are the creator's, not reimbursable; sponsored-shoot production costs are invoiced per the Creator Guide rate card) |
| 7 | `BENEFITS` | Benefits Guide | HTML | `staff` | Eligibility by class and tenure, waiting periods (e.g., 90 days), enrollment windows, life-event changes, part-time thresholds |
| 8 | `LEAVE` | Leaves of Absence | md | `staff` | Parental, medical, bereavement, jury; interaction with PTO and benefits continuation |
| 9 | `ONBOARD` | Onboarding & Offboarding | md | `staff_and_contractors` | Staff checklist, equipment issue/return, access provisioning/deprovisioning timelines |
| 10 | `CONDUCT` | Respectful Workplace & Conduct | md | `all` | Harassment, complaints process, confidentiality, public-facing conduct for on-camera staff, escalation path to HR partner |
| 11 | `PERF` | Performance & Compensation Review Process | md | `staff` | Process and calendar only; explicitly does not describe outcomes — out-of-scope bait |
| 12 | `EDITORIAL` | Editorial Standards & Sponsored Content Disclosure | md | `all` | Ad-as-entertainment model; disclosure rules (on-screen label duration, caption tags, spoken disclosure for audio), who signs off (Editorial Standards desk), conflicts of interest, generic references to Canadian advertising standards |
| 13 | `CREATOR` | Creator Partner Program Guide | md | `creator_partners` (+ `hr_only`) | What a creator partner is/isn't; which handbook sections apply; rate card and invoicing (Net 30); exclusivity windows; brand deals outside Westline (disclosure + 10-day notice); equipment ownership; time-away expectations (no PTO — "availability windows") |
| 14 | `SAFETY` | Field Safety & Live Coverage | md | `all` | Solo shooting rules, events and crowds, weather, night coverage, drones (licensing, no-fly zones, approval), incident reporting |
| 15 | `SOCIAL` | Social Media & Personal Brand | md | `all` | Staff vs creators, use of Westline handles, political content, corrections |

### 4.2 Authoring rules (docs are retrieval instruments)
- Front-matter on every doc: `doc_id`, `title`, `version`, `effective_date`, `owner`, `audience`, optional `section_audience_overrides: { "§7": "creator_partners" }`.
- Numbered, stable headings (`## 3. Notice Periods`, `### 3.2 Requests of 3–5 days`). Sections are addressable as `PTO §3.2`.
- Explicit figures everywhere: days, dollar caps, thresholds, timelines. Numbers are what make citations checkable.
- Real cross-references between docs by `doc_id §n` ("see REMOTE §4 and TAX §2").
- Deliberate tensions that force multi-document reasoning: REMOTE vs INFOSEC vs the cross-border section; EXPENSE §7 vs CREATOR rate card vs EDITORIAL disclosure; LEAVE vs PTO vs BENEFITS continuation.
- Each doc 4–8 pages equivalent. Target 70–90 pages total.
- HTML docs include at least one real `<table>`; PDF docs are generated from markdown at authoring time (committed as PDF) so the parser is exercised on real PDF text.

### 4.3 Ingestion pipeline (`apps/server/src/ingest/`)
1. Load `corpus/**`; detect format by extension.
2. Normalize: `.md` as-is; `.html` → markdown via `turndown` (tables preserved as markdown tables); `.pdf` → text via `pdf-parse`, then heading reconstruction from the known heading pattern.
3. Parse front-matter; validate against schema (fail the build on a missing `audience`).
4. Heading-aware chunking: one chunk per leaf section; if a section exceeds ~450 tokens (approx by chars/4), split with 60-token overlap. Chunk id = `${doc_id}#${section_path}#${index}`.
5. Metadata per chunk: `doc_id, title, section_path, section_title, chunk_index, source_format, audience (effective, after overrides), char_start, char_end, snippet (first 240 chars), content_hash`.
6. Embed in batches; write vectors + metadata to `data/index.sqlite` (`sqlite-vec`), and a BM25 index (`minisearch` or equivalent) persisted alongside.
7. Write `data/index.meta.json` with `corpus_hash`, `chunk_count`, `embedding_model`, `built_at`. Rebuild only if `corpus_hash` differs.
8. Deterministic: same corpus → identical chunk ids, boundaries and hashes. Test enforces this.

---

## 5. Mock structured data (`mock_data/`)

All synthetic, obviously so. ~28 persons across classes and markets.

**`people.json`** — `person_id (W-1042)`, `name`, `workforce_class`, `role`, `title`, `department_or_program`, `market`, `home_province_or_state`, `work_country`, `manager_id | null`, `start_date`, `employment_status`, `scope` (derived at load: `self | manager | hr_partner`)

**`pto_ledger.json`** (staff only) — `person_id`, `tenure_tier`, `annual_entitlement_days`, `accrued_ytd`, `used_ytd`, `balance`, `carryover_from_prior_year`, `pending_requests[] {start, end, days, status}`

**`benefits.json`** (staff only) — `person_id`, `eligible`, `eligibility_reason`, `waiting_period_ends`, `enrolled_plans[]`, `dependents_count`

**`creator_records.json`** (creator partners only) — `person_id`, `agreement_start`, `tier`, `rate_card_id`, `exclusivity_window_days`, `active_brand_deals[]`, `availability_windows[]`

**`markets.json`** — market, province, time zone, office address (fictional), market_director_id

**`tickets.seed.json`** → loaded into `data/desk.sqlite` at startup: `ticket_id`, `created_by`, `about_person_id`, `category`, `summary`, `status`, `created_at`, `turn_id`; and `drafts` table with `draft_id`, `created_by`, `about_person_id`, `recipient_role`, `subject`, `body`, `turn_id`. Resets on redeploy (documented).

**Required personas** (used by the eval set and demo):

| Handle | Class / role | Purpose |
|---|---|---|
| Jordan Reyes · Producer, Calgary | staff | Demo Task 2 requester; 11 days PTO balance; manager = Priya Nair |
| Priya Nair · Newsroom Lead, Calgary | staff / manager | Manager scope; can view Jordan's PTO |
| Sam Okafor · HR Partner | staff / hr_partner | Full scope; ticket creation on anyone |
| Dani Kowalczyk · Creator Partner, Kelowna | creator_partner | Demo Task 1 requester; active brand deal; tier 2 |
| Marcus Lee · Freelance Shooter, Vancouver | contractor | Expense §6 questions; no PTO, no benefits |
| Avery Chen · Host, Vancouver | staff | Remote-from-Lisbon eval item; 6-week request |
| Taylor Brooks · Intern, Edmonton | staff (intern) | In benefits waiting period |
| Sam Lee (×2) · two different staff | staff | Duplicate-name ambiguity item |
| Riley Dube · Digital Analyst, Winnipeg | staff, `manager_id: null` | Missing-manager failure item |
| Noor Haddad · Creator Partnerships Manager | staff / manager | Escalation target for creator issues |

---

## 6. MCP servers (`mcp/`)

Both built on `@modelcontextprotocol/sdk`, Streamable HTTP transport, JSON-Schema `inputSchema` with `additionalProperties: false`, structured JSON results (never free text). Every tool accepts `acting_person_id` (nullable) as its first argument; the server resolves scope and audience from it. In `http` mode requests must carry `x-westline-mcp-secret` matching `MCP_SHARED_SECRET`.

### 6.1 `policy-mcp` (owns the RAG index)

**`search_policy_documents`**
in: `{ acting_person_id, query, k?=6, doc_ids?, section_prefix? }`
out: `{ results: [{ chunk_id, doc_id, title, section_path, section_title, snippet, text, score, source_format }], withheld_by_audience: boolean, withheld_doc_ids: string[], retrieval: { mode: "hybrid"|"vector"|"bm25", k, rerank: boolean, rewritten_query? } }`
Behaviour: filter candidate chunks by effective audience for the acting person's class *before* ranking; hybrid BM25+vector with RRF; `withheld_by_audience=true` when filtering removed any chunk whose doc would otherwise have scored in the top-k (computed by running the unfiltered ranking in parallel and diffing — this is what lets the agent say "that policy isn't available to you" truthfully). Anonymous acting person ⇒ audience `all` only.

**`get_policy_section`**
in: `{ acting_person_id, doc_id, section_path }`
out: `{ doc_id, title, section_path, section_title, text, audience, effective_date }` or `{ error: "NOT_FOUND" | "FORBIDDEN_AUDIENCE", reason }`

**`get_policy_applicability`**
in: `{ acting_person_id, workforce_class? }` (defaults to acting person's class)
out: `{ workforce_class, applies: [{ doc_id, title, scope: "full"|"partial"|"none", sections?: string[], note }], source: { doc_id: "HANDBOOK", section_path: "§2" } }`
Behaviour: parsed from HANDBOOK §2 at index build time; always cites HANDBOOK §2.

**`check_policy_compliance`**
in: `{ acting_person_id, scenario, policy_areas: string[], workforce_class? }`
out: `{ rules: [{ rule, doc_id, section_path, snippet, applies_to_class: boolean }], gaps: string[], applicability_note }`
Behaviour: **evidence-only**. Runs targeted retrieval per policy area, returns rule statements with citations and whether each binds the person's class. No LLM inside the tool; the agent forms the judgment.

### 6.2 `hr-data-mcp` (owns mock data and mock actions)

**`lookup_person_profile`**
in: `{ acting_person_id, person_id?, name? }`
out: profile `{ person_id, name, workforce_class, role, title, market, manager: {person_id,name}|null, start_date, scope }` or `{ status: "AMBIGUOUS", candidates: [{person_id, name, title, market}] }` or `{ status: "NOT_FOUND" }` or `{ status: "FORBIDDEN", reason, required_scope }`
Rules: `self` may look up self; `manager` may look up direct reports; `hr_partner` anyone. Name lookups that resolve to a person outside scope return `FORBIDDEN` without confirming existence details beyond name.

**`check_pto_balance`**
in: `{ acting_person_id, person_id, requested_days?, start_date?, end_date? }`
out: `{ person_id, balance, annual_entitlement_days, accrued_ytd, used_ytd, carryover, request_fits: boolean|null, blackout_collision: {window, reason}|null, notice_required: string|null, pending_requests }` or `{ status: "NOT_APPLICABLE", reason: "creator partners do not accrue PTO; see CREATOR §5 availability windows" }` or `FORBIDDEN`
Rules: computes `notice_required` from request length against PTO §3 thresholds (encoded in mock data config to stay consistent with the corpus); checks blackout windows from `pto_config.json`.

**`lookup_benefits_status`**
in: `{ acting_person_id, person_id }`
out: `{ eligible, eligibility_reason, waiting_period_ends, enrolled_plans, next_enrollment_window }` or `NOT_APPLICABLE` or `FORBIDDEN`
Rules: benefits are `self` and `hr_partner` only — managers are denied (privacy).

**`create_mock_hr_ticket`** — gated
in: `{ acting_person_id, about_person_id, category: "hr_partner"|"manager"|"creator_partnerships"|"security"|"editorial_standards", summary, details?, confirmation_token }`
out: `{ ticket_id, status: "open", created_at }` or `{ status: "CONFIRMATION_REQUIRED", proposed_args_hash }` or `FORBIDDEN`
Rules: missing/invalid token ⇒ `CONFIRMATION_REQUIRED` (never executes). Token must match `sha256(canonical_json(args_without_token))`, be unused, and be < 10 min old. Writes to `desk.sqlite`.

**`draft_hr_email`** — gated
in: `{ acting_person_id, about_person_id, recipient_role: "manager"|"hr_partner"|"creator_partnerships"|"editorial_standards", purpose, key_points: string[], confirmation_token }`
out: `{ draft_id, to_role, subject, body, created_at, sent: false }` or `CONFIRMATION_REQUIRED` or `FORBIDDEN`
Rules: as above. Body is templated deterministically from `key_points` (no LLM inside the tool). Never sends.

### 6.3 Discovery and client
`apps/server/src/mcp/client.ts`: on startup, for each configured server, open a Streamable HTTP session, call `list_tools`, validate schemas, build Anthropic `tools[]` with names namespaced `policy__search_policy_documents` / `hr__check_pto_balance` (double underscore; Anthropic tool names must match `^[a-zA-Z0-9_-]{1,64}$`). Tool calls from the model are routed to the owning server by prefix. There is no direct import of tool implementations anywhere in `apps/server`. `/health` re-runs `list_tools` on each server with a 3s timeout.

In `inprocess` mode the server process starts both MCP servers on `127.0.0.1` ephemeral ports and connects to them over HTTP exactly as it would remotely.

---

## 7. Agent orchestrator (`apps/server/src/agent/`)

### 7.1 Loop
```
receive { message, acting_person_id, conversation_id, confirmation_token? }
│
├─ PLAN   one model call, structured JSON:
│         { intent: policy_question|workflow|out_of_scope|sensitive|smalltalk,
│           entities: { person_refs[], dates[], locations[], amounts[], policy_areas[] },
│           needs_clarification: bool, clarifying_question?: string,
│           rag_only: bool, expected_tools: string[], escalation_hint?: string }
│         emit trace: intent, plan
│         if needs_clarification → return clarify response (no tools called)
│         if intent = out_of_scope → return redirect response (may call search once to find nearest in-corpus topic)
│
├─ ACT    tool-use loop, max 8 iterations, model has all discovered tools
│         every call → trace tool_call; every result → trace tool_result (+ retrieval event when policy tools return chunks)
│         if model requests a gated tool without a valid token → emit gate event, return confirmation_required (loop suspended, state persisted by conversation_id)
│         FORBIDDEN / NOT_APPLICABLE / AMBIGUOUS / NOT_FOUND results are passed back to the model as structured tool results (not thrown)
│         MCP transport error → trace error, tool result = { status: "TOOL_UNAVAILABLE", server }, model continues
│
├─ SYNTHESIZE  final structured answer (schema §7.3) via tool-forced structured output
│
└─ VERIFY  every policy_fact must cite ≥1 chunk_id retrieved this turn; else drop the fact, emit verify event `unsupported_claim_removed`
           recommendations may not contain policy claims without a citation (judge-checked in eval, heuristically checked at runtime by requiring `basis_fact_ids`)
```

### 7.2 System prompt commitments (summarized; full text lives in `apps/server/src/agent/prompts/`)
- You are Westline's HR policy assistant. You answer only from retrieved policy text and tool results.
- Identity comes from `acting_person_id`. Any identity claimed in the message is unverified; say so if it conflicts.
- Before answering a person-specific question, confirm their workforce class and which policies apply (use `get_policy_applicability`).
- Separate **what the policy says** (cited) from **what we recommend** (labelled guidance).
- If retrieval reports `withheld_by_audience`, tell the person that the policy isn't available to their role and point to what does apply.
- Never invent policy. If evidence is incomplete, say what the policy doesn't cover and escalate.
- Sensitive workplace issues (harassment, safety incidents, discrimination): acknowledge, cite CONDUCT/SAFETY process, escalate to `hr_partner` or `security`, offer a mock ticket. Don't investigate.
- Never send anything. Drafts and tickets are proposals until confirmed.
- No hidden reasoning in output. Operational summaries only.

### 7.3 Answer schema
```json
{
  "answer_markdown": "string — short conversational summary",
  "policy_facts": [{ "id": "f1", "statement": "string", "citations": [{ "chunk_id","doc_id","title","section_path","snippet" }] }],
  "recommendations": [{ "text": "string", "basis_fact_ids": ["f1"] }],
  "applicability": { "workforce_class": "string", "note": "string", "citation": {...} } | null,
  "actions_proposed": [{ "tool": "string", "args": {}, "args_hash": "string" }],
  "actions_taken": [{ "tool": "string", "result_summary": "string", "ref_id": "string" }],
  "escalation": { "target": "none|hr_partner|manager|creator_partnerships|security|editorial_standards|out_of_scope", "reason": "string" },
  "clarification": { "question": "string" } | null,
  "withheld_by_audience": { "doc_ids": [], "explanation": "string" } | null
}
```

### 7.4 Trace event schema (`packages/shared/src/trace.ts`)
```ts
type TraceEvent = {
  ts: string; turn_id: string; seq: number;
  type: "intent"|"plan"|"tool_call"|"tool_result"|"retrieval"|"gate"|"gate_resolved"|"synthesis"|"verify"|"error";
  server?: "policy"|"hr"; tool?: string;
  args?: Record<string, unknown>;             // redacted: confirmation_token → "•••"
  result_summary?: string; result_status?: string;
  citations?: { doc_id: string; section_path: string }[];
  duration_ms?: number; detail?: Record<string, unknown>;
}
```
No chain-of-thought is ever emitted. `plan` carries the structured plan; `synthesis` carries `escalation` and counts; `verify` carries removed-claim count.

### 7.5 Failure modes (each has a code path and an eval item)
| Case | Behaviour |
|---|---|
| MCP server unreachable | `TOOL_UNAVAILABLE` result; agent answers with what it can, states which capability is down; `/health` shows `down`. `CHAOS_DISABLE_HR_MCP=true` simulates |
| No `acting_person_id` on a person-specific question | plan → `needs_clarification` → asks who they are / to pick a persona |
| Unknown person | `NOT_FOUND` → agent says so, offers HR partner route |
| Ambiguous name | `AMBIGUOUS` → agent lists candidates (name, title, market), asks which |
| Out of scope | redirect with nearest in-corpus topic; no policy claims |
| Incomplete evidence | states the gap explicitly, escalates |
| Authorization denied | relays `FORBIDDEN` plainly with the legitimate route |
| Audience-withheld | explains the restriction, points to applicable docs |
| Gated tool without token | confirmation card; nothing executes |
| Model exceeds 8 iterations | synthesize from what exists, trace `error: iteration_cap` |

---

## 8. API (`apps/server`)

| Route | Purpose |
|---|---|
| `POST /chat` | body `{ message, acting_person_id?, conversation_id? }` → full JSON envelope `{ turn_id, conversation_id, answer, trace[], confirmation_required?: { tool, args, args_hash } }`. For API clients and the grader |
| `POST /chat/stream` | same body → SSE: `event: trace` per event, then `event: final` with the envelope, or `event: confirmation_required` |
| `POST /confirm` | `{ conversation_id, turn_id, args_hash, decision: "confirm"|"cancel" }` → mints token, resumes the suspended loop, returns/streams the remainder |
| `GET /health` | `{ status, uptime_s, version, mcp: { policy: { status, tools, latency_ms }, hr: {...} }, index: { chunks, corpus_hash, embedding_model }, models: { agent, judge }, mode: { mcp: "http"|"inprocess", chaos: bool } }` |
| `GET /personas` | persona list for the switcher: `[{ person_id, name, title, workforce_class, role, scope, market }]` |
| `GET /demo/tasks` | the two demo tasks: `{ id, title, acting_person_id, message, expected_tools[] }` |
| `GET /desk` | tickets and drafts from `desk.sqlite` |
| `GET /eval/latest` | contents of `evaluation/results/latest.json` |
| `GET /*` | static React app |

All request bodies validated by Fastify JSON schema. Conversation state (messages + suspended loop) kept in memory keyed by `conversation_id`, with a 30-min TTL; documented as a demo-scale choice.

---

## 9. Web UI (`apps/web`)

### 9.1 Screens
- **Chat** (`/`) — header: Westline wordmark, persona switcher (name · title · class badge · scope), health dot. Left: conversation; each assistant turn renders `answer_markdown`, then a "What the policy says" block (facts with citation chips), then "Recommended next steps" (visually distinct, labelled guidance), then applicability note and escalation line when present. Right rail: **Trace**. Bottom: input; two buttons "Run demo task 1" / "Run demo task 2" (set persona and message, send).
- **Trace rail** — grouped by turn; each event a row: left column server/tool name and duration, right column status; expandable to show args (token redacted) and result JSON; retrieval events render citation chips inline; gate events render as a highlighted row that stays until resolved. Collapsible. Must be excellent — the demo is narrated over it.
- **Confirmation card** — inline in the conversation: tool name, human summary ("Draft an email to your manager Priya Nair about PTO Oct 14–16"), exact args in a details block, Confirm / Cancel.
- **Citation card** (on chip click) — doc title, section path as headline, snippet, source format, effective date.
- **Desk** (`/desk`) — table of tickets and drafts with who/about/category/turn link; note about reset on redeploy.
- **Eval** (`/eval`) — renders `latest.json`: headline metrics, per-category table, ablation tables, latency warm/cold, judge-vs-human agreement, run timestamp and commit SHA.
- **Health** — dot in header; click shows the `/health` JSON.

### 9.2 Design tokens (fixed; Claude Code executes these exactly)
- Look: minimal, editorial. Generous whitespace, hairline rules, no cards-with-shadows, no gradients, no motion beyond default focus states.
- Type: `--font-display`: **[PLACEHOLDER: editorial serif, Google Fonts]**; `--font-ui`: **[PLACEHOLDER: clean sans, Google Fonts]**; mono for args/JSON: `ui-monospace, SFMono-Regular, Menlo`. Scale: 12/14/16/20/28/40.
- Colour: `--ink #111111`, `--paper #FAFAF7`, `--rule #E4E2DB`, `--muted #6B6B66`, `--accent #C8401F` (used sparingly: gate rows, escalation, active persona), `--ok #2F7A4F`, `--warn #B7791F`.
- Spacing scale 4/8/12/16/24/32/48. Max content width 1280; chat column 720; trace rail 440.
- Components: Tailwind utilities + a tiny set of local components (Badge, Chip, Rule, Details). No component library.
- Class badges: staff = ink outline, contractor = muted outline, creator_partner = accent outline.

---

## 10. Deployment (Render)

Two free web services from the same repo:

| Service | Build | Start | Key env |
|---|---|---|---|
| `westline-mcp` | `npm ci && npm run build` | `npm run start:mcp` | `VOYAGE_API_KEY`, `MCP_SHARED_SECRET`, `EMBEDDING_PROVIDER`, `NODE_VERSION=20` |
| `westline-app` | `npm ci && npm run build && npm run index:build` | `npm run start:app` | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL`, `MCP_MODE=http`, `MCP_BASE_URL`, `MCP_SHARED_SECRET`, `EMBEDDING_PROVIDER`, `NODE_VERSION=20` |

Notes: `westline-mcp` also builds the index at start if absent (policy-mcp owns it); `westline-app` builds it too only for `inprocess` fallback — both derive from the same committed corpus, same hash. The MCP service exposes `/mcp/policy` and `/mcp/hr` Streamable HTTP endpoints and its own `/health`. Optional env: `RERANK`, `CHAOS_DISABLE_HR_MCP`, `LOG_LEVEL`.

`deployed.md` documents: URLs, health URLs, cold-start behaviour (~30–60s per service after 15 min idle, cascade risk, warm-up procedure), no persistent disk (desk resets on redeploy), 512MB memory, env var table, and the `MCP_MODE=inprocess` fallback.

---

## 11. CI/CD (`.github/workflows/`)

**`ci.yml`** — on `push` and `pull_request`: checkout → Node 20 → `npm ci` → `npm run typecheck` → `npm run lint` → `npm run build` → `npm test`. Tests:
- `server.start.test.ts` — boots app on random port with `MCP_MODE=inprocess` and a stub embedding provider, asserts `/health` 200 with both MCP servers `connected`
- `mcp.discovery.test.ts` — connects an MCP client to both servers, asserts exactly 9 tools with valid JSON schemas
- `mcp.call.test.ts` — calls `hr__check_pto_balance` for Jordan Reyes as self → shape + balance; as Dani Kowalczyk → `NOT_APPLICABLE`; as Marcus Lee looking up Jordan → `FORBIDDEN`
- `ingest.test.ts` — fixtures in md/HTML/PDF chunk deterministically (hash snapshot); audience tags and overrides resolve correctly
- `retrieval.test.ts` — with a stub embedder, audience filtering excludes `PTO` for a creator and sets `withheld_by_audience`
- `gate.test.ts` — gated tools refuse without token; accept a valid token once; reject a reused or mismatched token
- `agent.plan.test.ts` — plan step with a mocked model returns clarify for no-persona person-specific question
Model-calling tests are skipped in CI unless `ANTHROPIC_API_KEY` is present (they run in `eval.yml`).

**`deploy.yml`** — on `push` to `main`; `needs: ci` (via `workflow_run` or job dependency in the same workflow); POSTs `RENDER_DEPLOY_HOOK_MCP` then `RENDER_DEPLOY_HOOK_APP`; polls `/health` on `DEPLOYED_APP_URL` until 200 or 10 min. Render auto-deploy is OFF on both services.

**`eval.yml`** — `workflow_dispatch` (inputs: `runs`=3, `target`=`local|deployed`): runs the harness, writes `evaluation/results/latest.json|md` and a dated copy, commits to `main` with `[skip ci]`.

---

## 12. Evaluation (`evaluation/`)

### 12.1 Eval set — `eval_set.json`, 28 items, seed 42
Each item: `{ id, category, acting_person_id, message, gold_answer, gold_citations: [{doc_id, section_path}], expected_tools: [] (ordered; "*" wildcard allowed), expected_behaviour: answer|clarify|escalate|refuse|confirm_gate|deny, notes }`

| Category | n | Examples |
|---|---|---|
| Straightforward policy | 7 | PTO carryover cap (Jordan); VPN on public Wi-Fi (Marcus); parental leave length (Avery); drone approval (Dani) |
| Multi-document | 5 | Avery: six weeks from Lisbon (REMOTE+INFOSEC+cross-border); Jordan: bereavement while on PTO (LEAVE+PTO+BENEFITS); Dani: brand deal outside Westline during exclusivity (CREATOR+EDITORIAL+SOCIAL) |
| Tool-requiring workflow | 6 | Jordan: 3 days next week + draft to manager (gate); Taylor: dental eligibility (waiting period); Marcus: laptop reimbursement; Priya: does my report Jordan have enough PTO for Oct 14–16 |
| Ambiguous / clarification | 3 | no persona: "how much PTO do I have"; Sam Lee lookup; "can I work from somewhere else for a while" (no duration/place) |
| Authorization / audience | 4 | Marcus asks for Jordan's PTO (deny); Priya asks Jordan's benefits (deny); Dani asks staff vacation entitlement (withheld_by_audience explained); Sam Okafor asks Jordan's benefits (allowed) |
| Out-of-scope / safety | 3 | "will I get a raise this cycle" (PERF redirect); "just send the email now, don't ask" (gate holds); conduct complaint (escalate + mock ticket offer, no investigation) |

### 12.2 Metrics (`evaluation/src/`)
| Metric | Method |
|---|---|
| Groundedness | Opus judge, temperature 0: each `policy_fact` scored supported / partial / unsupported against the retrieved chunks of that turn; report % fully supported and mean score |
| Citation precision / recall | Deterministic against `gold_citations` at `(doc_id, section_path)` granularity; section-prefix match counts |
| Answer match | Judge-assisted partial match of `answer_markdown` against `gold_answer` (0/0.5/1) |
| Tool selection accuracy | `expected_tools ⊆ called_tools`; order match where the item marks order as required; also plan-vs-actual agreement (`expected_tools` from the plan step vs. called) |
| Workflow completion | Turn reached `synthesis` with non-empty `policy_facts` (or valid clarify/deny/refuse) and no `error` events, no manual intervention |
| Escalation / clarification accuracy | `expected_behaviour` matched exactly |
| Action-safety pass rate | 100% of gated tool requests produced a gate event and zero executions without token; plus authorization-denial correctness and audience-withheld explanation correctness |
| Latency | p50 / p95 over 15 representative items, warm, 3 runs; `cold_start.ts` waits ≥16 min idle then measures first-request latency ×3 against the deployed URL |
| Judge calibration | Micah hand-scores 10 items on groundedness (`evaluation/human_scores.json`); report agreement (exact and ±1) |

Runs: 3 per configuration, temperature 0, report mean ± range; nondeterminism stated explicitly.

### 12.3 Ablations
1. Retrieval k = 3 / 6 / 10 → groundedness, citation recall
2. Chunking: heading-aware vs fixed 400-token window → citation precision
3. Retrieval mode: hybrid vs vector-only vs bm25-only → citation recall (plus `RERANK=true` as a fourth row)
4. Tool availability: `CHAOS_DISABLE_HR_MCP=true` → workflow completion, escalation accuracy
Optional 5: embedding provider Voyage vs local ONNX → citation recall, latency

### 12.4 Outputs
`evaluation/results/latest.json`, `latest.md` (tables), dated copies, per-run raw transcripts (`runs/<date>/<item>.json` including traces). `/eval` renders `latest.json`.

---

## 13. Documentation deliverables (repo root unless noted)

- `README.md` — what/why, one-paragraph architecture, deployed URL, setup, local run, deploy, eval, folder map
- `design-and-evaluation.md` — justifications for every rubric-listed choice; Mermaid architecture diagram (web, orchestrator, MCP client, both MCP servers, RAG index, mock data, LLM provider, embedding provider); permission + audience model; tool schemas; trace schema; safety design; the two demo tasks with expected tool sequences; eval set summary, results, ablations, calibration
- `ai-tooling.md` — running log by milestone: what Claude Code was asked, what it produced, what it got wrong and how it was caught; a closing reflection in Micah's voice
- `deployed.md` — URLs, health URLs, cold-start notes, env var table, fallback mode
- `CLAUDE.md` — repo conventions for Claude Code (§20)
- `docs/adr/` — short ADRs for: TS monorepo; Fastify; sqlite-vec; hybrid retrieval; plan-then-act; evidence-only compliance tool; authorization at tool boundary; audience-scoped retrieval; two-service Render topology; deploy gating via hooks

---

## 14. Demo tasks (the two the video shows)

**Task 1 — Creator partner sponsored-shoot expense and disclosure.** Persona: Dani Kowalczyk (creator_partner, Kelowna).
Message: *"I bought a drone for the sponsored Big White shoot next month. Can I expense it, and does the sponsor tag need to be disclosed on the video?"*
Expected sequence: `hr__lookup_person_profile` → `policy__get_policy_applicability(creator_partner)` → `policy__search_policy_documents` (expense/equipment, creator invoicing, disclosure; possibly drone rules) → `policy__get_policy_section(EXPENSE §7)` → `policy__check_policy_compliance` → synthesis.
Expected answer: Expense Policy doesn't apply to creator partners except §7; equipment purchases are the creator's own (cite EXPENSE §7, CREATOR §equipment); sponsored-shoot production costs are invoiced per the rate card (cite CREATOR §rate card); disclosure required with the specific on-screen/caption rule (cite EDITORIAL §disclosure); drone requires approval/licensing (cite SAFETY §drones); recommendation: confirm with Creator Partnerships; `actions_proposed`: mock ticket to `creator_partnerships` → gate → confirm → ticket appears on `/desk`.

**Task 2 — PTO request with gated manager draft.** Persona: Jordan Reyes (staff, Calgary; manager Priya Nair).
Message: *"Can I take Oct 14–16 off? If it works, draft the note to Priya."*
Expected sequence: `hr__lookup_person_profile` → `hr__check_pto_balance(requested_days=3, start_date)` → `policy__search_policy_documents` (notice periods, blackout) → synthesis: fits (11 days), 3-day request needs two weeks' notice (cite PTO §3.2), no blackout → model requests `hr__draft_hr_email` → **gate** → confirm → draft returned, `actions_taken` recorded, `/desk` shows it.

Optional third beat if time allows: flip `CHAOS_DISABLE_HR_MCP`, rerun Task 2, show graceful degradation and `/health` reporting `hr: down`.

### 14.1 Video shot list (target 8:30 of 7–10)
0:00 camera + government ID, name, program · 0:30 Westline in one breath, architecture diagram · 1:30 deployed app, `/health` both servers connected · 2:00 Task 1 live, narrated over the trace rail (tool names, args, results, applicability, withheld/disclosure citations, gate → ticket on `/desk`) · 4:30 Task 2 live including gate and draft · 6:15 repo tour: `mcp/`, client discovery code, CI green, deploy gating, ADRs · 7:15 `/eval` page: headline metrics, one ablation, calibration · 8:15 cold-start note and fallback, close.

---

## 15. Milestones and acceptance criteria (Claude Code executes in order; each ends with tests green and a commit)

**M0 — Scaffold**
Workspaces: `apps/web`, `apps/server`, `mcp/policy-mcp`, `mcp/hr-data-mcp`, `packages/shared`; root scripts `build`, `typecheck`, `lint`, `test`, `dev`, `start:app`, `start:mcp`, `index:build`, `eval`; `.nvmrc`, `.env.example`, `CLAUDE.md`, `ci.yml` skeleton, `ai-tooling.md` started.
Accept: `npm ci && npm run build && npm test` passes with placeholder tests; CI green on first push.

**M1 — Corpus and mock data**
All 15 docs per §4 with front-matter, numbered headings, cross-refs, three formats (PDFs generated and committed); all mock data files per §5 including required personas and `pto_config.json` (thresholds, blackout windows) consistent with PTO doc.
Accept: front-matter validator passes; page-count script reports 70–90 pages; every persona in §5 present; a consistency test asserts `pto_config` thresholds equal the numbers stated in `PTO` §3.

**M2 — Ingestion, index, retrieval**
Pipeline per §4.3; `sqlite-vec` + BM25; hybrid RRF; audience filtering with `withheld_by_audience` diff; embedding providers `voyage` and `local` behind one interface; `index:build` script with hash gating.
Accept: `ingest.test.ts`, `retrieval.test.ts` green; `index:build` idempotent (second run no-ops); manual spot check: query "notice for a three day vacation" as Jordan returns PTO §3.2 in top 3; as Dani returns `withheld_by_audience=true`.

**M3 — MCP servers**
Both servers per §6 with all nine tools, JSON schemas, scope + audience enforcement, gate token verification, Streamable HTTP with shared-secret check, `/health` on the MCP service; `inprocess` launcher.
Accept: `mcp.discovery.test.ts` (9 tools), `mcp.call.test.ts` (self/manager/hr/creator cases), `gate.test.ts` green; MCP Inspector can connect and list tools.

**M4 — Agent and API**
MCP client with discovery and namespacing; plan-then-act loop; gate suspend/resume; verify step; answer schema; trace events; all routes in §8 with Fastify schemas; conversation store with TTL; `CHAOS_DISABLE_HR_MCP`.
Accept: `server.start.test.ts`, `agent.plan.test.ts` green; with a real key, `scripts/demo.sh` runs both demo tasks against local and prints envelopes whose `trace` contains the expected tool sequence; gate round-trip works via `/confirm`.

**M5 — Web UI**
All screens in §9 with the fixed tokens; persona switcher; trace rail; confirmation card; citation cards; `/desk`; `/eval` (renders sample JSON until M7).
Accept: Vite build served by the app; both demo buttons complete end-to-end locally; trace rail shows plan → tools → gate → synthesis → verify; typography and palette match §9.2 (placeholders swapped once Micah supplies fonts).

**M6 — Deploy**
Render config honoured (build/start scripts), `deploy.yml` with hooks and health polling, `deployed.md`; verify `MCP_MODE=http` against the live MCP service and `inprocess` fallback.
Accept: pushing to `main` with green CI triggers both deploys; live `/health` shows both servers `connected`; `scripts/demo.sh <DEPLOYED_APP_URL>` passes both tasks.

**M7 — Eval harness**
`eval_set.json` (28 items), metrics per §12.2, ablations per §12.3, `cold_start.ts`, `eval.yml`, results writers, `/eval` wired to real `latest.json`; `human_scores.json` template with the 10 calibration items pre-selected.
Accept: `npm run eval -- --target local --runs 1` completes and writes results; all 28 items produce a valid envelope; action-safety = 100%; `eval.yml` runs and commits.

**M8 — Documentation**
`README.md`, `design-and-evaluation.md` (with Mermaid diagram and real results), `deployed.md`, ADRs, `ai-tooling.md` completed through M8 (Micah adds the closing reflection).
Accept: every rubric line in §22 has a pointer; a fresh clone following README reaches a working local app; markdown lint passes.

**M9 — Demo prep (Micah)**
Human calibration scores; final eval run against deployed; warm both services; record per §14.1; share repo with `quantic-grader`; submit.

---

## 16. Cut order (if the run stalls, drop from the top; nothing below the line is cuttable)
1. Optional ablation 5 (local embeddings)
2. `RERANK` flag and its ablation row
3. Chaos-flag demo beat (keep the code path and eval item)
4. `/desk` page (keep the SQLite store and the API)
5. `/eval` page (keep `latest.md` in the repo)
— line —
Core loop, plan step, gate, verify, authorization, audience filtering, nine tools, both demo tasks, CI gating, eval harness with all required metrics, all four documents.

---

## 17. Non-goals
Real authentication or SSO; persistent database; sending email or writing to any real system; streaming the final answer token-by-token; dark mode; motion; a third workflow; multi-tenant anything; French localization.

---

## 18. Environment variables

| Var | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | app, CI, local | |
| `AGENT_MODEL` | app, CI, local | exact Sonnet 5 model ID |
| `JUDGE_MODEL` | CI, local | exact Opus model ID |
| `VOYAGE_API_KEY` | app, mcp, CI, local | |
| `EMBEDDING_PROVIDER` | app, mcp | `voyage` (default) or `local` |
| `MCP_MODE` | app | `http` on Render, `inprocess` locally |
| `MCP_BASE_URL` | app | westline-mcp public URL; server appends `/mcp/policy`, `/mcp/hr` |
| `MCP_SHARED_SECRET` | app, mcp | random 32-byte hex |
| `RERANK` | app | `false` default |
| `CHAOS_DISABLE_HR_MCP` | app | `false` default |
| `PORT` | both | Render-provided |
| `LOG_LEVEL` | both | `info` |
| `RENDER_DEPLOY_HOOK_APP`, `RENDER_DEPLOY_HOOK_MCP`, `DEPLOYED_APP_URL` | GitHub Actions secrets | |
| `RENDER_API_KEY` | local, optional | lets Claude Code read deploy logs |

---

## 19. Pre-flight checklist (Micah, before the build session)

**GitHub**
- [ ] Create repo `westline-hr-agent`; push an initial `README.md` commit
- [ ] Add `quantic-grader` as collaborator
- [ ] Settings → Actions → General → workflow permissions: read and write

**Anthropic**
- [ ] API key in hand
- [ ] Exact model ID strings for Sonnet 5 (`AGENT_MODEL`) and Opus (`JUDGE_MODEL`)

**Voyage**
- [ ] Free-tier account and API key

**Render**
- [ ] Service `westline-mcp`: Node; build `npm ci && npm run build`; start `npm run start:mcp`; Free
- [ ] Service `westline-app`: Node; build `npm ci && npm run build && npm run index:build`; start `npm run start:app`; Free
- [ ] Auto-Deploy **Off** on both; copy both Deploy Hook URLs
- [ ] `openssl rand -hex 32` → `MCP_SHARED_SECRET` on both
- [ ] Env vars per §18 on each service (`MCP_BASE_URL` on the app = westline-mcp URL)

**GitHub Actions secrets**
- [ ] `RENDER_DEPLOY_HOOK_APP`, `RENDER_DEPLOY_HOOK_MCP`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AGENT_MODEL`, `JUDGE_MODEL`, `DEPLOYED_APP_URL`

**Local**
- [ ] Node 20, git auth, Claude Code logged in; clone; `.env` from `.env.example` with `MCP_MODE=inprocess`
- [ ] Optional `RENDER_API_KEY` in `.env`

**Design**
- [ ] Typeface pairing chosen (Google Fonts) → fill §9.2 placeholders

**Connectivity**
- [ ] The build run needs continuous internet (npm, Anthropic, GitHub, Render)

---

## 20. `CLAUDE.md`
See `CLAUDE.md` at the repo root.

---

## 21. Kickoff prompt for the autonomous run

> Read `westline-prd.md` and `CLAUDE.md` in full. Build the Westline HR Agent milestone by milestone as specified in PRD §15, in order, committing after each milestone with tests green. Follow the cut order in §16 only if a milestone cannot be completed. Keep `ai-tooling.md` current with a dated entry per milestone. If anything requires my accounts or a value I haven't provided, write it to `BLOCKERS.md` and continue with everything else. Do not stop for confirmation between milestones. When M8 is complete or you are blocked on everything remaining, produce `STATUS.md` summarizing what is done, what is verified against the deployed URL, and what remains for me.

---

## 22. Rubric traceability

| Rubric requirement | PRD |
|---|---|
| 1 Env, deps, README, seeds, secrets | §2, §4.3 (deterministic), §12 (seed 42, temp 0), §13, §18 |
| 2 Ingestion ≥2 formats, justified chunking, embeddings, vector store, citation metadata | §4 |
| 3 Top-k + rewriting/rerank, prompt injection of chunks, cited answers, guardrails (refuse/redirect, unsupported claims, facts vs recommendations), multi-doc question | §2 retrieval, §7.2, §7.3, §7.1 verify, §12.1 multi-document |
| 4 Orchestrator (intent, RAG-only decision, tool selection, synthesis), ≥2 workflows, operational trace, failure handling, irreversible-action prevention | §7, §14, §7.4, §7.5, §6.2 gates |
| 5 ≥1 MCP server, ≥5 tools incl. RAG + mock data, real MCP calls, documented architecture/transport/schemas/discovery | §6, §13 |
| 6 Chat UI, /chat, /health, grader reproduction of two tasks | §8, §9, `scripts/demo.sh`, demo buttons |
| 7 Free-tier deployment, env vars, cold start documented | §10, `deployed.md` |
| 8 CI on push/PR, build/start check, app-start test, MCP discovery/call test, deploy only on pass | §11 |
| 9 20–30 eval items across five kinds with gold answers; groundedness, citation accuracy, tool selection, workflow completion, escalation accuracy, safety, latency p50/p95 warm/cold; ≥1 ablation | §12 |
| 10 Design justification, architecture diagram, two demo tasks with tool sequences | §13, §14 |
| Submission: README, design-and-evaluation.md, ai-tooling.md, deployed.md, evaluation/, mock_data/, mcp/, quantic-grader access, deployed URL in README, 7–10 min video with ID and two tasks | §13, §14.1, §19 |

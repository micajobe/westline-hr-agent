# Demo video — teleprompter script (draft 2, 2026-09-12)

Target 9:00 of the allowed 7–10. Spoken lines are plain paragraphs. Bracketed lines are not read:

- **[CLICK: …]** something to click or type before the next spoken line
- **[SHOW: …]** what should be on screen while the line is read
- **[POINT: …]** move the cursor to it while speaking
- **[WAIT]** let the model run; the following lines are meant to be spoken over the wait
- `⟵ screen` say the value the live run shows, not the one written here

## 0. What the top band asks for, and what the past feedback changes

The 5 band is "addresses ALL requirements at an outstanding level". For the demo itself the
requirements are concrete: camera and government ID on screen, 7–10 minutes, two agentic tasks end
to end, and for each task the presenter says the tool names, arguments, outputs, retrieved citations
and final answer or action. Then a quick walkthrough of design, deployment, CI/CD and evaluation.
On cold start, the assignment says only that "the README and demo should explain the expected
cold-start behavior". Nothing asks for a cold start to be shown, so both services are warmed before
recording and one sentence covers the explanation.

Both prior feedback notes had the same shape: the reviewer had to infer. Rules for this script:

1. **Name the rubric item, then name the baseline, then what was built.** "The rubric asks for at
   least five tools. There are nine."
2. **Every behaviour claim gets a rule or a number.** Not "it escalates when unsure" but "PLAN
   classifies intent into five values, and two of them never reach a tool call."
3. **Name the fields, endpoints and tool names**, the way the restaurant feedback wanted table
   fields and Flask routes named.
4. **Show the optional paths, don't describe them.** `withheld_by_audience` live in Task 1; the
   `NOT_APPLICABLE` route live after Task 2 if time allows; the HR-server-down ablation on `/eval`.
5. **Say the weak numbers first, with the cause.** Citation precision, tool selection, `au-02`.

On voice: the previous videos read as less technical than the work. The fix is not more numbers per
minute, it's saying *why* after each *what*. Every technical claim below is followed by the reason it
matters or the thing it prevents. Contractions, first person, one idea per sentence. Numbers are
spoken once and shown on screen; the screen carries the precision so the voice doesn't have to.

## 1. Coverage map

| Beat | Time | Rubric items | Must-say |
|---|---|---|---|
| A Open + ID | 0:00–0:25 | submission | name, program, individual, ID |
| B Problem + architecture | 0:25–1:40 | 10, 5, 4 | 3 workforce classes, 2 servers, 9 tools, Streamable HTTP, PLAN→ACT→SYNTHESIZE→VERIFY, no framework and why |
| C Deployed + /health | 1:40–2:05 | 7, 6 (named) | both services, `/health` fields, cold-start sentence, `/chat` + demo buttons + `demo.sh` |
| D Task 1 live | 2:05–4:40 | 3, 4 (named), 5 | each tool with args and result, 34 → 27 candidates, `withheld_by_audience`, multi-doc citations, verify; gate only if offered |
| E Task 2 live | 4:40–6:20 | 4, 5, 6 | `check_pto_balance` fields, PTO §3.2 via `get_policy_section`, gate token rules, `sent: false` |
| F Repo: MCP, RAG, CI/CD | 6:20–7:40 | 1, 2, 3, 5, 8 | discovery + injection code, chunking, sqlite-vec, k and RRF, `ci.yml`, `deploy.yml` gating |
| G `/eval` | 7:40–8:40 | 9 | headline, weak numbers with cause, chunking ablation, chaos row, calibration |
| H Close | 8:40–9:00 | 7, 10 | inprocess fallback, where the docs are |

## 2. Pre-record checklist

- [ ] Re-send the `quantic-grader` invitation if it has lapsed (sent 2026-09-08; expires at 7 days).
- [ ] **Test count is 225** (`npx vitest run`, 2026-09-12, 17 files). README and
      `design-and-evaluation.md` §2.8 say 179 and `STATUS.md` says 213; all three are stale and the
      grader reads them. Fix the three numbers before recording so the video and the docs agree.
- [ ] `STATUS.md` "Remaining for Micah" item 3 still lists the cold-start run. Drop it.
- [ ] **Task 1 may not propose a ticket.** In 3 of 3 eval runs of the identical message (`md-04`)
      the agent answered from policy with `escalation.target: none` and proposed nothing, and
      `apps/server/src/demo.ts` does not list a gated tool in Task 1's expected sequence. The script
      treats a Task 1 gate as a bonus and puts the full gate walkthrough in Task 2. If you want a
      guaranteed gate in Task 1, the message would have to ask for the ticket, which changes
      `demo.ts`, `scripts/demo.sh`'s expectations and PRD §14; that is a decision, not a fix.
- [ ] Task 1's tool sequence varies between runs: 2–3 searches, then sometimes
      `get_policy_section`, sometimes `check_policy_compliance`, sometimes neither. The D beat has
      conditional lines for each; read only the one that matches the screen.
- [ ] Task 2's sequence was identical in 3 of 3 runs: profile → applicability → balance →
      `get_policy_section(PTO §3.2)` → gate. The script assumes that order.
- [ ] Optional: correct the four `expected_tools` (`md-06`, `sp-06`, `tw-03`, `sp-07`), re-run base,
      report both figures in beat G.
- [ ] Warm both services 5 minutes before recording: `curl https://westline-mcp.onrender.com/health`,
      then `curl https://westline-hr-agent.onrender.com/health` until `"status":"ok"`. Don't then
      leave them idle 15 minutes.
- [ ] One full dry run of both demo buttons. Write down the actual tool order, citations, balance and
      ticket/draft IDs. Fill every `⟵ screen` line from that run.
- [ ] Decide whether `/desk` shows one ticket or two after the dry run, and say so if two.
- [ ] Browser tabs in order: (1) `/health`, (2) chat, (3) `/desk`, (4) `/eval`, (5) GitHub Actions,
      (6) `docs/architecture.html` opened from disk (`open docs/architecture.html`); press F for
      full view. It inlines the mermaid.live SVG export of the §1 diagram. Editor tabs in
      order: `apps/server/src/mcp/client.ts` (lines 142, 157–163, 217–227),
      `.github/workflows/ci.yml` (39–40), `.github/workflows/deploy.yml` (12, 27).

### Screen cues: read aloud or visual only

| Cue | Decision | Why |
|---|---|---|
| D applicability summary "6 full, 4 partial, 5 none" | **Read aloud**, paraphrased as in the script | It is the tool output; the demo requirement says outputs are spoken |
| D search query string | **Visual only**, point at it | Long and unremarkable; saying "one per policy area" is the point |
| D retrieval counts 34 → 27 | **Read aloud** | The one number that proves filter-before-ranking |
| D answer facts and sections | **Read aloud**, the four stable ones | Required: "retrieved citations and final answer" |
| D `verify` kept/dropped | **Read aloud**, one clause | Short, and it is the guardrail working |
| D ticket ID | Only if a gate appears; otherwise skipped | See Task 1 note above |
| E balance result | **Read aloud** | Required tool output; the numbers are the answer |
| E draft ID | **Read aloud**, ID only | Proves the action happened and is on the desk |
| F test count | **Read aloud** (225, now in the script) | Item eight asks for tests; the number is on screen too |

### Delivery notes

- The script no longer says "RPAS". If it comes back in, say "Remotely Piloted Aircraft System" once.
- Nair rhymes with "fire".
- The citation-precision paragraph in G is a reading of the data, not an apology. Flat, even pace.
- Pronounce `sqlite-vec` as "SQLite vec", `RRF` as "reciprocal rank fusion" (the script already
  spells it out), `HMAC` as "H-mac".

---

## 3. Script

### A — Open (0:00–0:25)

**[CAMERA on, full frame. Hold government ID beside face for a slow three-count.]**

Hi, I'm Micah Slavens. This is my individual project for AI Engineering Techniques and Architectures
in the Quantic MSAIE. It's called Westline HR Agent, and everything you're about to see runs on the
deployed Render instance, not on my laptop.

### B — Problem and architecture (0:25–1:40)

**[CLICK: browser tab 6, `docs/architecture.html` opened from disk. Press F for full view. It is the
Mermaid flowchart from `design-and-evaluation.md` §1, exported as SVG and inlined.]**

Westline is a fictional media company with three kinds of workers: staff, contractors and creator
partners, each under different rules. So "can I expense this?" has three right answers depending on
who's asking. That drove the design. The agent works out who's asking and which policies bind them
*before* it retrieves anything.

**[POINT: left to right across the diagram as each part is named.]**

The architecture, rubric item ten. A React chat app. A Fastify server that runs the agent loop and
holds the MCP client. And a second service hosting two MCP servers over Streamable HTTP: `policy-mcp`
with the retrieval index and four tools, `hr-data-mcp` with the mock employee data and five tools,
two of them gated behind a confirmation. The rubric asks for five tools on one server. There are
nine on two.

The agent loop is hand-written, four functions: PLAN, ACT, SYNTHESIZE, VERIFY. No framework, because
the confirmation gate has to pause a model turn and resume it in a *later* HTTP request, and
frameworks want their loop to run to completion. Decision record six has the full argument. You'll
see each of the four steps in the trace in a moment.

### C — Deployed and healthy (1:40–2:05)

**[CLICK: browser tab 1, `https://westline-hr-agent.onrender.com/health`. SHOW: the JSON.]**

Rubric item seven. Two free Render services, `westline-hr-agent` and `westline-mcp`. This is the
app's health route.

**[POINT: `status`, then `mcp.policy`, `mcp.hr`, then the tool count.]**

Status `ok`. Both MCP servers `connected`. Nine tools discovered. That's a live check, not a cached
flag: health re-runs tool discovery on every call with a three-second timeout. Free Render instances
sleep after fifteen minutes and take up to a minute to wake, so I warmed both services before
recording; the behaviour is written up in `deployed.md`. This route, `/chat` and the two demo
buttons you're about to see are rubric item six, and `scripts/demo.sh` replays both tasks against
any URL for a grader.

### D — Task 1: a creator partner, a drone, and four policies (2:05–4:40)

**[CLICK: tab 2, chat. CLICK: persona switcher → Dani Kowalczyk. SHOW: persona line reads
creator_partner, Kelowna.]**

Task one. Dani Kowalczyk is a creator partner in Kelowna.

**[CLICK: "Run demo task 01". WAIT. Speak the next lines over the trace rail as it fills.]**

The question: "I bought a drone for the sponsored Big White shoot next month. Can I expense it, and
does the sponsor tag need to be disclosed on the video?" That's the multi-document question rubric
item three asks for. A right answer needs four documents, and needs to know that most of the expense
policy doesn't apply to Dani at all.

**[POINT: first two events in the rail, `intent` then `plan`.]**

Watch the rail. This is rubric item four's trace: tools, arguments, results, sources, no
chain-of-thought. `intent` is `workflow`, one of five PLAN can choose; two of them, `sensitive` and
`out_of_scope`, never reach a tool. `plan` lists the expected tools, which the evaluation later
scores against what actually ran.

**[CLICK: `+ details` on the first `tool_call` row. POINT: the two args blocks in turn.]**

First call, `hr__lookup_person_profile`. Expand the args: two blocks. From the model, an empty
object — it named nobody. Server-injected, `acting_person_id`: stripped from the schema the model
sees, written in per call, so identity can't be spoofed by a prompt. Result: `workforce_class`
creator partner.

**[POINT: `policy__get_policy_applicability` row.]**

Second, `policy__get_policy_applicability` for a creator partner. It reads the handbook's
applicability matrix and returns, per document, `full`, `partial` or `none`. Six documents bind
Dani in full. Expense binds only at section seven. PTO doesn't bind at all. `⟵ screen: read
"6 full, 4 partial, 5 none" from the result summary`

**[POINT: the first `policy__search_policy_documents` row. Expand the result. There will be two or
three searches; narrate the first, then point at the others as "the same again for disclosure".]**

Third, `policy__search_policy_documents`, and it runs two or three of these, one per policy area.
`⟵ screen the query, e.g. "equipment purchase reimbursement creator partner drone gear", scoped to
CREATOR and EXPENSE` Look at the retrieval block: hybrid, k six, 34 candidates considered, 27 after
the audience filter. `⟵ screen the two counts` And `withheld_by_audience` is `true`, withheld
document `EXPENSE`. The audience filter runs inside the policy server, before ranking, so restricted
text never reaches the model, and the diff comes back so the agent can say something was withheld.

**[POINT: whichever appears: a `policy__get_policy_section` row, a `policy__check_policy_compliance`
row, or neither. Say the matching line; skip if neither.]**

`⟵ if get_policy_section:` It also pulls a whole section with `policy__get_policy_section`, because a
snippet isn't the whole rule. `⟵ if check_policy_compliance:` And `policy__check_policy_compliance`
gathers rules across policy areas with chunk IDs. It's evidence only, never a verdict; the judgement
stays with the model, where it's cited.

**[WAIT for the answer to render. POINT: the two answer blocks.]**

The answer. Two blocks, two separate schema fields. "What the policy says" is `policy_facts`, each
cited. "Guidance, not policy" is recommendations, each pointing at a fact above it. `⟵ screen for
the actual facts; these four have appeared in every run:` The drone isn't reimbursable, expense 7.2
and creator 7.1. Disclosure is required: an on-screen label in the first five seconds, editorial
4.2, and a sponsored tag in the first two caption lines, editorial 4.3. `⟵ screen for the drone
rule: SAFETY 8.6 or 5.4` And the drone itself needs certification and Field Safety approval under
the safety policy.

**[POINT: the withheld notice in the answer, then CLICK one citation card, let it open, close it.]**

The answer also says what was withheld: only expense section seven was retrievable for Dani's class.
Every citation opens to its chunk.

**[POINT: `verify` event.]**

And `verify`, the last step, drops any fact whose citation wasn't retrieved this turn. `⟵ screen:
"10 facts in, 10 kept, 0 removed", or whatever it shows`

**[IF a confirmation card appears (it did not in 3 of 3 eval runs; treat as a bonus): SHOW it. Say:]**

The agent also proposed a ticket to Creator Partnerships, `hr__create_mock_hr_ticket`, and didn't
run it. The `gate` event fired, the loop froze, and this card shows the exact arguments. I'll walk
through the gate in task two.

**[IF a confirmation card appears: CLICK Confirm, WAIT, then move on without visiting `/desk`; task
two covers the desk. IF NOT: say this one line and move on.]**

No action proposed here: the policy text answers it, and the escalation target is `none`. The gate
comes in task two.

### E — Task 2: a PTO request and a gated draft to the manager (4:40–6:20)

**[CLICK: tab 2. CLICK: persona → Jordan Reyes. SHOW: staff, Calgary, manager Priya Nair. "Nair"
rhymes with "fire".]**

Task two. Jordan Reyes, staff, Calgary. Jordan's manager is Priya Nair.

**[CLICK: "Run demo task 02". WAIT. Speak over the rail.]**

"Can I take October 14 to 16 off? If it works, draft the note to Priya." This is the workflow that
runs on structured mock data end to end.

**[POINT: `hr__check_pto_balance` row. Expand the result.]**

Profile lookup first, identity injected again, then applicability, which for staff is fourteen
documents in full. Then `hr__check_pto_balance` with `person_id`, `start_date` 2026-10-14 and
`end_date` 2026-10-16. The design is in the result fields: `balance`, `request_fits`,
`notice_required`, `notice_met`, `blackout_collision`. `⟵ screen: "balance 11/18 · 3 requested ·
fits true · notice 14d (met)"` Eleven days left of eighteen, three requested, it fits, fourteen
days' notice required and met.

**[POINT: `policy__get_policy_section` row. If the run searched instead, point at that row and say
"searches for" in place of "fetches".]**

Then it fetches PTO section 3.2 directly with `policy__get_policy_section`, "Requests of three to
five days", which is the citable notice rule. The data tool gives the numbers, the policy tool gives
the rule, and the answer needs both.

**[SHOW: gate card for `hr__draft_hr_email`. POINT: recipient role, purpose, key points.]**

And here's the gate. `hr__draft_hr_email`, recipient role `manager`, purpose "PTO request for
October 14 to 16", key points listing the three days and the notice date, all visible before
anything runs. To be exact about the token: it's bound to a hash of these
arguments, lives ten minutes, and is consumed on first use. A replay, a forgery, an expiry or
different arguments all come back `CONFIRMATION_REQUIRED` and run nothing. And scope is checked
*before* the gate, so an out-of-scope request is `FORBIDDEN` even with a valid token.

**[CLICK: Confirm. WAIT. POINT: `sent: false` in the result. CLICK: tab 3, `/desk`. POINT: the draft.]**

The draft. `sent: false`. Nothing in this system ever sends anything. It writes to a mock desk, and
here it is with its ID. `⟵ screen`

### F — Repo tour: MCP client, retrieval, CI/CD (6:20–7:40)

**[CLICK: editor, `apps/server/src/mcp/client.ts`. SCROLL to line 142 (`listTools`), then 157–163
(`SERVER_OWNED_ARGS` stripped from the model-facing schema), then 217–227 (`call()` injects
`acting_person_id` and the token).]**

Rubric item five. This file is the only road from the agent to any tool; the server never imports
tool code. On startup it calls `list_tools` on both servers, prefixes the names `policy__` and
`hr__`, and routes by prefix. Here's where it strips `acting_person_id` and `confirmation_token` from
the model-facing schema and injects them per call, and a test proves a model-supplied identity is
overridden. Transport is Streamable HTTP behind a shared-secret header.

**[CLICK: design doc, §2.2. SHOW: chunking paragraph. No need to open the RAG source.]**

Rubric items two and three. Fifteen documents in three formats: eleven markdown, two HTML, two PDF.
Everything's normalised to markdown and chunked by heading, one chunk per section, 457 chunks,
hash-snapshotted so chunking is deterministic. Embeddings are Voyage 3 Lite. The store is
`sqlite-vec` through Node's built-in SQLite, one file holding vectors, chunks and the BM25 index
together. Retrieval is hybrid, BM25 plus vector fused with reciprocal rank fusion, k of six, with
audience as a metadata column on the vector table so the filter runs before ranking.

**[CLICK: browser tab 5, GitHub Actions, green `ci` and `deploy` runs. Then editor `ci.yml`,
lines 39–40, the Test step.]**

Rubric item eight. `ci.yml` runs on every push and pull request: typecheck, lint, build, then
two hundred twenty-five tests with no API keys, because CI uses a deterministic stub embedder. That
includes the app-start test asserting both servers connected on `/health`, the discovery test
asserting exactly nine tools, MCP call tests across all four scopes, and five gate tests: refuse,
run once, refuse replay, forged, mismatched.

**[CLICK: editor `deploy.yml`. POINT: line 12, the `workflow_run` trigger, then line 27, the
`if: conclusion == 'success'` guard.]**

`deploy.yml` only fires when a `ci` run on `main` completes successfully. Render's own auto-deploy is
off on both services, so this workflow is the only thing that can deploy. Item one is on screen too:
Node pinned in `.nvmrc`, secrets only from environment, `.env.example` kept current.

### G — Evaluation (7:40–8:40)

**[CLICK: tab 4, `/eval`. POINT: headline table.]**

Rubric item nine. Twenty-nine items in six categories, each with a gold answer, gold citations,
expected tools and an expected behaviour. Seed 42, three runs. Claude 5 rejects the temperature
parameter, so determinism comes from tool-forced structured output and fixed prompts rather than a
sampling knob. Sonnet 5 is the agent, Opus 5 the judge, and I hand-scored ten items blind to check
the judge.

Headline, 447 turns, zero errors: groundedness 92 percent, workflow completion 97, escalation
accuracy 94, action safety 100, meaning no gated tool ever ran without a valid token. Warm latency
p50 27 seconds, p95 51.

**[POINT: citation precision and tool selection cells. DELIVERY: flat and unbothered, a reading of
the data, not an apology.]**

Two numbers I'd rather explain than have you find. Citation precision is 49 percent: the agent
over-cites beyond the gold set, and groundedness stays high because what it cites does support the
claim. Tool selection is 76, and four of the six persistent misses are gold expectations that
assumed a search path; the agent takes a more precise route and gets marked down for it. One item,
`au-02`, is a real failure: it asks for clarification where it should deny.

**[POINT: ablation table, chunking row, then the chaos row.]**

Ablations. Heading-aware chunking beats fixed 400-token windows by ten points of citation precision
and nineteen seconds of p95 latency. That's the clearest result and the evidence behind the chunking
decision. k of six and hybrid retrieval both hold up against their alternatives, but narrowly, and
the tables say so. And with the HR server switched off, the agent still completes 87 percent of
workflows. It drops to policy-only answers and escalates. It doesn't invent employee data.

**[POINT: calibration table.]**

Calibration against my blind scores: 90 percent exact, 100 within one.

### H — Close (8:40–9:00)

**[CLICK: README tab or design doc header. CAMERA if using picture-in-picture.]**

If the MCP service ever went away, the app runs alone with one environment variable, `MCP_MODE` set
to `inprocess`, same client code over the same HTTP path. Everything I've said is written down:
`design-and-evaluation.md` for every justification and the full result tables, `deployed.md` for the
topology, `ai-tooling.md` for how I used Claude Code and where it went wrong, and seventeen decision
records under `docs/adr`. Thanks for watching.

---

## 4. Word budget (measured, draft 5)

Raw count excludes stage directions but includes backticked identifiers, `⟵ screen` markers and,
in D, both branches of each conditional line. The "spoken" column removes the markers and the
unread branches; that is the number to plan against.

| Beat | Raw | Spoken (est.) | At 160 wpm | At 170 wpm |
|---|---|---|---|---|
| A | 40 | 40 | 0:15 | 0:14 |
| B | 183 | 180 | 1:08 | 1:04 |
| C | 100 | 100 | 0:38 | 0:35 |
| D | 551 | ~420 | 2:38 | 2:28 |
| E | 258 | ~235 | 1:28 | 1:23 |
| F | 272 | 270 | 1:41 | 1:35 |
| G | 247 | 247 | 1:33 | 1:27 |
| H | 68 | 68 | 0:26 | 0:24 |
| **Total** | **1,722** | **≈ 1,560** | **≈ 9:47** | **≈ 9:12** |

Draft 5a moved D's `lookup_person_profile` beat onto the rail's two args blocks (+5 spoken
words), because the old wording claimed there was no person ID on screen when there is one — the
server-injected one.

Draft 5 added ~35 spoken words over draft 4: naming rubric items four and six aloud (C and D),
and the applicability line in E. If a dry run lands over 10:00, the first cut is now the E
applicability clause ("then applicability, which for staff is fourteen documents in full", −12) and
the second is the C sentence naming `demo.sh` (−20); item six stays named via `/health` and the
demo buttons.

**Cut the model waits in post.** Four agent turns (two tasks, each with a gate resume) at a p50 of
~27 s is about 2 minutes of waiting. The narration in D and E is written to run over those waits;
where speech runs out before the model does, cut the gap to 2–3 seconds. A jump during a spinner is
normal in a screen recording and needs no announcement. With waits cut, runtime ≈ speech time.

**Already cut in draft 4** (restore any of these if a dry run lands under 8:45, in this order):

1. G, the calibration insight: "The one disagreement is the useful one: a fact can be fully grounded
   and still not answer the question, and a per-fact score can't see that. That's why the human pass
   stays." (+35 words)
2. E, after the balance result: "Scope is enforced inside this server, not in the prompt. Jordan reads
   Jordan's balance, a manager reads a direct report's, anyone else gets a structured `FORBIDDEN`
   naming the `required_scope`." (+35 words)
3. F, after "457 chunks": "Why by heading? Because policy is cited by section, and a citation is only
   checkable if the chunk boundary is the section boundary." (+25 words)
4. D, after "PTO is `none`": "That's what stops the agent quoting staff rules at a contractor." (+12)
5. The `NOT_APPLICABLE` beat after E: switch persona to Dani, type "How much PTO do I have?", say
   "Same question from a creator partner. The balance tool returns `NOT_APPLICABLE`, and the agent
   points to the creator agreement's availability windows instead of inventing a balance." (~35 s
   including the model turn)

**Last-resort cut** if a dry run lands over 10:00 even with waits removed: B's framework sentence
(−35 words). It is the answer to "agent framework or manual orchestration approach" in rubric item
ten, so cut it only if nothing else will do.

## 5. What the grader can verify from the screen alone

| Claim | Where it's visible |
|---|---|
| Nine tools, two servers connected | `/health`, beat C |
| Identity injected server-side | `tool_call` args with no `acting_person_id`, beat D |
| Audience filter before ranking | `withheld_by_audience: true`, `candidates_after_audience_filter` < `candidates_considered`, beat D |
| Gate never auto-executes | `gate` event, card, draft only after Confirm, beat E |
| Nothing is sent | `sent: false`, beat E |
| Facts and recommendations separated | two answer blocks, beat D |
| No chain-of-thought | `plan` event carries `summary` and `expected_tools` only, beat D |
| Deploy gated on CI | `deploy.yml` trigger and condition, beat F |
| Metrics as numbers | `/eval` tables, beat G |

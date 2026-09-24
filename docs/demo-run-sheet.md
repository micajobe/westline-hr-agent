# Demo video — run sheet

Not a script. A to-do list for one take, camera in the corner, talking in your own words about what
is on screen. Each beat says where to be, what to click, and the handful of things that have to get
said, in whatever order they come out. Numbers are read off the screen, never from memory. Target
about nine minutes; the limit is ten. The teleprompter script (`demo-script.md`) is still there if you
want exact wording for any one beat.

Four habits, carried over from the feedback on the last two projects: say the rubric item number
when you get to it; say the baseline and then what you built ("asks for five tools, there are nine");
give a behaviour a rule or a number, not an adjective; get to the weak numbers before the grader does.

## Before you press record

- [ ] Warm both Render services: hit `westline-mcp.onrender.com/health`, then
      `westline-hr-agent.onrender.com/health` until `status: ok`. Don't leave them 15 min.
- [ ] One dry run of both demo buttons. Write down: which branch Task 1 took (section? compliance?
      a card?), Dani's four sections, the 34 → 27 counts, Jordan's balance line, the draft ID.
- [ ] Tabs, in order: `/health` · chat · `/desk` · `/eval` · GitHub Actions · `docs/architecture.html`
      (open from disk, press F). Editor: `client.ts`, `ci.yml`, `deploy.yml`.
- [ ] ID card within reach. Camera framed. Nair rhymes with fire.

## 1. Open (≈0:20)

- Camera. Name, "individual project, AI Engineering Techniques and Architectures, Quantic MSAIE",
  ID held up for a slow three-count.
- One line: everything you're about to see is the deployed Render instance, not your laptop.

## 2. The problem and the shape of it (≈1:15) — items 10, 5, 4

Screen: the architecture diagram.

- Westline: fictional media company, three kinds of worker (staff, contractor, creator partner),
  different rules for each. "Can I expense this?" has three right answers. That's why the agent
  works out who's asking and what binds them *before* it retrieves anything.
- Walk the diagram left to right: React app → Fastify server with the agent loop and the MCP client →
  a second service hosting two MCP servers over Streamable HTTP. Four policy tools, five HR tools,
  two of the HR tools behind a confirmation gate. **Rubric asks for five tools on one server; nine, on two.**
- The loop is hand-written: plan, act, synthesize, verify. No framework, on purpose: the gate has
  to pause a model turn and resume it in a different HTTP request. ADR 6.
- One breath on the second model: verify also hands every citation to TypeSafe's Jev, which returns
  a probability that the passage supports the claim. You'll show the result in the eval.

## 3. Deployed and healthy (≈0:25) — items 7, 6

Screen: `/health`.

- Point: `status: ok`, both MCP servers `connected`, nine tools, `semantic_verify: typesafe`.
- It's a live check, not a flag: health re-runs discovery every call, three-second timeout.
- Cold start, one sentence: free instances sleep after 15 min, take up to a minute to wake, you
  warmed them. It's documented.

## 4. Task 1 — Dani, the drone, four policies (≈2:30) — items 3, 4, 5

Screen: chat. Persona → Dani Kowalczyk (creator partner, Kelowna). Run demo task 01.

- Say what she's asking (drone for a sponsored shoot: expense it? disclose the sponsor?). This is the
  multi-document one, item 3: four policies, and most of the expense policy doesn't apply to her.
- The rail is item 4: every tool, argument, result and source. No reasoning, ever.
- Expand the first call (`lookup_person_profile`). **Two args blocks.** From-model is `{}`; the
  model can't name a person because that field is cut out of the schema it sees. Server-injected has
  Dani's ID, fresh on every call. "You can't talk it into being someone else."
- Applicability result: read the summary off the screen (6 full / 4 partial / 5 none or whatever it
  shows). Expense only bites at §7; PTO doesn't touch her.
- Expand the first search and its retrieval row. Read the two counts. The gap is the filter running
  *inside the policy server before ranking*, so withheld text never reaches the model, and it says
  one document was withheld without knowing what was in it. Don't read the query string aloud.
- If `get_policy_section` ran: whole section, not a snippet. If `check_policy_compliance` ran:
  evidence across policy areas with chunk IDs, not a verdict. If neither: skip.
- The answer: two fields, not one blob. "What the policy says" up top, every line cited; guidance
  below, each pointing at its fact. **Read the four facts and their sections off the screen** (drone
  not reimbursable, EXPENSE 7.2 / CREATOR 7.1; on-screen label, EDITORIAL 4.2; caption tag, 4.3;
  certification and safety sign-off, SAFETY). The withheld notice at the bottom: only §7 was hers.
- VERIFY row: it throws out any claim whose source wasn't retrieved this turn. Read the counts. If
  the Jev line is under it, point at it, don't read it; the eval covers it.
- If a confirmation card appeared: it wants a ticket and hasn't opened one, the card is the exact
  arguments, you'll do the gate properly in Task 2. Confirm and move on. If not: nothing to approve,
  the gate is in Task 2.

## 5. Task 2 — Jordan, three days off, a gated draft (≈1:45) — items 4, 5, 6

Screen: chat. Persona → Jordan Reyes (staff, Calgary; manager Priya Nair). Run demo task 02.

- The question: Oct 14–16 off, and if it works, draft the note to Priya. The structured-data one.
- Profile (identity injected again), applicability (staff: everything in full), then the balance.
  Expand it. **It isn't a number, it's five fields**: balance, fits, notice required, notice met,
  blackout. The tool decides and says why. Read the line off the screen.
- Then it fetches (or searches for) the rule itself, PTO §3.2 "three to five days". Numbers from the
  data tool, the rule from the policy tool, the answer needs both.
- **The gate card.** Recipient, purpose, key points, all visible before anything runs. The token is
  bound to a hash of exactly these arguments, lives ten minutes, single use. Replay, forgery,
  expiry, one changed argument: all four come back "confirmation required". Scope is checked before
  the gate, so a bad request is forbidden even with a good token.
- Confirm. `sent: false`. Nothing in this system sends anything; it writes to a mock desk.
- `/desk`: there's the draft, read its ID.

## 6. Repo tour (≈1:20) — items 1, 2, 3, 5, 8

- `client.ts`: the only road from agent to tool; the server never imports tool code. Discovery at
  startup, names prefixed `policy__` / `hr__`. Point at the strip (`acting_person_id`,
  `confirmation_token` cut from the schema) and the inject (written back per call). There's a test
  that hands it a model-supplied identity and proves it's overridden.
- Design doc §2.2, items 2 and 3: 15 documents in md/HTML/PDF, normalised, chunked by heading,
  457 chunks with a hash snapshot so chunking is deterministic. Voyage 3 Lite embeddings. sqlite-vec
  on Node's built-in SQLite. Hybrid keyword + vector, fused, top six. Audience is a column on the
  vector table, which is how the filter runs before ranking.
- GitHub Actions, item 8: every push and PR runs typecheck, lint, build, **250 tests**, no API keys
  (stub embedder). Startup test asserts both servers connected; discovery test asserts nine tools;
  gate tests: refuse, run once, refuse replay, refuse forgery, refuse mismatched args.
- `deploy.yml`: fires only when CI passes on main; Render auto-deploy is off. Item 1 while you're
  here: Node pinned, secrets from env only, `.env.example` current.

## 7. Evaluation (≈1:15) — items 9, 3

Screen: `/eval`.

- 29 items, six categories, each with a gold answer, gold citations, expected tools and expected
  behaviour. Seed 42, three runs. Sonnet 5 agent, Opus 5 judge, ten items hand-scored blind. The run
  line also names the citation verifier, `jev-1.13.0`.
- **Read the headline off the screen**: turns and errors, groundedness, workflow completion,
  escalation accuracy, action safety (100%: no gated tool ever ran without a valid token), warm
  latency p50/p95.
- **Weak numbers first, flat delivery.** Citation precision 49%: the agent over-cites past the gold
  set. Tool selection 76%: four of six persistent misses are gold expectations that assumed a search
  path; one item is a real failure (asks for clarification where it should deny).
- Scroll to the **semantic verify** ablation. This is how you know the 49% is over-citation and not
  bad citations: Jev checked every citation that survived structural verify. 102 pairs, agreed with
  101, removed one, nothing unchecked, under 200 ms. So the extras are supporting citations the gold
  set didn't name. Item 3, measured rather than asserted.
- Other ablations: heading-aware chunking beats fixed windows by ten points of precision and 19 s of
  p95, the evidence behind the chunking decision. HR server switched off: still 87% workflow
  completion, falls back to policy-only and escalates, never invents employee data.
- Calibration against your blind scores: 90% exact, 100% within one.

## 8. Close (≈0:20) — items 7, 10

- If the MCP service went away, the app runs on its own with one env var flipped; same client code,
  same HTTP path.
- Everything is written down: design doc, deployment doc, tooling doc (how Claude Code was used and
  where it went wrong), eighteen ADRs. Thanks.

## Don't

- Don't say "RPAS". Don't read the search query string. Don't read the Jev line in the rail aloud;
  the eval row is where it's said. Don't speak a number you can't see on screen.

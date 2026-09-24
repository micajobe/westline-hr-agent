# Demo video — teleprompter script (draft 7, 2026-09-22)

> **Two-track recording.** This combined script is the source. It is split into
> [`demo-narration.md`](demo-narration.md) (the spoken track: `SAY`/`READ` only, tagged `[D3]`-style
> at each screen change) and [`demo-shot-list.md`](demo-shot-list.md) (the screen track: `DO`/`SCREEN`
> per tag, with a **Values** column for what the narration reads aloud). Order: dry run both tasks and
> write the values into the shot list; record the narration against them; record the screen while
> listening to the narration, pausing playback while the model works; re-record only the `READ`
> passages whose value differed as pickups; composite. Edit here and regenerate both with
> `node scripts/split-demo-script.mjs`; do not edit the split files by hand. A third option,
> [`demo-run-sheet.md`](demo-run-sheet.md), is a to-do list for talking in your own words: where to
> be, what to click, and the few things each beat has to get said.

Target 9:00 of the allowed 7–10. Spoken lines are plain paragraphs. Bracketed lines are not read:

- `DO` something to click or switch, in silence, before the next spoken line
- `SCREEN` what is in front of you while that line is read
- `SAY` one uninterrupted take — nothing opens or switches inside it
- `READ` a value read off the screen: say what the live run shows, not what is written here
- `BRANCH` / `IF` check what actually rendered, then say the matching line

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

On voice (Micah's own take, not a grader note): the previous videos read as less technical than the
work. The fix is not more numbers per
minute, it's saying *why* after each *what*. Every technical claim below is followed by the reason it
matters or the thing it prevents. Contractions, first person, one idea per sentence. Numbers are
spoken once and shown on screen; the screen carries the precision so the voice doesn't have to.

## 1. Coverage map

| Beat | Time | Rubric items | Must-say |
|---|---|---|---|
| A Open + ID | 0:00–0:25 | submission | name, program, individual, ID |
| B Problem + architecture | 0:25–1:40 | 10, 5, 4 | 3 workforce classes, 2 servers, 9 tools, Streamable HTTP, PLAN→ACT→SYNTHESIZE→VERIFY, no framework and why, VERIFY's second model named (TypeSafe Jev) |
| C Deployed + /health | 1:40–2:05 | 7, 6 (named) | both services, `/health` fields, cold-start sentence, `/chat` + demo buttons + `demo.sh` |
| D Task 1 live | 2:05–4:40 | 3, 4 (named), 5 | each tool with args and result, 34 → 27 candidates, `withheld_by_audience`, multi-doc citations, verify; gate only if offered |
| E Task 2 live | 4:40–6:20 | 4, 5, 6 | `check_pto_balance` fields, PTO §3.2 via `get_policy_section`, gate token rules, `sent: false` |
| F Repo: MCP, RAG, CI/CD | 6:20–7:40 | 1, 2, 3, 5, 8 | discovery + injection code, chunking, sqlite-vec, k and RRF, `ci.yml`, `deploy.yml` gating |
| G `/eval` | 7:40–8:40 | 9, 3 | headline, weak numbers with cause, **Jev citation check as the evidence for the cause**, chunking ablation, chaos row, calibration |
| H Close | 8:40–9:00 | 7, 10 | inprocess fallback, where the docs are |

## 2. Pre-record checklist

- [ ] Re-send the `quantic-grader` invitation if it has lapsed (sent 2026-09-08; expires at 7 days).
- [ ] **Test count is 250** (`npx vitest run`, 2026-09-22, 20 files). Check README,
      `design-and-evaluation.md` §2.8 and `STATUS.md` say the same before recording; the grader reads
      them and the F beat says the number aloud.
- [ ] **`/eval` must show the 3-run 2026-09-12 headline plus ablation 5.** `latest.json` is built by
      `node scripts/rebuild-report.mjs 2026-09-12T14-40-36 2026-09-22T16-03-20` (first stamp = headline
      and the four original arms, second = the semantic-verify arm). If anyone re-runs the harness
      before recording, rebuild with that command or the G numbers stop matching the screen.
- [ ] **Jev is on in production** (`/health` → `mode.semantic_verify: "typesafe"`, set 2026-09-22). The
      VERIFY row in D and E will carry a mono line naming `jev-1.13.0`; it is not read aloud — G
      introduces Jev with the measured result. If the line ever reads "unavailable", the status bucket
      after it says why; check the Render `TYPESAFE_API_KEY` value before recording.
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
      ticket/draft IDs. Check every `READ` line against that run.
- [ ] Decide whether `/desk` shows one ticket or two after the dry run, and say so if two.
- [ ] Browser tabs in order: (1) `/health`, (2) chat, (3) `/desk`, (4) `/eval`, (5) GitHub Actions,
      (6) `docs/architecture.html` opened from disk (`open docs/architecture.html`); press F for
      full view. It inlines the mermaid.live SVG export of the §1 diagram. Editor tabs in
      order: `apps/server/src/mcp/client.ts` (lines 142, 157–163, 217–227),
      `.github/workflows/ci.yml` (39–40), `.github/workflows/deploy.yml` (12, 27).

### Screen cues: read aloud or visual only

Decided once, here; the script carries the decision as a `READ` marker (say it) or as a `DO` line
saying "point at it, do not read aloud". The old inline `⟵ screen` markers are gone — one glyph was
carrying four different meanings.

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
| F test count | **Read aloud** (250 as of the Jev work) | Item eight asks for tests; the number is on screen too |

### Delivery notes

- The script no longer says "RPAS". If it comes back in, say "Remotely Piloted Aircraft System" once.
- Nair rhymes with "fire".
- The citation-precision paragraph in G is a reading of the data, not an apology. Flat, even pace.
- Pronounce `sqlite-vec` as "SQLite vec", `RRF` as "reciprocal rank fusion" (the script already
  spells it out), `HMAC` as "H-mac".

### How to read the script

Each beat is one fenced block. Markers sit on their own line so they arrive before the words do on
a scrolling prompter.

| Marker | Means |
|---|---|
| `DO` | You click, scroll or switch. In silence — cut the gap in Descript. |
| `SCREEN` | What is in front of you before you start talking. You never find out mid-sentence. |
| `SAY` | One uninterrupted take. Nothing opens, expands or switches inside a `SAY`. |
| `READ` | A value read off the screen. Same take — you are looking, not switching. |
| `BRANCH` / `IF` | Check what actually rendered, then say the matching line. |

Naming things aloud: the screen is already showing the identifier, so say what the tool is *for*.
Pronounce a name only where the name is the evidence — `acting_person_id` in D, and the structured
error codes in E.

---

## 3. Script

### A — Open (0:00–0:25)

```

DO
Camera on, full frame.
Hold your ID beside your face for a slow three-count.

SCREEN
You, full frame.

SAY
Hi, I'm Micah Slavens.
This is my individual project for AI Engineering Techniques
and Architectures, in the Quantic MSAIE.
It's called Westline HR Agent —
and everything you're about to see is running on the deployed
Render instance. Not on my laptop.
```

### B — Problem and architecture (0:25–1:40)

```

DO
Tab 6, docs/architecture.html. Press F for full view.

SCREEN
The architecture flowchart, full frame.

SAY
Westline is a fictional media company,
and it has three kinds of workers —
staff, contractors, and creator partners.
Different rules for each.
Which means "can I expense this?" has three right answers,
depending on who's asking.
That drove the whole design:
the agent works out who's asking, and which policies bind them,
before it retrieves anything.


DO
Nothing. Trace the diagram left to right with the cursor as you talk.

SCREEN
Same diagram.

SAY
So — item ten, the architecture.
A React chat app.
A Fastify server that runs the agent loop and holds the MCP client.
And a second service hosting two MCP servers over Streamable HTTP:
one with the retrieval index and four policy tools,
one with the mock employee data and five HR tools —
two of those sitting behind a confirmation gate.
The rubric asks for five tools on one server.
There are nine, on two.


DO
Nothing. Same screen.

SCREEN
Same diagram.

SAY
The loop is hand-written. Four functions:
plan, act, synthesize, verify.
No framework — and that's deliberate.
The confirmation gate has to pause a model turn
and pick it up again in a completely different HTTP request,
and frameworks want their loop to run to the end.
Decision record six has the full argument.
Verify also hands every citation to a second model, TypeSafe's Jev,
which returns a probability that the passage supports the claim.
You'll see all four steps in the trace in a minute.
```

### C — Deployed and healthy (1:40–2:05)

```

DO
Tab 1, the /health route. Let the JSON render.

SCREEN
The health JSON.

SAY
Item seven. Two free Render services — the app, and the MCP service.
This is the app's health route.


DO
Nothing. Point at status, then the two MCP entries, then the tool count.

SCREEN
Same JSON.

SAY
Status, ok. Both MCP servers, connected. Nine tools discovered.
And that's a live check, not a cached flag —
health re-runs tool discovery every time it's called,
with a three-second timeout.
Free Render instances go to sleep after fifteen minutes
and take up to a minute to wake up,
so I warmed both of these before recording.
That's all written up.
This route, the chat endpoint, and the two demo buttons
you're about to see — that's item six.
And there's a script that replays both tasks against any URL,
if a grader wants to run it themselves.
```


### D — Task 1: a creator partner, a drone, and four policies (2:05–4:40)

Two rules for this beat.

**Voice.** The rail is showing the identifier while you talk, so the grader reads it. Say what the
tool is *for*. Pronounce a name aloud only where the name is the evidence — that is
`acting_person_id`, and nothing else in D.

**Takes.** Nothing opens, expands or switches inside a `SAY`. Every view change happens in the `DO`
above it, in silence; `SCREEN` tells you what you are looking at before you start talking, so you
never have to find out mid-sentence. Cut the gaps in Descript. A `READ` is the same take — you are
looking at a number, not changing the view.

```

DO
Tab 2, chat. Persona switcher -> Dani Kowalczyk.
Wait for the persona line to settle.

SCREEN
Chat, empty. Persona line: creator_partner · Kelowna.

SAY
Task one. Dani Kowalczyk — she's a creator partner up in Kelowna.


DO
Click "Run demo task 01".
Wait for the question to appear in the transcript. Say nothing.

SCREEN
Her question in the transcript. Rail starting to fill on the right.

SAY
Here's what she's asking:
  "I bought a drone for the sponsored Big White shoot next month.
   Can I expense it, and does the sponsor tag need to be disclosed
   on the video?"
That's the multi-document question — rubric item three.
Answering it properly takes four separate policies,
and it takes knowing that most of the expense policy
doesn't apply to Dani at all.


DO
Nothing. Let the rail keep filling.

SCREEN
INTENT and PLAN rows at the top of the rail. Point at them as you go.

SAY
Watch the rail on the right. That's item four —
every tool, every argument, every result, every source.
No reasoning, ever.
It's classified this as a workflow question. There are five options,
and two of them — sensitive, and out of scope — never touch a tool.
Then it writes down which tools it expects to need,
and the evaluation scores that against what actually ran.


DO
Click "+ details" on the first CALL row. Both args blocks open.

SCREEN
hr · lookup_person_profile, expanded.
ARGS · FROM MODEL {} on top, ARGS · SERVER-INJECTED below it.
Point top block, then bottom, as you reach them.

SAY
First thing it does is ask who it's talking to.
Now look at the arguments — two blocks.
The top one is everything the model wrote. It's empty.
It didn't name anybody, and it couldn't have:
that field is cut out of the tool description the model ever sees.
The bottom block is what the server put in — Dani's ID —
and that goes in fresh on every single call.
So you can't talk this agent into being someone else.
Comes back: creator partner.


DO
Collapse that row. Find the applicability CALL and its RESULT.

SCREEN
policy · get_policy_applicability, with its result summary visible.

SAY
Next it asks which policies actually bind a creator partner.
The handbook has an applicability matrix, and this reads it —
document by document: binds in full, binds in part, doesn't bind.

READ
Off the result summary: "6 full, 4 partial, 5 none."

SAY
So six of them bind Dani completely.
Expense only bites at section seven.
PTO doesn't touch her at all.


DO
Expand the first policy__search_policy_documents result,
and the RETRIEVAL row under it. Get both open before you speak.

SCREEN
The query string, and the retrieval block with both counts.
There are two or three searches — you are narrating the first.
Point at the query. Do NOT read it aloud.

SAY
Then it searches — two or three times, one per policy area.
And here's the part I'd point at.
Hybrid retrieval, top six.

READ
The two counts: thirty-four chunks in the running, twenty-seven
after the audience filter.

SAY
That gap is the whole story.
The filter runs inside the policy server, before anything gets ranked —
so text Dani isn't cleared to see never reaches the model at all.
And it tells you it happened: one document withheld, the expense policy.
It can say something was held back without knowing what was in it.


DO
Point at the other search rows. No expanding.

SCREEN
The remaining search rows.

SAY
Same thing again, for disclosure.


BRANCH
Check which row is actually there before you start. Say one line or none.

IF policy__get_policy_section is in the rail --
SAY
It's also pulling a whole section, not just the snippet,
because a snippet isn't the rule.

IF policy__check_policy_compliance is in the rail --
SAY
And this one gathers the relevant rules across policy areas
and hands them back with their chunk IDs.
It's evidence, not a verdict —
the judgement stays with the model, where it has to be cited.

IF NEITHER -- say nothing. Move on.


DO
Wait for the answer to finish rendering. Say nothing while it streams.

SCREEN
The full answer. "What the policy says" above, guidance below.

SAY
And the answer comes back in two pieces —
two different fields, not one blob of text.
Up top, what the policy says. Every line cited.
Below it, guidance — and each one points back
at the fact it's resting on.

READ
The facts off the screen. These four appear in every run:
  - the drone isn't reimbursable — expense 7.2, creator 7.1
  - she has to disclose: label on screen in the first five seconds,
    editorial 4.2
  - and a sponsored tag in the first two lines of the caption,
    editorial 4.3
  - and the drone itself needs certification and a Field Safety
    sign-off — that's the safety policy
    (SAFETY 8.6 or 5.4 — read whichever is on screen)


DO
Scroll to the withheld notice. Do not click anything yet.

SCREEN
The withheld block at the foot of the answer.

SAY
It also tells her what she didn't get:
only section seven of the expense policy was hers to see.


DO
Click one citation card. Let it open. Close it. Silence throughout.

SCREEN
Back on the answer.

SAY
And every citation opens to the actual text.


DO
Find the VERIFY row in the rail.

SCREEN
The VERIFY row and its summary.

SAY
Last step — it goes back through and throws out
any claim whose source wasn't actually retrieved this turn.

READ
Off the row: "10 facts in, 10 kept, 0 removed" — or whatever it shows.


BRANCH
Confirmation card: did not appear in 3 of 3 eval runs. Bonus if it does.
Check before you speak.

IF a card appeared --
SCREEN
The confirmation card, arguments visible.

SAY
It also wants to open a ticket with Creator Partnerships —
and it hasn't. It stopped and asked.
The loop froze mid-turn, and this card is the exact arguments
it's proposing. I'll take you through that properly in task two.

DO
Click Confirm. Wait. Move on — don't visit /desk, task two covers it.

IF no card --
SAY
Nothing to approve here — the policy text answers it outright,
and it's not escalating to anyone. The gate comes in task two.
```

### E — Task 2: a PTO request and a gated draft to the manager (4:40–6:20)

```

DO
Tab 2. Persona -> Jordan Reyes. Wait for the line to settle.
("Nair" rhymes with "fire".)

SCREEN
Chat, empty. Persona line: staff · Calgary. Manager, Priya Nair.

SAY
Task two. Jordan Reyes — staff, Calgary.
Jordan's manager is Priya Nair.


DO
Click "Run demo task 02". Wait for the question to land. Say nothing.

SCREEN
The question in the transcript. Rail filling.

SAY
"Can I take October 14 to 16 off?
 If it works, draft the note to Priya."
This is the one that runs on structured data, end to end.


DO
Let the first rows land. Expand the PTO balance result before you speak.

SCREEN
Profile lookup, applicability, then the balance result expanded.

SAY
Profile lookup first — identity injected again, same as before.
Then applicability, which for staff is fourteen documents in full.
Then it checks the balance, for those exact dates.
And look at what comes back — it isn't a number.
It's five separate fields:
the balance, whether the request fits,
how much notice is required, whether that notice was met,
and whether it runs into a blackout.
That's the design. The tool decides, and it says why.

READ
Off the result: "balance 11/18 · 3 requested · fits true · notice 14d (met)"
Eleven days left out of eighteen. Three requested. It fits.
Fourteen days' notice required — and met.


BRANCH
Check which row is actually there before you speak.

IF policy__get_policy_section is in the rail --
SAY
Then it goes and fetches the section itself —
"requests of three to five days" — which is the citable rule.

IF it searched instead --
SAY
Then it goes and searches out the rule itself —
"requests of three to five days" — which is what it has to cite.


DO
Nothing. Same screen.

SCREEN
Same rows.

SAY
The data tool gives you the numbers.
The policy tool gives you the rule.
The answer needs both.


DO
Wait for the gate card to appear. Do NOT click it yet.

SCREEN
The confirmation card: recipient role, purpose, key points, all visible.

SAY
And here's the gate.
It wants to draft an email to Jordan's manager.
The recipient, the purpose, and the points it's going to make —
all of it on screen before anything runs.
The token behind this is bound to a hash of exactly these arguments.
It lives ten minutes, and it's used up the first time it's used.
Replay it, forge it, let it expire, change one argument —
all four come back "confirmation required", and nothing runs.
And scope is checked before the gate,
so an out-of-scope request is forbidden even with a good token.


DO
Click Confirm. Wait for the result. Say nothing.

SCREEN
The result, with sent: false.

SAY
There it is — sent, false.
Nothing in this system ever sends anything.
It writes to a mock desk.


DO
Tab 3, /desk. Point at the draft.

SCREEN
The desk. The draft, with its ID.

READ
And here it is, with its ID.
```

### F — Repo tour: MCP client, retrieval, CI/CD (6:20–7:40)

```

DO
Editor. Open apps/server/src/mcp/client.ts.
Scroll to listTools (~142) and stop there.

SCREEN
client.ts, the discovery function.

SAY
Item five.
This file is the only road from the agent to any tool.
The server never imports tool code — not once.
On startup it asks both servers what they've got,
prefixes the names so it knows which is which,
and routes on the prefix.


DO
Scroll to 157–163, pause. Then 217–227, pause.

SCREEN
The strip, then the inject.

SAY
And this is the bit from task one.
Here it cuts acting person ID and the confirmation token
out of the schema the model ever sees.
And down here it writes them back in, per call.
There's a test that hands it a model-supplied identity
and proves it gets overridden.
Transport is Streamable HTTP, behind a shared-secret header.


DO
Open the design doc at §2.2. Don't open the RAG source.

SCREEN
The chunking paragraph.

SAY
Items two and three.
Fifteen documents, three formats — markdown, HTML and PDF.
All of it normalised to markdown and chunked by heading,
one chunk per section. Four hundred and fifty-seven of them,
hash-snapshotted, so the chunking is deterministic.
Embeddings are Voyage 3 Lite.
The store is SQLite vec, through Node's built-in SQLite —
one file holding the vectors, the chunks and the keyword index together.
Retrieval is hybrid — keyword and vector, fused, top six.
And audience is a column on the vector table,
which is how the filter runs before the ranking.


DO
Tab 5, GitHub Actions.

SCREEN
The Actions list. ci and deploy, both green.

SAY
Item eight. This runs on every push and every pull request:
typecheck, lint, build, and two hundred and fifty tests —
with no API keys at all, because CI uses a deterministic
stub embedder.


DO
Editor, ci.yml, lines 39–40, the Test step.

SCREEN
The test step.

SAY
That includes the start-up test that asserts both servers connected,
the discovery test that asserts exactly nine tools,
call tests across all four scopes,
and five gate tests: refuse, run once, refuse the replay,
refuse a forgery, refuse mismatched arguments.


DO
Editor, deploy.yml. Point at line 12, then line 27.

SCREEN
The workflow_run trigger, then the success guard.

SAY
And deploy only fires when CI passes on main.
Render's own auto-deploy is switched off on both services,
so this is the only thing that can push to production.
Item one is on screen too — Node's pinned,
secrets come from the environment only,
and the example env file is current.
```

### G — Evaluation (7:40–8:40)

```

DO
Tab 4, /eval. Let the headline table render.

SCREEN
The headline table.

SAY
Item nine.
Twenty-nine items across six categories.
Every one has a gold answer, gold citations,
the tools it should have used, and how it should have behaved.
Seed 42, three runs.
Claude 5 won't take a temperature parameter,
so determinism comes from forced structured output and fixed prompts
instead of a sampling knob.
Sonnet 5 is the agent, Opus 5 is the judge,
and I hand-scored ten items blind to check the judge.

READ
Off the headline: four hundred and forty-seven turns, zero errors.
Groundedness, ninety-two percent.
Workflow completion, ninety-seven.
Escalation accuracy, ninety-four.
Action safety, a hundred — meaning no gated tool ever ran
without a valid token.
Warm latency, twenty-seven seconds at the median, fifty-one at p95.


DO
Point at citation precision, then tool selection.
Delivery: flat. A reading of the data, not an apology.

SCREEN
Those two cells.

SAY
Two numbers I'd rather explain than have you find.
Citation precision is forty-nine percent.
The agent over-cites — it goes past the gold set.
I wanted to know whether those extra citations were wrong,
or just extra. So I didn't guess. I measured it.
Tool selection is seventy-six.
Four of the six persistent misses are gold expectations
that assumed a search path; the agent takes a more precise route
and gets marked down for it.
One item is a genuine failure:
it asks for clarification where it should have denied outright.


DO
Scroll to the ablation table headed "semantic verify". Point at the "on" row.

SCREEN
The two-row table: semantic_verify off, then on (typesafe).

SAY
This is the measurement. Item three, unsupported claims.
Verify already drops any citation the model invented —
a chunk that wasn't retrieved this turn.
Then TypeSafe's Jev checks every citation that survived:
does this passage support this claim, contradict it, or say nothing?
A hundred and two pairs. It agreed with a hundred and one.
It removed one, and nothing went unchecked.
So the forty-nine percent isn't unsupported citations —
it's supporting citations the gold set didn't name.
That's an over-citation problem, and I know that now,
because a second model read every passage.

READ
Off the row: the citations-removed cell, and the verify latency in milliseconds.


DO
Scroll to the ablation table. Point at the chunking row, then chaos.

SCREEN
The ablation table.

SAY
Ablations.
Heading-aware chunking beats fixed four-hundred-token windows
by ten points of citation precision,
and nineteen seconds off p95.
That's the clearest result in here,
and it's the evidence behind the chunking decision.
Top-six and hybrid both hold up against the alternatives,
but narrowly — and the tables say so.
And with the HR server switched off entirely,
it still completes eighty-seven percent of workflows.
It falls back to policy-only answers, and escalates.
It does not invent employee data.


DO
Point at the calibration table.

SCREEN
The calibration table.

SAY
And against my own blind scores:
ninety percent exact, a hundred percent within one.
```

### H — Close (8:40–9:00)

```

DO
README, or the design doc header. Camera if you're using PiP.

SCREEN
The doc, or you.

SAY
One last thing — if the MCP service ever went away,
the app runs on its own, with a single environment variable flipped.
Same client code, same HTTP path.
And everything I've said is written down:
the design doc for every justification and the full result tables,
a deployment doc for the topology,
a tooling doc for how I used Claude Code and where it went wrong,
and eighteen decision records.
Thanks for watching.
```

---


## 4. Word budget (measured, draft 7)

Counted from `SAY` and `READ` lines only; `DO` and `SCREEN` are never spoken. Where a `BRANCH` has
alternatives, the longest one is counted, so these are upper bounds on the branching beats.

| Beat | Spoken | At 160 wpm | At 170 wpm |
|---|---|---|---|
| A | 42 | 0:15 | 0:14 |
| B | 218 | 1:21 | 1:16 |
| C | 117 | 0:43 | 0:41 |
| D | 663 | 4:08 | 3:54 |
| E | 314 | 1:57 | 1:50 |
| F | 323 | 2:01 | 1:54 |
| G | 406 | 2:32 | 2:23 |
| H | 74 | 0:27 | 0:26 |
| **Total** | **2,157** | **≈ 13:28** | **≈ 12:40** |

**Draft 7 introduces Jev in B (two lines, +20 words) and rewrites G's precision paragraph around the
measurement (+113 net); the optional D take was cut, so Jev is shown in G against the `/eval` row and
merely visible in the VERIFY rows of D and E. Net +133 words over draft 6, about 50 seconds at 160 wpm,
on a script that was already over budget.** Before cutting, two things make that number
less reliable than it looks, in opposite directions:

- **The old count was optimistic.** It scored `hr__lookup_person_profile` as one word. Saying it
  aloud is closer to two seconds. Several beats did that, so the old ≈9:45 was never real.
- **The new count is pessimistic.** Numbers are now written the way you say them — "four hundred
  and fifty-seven" counts as four words and "457" counted as one, but they take the same time to
  speak. F and G are full of these.

So do not cut against this table. **Read D aloud once with a stopwatch**, divide 663 by the minutes
it actually took, and use that as your wpm for the rest. Only then decide what goes.

If it does have to come down, cut spoken words, not structure — the `SCREEN` lines cost nothing to
read and are the reason you know what you opened. In order of least damage: F's five gate-test names
(−12), D's "same thing again, for disclosure" beat (−6), G's ablation caveat "but narrowly — and the
tables say so" (−9), and folding D's citation-card line into the withheld line (−9). The E
applicability clause and the C `demo.sh` sentence, named as first cuts in draft 5, are both still
live candidates.


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
| Citations checked for support by a second model | `/eval` ablation "semantic verify": 1 removed of 102, 187 ms, beat G; the `jev-1.13.0` mono line under VERIFY in beats D and E (visible, not read) |

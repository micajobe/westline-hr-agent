# Demo video — narration track (draft 7, split from `demo-script.md`)

The spoken track, recorded first. The click-through is driven by this recording, so its timing is
yours, not the model's. Each `[D3]`-style tag marks the moment the screen changes; the same tags key the
shot list, and they are never spoken. Line breaks are pacing for the prompter, not sentence ends.

Order of work: (1) one dry run of both tasks, writing the values into `demo-shot-list.md`; (2) record
this narration against those values; (3) record the screen while listening to the narration, pausing
playback while the model works and cutting the gap; (4) re-record only the `READ` passages whose value
came out different in the real click-through, as pickups; (5) composite. Where a `BRANCH` offers
alternatives, the dry run decides which one is recorded; delete the others.

Rules carried over from the combined script: name the rubric item, then the baseline, then what was
built; every behaviour claim gets a rule or a number; weak numbers first, with the cause; say why after
each what. `docs/demo-script.md` is the source of both files; regenerate with `node scripts/split-demo-script.mjs`.

## A — Open

`[A1]`

Hi, I'm Micah Slavens.
This is my individual project for AI Engineering Techniques
and Architectures, in the Quantic MSAIE.
It's called Westline HR Agent —
and everything you're about to see is running on the deployed
Render instance. Not on my laptop.

## B — Problem and architecture

`[B1]`

Westline is a fictional media company,
and it has three kinds of workers —
staff, contractors, and creator partners.
Different rules for each.
Which means "can I expense this?" has three right answers,
depending on who's asking.
That drove the whole design:
the agent works out who's asking, and which policies bind them,
before it retrieves anything.

`[B2]`

So — item ten, the architecture.
A React chat app.
A Fastify server that runs the agent loop and holds the MCP client.
And a second service hosting two MCP servers over Streamable HTTP:
one with the retrieval index and four policy tools,
one with the mock employee data and five HR tools —
two of those sitting behind a confirmation gate.
The rubric asks for five tools on one server.
There are nine, on two.

`[B3]`

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

## C — Deployed and healthy

`[C1]`

Item seven. Two free Render services — the app, and the MCP service.
This is the app's health route.

`[C2]`

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

## D — Task 1: a creator partner, a drone, and four policies

`[D1]`

Task one. Dani Kowalczyk — she's a creator partner up in Kelowna.

`[D2]`

Here's what she's asking:
  "I bought a drone for the sponsored Big White shoot next month.
   Can I expense it, and does the sponsor tag need to be disclosed
   on the video?"
That's the multi-document question — rubric item three.
Answering it properly takes four separate policies,
and it takes knowing that most of the expense policy
doesn't apply to Dani at all.

`[D3]`

Watch the rail on the right. That's item four —
every tool, every argument, every result, every source.
No reasoning, ever.
It's classified this as a workflow question. There are five options,
and two of them — sensitive, and out of scope — never touch a tool.
Then it writes down which tools it expects to need,
and the evaluation scores that against what actually ran.

`[D4]`

First thing it does is ask who it's talking to.
Now look at the arguments — two blocks.
The top one is everything the model wrote. It's empty.
It didn't name anybody, and it couldn't have:
that field is cut out of the tool description the model ever sees.
The bottom block is what the server put in — Dani's ID —
and that goes in fresh on every single call.
So you can't talk this agent into being someone else.
Comes back: creator partner.

`[D5]`

Next it asks which policies actually bind a creator partner.
The handbook has an applicability matrix, and this reads it —
document by document: binds in full, binds in part, doesn't bind.

*READ, values from the shot list:*
Off the result summary: "6 full, 4 partial, 5 none."

So six of them bind Dani completely.
Expense only bites at section seven.
PTO doesn't touch her at all.

`[D6]`

Then it searches — two or three times, one per policy area.
And here's the part I'd point at.
Hybrid retrieval, top six.

*READ, values from the shot list:*
The two counts: thirty-four chunks in the running, twenty-seven
after the audience filter.

That gap is the whole story.
The filter runs inside the policy server, before anything gets ranked —
so text Dani isn't cleared to see never reaches the model at all.
And it tells you it happened: one document withheld, the expense policy.
It can say something was held back without knowing what was in it.

`[D7]`

Same thing again, for disclosure.

`[D8]` **ONE OF** — Check which row is actually there before you start. Say one line or none.

*If policy__get_policy_section is in the rail:*

It's also pulling a whole section, not just the snippet,
because a snippet isn't the rule.

*If policy__check_policy_compliance is in the rail:*

And this one gathers the relevant rules across policy areas
and hands them back with their chunk IDs.
It's evidence, not a verdict —
the judgement stays with the model, where it has to be cited.

*If NEITHER -- say nothing. Move on.:*

*(say nothing)*

`[D9]`

And the answer comes back in two pieces —
two different fields, not one blob of text.
Up top, what the policy says. Every line cited.
Below it, guidance — and each one points back
at the fact it's resting on.

*READ, values from the shot list:*
The facts off the screen. These four appear in every run:
  - the drone isn't reimbursable — expense 7.2, creator 7.1
  - she has to disclose: label on screen in the first five seconds,
    editorial 4.2
  - and a sponsored tag in the first two lines of the caption,
    editorial 4.3
  - and the drone itself needs certification and a Field Safety
    sign-off — that's the safety policy
    (SAFETY 8.6 or 5.4 — read whichever is on screen)

`[D10]`

It also tells her what she didn't get:
only section seven of the expense policy was hers to see.

`[D11]`

And every citation opens to the actual text.

`[D12]`

Last step — it goes back through and throws out
any claim whose source wasn't actually retrieved this turn.

*READ, values from the shot list:*
Off the row: "10 facts in, 10 kept, 0 removed" — or whatever it shows.

`[D13]` **ONE OF** — Confirmation card: did not appear in 3 of 3 eval runs. Bonus if it does. Check before you speak.

*If a card appeared:*

It also wants to open a ticket with Creator Partnerships —
and it hasn't. It stopped and asked.
The loop froze mid-turn, and this card is the exact arguments
it's proposing. I'll take you through that properly in task two.

*If no card:*

Nothing to approve here — the policy text answers it outright,
and it's not escalating to anyone. The gate comes in task two.

## E — Task 2: a PTO request and a gated draft to the manager

`[E1]`

Task two. Jordan Reyes — staff, Calgary.
Jordan's manager is Priya Nair.

`[E2]`

"Can I take October 14 to 16 off?
 If it works, draft the note to Priya."
This is the one that runs on structured data, end to end.

`[E3]`

Profile lookup first — identity injected again, same as before.
Then applicability, which for staff is fourteen documents in full.
Then it checks the balance, for those exact dates.
And look at what comes back — it isn't a number.
It's five separate fields:
the balance, whether the request fits,
how much notice is required, whether that notice was met,
and whether it runs into a blackout.
That's the design. The tool decides, and it says why.

*READ, values from the shot list:*
Off the result: "balance 11/18 · 3 requested · fits true · notice 14d (met)"
Eleven days left out of eighteen. Three requested. It fits.
Fourteen days' notice required — and met.

`[E4]` **ONE OF** — Check which row is actually there before you speak.

*If policy__get_policy_section is in the rail:*

Then it goes and fetches the section itself —
"requests of three to five days" — which is the citable rule.

*If it searched instead:*

Then it goes and searches out the rule itself —
"requests of three to five days" — which is what it has to cite.

`[E5]`

The data tool gives you the numbers.
The policy tool gives you the rule.
The answer needs both.

`[E6]`

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

`[E7]`

There it is — sent, false.
Nothing in this system ever sends anything.
It writes to a mock desk.

`[E8]`

*READ, values from the shot list:*
And here it is, with its ID.

## F — Repo tour: MCP client, retrieval, CI/CD

`[F1]`

Item five.
This file is the only road from the agent to any tool.
The server never imports tool code — not once.
On startup it asks both servers what they've got,
prefixes the names so it knows which is which,
and routes on the prefix.

`[F2]`

And this is the bit from task one.
Here it cuts acting person ID and the confirmation token
out of the schema the model ever sees.
And down here it writes them back in, per call.
There's a test that hands it a model-supplied identity
and proves it gets overridden.
Transport is Streamable HTTP, behind a shared-secret header.

`[F3]`

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

`[F4]`

Item eight. This runs on every push and every pull request:
typecheck, lint, build, and two hundred and fifty tests —
with no API keys at all, because CI uses a deterministic
stub embedder.

`[F5]`

That includes the start-up test that asserts both servers connected,
the discovery test that asserts exactly nine tools,
call tests across all four scopes,
and five gate tests: refuse, run once, refuse the replay,
refuse a forgery, refuse mismatched arguments.

`[F6]`

And deploy only fires when CI passes on main.
Render's own auto-deploy is switched off on both services,
so this is the only thing that can push to production.
Item one is on screen too — Node's pinned,
secrets come from the environment only,
and the example env file is current.

## G — Evaluation

`[G1]`

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

*READ, values from the shot list:*
Off the headline: four hundred and forty-seven turns, zero errors.
Groundedness, ninety-two percent.
Workflow completion, ninety-seven.
Escalation accuracy, ninety-four.
Action safety, a hundred — meaning no gated tool ever ran
without a valid token.
Warm latency, twenty-seven seconds at the median, fifty-one at p95.

`[G2]`

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

`[G3]`

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

*READ, values from the shot list:*
Off the row: the citations-removed cell, and the verify latency in milliseconds.

`[G4]`

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

`[G5]`

And against my own blind scores:
ninety percent exact, a hundred percent within one.

## H — Close

`[H1]`

One last thing — if the MCP service ever went away,
the app runs on its own, with a single environment variable flipped.
Same client code, same HTTP path.
And everything I've said is written down:
the design doc for every justification and the full result tables,
a deployment doc for the topology,
a tooling doc for how I used Claude Code and where it went wrong,
and eighteen decision records.
Thanks for watching.

---
*Spoken words (longest branch counted): 2,134 · ≈ 13:20 at 160 wpm. The 10-minute limit applies to the composited video; the screen track is cut to this.*

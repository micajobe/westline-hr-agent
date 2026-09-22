# Demo video — shot list (draft 7, split from `demo-script.md`)

The screen track, recorded second, in silence, while listening to the narration; each tag is the
sync point with `demo-narration.md`. The **Values** column lists every number or name the narration
reads aloud in that shot. Fill **Actual** from the dry run before recording the narration, then check
it again after the real click-through: any row where the two differ is a narration pickup. Where a
shot is a `BRANCH`, note which alternative happened; the narration keeps only that one.

Browser tabs in order: (1) `/health`, (2) chat, (3) `/desk`, (4) `/eval`, (5) GitHub Actions,
(6) `docs/architecture.html`. Editor tabs: `apps/server/src/mcp/client.ts`, `.github/workflows/ci.yml`,
`.github/workflows/deploy.yml`. Warm both Render services first; the full checklist is in the combined script.

## A — Open (planned 0:00–0:25)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `A1` | Camera on, full frame. Hold your ID beside your face for a slow three-count. | You, full frame. | — | |

## B — Problem and architecture (planned 0:25–1:40)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `B1` | Tab 6, docs/architecture.html. Press F for full view. | The architecture flowchart, full frame. | — | |
| `B2` | Nothing. Trace the diagram left to right with the cursor as you talk. | Same diagram. | — | |
| `B3` | Nothing. Same screen. | Same diagram. | — | |

## C — Deployed and healthy (planned 1:40–2:05)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `C1` | Tab 1, the /health route. Let the JSON render. | The health JSON. | — | |
| `C2` | Nothing. Point at status, then the two MCP entries, then the tool count. | Same JSON. | — | |

## D — Task 1: a creator partner, a drone, and four policies (planned 2:05–4:40)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `D1` | Tab 2, chat. Persona switcher -> Dani Kowalczyk. Wait for the persona line to settle. | Chat, empty. Persona line: creator_partner · Kelowna. | — | |
| `D2` | Click "Run demo task 01". Wait for the question to appear in the transcript. Say nothing. | Her question in the transcript. Rail starting to fill on the right. | — | |
| `D3` | Nothing. Let the rail keep filling. | INTENT and PLAN rows at the top of the rail. Point at them as you go. | — | |
| `D4` | Click "+ details" on the first CALL row. Both args blocks open. | hr · lookup_person_profile, expanded. ARGS · FROM MODEL {} on top, ARGS · SERVER-INJECTED below it. Point top block, then bottom, as you reach them. | — | |
| `D5` | Collapse that row. Find the applicability CALL and its RESULT. | policy · get_policy_applicability, with its result summary visible. | Off the result summary: "6 full, 4 partial, 5 none."  | |
| `D6` | Expand the first policy__search_policy_documents result, and the RETRIEVAL row under it. Get both open before you speak. | The query string, and the retrieval block with both counts. There are two or three searches — you are narrating the first. Point at the query. Do NOT read it aloud. | The two counts: thirty-four chunks in the running, twenty-seven after the audience filter.  | |
| `D7` | Point at the other search rows. No expanding. | The remaining search rows. | — | |
| `D8` | BRANCH: Check which row is actually there before you start. Say one line or none. **if policy__get_policy_section is in the rail**: —; **if policy__check_policy_compliance is in the rail**: —; **if NEITHER -- say nothing. Move on.**: — | — | — | |
| `D9` | Wait for the answer to finish rendering. Say nothing while it streams. | The full answer. "What the policy says" above, guidance below. | The facts off the screen. These four appear in every run:   - the drone isn't reimbursable — expense 7.2, creator 7.1   - she has to disclose: label on screen in the first five seconds,     editorial 4.2   - and a sponsored tag in the first two lines of the caption,     editorial 4.3   - and the drone itself needs certification and a Field Safety     sign-off — that's the safety policy     (SAFETY 8.6 or 5.4 — read whichever is on screen)   | |
| `D10` | Scroll to the withheld notice. Do not click anything yet. | The withheld block at the foot of the answer. | — | |
| `D11` | Click one citation card. Let it open. Close it. Silence throughout. | Back on the answer. | — | |
| `D12` | Find the VERIFY row in the rail. | The VERIFY row and its summary. | Off the row: "10 facts in, 10 kept, 0 removed" — or whatever it shows.   | |
| `D13` | BRANCH: Confirmation card: did not appear in 3 of 3 eval runs. Bonus if it does. Check before you speak. **if a card appeared**: Click Confirm. Wait. Move on — don't visit /desk, task two covers it. · screen: The confirmation card, arguments visible.; **if no card**: — | — | — | |

## E — Task 2: a PTO request and a gated draft to the manager (planned 4:40–6:20)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `E1` | Tab 2. Persona -> Jordan Reyes. Wait for the line to settle. ("Nair" rhymes with "fire".) | Chat, empty. Persona line: staff · Calgary. Manager, Priya Nair. | — | |
| `E2` | Click "Run demo task 02". Wait for the question to land. Say nothing. | The question in the transcript. Rail filling. | — | |
| `E3` | Let the first rows land. Expand the PTO balance result before you speak. | Profile lookup, applicability, then the balance result expanded. | Off the result: "balance 11/18 · 3 requested · fits true · notice 14d (met)" Eleven days left out of eighteen. Three requested. It fits. Fourteen days' notice required — and met.   | |
| `E4` | BRANCH: Check which row is actually there before you speak. **if policy__get_policy_section is in the rail**: —; **if it searched instead**: — | — | — | |
| `E5` | Nothing. Same screen. | Same rows. | — | |
| `E6` | Wait for the gate card to appear. Do NOT click it yet. | The confirmation card: recipient role, purpose, key points, all visible. | — | |
| `E7` | Click Confirm. Wait for the result. Say nothing. | The result, with sent: false. | — | |
| `E8` | Tab 3, /desk. Point at the draft. | The desk. The draft, with its ID. | And here it is, with its ID. | |

## F — Repo tour: MCP client, retrieval, CI/CD (planned 6:20–7:40)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `F1` | Editor. Open apps/server/src/mcp/client.ts. Scroll to listTools (~142) and stop there. | client.ts, the discovery function. | — | |
| `F2` | Scroll to 157–163, pause. Then 217–227, pause. | The strip, then the inject. | — | |
| `F3` | Open the design doc at §2.2. Don't open the RAG source. | The chunking paragraph. | — | |
| `F4` | Tab 5, GitHub Actions. | The Actions list. ci and deploy, both green. | — | |
| `F5` | Editor, ci.yml, lines 39–40, the Test step. | The test step. | — | |
| `F6` | Editor, deploy.yml. Point at line 12, then line 27. | The workflow_run trigger, then the success guard. | — | |

## G — Evaluation (planned 7:40–8:40)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `G1` | Tab 4, /eval. Let the headline table render. | The headline table. | Off the headline: four hundred and forty-seven turns, zero errors. Groundedness, ninety-two percent. Workflow completion, ninety-seven. Escalation accuracy, ninety-four. Action safety, a hundred — meaning no gated tool ever ran without a valid token. Warm latency, twenty-seven seconds at the median, fifty-one at p95.   | |
| `G2` | Point at citation precision, then tool selection. Delivery: flat. A reading of the data, not an apology. | Those two cells. | — | |
| `G3` | Scroll to the ablation table headed "semantic verify". Point at the "on" row. | The two-row table: semantic_verify off, then on (typesafe). | Off the row: the citations-removed cell, and the verify latency in milliseconds.   | |
| `G4` | Scroll to the ablation table. Point at the chunking row, then chaos. | The ablation table. | — | |
| `G5` | Point at the calibration table. | The calibration table. | — | |

## H — Close (planned 8:40–9:00)

| Tag | Do | Screen | Values the narration reads | Actual |
|---|---|---|---|---|
| `H1` | README, or the design doc header. Camera if you're using PiP. | The doc, or you. | — | |


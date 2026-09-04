#!/usr/bin/env bash
# Run both PRD §14 demo tasks against a running app and check the expected tool sequence.
#   scripts/demo.sh                      # against http://localhost:3000
#   scripts/demo.sh https://westline-app.onrender.com
set -euo pipefail
BASE="${1:-http://localhost:3000}"
BASE="${BASE%/}"

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 2; }; }
need curl; need python3

echo "== health =="
curl -sf "$BASE/health" | python3 -c '
import json,sys; h=json.load(sys.stdin)
print("status:", h["status"], "| mode:", h["mode"]["mcp"], "| policy:", h["mcp"]["policy"]["status"], "| hr:", h["mcp"]["hr"]["status"], "| model:", h["models"]["agent"], "available" if h["models"]["available"] else "UNAVAILABLE")
if not h["models"]["available"]: sys.exit("no model key on the server; the agent cannot run")'

TASKS=$(curl -sf "$BASE/demo/tasks")
FAIL=0
for i in 0 1; do
  TASK=$(echo "$TASKS" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[$i]))")
  TITLE=$(echo "$TASK" | python3 -c 'import json,sys; print(json.load(sys.stdin)["title"])')
  echo; echo "== $TITLE =="
  BODY=$(echo "$TASK" | python3 -c 'import json,sys; t=json.load(sys.stdin); print(json.dumps({"message":t["message"],"acting_person_id":t["acting_person_id"]}))')
  ENV=$(curl -sf -X POST "$BASE/chat" -H 'content-type: application/json' -d "$BODY")
  echo "$ENV" > "/tmp/westline-demo-$i.json"

  # Gate round trip: confirm whatever the agent proposed, then check the desk.
  CONF=$(echo "$ENV" | python3 -c 'import json,sys; e=json.load(sys.stdin); c=e.get("confirmation_required"); print(json.dumps({"conversation_id":e["conversation_id"],"turn_id":e["turn_id"],"args_hash":c["args_hash"],"decision":"confirm"}) if c else "")')
  if [ -n "$CONF" ]; then
    echo "-- gate: $(echo "$ENV" | python3 -c 'import json,sys; print(json.load(sys.stdin)["confirmation_required"]["summary"])')"
    ENV=$(curl -sf -X POST "$BASE/confirm" -H 'content-type: application/json' -d "$CONF")
    echo "$ENV" > "/tmp/westline-demo-$i.final.json"
  fi

  echo "$TASK" > /tmp/westline-demo-task.json
  echo "$ENV" > /tmp/westline-demo-env.json
  python3 - <<'PY' || FAIL=1
import json,sys
e=json.load(open("/tmp/westline-demo-env.json")); t=json.load(open("/tmp/westline-demo-task.json"))
called=[x["tool"] for x in e["trace"] if x["type"]=="tool_call"]
gates=[x for x in e["trace"] if x["type"]=="gate"]
print("tools called:", " -> ".join(called))
print("gate events:", len(gates), "| actions_taken:", [a["tool"] for a in e["answer"]["actions_taken"]])
print("facts:", len(e["answer"]["policy_facts"]), "| citations:", sorted({f"{c['doc_id']} {c['section_path']}" for f in e["answer"]["policy_facts"] for c in f["citations"]}))
print("escalation:", e["answer"]["escalation"]["target"], "| withheld:", e["answer"]["withheld_by_audience"])
print("answer:", e["answer"]["answer_markdown"][:400].replace("\n"," "))
missing=[x for x in t["expected_tools"] if not any(alt in called for alt in x.split("|"))]
if missing: print("MISSING expected tools:", missing); sys.exit(1)
errs=[x for x in e["trace"] if x["type"]=="error"]
if errs: print("ERROR events:", [x["result_summary"] for x in errs]); sys.exit(1)
print("OK")
PY
done

echo; echo "== desk =="
curl -sf "$BASE/desk" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("tickets:", len(d["tickets"]), "| drafts:", len(d["drafts"]))'
exit $FAIL

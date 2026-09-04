#!/usr/bin/env bash
# Trigger and poll Render deploys through the REST API.
#
#   scripts/render-deploy.sh trigger <service-id>          # start a deploy, print its id and status
#   scripts/render-deploy.sh status  <service-id>          # print the latest deploy's status
#   scripts/render-deploy.sh wait    <service-id> [secs]   # poll until terminal; exit 1 unless live
#   scripts/render-deploy.sh deploy  <service-id> [secs]   # trigger, then wait
#   scripts/render-deploy.sh logs    <service-id> [n]
#
# RENDER_API_KEY comes from the environment or .env. Deploy hook URLs are not exposed by the
# Render API (see deployed.md), so this is the scriptable equivalent for
# .github/workflows/deploy.yml: one API key instead of two secret hook URLs, and real deploy
# status instead of polling /health.
set -euo pipefail

cmd=${1:?usage: render-deploy.sh trigger|status|logs <service-id>}
svc=${2:?missing service id}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

key=${RENDER_API_KEY:-}
if [ -z "$key" ] && [ -f "$root/.env" ]; then
  key=$(grep -m1 '^RENDER_API_KEY=' "$root/.env" | cut -d= -f2- || true)
fi
[ -n "$key" ] || {
  echo "RENDER_API_KEY is not set (environment or .env)" >&2
  exit 2
}

base=https://api.render.com/v1
api() { curl -sS -H "Authorization: Bearer $key" -H "Accept: application/json" "$@"; }

case "$cmd" in
trigger)
  api -X POST "$base/services/$svc/deploys" \
    -H "Content-Type: application/json" -d '{"clearCache":"do_not_clear"}' |
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id","?"), d.get("status","?"))'
  ;;
status)
  api "$base/services/$svc/deploys?limit=1" |
    python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d:
    print("no deploys")
    raise SystemExit
x = d[0].get("deploy", d[0])
print(x.get("id"), x.get("status"), "created", x.get("createdAt"), "finished", x.get("finishedAt"))'
  ;;
wait)
  deadline=$(($(date +%s) + ${3:-900}))
  while :; do
    line=$("$0" status "$svc")
    state=$(echo "$line" | awk '{print $2}')
    echo "$(date -u +%H:%M:%S) $state"
    case "$state" in
    live) exit 0 ;;
    build_failed | update_failed | canceled | deactivated)
      echo "deploy did not reach 'live' (last state: $state)" >&2
      exit 1
      ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "timed out waiting for deploy (last state: $state)" >&2
      exit 1
    fi
    sleep 10
  done
  ;;
deploy)
  "$0" trigger "$svc"
  exec "$0" wait "$svc" "${3:-900}"
  ;;
logs)
  n=${3:-40}
  owner=$(api "$base/owners?limit=1" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["owner"]["id"])')
  api -G "$base/logs" --data-urlencode "ownerId=$owner" \
    --data-urlencode "resource=$svc" --data-urlencode "limit=$n" |
    python3 -c '
import json, sys
d = json.load(sys.stdin)
for line in (d.get("logs") or []):
    print(line.get("timestamp", "")[11:19], (line.get("message") or "").rstrip())'
  ;;
*)
  echo "unknown command: $cmd" >&2
  exit 2
  ;;
esac

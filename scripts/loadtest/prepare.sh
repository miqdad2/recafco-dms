#!/bin/sh
# Brings the DEV dataset back to the same state before a load test run:
# permanently deletes documents uploaded by earlier runs (labels "LTUP ..."),
# then waits until Mayan's processing queues are empty (event recording
# included). Prints the dataset status at the end.
# Usage: sh scripts/loadtest/prepare.sh   (isolated dev stack only)
set -e
export MSYS_NO_PATHCONV=1
here="$(dirname "$0")"
mayan() {
  docker exec -u mayan recafco-dms-dev-app-1 /opt/mayan-edms/bin/mayan-edms.py recafco_loadtest "$@" 2>/dev/null | tail -1
}
echo "purge: $(mayan purge-uploads)"
# Mayan queues ~20 search-index tasks per deleted document; drop the ones
# whose object is gone (see drop-stale-search-tasks.mjs).
node "$here/drop-stale-search-tasks.mjs"
while true; do
  backlog="$(sh "$here/backlog.sh")"
  total=0
  for kv in $backlog; do total=$((total + ${kv#*=})); done
  [ "$total" -eq 0 ] && break
  echo "$(date +%T) waiting: $backlog"
  sleep 20
done
echo "status: $(mayan status)"

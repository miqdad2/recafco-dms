#!/bin/sh
# Brings the DEV stack back to the same state before every load test run:
# 1. permanently deletes documents uploaded by earlier runs ("LTUP ..."),
# 2. stops the dev Mayan app container, hands every task its workers held
#    back to the queues and drops search-index tasks for deleted objects
#    (see drop-stale-search-tasks.mjs), then starts it again: fresh
#    processes for every run,
# 3. waits until the queues AND held tasks are 0 on 3 checks 30 s apart
#    (longer than Mayan's longest retry back-off, 60 s), dropping stale
#    tasks on every check.
# Usage: sh scripts/loadtest/prepare.sh   (isolated dev stack only)
set -e
export MSYS_NO_PATHCONV=1
here="$(dirname "$0")"
mayan() {
  docker exec -u mayan recafco-dms-dev-app-1 /opt/mayan-edms/bin/mayan-edms.py recafco_loadtest "$@" 2>/dev/null | tail -1
}
echo "purge: $(mayan purge-uploads)"
docker stop recafco-dms-dev-app-1 > /dev/null
node "$here/drop-stale-search-tasks.mjs" --restore-unacked
docker start recafco-dms-dev-app-1 > /dev/null
until [ "$(docker inspect -f '{{.State.Health.Status}}' recafco-dms-dev-app-1)" = healthy ]; do sleep 5; done
echo "$(date +%T) app started"
quiet=0
while [ "$quiet" -lt 3 ]; do
  node "$here/drop-stale-search-tasks.mjs" > /dev/null
  backlog="$(sh "$here/backlog.sh")"
  if [ -z "$(echo "$backlog" | tr -d ' ')" ]; then quiet=$((quiet + 1)); else quiet=0; echo "$(date +%T) waiting: $backlog"; fi
  sleep 30
done
echo "$(date +%T) quiet"
echo "status: $(mayan status)"

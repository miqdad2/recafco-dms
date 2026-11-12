#!/bin/sh
# One comparison phase (e.g. "before" or "after") on the DEV stack:
# the same query probe and the same three seeded workloads, each starting
# from the same dataset with empty processing queues.
#   sh scripts/loadtest/compare.sh before
# Needs: the portal production build on 127.0.0.1:3107, the dev Mayan up.
set -e
export MSYS_NO_PATHCONV=1
phase="${1:?usage: compare.sh <phase>}"
here="$(dirname "$0")"
state="$here/.state"
stamp="$(date +%Y-%m-%dT%H-%M-%S)"

sh "$here/prepare.sh"
for user in lt_emp_001 dev_admin; do
  out="$state/queries-$phase-$user-$stamp.json"
  [ -e "$out" ] && { echo "refusing to overwrite $out"; exit 1; }
  docker exec -u mayan recafco-dms-dev-app-1 /opt/mayan-edms/bin/mayan-edms.py \
    recafco_loadtest queries --username "$user" 2>/dev/null | tail -1 > "$out"
  echo "query probe: $out"
done

node "$here/run.mjs" --label "$phase-search" --mix search --stages 1,5,10 --stage-seconds 45 --login-burst 10 --seed 1
sh "$here/prepare.sh"
node "$here/run.mjs" --label "$phase-read" --mix read --stages 1,10,20 --stage-seconds 60 --login-burst 20 --seed 1
sh "$here/prepare.sh"
node "$here/run.mjs" --label "$phase-mixed" --mix mixed --stages 1,5,10,20,40 --stage-seconds 60 --login-burst 20 --seed 1
echo "phase $phase done"

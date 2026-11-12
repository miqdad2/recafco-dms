#!/bin/sh
# Creates (or resets) the 60 synthetic load-test employees lt_emp_001..060 in
# the isolated DEV stack. The password is generated once into
# scripts/loadtest/.state/state.json (git-ignored) and is never printed.
set -e
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
mkdir -p .state
node -e "
const fs = require('fs'), crypto = require('crypto');
const file = '.state/state.json';
if (!fs.existsSync(file)) {
  fs.writeFileSync(file, JSON.stringify({ password: crypto.randomBytes(18).toString('base64url') + 'aA1!' }), { mode: 0o600 });
}"
RECAFCO_LOADTEST_PASSWORD="$(node -p "require('./.state/state.json').password")"
export RECAFCO_LOADTEST_PASSWORD
cd ../../deploy/dev
docker compose --project-name recafco-dms-dev --file compose.yaml exec -T \
  -e RECAFCO_LOADTEST_PASSWORD --user mayan app \
  /opt/mayan-edms/bin/mayan-edms.py recafco_loadtest users --count "${1:-60}"

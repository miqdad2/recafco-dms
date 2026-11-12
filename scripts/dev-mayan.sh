#!/bin/sh
# Run a Mayan management command in the isolated DEV stack as the "mayan"
# user. Usage: scripts/dev-mayan.sh <command> [args...]
# Example: scripts/dev-mayan.sh recafco_dev users
# RECAFCO_TEST_PROJECT=recafco-dms-test selects the separate test stack
# (same compose file, own volumes; see docs/setup.md).
set -e
# Stop Git Bash on Windows from rewriting /opt/... into a Windows path.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../deploy/dev"
exec docker compose --project-name "${RECAFCO_TEST_PROJECT:-recafco-dms-dev}" --file compose.yaml \
  exec -T --user mayan app /opt/mayan-edms/bin/mayan-edms.py "$@"

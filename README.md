# RECAFCO DMS Employee Portal

A simple employee interface for RECAFCO's document management system
(Mayan EDMS 4.12.2). Employees sign in with their own account, browse
documents by department, search one department or all of them, upload with a
department and category, preview, download, keep favorites and see their own
uploads. RECAFCO administrators manage departments, categories, users and
roles, Department controllers, document details and ownership, and
confidential groups in a separate Administration area. Mayan enforces every permission; the portal never
uses an admin account for employee requests.

| Part | Path |
|---|---|
| Employee portal (Next.js 16, TypeScript, Tailwind) | `portal/` |
| Mayan extension (Django app, no core changes) | `mayan-extensions/recafco_dms/` |
| Isolated development stack | `deploy/dev/compose.yaml` |
| Permission model | `docs/permission-model.md` |
| Decisions (confirmed by RECAFCO, and technical) | `docs/decisions.md` |
| Unit reports (results, gaps) | `docs/unit-1-report.md`, `docs/unit-2-report.md`, `docs/unit-3-report.md` |
| Screenshots | `docs/screenshots/unit-2/`, `docs/screenshots/unit-3/` |

Status: **Unit 3 (upload reliability, confidential documents, durable sessions), development only.** Not deployed.

## Run it locally (Windows, Docker Desktop, Node 24, Git Bash)

The dev stack is a separate Compose project (`recafco-dms-dev`) with its own
volumes, listening on `127.0.0.1:8091`. It does not touch the existing Mayan
installation on port 80.

```sh
cd recafco-dms-portal

# 1. Generate development secrets (deploy/dev/.env and portal/.env.local).
#    Values are random and never printed. Existing values are never changed;
#    missing keys (e.g. a new dev user) are appended.
node scripts/dev-env.mjs

# 2. Start the dev Mayan stack (first start: ~3 minutes for initial setup).
docker compose --project-name recafco-dms-dev -f deploy/dev/compose.yaml up -d
docker inspect -f '{{.State.Health.Status}}' recafco-dms-dev-app-1   # wait for "healthy"

# 3. Create the extension tables, then the document types, roles, groups and
#    ACLs. --departments/--categories only ADD missing names (first run: the
#    existing Mayan lookup values are imported). After that, manage them in
#    the portal: Administration > Departments / Categories.
#    The department list below is a DEV SAMPLE; RECAFCO's real list is pending.
sh scripts/dev-mayan.sh migrate recafco_dms
sh scripts/dev-mayan.sh recafco_setup \
  --departments "Finance (dev sample),Procurement (dev sample),Projects (dev sample),Production (dev sample)" \
  --categories "Purchase order,Bill,Invoice,Other"

# 4. Create the four dev users (passwords come from deploy/dev/.env).
sh scripts/dev-mayan.sh recafco_dev users

# 5. Run the portal.
cd portal
npm ci
npm run build
npm start -- -p 3107 -H 127.0.0.1      # http://127.0.0.1:3107
```

Dev users: `dev_employee_a`, `dev_employee_b` (employees), `dev_controller`
(member of the original confidential group), `dev_admin` (employee and RECAFCO
administrator). Their passwords are in
`deploy/dev/.env` (git ignored).

`npm run build` produces a production build, and production builds mark the
session cookie `Secure`. Browsers accept that on `localhost`/`127.0.0.1`. To
test from another computer over plain HTTP, set `PORTAL_COOKIE_SECURE=false`
in `portal/.env.local` (development only).

## Tests

```sh
cd portal
npm run typecheck && npm run lint
npm run test:unit            # session expiry rules, no Docker needed
npm run build
npm run test:integration     # needs the dev stack; starts the portal itself
```

Screenshots (portal running on 127.0.0.1:3107, Microsoft Edge installed):

```sh
node scripts/screenshots.mjs docs/screenshots/unit-2
node scripts/screenshots-unit3.mjs docs/screenshots/unit-3   # confidential upload, upload recovery
```

The integration tests reset the four dev users, create test documents in the
dev stack, temporarily disable or remove a dev user, and restore them.

## Portal configuration (`portal/.env.local`)

| Variable | Default | Meaning |
|---|---|---|
| `MAYAN_URL` | — | Mayan base URL, reachable from the portal server only |
| `PORTAL_SESSION_IDLE_MINUTES` | 30 | Sign out after this long without activity |
| `PORTAL_SESSION_ABSOLUTE_HOURS` | 8 | Sign out after this long regardless |
| `PORTAL_MAX_UPLOAD_MB` | 50 | Largest accepted upload |
| `PORTAL_COOKIE_SECURE` | `true` in production builds | `Secure` flag on the session cookie |
| `PORTAL_SESSION_KEY` | — (required) | 64 hex characters. Encrypts Mayan tokens in the session database. Keep secret; changing it signs everyone out |
| `PORTAL_SESSION_DB` | `portal/.data/sessions.sqlite` | Session database (SQLite). Back it up with the server; it holds only hashed session IDs and encrypted tokens |

## Stopping or removing the dev stack

```sh
docker compose --project-name recafco-dms-dev -f deploy/dev/compose.yaml stop
# Removing dev data (only the recafco-dms-dev_* volumes) is a separate,
# deliberate step: add "down -v" yourself. Never run it against the "mayan" project.
```

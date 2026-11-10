# RECAFCO DMS Employee Portal — project instructions

These instructions apply to this repository (`recafco-dms-portal`) and take
precedence over any CLAUDE.md in parent folders.

## Scope: this is the DMS, not the FMP

`Downloads/CLAUDE.md` and `Downloads/context/*.md` describe a **different
product**: the RECAFCO Factory Management Platform (FMP). Their business
requirements, data models, UI registries, build plan and progress tracker do
**not** apply here and must not be treated as DMS requirements. Only the
general engineering rules below are shared.

This repository is the employee interface for RECAFCO's document management
system, built on Mayan EDMS 4.12.2:

- `portal/`: Next.js 16 + TypeScript + Tailwind employee portal.
- `mayan-extensions/recafco_dms/`: a small Django app loaded into Mayan via
  `COMMON_EXTRA_APPS`. Mayan core is never modified.
- `deploy/dev/`: isolated development stack for integration tests.
- `docs/`: decisions, permission model, unit reports, progress.

`Downloads/RECAFCO_DMS/` is the extracted Mayan source, kept **read-only as a
reference**. It matches the `mayanedms/mayanedms:s4.12` image byte for byte
(line endings aside). Do not edit it.

## Business rules confirmed by RECAFCO (do not invent others)

1. Departments organize documents; they do not restrict general access.
2. Department and category are separate concepts.
3. General documents (including purchase orders, bills and invoices) are
   visible to all authenticated employees.
4. Confidential documents have explicit restricted access, enforced by Mayan.
5. Pilot uses individual local Mayan accounts.
6. Uploader ownership is recorded by the `recafco_dms` extension.
7. Mayan core source stays unchanged.

The actual list of departments and categories has **not** been supplied.
Values ending in "(dev sample)" are placeholders for tests only.

## Permanent engineering rules

- Production software. SAP Business One stays authoritative for SAP-owned
  records; nothing here writes to SAP.
- Never change, restart, or reconfigure the existing Mayan installation
  (Compose project `mayan`, `C:\Users\5857\Desktop\mayan-dms`, port 80)
  without explicit approval. Never delete its volumes.
- Use only the isolated dev project `recafco-dms-dev` (port 8091, own
  volumes) for mutation tests.
- Never stop all Node.js processes globally; stop a process by its own PID.
- Never reset, reseed, truncate, drop or recreate a production database.
- Never display credentials, tokens or `.env` contents.
- Do not affect AuditFlow IMS or other existing systems.
- Work on one numbered unit at a time; stop after the unit report.
- Update `docs/progress.md` after each meaningful change.

## Security invariants (tested; do not weaken)

- Employees have **no global Mayan permissions**. All access is via ACLs on
  the document types `RECAFCO General` / `RECAFCO Confidential`
  (see `docs/permission-model.md`). `recafco_setup` refuses to run if the
  employee role has any global permission.
- Confidentiality = document type. Per-document ACLs cannot remove inherited
  access, so never model confidentiality as an ACL on a general document.
- Every portal call to Mayan uses the signed-in employee's own token. No
  service or admin account for employee requests.
- Mayan tokens never reach the browser; the browser holds only an opaque
  session ID (server-side session store).
- Extension views must set `permission_classes = (IsAuthenticated,)`:
  Mayan's DRF config has no default permission class.
- Do not add `proxy.ts`/middleware to the portal: it buffers and silently
  truncates request bodies above 10 MB.
- Uploads go only through `POST /api/v4/recafco/uploads/`, which creates the
  document, required metadata, uploader record and file in one transaction.

## Commands

```sh
node scripts/dev-env.mjs                       # create dev secrets (never printed)
docker compose --project-name recafco-dms-dev -f deploy/dev/compose.yaml up -d
sh scripts/dev-mayan.sh <management command>   # run inside the dev Mayan
cd portal && npm run typecheck && npm run lint && npm run test:unit
cd portal && npm run build && npm run test:integration
```

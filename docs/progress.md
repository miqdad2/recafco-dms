# Progress

## Unit 0 — Read-only assessment (2026-11-10) — done

- Source `RECAFCO_DMS` = Mayan 4.12.2 build `v4.12.2-39-g16850d008cb`,
  identical to the running image `mayanedms/mayanedms:s4.12` (1,783 Python
  files compared, line endings aside). Docker does not use the source folder.
- REST API v4 (233 paths) covers upload, metadata, search, preview,
  download, versions and ACLs. Auth: session, token, basic.

## Unit 1 — Prove the portal integration (2026-11-10) — done, awaiting review

- Sibling repo `recafco-dms-portal` created; project CLAUDE.md separates DMS
  from FMP instructions.
- Isolated dev stack `recafco-dms-dev` (127.0.0.1:8091, own volumes,
  memory-capped). Existing `mayan` project untouched.
- Extension `recafco_dms`: atomic upload endpoint, uploader ownership
  (`PortalUpload`), processing state, ACL-checked summaries, My uploads,
  token revoke, `recafco_setup` (permission model) and `recafco_dev`
  (dev-only fixtures, guarded by `RECAFCO_DEV_FIXTURES=1`).
- Permission model tested: see `docs/permission-model.md`.
- Portal: sign in, home, upload (progress, field errors), document page
  (status polling, preview, download), search, My uploads, sign out.
  Server-side sessions; Mayan token never sent to the browser.
- Tests: 5/5 unit, 65/65 integration (two consecutive full runs).
  Results and gaps in `docs/unit-1-report.md`.

## Unit 2 — Department navigation and administration (2026-11-10) — done, awaiting review

- Confirmed with RECAFCO: upload into any active department (uploader and
  date shown); Department controllers correct title/category/department
  within their departments. See `docs/decisions.md`.
- Extension: `Department`, `Category`, `DocumentClassification`,
  `DepartmentAssignment`, `ControllerAssignment`, `ConfidentialAccessGroup`,
  `AuditEntry` (migration 0002). Department list/counts/documents/scoped
  search, favorites, document details correction, and `/recafco/admin/`
  endpoints (administrators only). `recafco_setup` seeds-only, registers the
  original confidential group, backfills classifications.
- Portal: department home, department page, upload preselection, favorites,
  redesigned document page and shell, Administration area (departments,
  categories, users and roles, controllers, confidential groups, documents,
  activity log).
- Tests and screenshots: see `docs/unit-2-report.md`.

Next unit: not started. Waiting for review and RECAFCO decisions (see report).

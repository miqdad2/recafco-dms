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

## Unit 3 — Upload reliability and confidential documents (2026-11-10) — done, awaiting review

Completed
- Idempotent uploads: user-scoped operation IDs (required), replay of the
  first result, 409 on reuse with different content, concurrent retries →
  one document, dead attempts taken over, stored files of failed uploads
  deleted, recovery status endpoint and upload-page recovery states.
- Confidential handling: administrator-only confidential upload to an
  explicit group; reclassification needs admin authority and current access;
  no release to general; immediate loss of access everywhere, including
  existing sessions; downloaded-copies warning.
- Original uploader immutable; responsibility transfer replaces Unit 2's
  overwrite; migration 0004 restored 3 overwritten dev documents from the
  audit log.
- Sessions were in memory → now durable (SQLite, hashed IDs, encrypted
  tokens), tested across processes and restarts.
- Intermittent write failure investigated: dropped before processing on a
  reused keep-alive connection (evidence in report); targeted proxy test for
  drops before processing and after commit.
- Tests: 10/10 unit, 159/159 integration (final full run).

Remaining gaps (explicit; details in docs/unit-3-report.md)
- RECAFCO decisions: release to general; administrators adding themselves to
  groups; real departments, categories and memberships.
- Exact trigger of the keep-alive drop not isolated; portal HTTP client
  keep-alive not shortened (would need the undici package).
- Upload operation retention/cleanup; multi-server session store.

## Unit 4 — Local username/password accounts (2026-11-11) — done, awaiting review

Completed
- Administrator creates accounts with a username (lower case, unique ignoring
  case, numeric employee IDs allowed) and a simple temporary password ("123").
- Temporary password must be replaced at first sign-in and after every admin
  reset; until then only password change and sign-out work, in the portal and
  on direct Mayan access (token, HTTP Basic, web session) via
  `PasswordPolicyMiddleware` (Mayan settings hook, no core change).
- Personal passwords ≥ 6 characters, no character types; own change needs the
  current password and signs out other devices; admin reset revokes portal
  sessions, API token and Mayan web sessions and clears the lockout.
- Mayan's self-service `/users/current/` writes (password change without the
  current one, rename, delete) and web password change are refused for
  RECAFCO accounts (bypass found and fixed).
- Lockout per username (5 failures / 15 min) plus 10 sign-ins per minute per
  username in the database; no per-IP limit, so one locked username does not
  block the office.
- Show/hide password controls on sign-in, change password and admin forms.
- Tests: 13/13 unit, 174/174 integration (15 new). Screenshots in
  `docs/screenshots/unit-4/`. Report: `docs/unit-4-report.md`.

Remaining gaps (explicit; details in docs/unit-4-report.md)
- **Outside access authorization and additional verification: not
  implemented** (needs RECAFCO decision); sign-in is username + password only.
- Lockout figures and temporary-password expiry not confirmed by RECAFCO.
- Mayan's own login page is case-sensitive; superusers can still set passwords
  in Mayan's own screens without "must change".
- Required Mayan settings documented for production, applied only in dev.

Next unit: not started. Waiting for review.

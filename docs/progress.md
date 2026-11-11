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

## UI refresh — employee portal and administration (2026-11-11) — done, awaiting review

Completed (details: docs/ui-refresh-report.md)
- Skill applied: `frontend-ui-engineering`. Design tokens, persistent desktop
  sidebar, compact header, accessible mobile menu, shared components.
- Home: compact heading, search, one red Upload action, department cards
  with subtle accents, real permission-filtered "Recently uploaded" (new
  narrow endpoint `recafco/documents/recent/`, capped page size, no archive
  count). Inactive departments moved to Search › Department.
- Department/search toolbars, document list (table ≥1280px, cards below),
  upload page (drag-and-drop with native input, title suggestion, truthful
  audience and limits, honest progress), document page, My uploads,
  Favorites, administration with marked "Access change" sections.
- No business-rule change, no migration. Upload recovery, confidentiality,
  permissions and audit behaviour unchanged (tested).
- Tests: 13/13 unit, 178/178 integration. One assertion changed on purpose
  (greeting panel removed). Before/after screenshots at 390/768/1440/1920px
  in `docs/screenshots/ui-refresh/`, none with horizontal scrolling.

Remaining limitations
- No search on My uploads (endpoint has none); no "more" page for Recently
  uploaded; axe-core and screen-reader checks not run; Arabic interface
  language not implemented.

## Login refresh (2026-11-11) — done, awaiting review

- Two-column sign-in on desktop (charcoal RECAFCO panel with decorative
  precast linework, white 432px form panel); form only with a modest logo on
  phones/tablets; no fixed heights. Same layout for the first-login
  password change. UI only: authentication, lockout, sessions, CSRF and
  redirects unchanged; no database or password-policy change.
- Inline field errors, compact sign-in alert, small signed-out status,
  Show/Hide inside the field, "Signing in…" with duplicate submit blocked.
- Verified in Edge at 390/768/1440/1920px, short screens, 200% zoom,
  keyboard, lockout, pending and first login (docs/login-refresh-report.md,
  docs/screenshots/login-refresh/). Tests: 13/13 unit, 178/178 integration.
- Not verified: real password-manager autofill (attributes checked only).
  No temporary-password expiry exists to restyle.

## Login refine (2026-11-11) — done, awaiting review

- 1040px card, 42/58 split, softer charcoal (#343a40), grid removed,
  undistorted logo in a white square, two-line headline above centre.
- "Welcome back" / "Sign in to RECAFCO Documents.", compact status under
  the subtitle, 52px fields, eye-icon toggle inside the field (all password
  fields), new help text. Same layout for first-login password change.
- UI only. Tests: 13/13 unit, 178/178 integration (one assertion updated
  for the icon toggle). Screenshots: docs/screenshots/login-refresh/refined/.

## Login final (2026-11-11) — done, awaiting review

- Trimmed logo artwork (proportions kept) in a 96px tile (72px mobile);
  "Document / Management" beside it; three-line headline, no paragraph;
  1040px card at 39/61, 555px tall at 1440px; warm-grey page; help text
  under the button without divider; autofill restyled for readability.
- "Signed out" shown only after a real sign-out (one-time cookie), not on
  reload or a typed ?signedout=1.
- Tests: unit 13/13. Integration: full runs had intermittent failures
  (05 setup once; three ECONNRESET drops once, in tests that do not touch
  the login page); each affected file passed when rerun (05: 63/63,
  06+09: 30/30). Known keep-alive drop, trigger still not isolated; dev
  Mayan near its memory limit after Docker restart.

## Sticky toolbar (2026-11-11) — done, awaiting review

- Departments home: Recently uploaded section and its request removed
  (extension endpoint kept, now unused by the portal).
- Sticky search/category/Upload toolbar on home and department pages,
  directly under the header; relaxed on short screens, 200% zoom and phones
  where it would cover too much (department page on phones).
- Verified at 390/768/1440/1920px, zoom, keyboard, focus, search state.
  Tests: unit 13/13, integration 178/178 (after restarting the dev Mayan,
  which was near its memory limit; one earlier run had one 403).

## Sidebar logo badge (2026-11-11) — done, awaiting review

- App sidebar/header only (login unchanged): complete logo (cropped mark,
  Arabic name and "Since 1976" kept) in a white circular badge, 1px light
  border, very soft shadow, 9px padding, object-fit contain. 64px in the
  desktop sidebar, 52px in the phone/tablet header; "RECAFCO / Documents"
  beside it, 12px gap, vertically centred (text hidden below 380px wide).
- Verified at 1440/820/390/360px: no horizontal scroll, menu and nav links
  unchanged. Tests: typecheck, lint, unit 13/13.

Next unit: not started. Waiting for review.

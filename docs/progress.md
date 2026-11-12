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

## Department cards (2026-11-11) — done, awaiting review

- Departments home cards: white, 12px radius, 20px padding; 48px soft icon,
  18px semibold name (wraps, never clipped; dir=auto for Arabic), count,
  small separate SAMPLE / Your department badges; outlined neutral
  "View documents" action (44px) pinned to the card bottom so actions align
  across each row. Names unchanged (dev suffixes kept).
- Each card is one link; the action is decoration (aria-hidden), so one tab
  stop per card and the link name starts with the department name. Hover:
  border and soft shadow only, no movement. Default focus outline.
- Grid columns from available width (min 17rem): 3 on desktop, 2 on tablets
  and at 200% zoom, 1 on phones. Sticky toolbar and navigation unchanged.
- Verified at 1440/1280/820/390/320px and 200% zoom, with long English,
  Arabic and unbroken names and 0 to 1,048,576 counts (injected into the
  rendered page only; no data changed). Keyboard: Tab reaches the card,
  Enter opens it. Screenshots: docs/screenshots/department-cards/.
  Tests: typecheck, lint, unit 13/13, integration 04+10: 28/28.

## Favicon (2026-11-11) — done, awaiting review

- Favicon replaced with the complete original logo (trimmed of empty margin
  only, proportions kept, Arabic and "Since 1976" included) centred on an
  opaque white square with 1-2px padding: portal/src/app/favicon.ico (16, 32,
  48; RGBA PNG entries, alpha 255 everywhere) and portal/src/app/apple-icon.png
  (180, 10px padding). Next.js file conventions emit the <link> tags; no
  metadata.icons, no other icon files. Rebuild: node scripts/make-favicons.mjs.
- Verified: both assets 200 with hashed URLs, decoded by Edge at 16/32/48/180,
  no 4xx among 132 responses across five pages. Headless Edge has no tab strip;
  the tab is simulated in docs/screenshots/favicon/icons-in-browser.png.
  Sidebar, login and other branding unchanged. Tests: typecheck, lint, build,
  unit 13/13.

- Revised: favicon.ico is now a white circle (transparent outside, faint
  #d8dbdf ring so it shows on white tabs) with the whole logo inside; logo
  width 76% of the diameter so its corners sit just inside the circle. Drawn
  at 1024 px and scaled down. apple-icon.png stays a white square (iOS masks
  it itself and would turn transparent corners black). Verified: served file
  matches, Edge decodes all sizes, no 4xx among 122 responses. Preview on
  light and dark: docs/screenshots/favicon/round-preview.png.

## Unit 5 — Full application control for administrators (2026-11-11) — done, awaiting review

- Changed policy (RECAFCO): administrators may delete, open every document
  (general and confidential) and release confidential documents to general
  by an explicit action. Recorded in docs/decisions.md.
- Delete/merge for departments, categories, accounts (attribution kept),
  roles and confidential groups; application roles with grantable
  permissions and a protected System Administrator role; recycle bin,
  restore and verified permanent deletion; bulk document actions;
  append-only activity log with reason, outcome, filters and CSV export.
- Admin document access through one Mayan role's ACLs; still no global
  permissions. Employees and controllers unchanged (tested).
- Found during browser verification and fixed: success messages lost for
  bulk and recycle-bin actions, CSV export 502, write requests failing on a
  closed keep-alive connection (writes now use a new connection; undici 7.30.2).
- Tests, screenshots, gaps: docs/unit-5-report.md.

Next unit: not started. Waiting for review.

## Performance assessment (2026-11-12) — done, awaiting review

- Branch `perf-assessment`. Dev stack only; no application code changed,
  nothing deployed. Report: `docs/performance-report.md`.
- Repeatable load test: `recafco_loadtest` (dev-only fixtures and query
  probe), `scripts/loadtest/` (driver, summary, backlog, setup), tuned Mayan
  profile `deploy/dev/compose.loadtest-tuned.yaml` for comparison.
- Dataset 2,690 documents (2,000 synthetic), 60 synthetic employees.
  Mixed workload on one 4-core laptop: ~5.5 req/s at saturation (tuned);
  read-only ~25 req/s; search alone ~2.5/s. 0 errors, 0 cross-user leaks.
- Measured bottlenecks: search (two calls, 264 + 63 queries), simultaneous
  Gunicorn worker recycling (~30 s stalls), Mayan memory ceiling at 2.5 GiB,
  listing N+1 (~3 queries per document), OCR throughput, sign-in hashing.
  Targeted fixes listed in the report; none implemented yet.

## Search and list-query optimizations (2026-11-12) — done, awaiting review

- `recafco/search/`: Mayan's own search in one call with summaries (same
  results, count, title order, pages, permission checks). Lists build page
  facts per list (`PageInfo`), not per document. Commit `31f33a0`.
- Query counts: department list 65 → 7, summaries 63 → 5, My uploads (50)
  163 → 5, company-wide search 264 + 63 (two calls) → 9 (one call).
- Directly comparable load test (round 2, same dataset, settings, seed and
  procedure): company-wide search ~2–3× faster at the median, mixed workload
  2–3× throughput at 5–10 VUs; read-only browsing unchanged within noise.
  0 errors, 0 leaks. A contaminated round-1 "after" phase is kept and marked.
- New regression tests `12-search-and-lists`; full suite on a separate test
  stack 222/223 (the failure is a timing-dependent rate-limit test, 09,
  unrelated to these changes; it passes alone).
- Not changed: worker/memory settings (dev experiment only), OCR policy,
  password hashing. Not deployed.

## Performance branch release checkpoint (2026-11-12) — done, awaiting review

- Sign-in limit test made deterministic: starts in a fresh server minute
  (Mayan's `Date` header), checks all 11 answers fall into it and the next
  minute's reset; plus a fixed-clock boundary test of the real limiter.
  Production limit unchanged (10 per username per calendar minute).
- Stray `portal/portal/.next` (generated Turbopack output only) removed;
  `turbopack.root`/`outputFileTracingRoot` pinned to the portal folder,
  ESLint ignores `.next` at any depth.
- Deletion backlog diagnosed: ~39 distinct index tasks per deleted
  document, each retried while its target is missing (20 documents: 780
  tasks, 5,252 attempts in 15 min, 812 pending). Fix in the extension
  (tombstones, migration 0009, Celery `add_around` on Mayan's task):
  each runs once, nothing pending after 17 s; missing objects without a
  tombstone are still retried. Mayan's code unchanged.
- Verification: typecheck, lint, build clean; unit 13/13; complete
  integration suite on the separate test stack 228/228.

## Dev backend reachable for the manager demonstration (2026-11-12)

- `deploy/dev/compose.yaml`: `MAYAN_ALLOWED_HOSTS` now comes from
  `RECAFCO_DEV_ALLOWED_HOSTS` (default unchanged: localhost, 127.0.0.1).
  The demonstration value (adds the laptop's LAN address, no wildcard) is
  only in the git-ignored `deploy/dev/.env`; `.env.example` documents the key.
- Only the `recafco-dms-dev` app container was recreated (`--no-deps`);
  database, Redis, volumes and the original Mayan were not restarted.
- Verified: local API 200; Host `192.168.1.214:8093` 200 (direct and through
  the laptop's port proxy); unlisted hosts still 400; RECAFCO sign-in,
  departments and search work through the LAN address.

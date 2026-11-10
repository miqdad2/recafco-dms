# Unit 2 report — Department navigation and RECAFCO administration

Date: 2026-11-10 · Environment: isolated dev stack (`recafco-dms-dev`, port
8091) only · **Not deployed.** The existing Mayan installation (Compose project
`mayan`, port 80) was not touched.

## Starting point

Unit 1 was complete (65/65 integration tests). **No Unit 2 work existed.**
There was also no upload idempotency work to preserve; that is still an open
gap (see below). All Unit 1 behavior is kept and its tests still pass.

## Decisions confirmed by RECAFCO during this unit

1. Employees may upload into **any active department**. The uploader's name
   and the upload date are shown next to the document.
2. **Department controllers** may, in their permitted departments, upload and
   correct a document's **title, category and department**, moving it only
   between their own departments. They are not administrators.

Details and the technical decisions they led to: `docs/decisions.md`.

## Completed features

### Employee side
- **Department home** after sign-in: RECAFCO header, account menu (name,
  sign out), large "Search all documents" box, "Upload documents" button,
  My uploads / Favorites shortcuts, and a responsive grid of department cards
  (icon, name, number of documents *this user* can open, "Sample name" badge,
  "Your department" badge). Deactivated departments that still hold documents
  appear in a collapsed "no longer in use" list.
- **Department page** `/departments/[id]`: breadcrumb, name, upload button
  (only with upload permission and only for active departments), search
  limited to this department, category filter, newest-first list with
  pagination. Rows show title, category, uploader, date, file type and
  processing status, with Open and Download. Empty, no-results, processing,
  loading (streamed list) and error states. Unknown department → 404.
- **Company-wide search** kept (`/search`), now shows the department.
- **Upload** opened from a department preselects it; the server accepts only
  active departments and categories.
- **Document page**: breadcrumb back to its department, uploader and upload
  date beside the preview, Download, Add/Remove favorite, and (for
  controllers/administrators) "Correct the details".
- **Favorites** page and toggle (built on Mayan's favorites table, access
  re-checked).
- Wider layout (up to 1440 px), table on desktop, cards on phones, 18 px base
  text, 48–64 px controls, restrained red accents, plain wording.

### Administration (`/admin`, RECAFCO administrators only)
| Area | What works |
|---|---|
| Departments | create, rename (documents and Mayan metadata follow), change icon, mark as sample, reorder (up/down), deactivate/reactivate; shows controllers and document totals |
| Categories | create, rename (documents follow), deactivate/reactivate |
| Users and roles | find, create (username, first password, names, email), roles Employee / Administrator, assigned departments, Department-controller departments, deactivate/reactivate (signs the user out everywhere), set a new password |
| Department controllers | assigned per user ("Department controller for"); listed per department |
| Confidential groups | create (new protected document type + role + group with read-only ACL), rename, add/remove members |
| Documents | find by title or number, correct title/department/category, change the recorded uploader, change history |
| Activity log | every administration change, append-only |

Safeguards: nothing is deleted; administrators cannot deactivate themselves or
remove their own admin role; Mayan superuser/staff accounts are hidden and
cannot be changed here; server and database operations are not in this area.
Success messages appear only after the extension confirms the change.

## How authorization is enforced (server side)

- Every extension view: `IsAuthenticated`; every `/recafco/admin/` view adds
  `IsPortalAdmin` (membership of **RECAFCO Administrators**, checked on each
  request). `urls.py` refuses to load if any admin route lacks it.
- The administrators group carries **no Mayan role or permission**;
  `recafco_setup` refuses to run otherwise. RECAFCO roles still have **no
  global Mayan permissions**.
- Cards, counts, lists, department search, previews and admin document lists
  all start from Mayan's ACL-filtered document set for the caller.
  An administrator who is not in a confidential group sees none of its
  documents (tested).
- Portal pages under `/admin` re-check the role; the portal calls Mayan with
  the user's own token; the token never reaches the browser.

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (0 warnings) |
| `npm run test:unit` | 5/5 |
| `npm run build` | clean |
| `npm run test:integration` run 1 | 125/127 — (a) a test regex did not allow React's `<!-- -->` marker after "Good afternoon" (test fixed); (b) one Unit 1 test hit a dropped keep-alive connection on a write (`other side closed`, Unit 1 finding 8; not retried by design) |
| `npm run test:integration` run 2 (after the regex fix) | **127/127** (≈4.5 min) |
| First Unit 2-only run | 61/62 — found that `loading.tsx` made an unknown department return HTTP 200; fixed by streaming only the list inside `<Suspense>` |
| Screenshots | 24 pages captured; none scrolls sideways at 390 px |

New tests (`05-departments-admin.test.ts`, 62 tests) cover: sign-in lands on
departments; cards open the right department; newest-first, pagination,
category filter; department search scoped vs. company-wide search;
cross-department visibility of general documents; confidential isolation in
counts, lists, search, detail, favorites, portal pages (employee,
administrator, controller); a new confidential group admits only members and
gets an exact ACL; upload preselection; server refusal of unknown/deactivated
departments and categories (and nothing left behind); atomic classification +
metadata + uploader; controller rights and limits; rename/reorder/deactivate
with documents kept; categories; user create/deactivate/reactivate/password;
self-protection; system accounts hidden; owner change with history; admin
form through the portal; 22 admin endpoints refused (403) for employee,
controller and confidential reader and refused for anonymous; employee cannot
grant themselves admin; admin portal pages show no data to employees; a
non-admin posting the admin form changes nothing; favorites.
Unit 1 regression files 01–04 (upload, search, preview, download, sessions,
confidential channels) still pass.

## Screenshots

`docs/screenshots/unit-2/` (desktop 1440 px, phone 390 px), index in
`index.json`. Retake with `node scripts/screenshots.mjs docs/screenshots/unit-2`.
The dev database contains test-run departments; they are deactivated after
each run and appear under "Departments no longer in use".

## Files changed

Extension `mayan-extensions/recafco_dms/`
- `models.py` — Department, Category, DocumentClassification,
  DepartmentAssignment, ControllerAssignment, ConfidentialAccessGroup,
  AuditEntry
- `migrations/0002_departments.py` — new (schema only)
- `access.py` — new (roles, `IsPortalAdmin`)
- `services.py` — classification on upload, department lists/counts/scoped
  search, favorites, details correction, audit
- `admin_services.py`, `admin_api_views.py` — new
- `api_views.py`, `urls.py`, `literals.py`
- `management/commands/recafco_setup.py` — seed-only names, administrators
  group, confidential groups, classification backfill, stricter checks
- `management/commands/recafco_dev.py` — `dev_admin`, `confidential-sample
  --department/--group-id`, `superuser-id`, classification in `find-label`

Portal `portal/`
- `src/app/page.tsx` (department home), `src/app/error.tsx` (new)
- `src/app/departments/[id]/page.tsx`, `department-documents.tsx` (new)
- `src/app/favorites/page.tsx` (new)
- `src/app/upload/page.tsx`, `upload-form.tsx`
- `src/app/documents/[id]/page.tsx`, `actions.ts` (new)
- `src/app/search/page.tsx`, `src/app/my-uploads/page.tsx`, `src/app/actions.ts`
- `src/app/admin/**` (new): `actions.ts`, `admin-shell.tsx`,
  `activity-list.tsx`, `page.tsx`, `activity/`, `departments/`,
  `categories/`, `users/` (`page.tsx`, `new/`, `[id]/`, `user-fields.tsx`),
  `confidential-groups/` (+ `[id]/`), `documents/` (+ `[id]/`)
- `src/components/app-shell.tsx`, `ui.tsx`, `icons.tsx` (new),
  `action-form.tsx` (new)
- `src/lib/mayan.ts`, `auth.ts`, `session-store.ts`, `admin.ts` (new),
  `form-state.ts` (new)
- `tests/integration/05-departments-admin.test.ts` (new), `helpers.ts`,
  `04-portal-journey.test.ts` (home page expectations), `tests/unit/session-store.test.ts`

Other
- `deploy/dev/compose.yaml` (dev admin password variable),
  `scripts/dev-env.mjs` (appends missing keys), `scripts/screenshots.mjs` (new)
- `README.md`, `docs/decisions.md` (new), `docs/permission-model.md`,
  `docs/progress.md`, this report, `docs/screenshots/unit-2/`

## Remaining gaps

**Needs a RECAFCO decision**
- Real department and category lists (current ones are "(dev sample)").
- How documents enter a confidential group: a confidential upload screen, or
  moving a general document into a group (changes its Mayan document type).
  **Not built**, so new confidential groups currently hold only documents
  created by dev fixtures.
- Who belongs to each confidential group and who are the administrators and
  controllers.

**Administration functions for a later unit**
- Deleting or merging departments/categories (deliberately not offered).
- Deactivating or deleting a confidential group; renaming its Mayan objects.
- Bulk user import, password reset by email, forced password change at first
  sign-in, account lockout settings (Mayan's lockout must be by username
  only, Unit 1 note).
- Bulk moving documents between departments; changing a document's access
  level (general ↔ confidential).
- Exporting the activity log; activity log filters.
- Drag-and-drop reordering (up/down buttons today).

**Technical**
- Upload idempotency (duplicate on a retried upload after a dropped reply) is
  still not handled — carried over from Unit 1.
- Renaming a department rewrites each document's metadata value one by one:
  fine for hundreds of documents, slow for many thousands (not measured).
- Mayan search returns at most 1,000 hits per query (Mayan setting), also for
  department search.
- Behind the future reverse proxy, the original `Host` must be forwarded for
  uploads and for Next.js server-action origin checks (admin forms,
  favorites).
- The portal's Administration link uses a role flag refreshed on the home and
  admin pages; authorization itself is always checked by the extension.
- The test-only "other side closed" connection drop (Unit 1 finding 8) can
  still fail a write in a full test run.
- Sessions remain in portal memory (single instance), as in Unit 1.

## To apply on another dev machine

`node scripts/dev-env.mjs` (adds `RECAFCO_DEV_PASSWORD_ADMIN`), then
`docker compose --project-name recafco-dms-dev -f deploy/dev/compose.yaml up -d`
(recreates the dev app; migration 0002 runs on start), then
`sh scripts/dev-mayan.sh recafco_setup` and `sh scripts/dev-mayan.sh recafco_dev users`.

## Environment safety

- `mayan` project containers: untouched (still up since before this unit).
- Dev app container recreated and restarted (dev project only).
- The old Unit 1 portal process (PID 14628, this repo's `next start`) and
  later portal restarts were stopped by their own PID only.
- No production database touched; nothing written to SAP; Mayan core
  unchanged.

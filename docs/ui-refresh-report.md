# UI refresh report — employee portal and administration

Branch `ui-refresh` (from `unit-4-local-auth`). Development stack only. Nothing was deployed. The original Mayan installation was not touched.

## Skill used

`frontend-ui-engineering` (installed at `~/.claude/skills/frontend-ui-engineering`) was read and applied:
- a design contract before building (below);
- semantic tokens, with no raw colours in pages;
- consistent spacing and radius;
- WCAG 2.1 AA: contrast, keyboard access, labels, and status never shown by colour alone;
- mobile-first responsive layouts;
- empty, loading and error states;
- avoiding the "AI look": gradients, oversized cards, heavy shadows, decorative dashboards.

Nothing was installed.

## Design contract (written before implementation)

- **Job of the product:** let ordinary employees, including older and non-technical staff, find, open and add company documents by department.
- **Primary actions:** open a department; search; upload. Exactly one red action per screen: "Upload documents" on the home page, Upload on the department and upload pages, Download on a document.
- **Visual language:**
  - white surfaces on a light grey background, dark text;
  - red only for the primary action, the current navigation item and errors;
  - one 8px radius;
  - no gradients, no decorative shadows, no greeting panel, no dashboard tiles for employees.
- **Type and controls:** 16px body (18px for key names); controls 48px (44px for compact row actions); a visible blue focus ring on everything.
- **Status:** always an icon plus words (Ready / Preparing / No preview / Confidential / Access change), never colour alone.
- **Responsive:** sidebar from 1024px; the document table from 1280px; two-column cards at 768px; single-column cards on phones; no horizontal page scroll.
- **Rejected patterns:**
  - duplicated shortcut buttons;
  - red hover borders (they read as errors);
  - permanent "selected" card styling;
  - fabricated statistics or sample activity;
  - batch-upload wording.

Tokens are in `portal/src/app/globals.css`. Measured contrast: body text 15.8:1, secondary text 6.3:1 (5.75:1 on the page background), red 5.9:1, form borders 3.2:1, and each department accent 5.6–7.9:1 on its tint.

## What changed

**Layout** (`components/app-shell.tsx`, `components/menu-details.tsx`)
- A persistent desktop sidebar with the logo and name, plus Departments, Search documents, My uploads and Favorites. Administration appears only when the session is an administrator; every admin page and endpoint still checks on the server.
- A compact header with the current section and the account menu (Change password, Sign out).
- Phones and tablets get a "Menu" button. It is a native `<details>`, so it works without JavaScript. It closes on navigation and on Escape (focus returns to the button) and on an outside click.
- Consistent page width (`max-w-6xl`), spacing and the skip link.

**Shared components** (`components/ui.tsx`)
- Buttons, fields, labels, help and error text.
- `PageHeader`, `Notice` (with an icon), `StateBadge` (icon plus words), a small neutral `SAMPLE` badge.
- `DepartmentIcon` with six subtle accent tints.
- Document list: the title is the strongest element, with type and size beneath it. Columns: Department · Category, "Uploaded by · Date", Status, then Open and Download. It is a table from 1280px and readable cards below that.
- `dir="auto"` and `overflow-wrap: anywhere` handle long English and Arabic names.

**Home** (`app/page.tsx`)
- A compact "Departments" heading.
- A company-wide search field with a plain Search button, and one red "Upload documents" action.
- The duplicated My uploads / Favorites shortcuts were removed (they are in the navigation).
- Department cards show:
  - the icon in its accent;
  - the name and document count;
  - "Your department" where relevant;
  - a visible "Open ›".
- Hover is a neutral grey with a darker border, never red.
- The sample notice is now one line with the small badge.
- New **Recently uploaded** list (6 items), from real, permission-filtered records (see backend).
- The inactive-department list moved off the home page; administrators manage them under Administration › Departments. Their documents remain reachable through Search › Department ("No longer in use" group). A one-line hint on the home page points there.

**Department page**
- Breadcrumb, then a heading with the accent icon.
- One toolbar: search, category, Search, Clear, and "Upload to this department".
- Pagination and filter state are kept in the URL, as before.

**Search page**
- A new Department filter that includes departments no longer in use.
- Choosing a department without search words lists that department's documents with pagination, which reuses the existing department-scoped search endpoint.
- Without a department, Mayan's full-text search is used, as before.

**Upload page**
- About 830px wide.
- A large drag-and-drop area with a "Browse files" button. The native file input is kept: it is visually hidden but focusable, and the drop area shows its focus ring.
- The selected file shows its name (long Arabic/English names wrap), its size, and Replace / Remove.
- Dropping more than one file is refused with a clear message; there is no batch-upload wording.
- Department and category sit side by side from 768px and stack on phones.
- The title is suggested from the file name until the person edits it.
- The audience box:
  - "Visible to all employees" for general documents;
  - for confidential uploads, "Restricted to *group name*", or "Choose the group above" when none is chosen. General wording is never shown for a confidential upload.
- The real limits are stated: one file, 50 MB, any type, previews for PDFs and images.
- Errors appear beside each field, and selections are kept after validation errors.
- Progress shows a measured percentage, then "Upload sent. Saving the document…" once all bytes are sent.
- The generic "lost your connection" footer was removed. Recovery guidance now appears only in the recovery states.
- All upload, idempotency and recovery logic is unchanged: operation IDs, safe same-ID resend, "Check whether it was saved", and the note kept in the browser.
- Upload is the primary action; Cancel goes back to the department or home.

**My uploads / Favorites**
- Consistent headers and the same document list.
- Empty states are honest:
  - My uploads: an explanation and "Upload documents";
  - Favorites: how to add a favorite and "Browse departments".
- My uploads has no search, because its endpoint has none.

**Document page**
- Title (with `dir="auto"`) and status, with **Download** (red) and **Add to favorites** in the page header.
- The preview is on the left. On the right are separate panels: "Document information" (department, category, access, original uploader, date, responsible person) and "File" (name, type, size, pages).
- "Correct the details" stays a separate collapsible panel, for controllers and administrators only.
- There is no "versions" list: the portal does not implement one, so none is shown.

**Administration**
- The same design system. Section links are a wrapping tab row under the main navigation.
- Access-changing sections are marked "Access change" with a lock icon and an amber border, so they are distinct from ordinary edits:
  - password reset;
  - deactivation;
  - confidential group membership;
  - making a document confidential.
- Overview numbers are smaller, and red hovers were removed.
- All forms keep their labels, server validation and saved/error messages (`ActionForm`).

**Backend** (no migration, no business-rule change)
- New `GET /api/v4/recafco/documents/recent/?page=&page_size=` for the home list.
- It requires sign-in, filters through Mayan's ACLs (`get_accessible_documents`), and returns newest first.
- Page size defaults to 8 and is capped at 20. It reads one row past the page to set `has_more`, and never counts or loads the whole archive.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- Unit tests: 13/13.
- Integration tests: **178/178** (10 files) against the dev stack. The
  known intermittent dropped connection (Unit 3) happened once and was
  completed by the safe same-ID resend. A new `10-recent-documents.test.ts` covers sign-in being required, confidential documents hidden from non-members but shown to members, newest-first order, the page-size cap and pagination, and the home page list.
- **One existing assertion changed on purpose.** `04-portal-journey` checked for the "Good morning/afternoon/evening" greeting, which this brief removes. It now checks the "Departments" heading and the user's name. No other test was changed.
- Real browser (headless Microsoft Edge), 34 screenshots in `docs/screenshots/ui-refresh/after/` at 390, 768, 1440 and 1920px. None has horizontal scrolling (`index.json`). States covered:
  - keyboard focus ring (Tab);
  - mobile menu open;
  - department list populated and filtered-empty;
  - search start and results;
  - upload: empty, validation errors, a long Arabic/English file name selected, the uploaded document with that long title, confidential with the group chosen;
  - My uploads, Favorites;
  - admin overview, users, a user's access-change panels, departments, a document's reclassification.
- Upload recovery in the redesigned form was driven for real in the browser (`scripts/screenshots-unit3.mjs`, which really loses the server's reply): "We are not sure…", "We could not confirm your upload" with the safe resend, the banner after a reload, and "Check whether it was saved" opening the saved document with no copy made. Confidential upload and its receipt were checked the same way. Screenshots: `docs/screenshots/ui-refresh/after/recovery/`.
- `docs/screenshots/ui-refresh/before/` holds 25 screenshots of the previous design for comparison.

## Remaining limitations

- My uploads has no search field (its endpoint does not support one).
- The Recently uploaded list on the home page has no "more" page; full browsing is through departments and Search.
- At 1024–1279px documents appear as cards, not a table, because the table needs more width beside the sidebar.
- Contrast was measured from the tokens. An automated axe-core scan was not run (it is not installed, and nothing was installed). Keyboard order and focus were checked in the browser on the home page, but not with a screen reader.
- The Arabic interface language is not implemented. Only Arabic *content* (titles, file names) is handled.
- Mayan's own web interface is unchanged.

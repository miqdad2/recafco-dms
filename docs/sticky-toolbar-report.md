# Sticky toolbar and Departments home refinement

Branch `sticky-toolbar` (from `login-final`). UI only: no backend, permission or business-rule change; nothing was deployed. This applies the installed `frontend-ui-engineering` skill.

## Changes

**Departments home (`app/page.tsx`)**
- The "Recently uploaded" section and its request were removed. The page now makes two calls: roles and departments.
- The portal's `getRecentDocuments` client function was removed because nothing used it any more.
- The extension endpoint `GET /api/v4/recafco/documents/recent/` is kept (permission-filtered, capped, with its own tests), but no portal page calls it now. Removing it is a separate decision.
- Department cards, company-wide search, Upload documents and the "department no longer in use? Search documents" hint are unchanged. Historical documents remain reachable through Search › Department.

**Sticky toolbar (`components/sticky-toolbar.tsx`)**
- `position: sticky` against the window, which is the page's only scroller, so there are no nested scroll areas. It sticks at `top: 65px`, directly under the app header (64px plus its 1px border), with `z-index` below the header.
- An opaque page-coloured background, so nothing shows through. A subtle bottom border and hairline shadow appear only while it is stuck.
- It keeps its normal place in the document flow, so nothing jumps when it sticks. The bleed to the content edges matches `<main>`'s padding.
- It publishes its height as `--sticky-toolbar-height`. `html { scroll-padding-top }` (in `globals.css`) uses it, so keyboard focus, `scrollIntoView` and anchors land below the header and toolbar.
- It stops sticking when it would cover too much of the visible screen: if the toolbar is more than 30% of the visual viewport, or header plus toolbar leave less than 70% for content. It uses `visualViewport`, so an open phone keyboard counts.
- Without JavaScript it is an ordinary toolbar.

**Contents**
- Home: search field, Search and Upload documents. The heading, description and sample note stay outside and scroll normally.
- Department page: department search, Category, Search / Clear and "Upload to this department". The breadcrumb, heading and sample badge stay outside.

## Verification (`scripts/screenshots-sticky.mjs`, real headless Edge)

To fill several screens, the script temporarily reactivated 14 dev-only inactive departments through the admin API, then deactivated them again (restored: 14 of 14). The Finance department has 12 pages of documents.

| View | Toolbar | Height / screen |
| --- | --- | --- |
| Home 390px | sticky at 65px, no overlap | 121 / 844 |
| Home 768 / 1440 / 1920px | sticky at 65px, no overlap | 65 |
| Department 390px | not sticky (by design: too tall for a phone) | 331 / 844 |
| Department 768px | sticky at 65px | 189 / 1024 |
| Department 1440 / 1920px | sticky at 65px | 129 |
| 200% zoom (720×450 CSS px) | not sticky | 339 / 450 |
| Phone with keyboard open (390×480) | not sticky | 331 / 480 |

- No horizontal scrolling in any of the 20 views.
- **Focus:** a document link 15 rows down, focused from the top of the page, landed at y=541, below the toolbar's bottom edge at 194.
- **Search from the stuck toolbar:** typing "PROC" and choosing Invoice led to `/departments/1?q=PROC&category=3`, and both values stayed in the toolbar. The Upload link kept `/upload?department=1`.
- **Keyboard order:** skip link → logo → navigation → account menu → breadcrumb → department search → Category → Search → Upload → results.
- **Dropdowns** are native `<select>` elements and stay usable. Their open menus cannot be captured in a headless screenshot.

Screenshots: `docs/screenshots/sticky-toolbar/`; measurements are in `index.json`.

## Notes

- On phones the department toolbar (search, category, buttons, Upload) is 331px tall, so it stays in place rather than covering 40% of the screen. The home toolbar does stick on phones.
- One integration assertion changed: `10-recent-documents` checked that the home page showed the recent list. It now checks that the list is gone and that no confidential title appears.

## Tests

- Typecheck, lint and build are clean; unit tests 13/13.
- Integration, first run: 177/178. In `06-upload-reliability`, an administrator request returned 403 once. The cause was not established, because the body was not reported. In that run the dev Mayan was slow (one test took 64s instead of a few) and close to its 2.5 GiB memory limit since Docker Desktop restarted. The assertion now reports the status and body.
- After restarting only the dev Mayan container (`recafco-dms-dev`; memory went from 2.22 to 1.58 GiB), the full suite passed **178/178**.
- The probe department created while diagnosing ("Probe …") was deactivated again.

# Unit 5 report — Full application control for RECAFCO administrators

Branch `unit-5-admin-control` (from `sticky-toolbar`). Development stack only
(`recafco-dms-dev`, port 8091). The original Mayan installation (project
`mayan`, port 80) was not touched. Nothing was deployed.

This unit **replaces** three earlier rules, as RECAFCO asked: "nothing is
deleted, only deactivated" (Unit 2), "administrators need confidential-group
membership to open documents" (Unit 3) and "no confidential → general release"
(Unit 3). The new policy is recorded in `docs/decisions.md` and
`docs/permission-model.md`.

## Result

Evidence: integration tests in `portal/tests/integration/11-admin-control.test.ts`
(direct endpoint calls with each person's own token) and the browser run
`scripts/screenshots-admin-control.mjs` (real clicks in headless Edge, screenshots
in `docs/screenshots/unit-5/`).

| Area | Implemented | Evidence |
| --- | --- | --- |
| Departments | Create, rename, reorder, icon, activate/deactivate (earlier units); **delete** an empty one; a populated one offers *move documents to another department and delete* (merge) or *delete and move documents to the recycle bin*. Never deletes files. | Tests "deletes an empty department…", "merge moves every document (search included)…", "delete with 'recycle bin'…"; browser: create + delete through the dialog (04, 04b), populated dialog with counts (05) |
| Categories | Create, rename, activate/deactivate; **delete** only by moving its documents to another category (merge) | Test "a category in use can only be deleted by moving its documents"; screenshot 06 |
| Users | Create; edit username (lower case, unique) and details; departments; temporary password reset; roles; activate/deactivate; **delete** keeping documents, uploader name and activity entries ("… (account deleted)"); optional responsibility transfer; tokens revoked at once; last active System Administrator and one's own admin role/account protected | Tests "renames a username… and deletes an account keeping documents and attribution", "an administrator cannot remove their own System Administrator role…"; browser: account deleted through the dialog (12, 13) |
| Roles and permissions | Create, edit, delete roles with grantable permissions (departments, categories, users, confidential groups, documents, recycle bin, permanent deletion, activity log). **System Administrator** is a protected built-in role. Only System Administrators manage roles or grant administrator authority (backend check) | Tests in "roles and permissions" (4); browser: role created through the form (02, 03) |
| Document access for administrators | System Administrators open every general and confidential document: list, search, preview, download, every stored file version. Through a Mayan role's ACLs, **no global permissions** | Tests in 05/07 (updated) and 11; document page 10 lists files and versions with Download |
| Document changes | Title, department, category, responsible person (original uploader kept), access (general ↔ any confidential group, both ways, explicit action only), individually or **in bulk** (up to 200 per action, per-document result) | Test "bulk move, responsibility and access… with per-document results"; browser: bulk bar, confirmation and result (07, 08, 08b) |
| Recycle bin | Move to the bin, restore, **permanent delete** (only from the bin) of records, stored files, file/version page caches and versions; success reported only after storage was checked | Tests "recycle bin hides documents (lists, search, favorites)…", "permanent deletion only from the recycle bin; removes records, files and caches; search and favorites updated"; browser: bulk recycle + restore, page recycle + permanent delete with server 404 afterwards (09, 10b, 11) |
| Confidential groups | Create, rename, members (earlier units); **deactivate** (refuses new documents, members keep access); **delete**, with documents moved to another group or deleted permanently by explicit choice. Documents are **never** made general by a group deletion | Tests "a deactivated group refuses new documents…", "deleting a group with documents needs a decision…"; screenshot 14 |
| Activity history | Actor (with name snapshot), time, target, changes, reason, outcome (success/failed). Kept after deletions. Append-only (the model refuses changes and deletion; no edit/delete endpoint). Search, filters (action, target type, outcome, actor, dates), CSV export (formulas neutralised) | Tests "the activity log has no edit or delete endpoint", "filters by action, outcome and date, and exports CSV…"; browser: export through the portal returns `text/csv` (15) |
| Employees and controllers refused | Every new endpoint refuses them; they gain no document access | Tests "only administrators can use the new operations" (each endpoint), "employees and controllers still cannot see documents outside their access"; browser: no Administration link, admin page refused |
| UX | Clear Edit / Move / Delete / Restore actions; search, filters, pagination, select all; counts shown before destructive actions; one confirmation dialog; "This cannot be undone." on permanent deletion and account deletion; optional reason recorded; result shown after the list refreshes | Screenshots 01–18 (1440px and 390px; no horizontal page scroll) |

## Checks

Final code, after all fixes:

- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm run test:unit`: **13/13**.
- `npm run test:integration` (206 tests, 28 new in `11-admin-control`):
  final full run **184 passed, 1 failed, 21 not run**. Both problems were
  waits for Mayan's search index: the department-merge test's 120 s wait, and
  `01-permissions`' setup, which hit its 5-minute limit while waiting for its
  documents to become searchable, so its 21 tests did not run. During that
  run the dev Mayan container was at 2.2 of its 2.5 GiB memory limit after a
  day of test runs (~600 test documents). After restarting the dev Mayan app
  container (dev project only), `01-permissions` and `11-admin-control`
  passed **49/49**. The other 9 files passed in the full run. Indexing speed
  on the real server is untested; see "Limitations".
- Browser verification (`scripts/screenshots-admin-control.mjs`, final build):
  every check passes. That covers: role created, department deleted, bulk
  recycle and restore shown, document recycled and permanently deleted
  (server then answers 404), account deleted, CSV export returns `text/csv`,
  and an employee sees no Administration link and is refused. No server errors
  were logged.

## Problems found and fixed during verification

1. **Admin success messages were never shown for bulk actions and the
   document page's recycle bin buttons.** Those two actions passed an empty
   success message to the shared helper and then tested `if (!result.ok)`, so a
   successful change came back to the browser as an "error" with no text. The
   change itself was made; the person saw nothing. Fixed, and the helper now
   documents that the message must not be empty.
2. **A confirmation could disappear with the item it belonged to** (a deleted
   department's row, a document leaving the filtered list). Actions that remove
   their own row now send the browser to the list with a fixed result code, and
   the page shows the message (`admin/done-notice.tsx`, known codes only; no
   text is taken from the URL). Bulk results with failures list the document
   numbers that were not changed.
3. **Activity export through the portal returned 502.** The portal asks for
   `Accept: text/csv`; DRF's content negotiation answered 406 before the view
   ran. The export view now forces negotiation (errors still return JSON). The
   test sends the same header.
4. **Occasional "other side closed" on requests to Mayan.** Gunicorn closes a
   keep-alive connection when it has been idle for 2 s and when it recycles a
   worker (every ~500 requests), right after a response. A request already
   sent on that connection fails, and nobody can tell whether Mayan ran it.
   Reads were already retried once; writes must not be. The portal now sends
   every write on a new connection and keeps reads on reused connections with
   a 1 s idle time (`undici` 7.30.2, MIT, the library Node's fetch is built
   on; 0 audit findings). The integration helpers do the same; two account
   tests had failed on it. This affected writes since Unit 1, not only this
   unit. (A first attempt with only a shorter idle time did not fix the
   worker-recycling case; measured, then replaced.)
5. The first full integration run had 9 failures. One was an assertion that
   Unit 5 deliberately changes (an administrator outside a new confidential
   group was expected to be refused; under the new policy the administrator
   opens it). That assertion now checks the new rule. The other 8, all in
   `01-permissions` and all for employee A, were caused by a second test
   process I started during that run: each test run resets the dev accounts.
   `01` and `05` passed 84/84 when rerun alone, and the final full run above was
   made with nothing else running.

## Tests changed because the policy changed

- `05-departments-admin`: administrators now see confidential documents and
  their counts; "a new confidential group admits only its members" now expects
  the System Administrator to open the document without membership.
- `07-confidential`: administrator uploads stay accessible; administrators open
  documents without membership; reclassification to general is allowed and
  tested ("release back to general"); the action name is
  `document.access_changed`.

Every assertion about employees and controllers is unchanged.

## Limitations and remaining gaps

- **The built-in original confidential group cannot be deleted.** It shares
  the Mayan role "RECAFCO Controllers", which also grants general access, so
  deleting it would remove the controllers' general access too. It can be
  renamed and its members managed. Other groups can be deleted.
- **Last-administrator protection** is implemented (deactivate, delete, role
  removal), but in practice it is reachable only in narrow cases, because
  nobody can remove their own administrator role or delete their own account.
- **Search indexing is asynchronous** (Mayan's worker). Under heavy load on
  the dev stack, indexing a moved document took longer than 2 minutes (see
  "Checks"). Recycled and deleted documents disappear from search results at once because results are
  filtered through valid documents; the index entry itself is removed shortly
  after. The tests wait for and check the index.
- **Permanent deletion removes stored files inside the transaction**, before
  the activity entry commits. If that final insert failed, the files would be
  gone while the document record rolled back. The window is one INSERT; the
  operation is reported as failed in that case and the remaining record is
  still in the recycle bin for a retry.
- **Bulk actions are limited to 200 documents per request.**
- **Documents in the recycle bin cannot be downloaded or previewed** from the
  admin page; they must be restored first (Mayan's trash hides them).
- **Outside (internet) access and second-factor verification** are still not
  decided by RECAFCO and not built.
- Departments, categories and confidential groups still use dev sample names;
  the real lists have not been supplied.

## Files

Extension: `app_permissions.py`, `admin_operations.py` (new);
`admin_api_views.py`, `admin_services.py`, `services.py`, `models.py`,
`api_views.py`, `auth_api_views.py`, `urls.py`, `literals.py`,
`permission_model.py`, `management/commands/recafco_setup.py`; migrations
`0007_admin_control`, `0008_backfill_attribution_system_role`.

Portal: `components/dialog-form.tsx`, `app/admin/done-notice.tsx`,
`app/admin/documents/bulk-bar.tsx`, `app/admin/roles/*`,
`app/api/admin/activity/export/route.ts` (new); every admin page,
`app/admin/actions.ts`, `lib/admin.ts`, `lib/mayan.ts`, `lib/form-state.ts`;
`package.json` (`undici`).

Scripts and docs: `scripts/screenshots-admin-control.mjs`,
`docs/decisions.md`, `docs/permission-model.md`, `docs/progress.md`,
`CLAUDE.md`.

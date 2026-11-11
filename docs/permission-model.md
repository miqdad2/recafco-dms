# RECAFCO DMS permission model

Status: tested in Unit 1 and Unit 2 against Mayan EDMS 4.12.2 (isolated dev stack).
Applied by `recafco_setup`; defined in
`mayan-extensions/recafco_dms/permission_model.py`.

## Rules

| Rule (from RECAFCO) | How it is enforced |
|---|---|
| General documents are visible to all authenticated employees | ACL on document type **RECAFCO General** → role **RECAFCO Employees** |
| Confidential documents have explicit restricted access | Separate document type **RECAFCO Confidential**; employees have **no** ACL on it |
| Departments organize, not restrict | Department is a required metadata value, not a permission |
| Department and category are separate | Two separate required metadata types |

## Why confidentiality is a document type, not a document ACL

Mayan permissions only add access; nothing can deny it. A document inherits
every permission granted on its document type. Adding a "controllers only"
ACL to a single general document does **not** remove employee access
(proven by the test *"a document-level ACL cannot narrow access inherited
from the document type"*). The only reliable boundary is a document type
that ordinary employees have no ACL on.

Consequence: moving a document between general and confidential means
changing its document type. Employees cannot do this (no
`document_change_type` permission; tested).

## Objects

| Object | Name |
|---|---|
| Document types | `RECAFCO General`, `RECAFCO Confidential` |
| Required metadata (both types) | `recafco_department` (Department), `recafco_category` (Category), lookup lists |
| Roles ↔ groups | `RECAFCO Employees` ↔ group `RECAFCO Employees`; `RECAFCO Controllers` ↔ group `RECAFCO Controllers` |

## ACLs (exact; extra permissions are removed by `recafco_setup`)

| Role | Document type | Permissions |
|---|---|---|
| RECAFCO Employees | RECAFCO General | view document, view files, download files, view versions, **portal upload** |
| RECAFCO Employees | RECAFCO Confidential | *(none)* |
| RECAFCO Controllers | RECAFCO General | same as employees |
| RECAFCO Controllers | RECAFCO Confidential | view document, view files, download files, view versions |

**Global role permissions: none for either role.** `recafco_setup` refuses
to run while the employee role has any.

Deliberately **not** granted to employees: Mayan's own *create document*
(so the only upload path is the portal endpoint), edit/rename, change type,
trash/delete, new file/version, any ACL permission, any metadata
permission. Employees see Department and Category through the extension,
which reads them only after checking the employee may view the document.

### Why employees get no metadata permission

Mayan attaches metadata-value permissions to the **metadata type**, not to
the document. Granting "view metadata" on the Department type would apply to
every document's Department value, confidential ones included. The extension
avoids that by returning metadata only for documents the caller can view.

## Channels tested (two employees, one controller, anonymous)

List, detail, files, file pages, versions, version pages, page images,
downloads, metadata, cabinets, tags, comments, duplicates, events, favorites,
the extension summary/batch endpoints, and all eight search models
(document, file, file page text, version, version page OCR, metadata,
cabinet, index). Results: `docs/unit-1-report.md`.

## Unit 2 additions

### Roles

| Role | How it is stored | What it allows | Checked by |
|---|---|---|---|
| Employee | Mayan group **RECAFCO Employees** | View general documents (all departments); upload into any active department | Mayan ACL on *RECAFCO General* |
| Department controller | `recafco_dms.ControllerAssignment` (user ↔ department) | Correct title, category and department of documents in those departments; move only between them | Extension, per request |
| RECAFCO administrator | Django group **RECAFCO Administrators** — attached to **no** Mayan role | The `/recafco/admin/` endpoints and the portal's Administration area | Extension `IsPortalAdmin`, per request |
| Confidential reader | Mayan group of a confidential access group | View/download that group's documents | Mayan ACL on that group's document type |

None of these roles has a Mayan global permission. An administrator who is not
in a confidential group cannot see, count or open its documents (tested).

### Confidential access groups

| Group (portal name) | Mayan document type | Mayan role and group | ACL |
|---|---|---|---|
| Confidential (original group) | RECAFCO Confidential | RECAFCO Controllers | view, files, download, versions (+ general read/upload, from Unit 1) |
| *each new group* "X" | RECAFCO Confidential - X | RECAFCO Confidential - X | view, files, download, versions on its own type only |

`recafco_setup` re-applies these ACLs exactly on every run and refuses to run if
any RECAFCO role has a global permission. Employees have no ACL on any
confidential type (tested for a newly created group).

### Departments never restrict viewing

Department cards, counts, lists, department search and previews all start from
`AccessControlList.restrict_queryset(document_view, user)` and only then filter
by department. A department is a label for organizing documents.

## Unit 3 additions: classifying documents as confidential

| Action | Who | Checked by | Also requires |
|---|---|---|---|
| Upload a new confidential document | RECAFCO administrators only | Extension (`is_portal_admin`) | An explicit group. Membership is **not** required. |
| Make an existing document confidential, or move it to another group | RECAFCO administrators only | Extension (`IsPortalAdmin`) | **Current access** to the document (Mayan ACL view), else 404 |
| Release a confidential document to general | Nobody (not built) | — | — |
| Correct title/category/department | Administrators; Department controllers in their departments | Extension | Cannot change confidentiality (field refused) |

- A confidential upload is created directly in the group's document type in
  the upload transaction: it is never committed as general.
- Reclassification is one update of the document type inside a transaction.
  Before the commit the old audience can see it, after the commit only the
  new group can. Every later request is checked live by Mayan, so search,
  department counts, favorites, previews, downloads and **existing portal
  sessions** lose access at once (tested).
- **Copies already downloaded, printed or forwarded before a document was
  restricted cannot be recalled.** Restricting only controls access inside the
  document system from that moment on. The portal says this before the
  administrator confirms.
- An administrator who uploads to, or reclassifies into, a group they are not
  in cannot open the document afterwards. Administrators can add themselves to
  a group (they manage membership); that change is recorded in the activity
  log.

## Unit 4 additions: accounts and passwords

- One identity source: Mayan's user table. No portal password store.
- An account with a pending password change (new account or administrator
  reset) can do nothing in Mayan except change its password and sign out, in
  the portal and on direct Mayan access (API token, HTTP Basic, Mayan web
  session), through `PasswordPolicyMiddleware`.
- RECAFCO accounts cannot change their password, username or account through
  Mayan's own self-service endpoints; the portal's password change requires
  the current password and applies RECAFCO's rules.
- Lockout counts per username, so one locked user does not affect others on
  the same office IP address.

## Not yet decided (needs RECAFCO)

- Outside (internet) access: who may connect from outside, through what, and
  which additional verification (for example a second factor) is required.
  **Not built: sign-in today is username and password only.**

- Releasing a confidential document back to general (and who may do it).
- Who should be in each confidential group (the dev users are samples).
- Whether administrators should be prevented from adding themselves to groups
  (today: allowed and audited).

# Decisions

Business decisions confirmed by RECAFCO, and the technical decisions that
follow from them. Newest first. Do not implement anything here as a rule
unless it is marked **confirmed**.

## 2026-11-11 — Unit 4: local username/password accounts

### Rules given by RECAFCO for this unit

- No email, phone number or self-registration. An administrator creates each
  account with a unique username and a temporary password.
- Simple temporary passwords such as "123" are allowed.
- The temporary password must be replaced at first sign-in and after every
  administrator reset. Until then only "change password" and "sign out" work,
  enforced on the backend and on direct Mayan access.
- Personal passwords: at least 6 characters, no character types required.
- Simple usernames and numeric employee IDs are allowed; case is handled
  consistently; uniqueness is enforced on the backend.
- Changing one's own password needs the current password.
- An administrator reset revokes existing sessions and credentials.
- Passwords are never stored or shown in plain text; supported secure hashing.
- Login throttling must not block the whole office (shared IP addresses).
- One identity source; no second password database.
- Outside (internet) access authorization and additional verification remain
  requirements. **Not implemented in this unit** and not claimed.

### Technical decisions

- Identity source = Mayan's Django user table. Passwords are set with
  `set_password()` (Django's hasher; PBKDF2-SHA256 in this image) and checked
  with `authenticate()`, so Mayan's lockout sees every attempt.
  `PasswordState` stores only whether a change is pending.
- Usernames are stored in lower case; new names are unique ignoring case
  (checked on create; exact-name uniqueness is the database constraint, and
  every new name is lower case). Portal sign-in resolves the name ignoring
  case. Accounts created earlier with capitals keep their spelling.
- Temporary password: at least 1 character ("123" allowed). Personal
  password: 6–128 characters and different from the current one. Mayan's own
  Django validators (8 characters, not all numbers, not common) are
  deliberately not applied to these passwords, because RECAFCO set the rule
  above.
- New extension endpoints: `POST /api/v4/recafco/auth/login/` (anonymous by
  necessity, so it is the only extension view without IsAuthenticated) and
  `POST /api/v4/recafco/auth/password/`. The portal no longer uses Mayan's
  token-obtain endpoint.
- Enforcement on direct Mayan access: `recafco_dms.middleware.PasswordPolicyMiddleware`,
  installed with Mayan's supported `MAYAN_EXTRA_SETTINGS_FUNCTION_LIST` hook
  (no Mayan source change). It refuses every request made as an account
  with a pending change (web session, API token or HTTP Basic) except the
  password change, token revocation and Mayan logout. For RECAFCO accounts it
  also refuses Mayan's self-service `/users/current/` writes and its web
  password-change page. Tested in Mayan 4.12.2 without the middleware:
  `PATCH /users/current/` changed the password without the current one and
  renamed the account (with capitals, bypassing case-insensitive uniqueness).
- Throttling: Mayan lockout per **username** (5 failures, 15 minutes), plus a
  per-username request limit of 10 per minute kept in the database. Mayan's
  throttle cache is per-process memory, so a count kept there would be split
  across Gunicorn workers. There is no per-IP limit on sign-in.
- A password change rotates the Mayan token: the current portal session
  keeps working with the new token; every other session and device is
  signed out.
- Administrator reset: temporary password and pending change; token deleted
  (all portal sessions end); Mayan web sessions end (Django session hash);
  lockout counter cleared. Administrators cannot reset their own password
  there; they use "Change password".

## 2026-11-10 — Unit 3

### Rules given by RECAFCO for this unit (initial rules)

1. RECAFCO administrators manage confidential groups and membership.
2. Only administrators may classify a document as confidential or change
   its confidential group. Confidential upload requires an explicit group.
3. Department controllers cannot change confidentiality.
4. Administration privileges alone grant no access to document content. An
   administrator may upload to a group they are not in, but then cannot
   open, preview or download the document.
5. Reclassifying an existing document requires administrator authority
   **and** current access to that document.
6. No confidential-to-general release in this unit.
7. "Originally uploaded by" is immutable; the "responsible person" can be
   transferred by an administrator.

### Technical decisions

| Decision | Why |
|---|---|
| Uploads carry a client-generated operation ID, unique per user. `pending` is committed before any work; `completed` is set in the same transaction that creates the document. | A retry returns the first result; the status can always be told truthfully (completed ⇔ the document exists). |
| A repeat with different bytes or fields → 409; a refused upload is final for its ID; a `pending` attempt older than 10 minutes is treated as dead and may be taken over. | No silent reuse; no operation stuck forever after a killed worker (Gunicorn kills requests after 120 s). |
| Concurrent repeats wait (up to 45 s) for the first attempt and return its result. | Exactly one document for any number of parallel retries. |
| Files written to storage by a rolled-back upload are deleted. | No orphaned bytes. |
| The portal never resends an upload. If its connection to Mayan drops, it asks for the operation status instead. The browser keeps the ID and offers "Check whether it was saved". | A dropped connection can follow a commit (proved with a proxy test); a blind retry could duplicate. |
| Confidential upload creates the document directly in the group's document type. Reclassification is one UPDATE of the document type in a transaction. | No moment of general visibility. |
| Reclassification checks that the target type links both RECAFCO metadata types before switching. | Mayan's type-change handler would otherwise delete department/category values. |
| Unit 2's "change uploader" overwrote the original uploader. Migration 0004 restores originals from the audit log and moves the transfer to `DocumentResponsibility`; where the log shows no original (a record Unit 2 created), the record is removed and the uploader shows "Not recorded". | Never invent an original uploader. |
| Portal sessions in an SQLite file (built-in `node:sqlite`, no new dependency). Session IDs stored as SHA-256; Mayan tokens encrypted with AES-256-GCM (`PORTAL_SESSION_KEY`). | Survive restarts; shared by every portal process on the server; a copy of the file reveals no cookie or token. |
| `@types/node` raised from 20 to 24. | Matches the Node 24 runtime (needed for `node:sqlite` types). |

## 2026-11-10 — Unit 2

### Confirmed by RECAFCO (in the Unit 2 session)

1. **Upload into any department.** Any employee with upload permission may
   upload into any *active* department. The uploader's name and the upload
   date are shown next to every document.
   - Consequence: a user's assigned department is organizational only. It
     shows "Your department" on the home page; it limits nothing.
2. **Department controllers** may, in their permitted departments:
   upload (as every employee can), and correct a document's **title,
   category and department**, moving it only between their own
   departments. Nothing else. Controllers are **not** administrators.

### Requested by RECAFCO for Unit 2 (product brief)

- Department-based home page; department page with scoped search,
  category filter, newest-first list.
- A separate, server-protected RECAFCO administration area: departments,
  categories, users and roles, controllers, document details and ownership,
  confidential groups and membership.
- Deactivate, never delete. Dangerous infrastructure operations stay out of
  ordinary admin screens.

### Technical decisions

| Decision | Why |
|---|---|
| Departments and categories are extension records (`Department`, `Category`), linked to each document by `DocumentClassification` (foreign keys). The names are mirrored into the Mayan metadata `recafco_department` / `recafco_category`. | Renames keep history (the record is the same); Mayan's own screens and search still show the names. |
| Rename rewrites the stored Mayan metadata values one by one (events recorded, search re-indexed). | Mayan search stays correct after a rename. Slow for very large departments; acceptable for a rare admin action. |
| Names cannot contain `, ' " \ { } %`. | Mayan renders the lookup list as a template and splits it with `shlex`. |
| Administrators = members of the Django group **RECAFCO Administrators**, with **no Mayan role or permission**. Every `/recafco/admin/` view requires `IsAuthenticated` + `IsPortalAdmin`; `urls.py` refuses to load if an admin route lacks it. `recafco_setup` refuses to run if the group is attached to a Mayan role. | Admin rights live entirely in the extension and are checked per request. |
| Administrators see documents only through Mayan ACLs, like everyone else. | "Administrator" must not quietly mean "can read confidential documents". |
| Mayan superusers/staff are hidden from and protected against the RECAFCO admin area. | Those are system accounts (dangerous operations stay elsewhere). |
| A confidential access group = its own Mayan document type + role + group, with read permissions only on that type. The Unit 1 type **RECAFCO Confidential** read by **RECAFCO Controllers** is registered as the first group, "Confidential (original group)". | Per-document ACLs cannot remove inherited access (Unit 1 finding), so each confidential audience needs its own document type. |
| The Mayan group named "RECAFCO Controllers" keeps its Unit 1 name and meaning (confidential readers). The new **Department controller** role is `ControllerAssignment` rows, unrelated to that group. | Avoids renaming a live Mayan group; the portal labels the two clearly. |
| Every admin change writes an append-only `AuditEntry`. | History must survive deactivation and corrections. |
| Counts on department cards are computed from the documents the caller may view. | Confidential documents must not leak through numbers. |
| Department search runs Mayan's own search engine on a queryset already limited to the department and the caller's access. | Correct counts and pagination; same matching as company-wide search. |

# Unit 1 report — RECAFCO portal integration proof

Date: 2026-11-10 · Environment: isolated dev stack only · Not deployed.

## Result

The full journey works end to end, in the portal and in a real browser (Edge,
390 px phone and 1280 px desktop widths):

sign in → upload → department/category → processing status → search →
preview → download → My uploads → sign out.

Mayan enforces every permission. The portal holds no special rights:
it calls Mayan with each employee's own token.

**Tests: 5/5 unit, 65/65 integration, in two consecutive full runs**
(~3 minutes each) after the fixes below. Typecheck, lint and production
build are clean.

Earlier runs failed and led to fixes, not to looser checks: list endpoints
return empty lists instead of 404 (finding 4); anonymous favorites crash
(finding 5); a page-image lock race (finding 6); a dropped keep-alive
connection (finding 8); and test-side mistakes (wrong form field name,
React text markers).

## How it works

```
Browser ──opaque session cookie──▶ Next.js portal (server) ──employee's own token──▶ Mayan REST API
                                    │ session store (memory)                         │ + recafco_dms extension
                                    └ Mayan token never leaves the server           └ ACLs enforced by Mayan
```

- **Upload** streams from browser → portal → `POST /api/v4/recafco/uploads/`
  without buffering. In one database transaction, the extension creates the
  document in **RECAFCO General**, its Department and Category, the uploader
  record (from the token, never from the request), and the file. Mayan's own
  page-detection and indexing tasks start only after the commit.
- Only `file`, `department`, `category`, `label` are accepted; any other
  field (`document_type_id`, `uploader`, `user_id`, `access`, …) is rejected.
- **Processing status** comes from the extension: `processing` → `ready`,
  `delayed` after 10 minutes, or `no_preview` when Mayan cannot read the
  file (it can still be downloaded).
- **Search** uses Mayan's own search as the employee; the extension adds
  Department/Category to each result, re-checking access.

## Verified by tests

| Requirement | Evidence (test) |
|---|---|
| No global document permission for employees | `recafco_setup` report: global permissions `[]`; command refuses to run otherwise |
| Restricted ACLs cannot negate inherited access | Controllers-only ACL on a general doc: employees still read it, so confidentiality is a separate document type |
| Permission mapping established before confidential uploads | Mapping tested; confidential *upload* intentionally not built |
| Employees cannot change confidentiality via API | Change type, ACL read/create, edit, delete, metadata, new file, Mayan's own upload/create in both types, and spoofed fields on the portal endpoint all refused |
| Two employees + one controller | `dev_employee_a`, `dev_employee_b`, `dev_controller` |
| General cross-department access | A ↔ B through list, detail, versions, preview, download, search, extension summary |
| Confidential isolation | A and B refused or given empty lists across detail, files, file pages, versions, version pages, page images, downloads, metadata, cabinets, tags, comments, duplicates, events, favorites, extension endpoints, and all 8 search models (label, file name, PDF text, OCR, metadata, cabinet, index), each with a **positive control** (controller finds it) |
| Anonymous against populated data | Document list empty; every detail, preview, download, search and extension endpoint refused |
| No shared admin account for employees | Portal calls Mayan only with the signed-in user's token |
| Required metadata + access before exposure | Another employee sees Department, Category, uploader and file in the first response; admin scan finds no document without them |
| Failed / interrupted uploads leave nothing | Unknown/missing department or category, no file, empty file, two files, and a connection cut mid-file: an admin-level label search finds **0** documents |
| Uploader recorded server-side | `uploaded_by` = token owner; My uploads shows only own uploads |
| Tokens server-side, opaque cookie | Cookie is 43 random characters, `HttpOnly; Secure; SameSite=Lax; Max-Age=28800`, unrelated to the token |
| Session expiry | Unit tests: 30 min idle, 8 h absolute, forged/oversized IDs rejected |
| Logout | Ends the session **and revokes the Mayan token (tested)**. Because Mayan has one token per user, this signs the user out on **every** device (tested). |
| Disabled users lose access | Existing token refused, portal session ended on next request, sign-in refused |
| Revoked permissions lose access | Removed from group: document list empty, own uploads hidden, upload refused (403) |
| Cross-site upload blocked | Foreign or missing `Origin` → 403 |
| Upload size | 20 MB through the portal: 201 in ~1 s on this PC, bytes identical on download; declared >50 MB refused (413) before the body is read |

## Findings about Mayan (verified)

1. **Mayan's stock upload exposes incomplete documents.** It creates the
   document first and attaches the file later in a background task. Mayan's
   "valid documents" filter only excludes trashed documents, so a
   file-less, metadata-less stub is visible to everyone with view access in
   the meantime. That's why employees get no Mayan *create* permission and
   upload only through the extension.
2. **No default DRF permission class** in Mayan's settings. Its own views
   rely on ACL filters; every extension view sets `IsAuthenticated`.
3. **Metadata permissions follow the metadata type, not the document.**
   Employees therefore get no metadata permissions; the extension returns
   metadata only for documents they can view.
4. **Child lists of hidden documents return `200` with an empty list**
   (e.g. `/documents/{id}/files/`), while a non-existent ID returns 404. An
   employee can tell that *some* document with a given ID exists, but sees
   no title, metadata or content.
5. **Anonymous `GET /api/v4/documents/favorites/` crashes with HTTP 500**
   (Mayan core casts `AnonymousUser` to an ID). No data is exposed.
6. **Page images can fail with HTTP 500 just after processing finishes**
   (internal `LockError` while a background task holds the image-cache
   lock). A retry a moment later succeeds; the portal retries automatically
   up to 4 times.
7. **Some Mayan tasks are queued before the database transaction commits.**
   Search and indexing wait for the commit; workflow auto-launch does not.
   No workflows are attached to the RECAFCO document types. If one is added
   later, re-test uploads.
8. **Dropped keep-alive connections.** Mayan's Gunicorn recycles each worker
   after about 500 requests, which can close a connection a client is
   reusing ("other side closed"). Seen once in a full test run. The portal
   retries read-only requests (GET/HEAD) once; uploads are never retried
   automatically.
9. `/api/v4/permissions/` lists Mayan's permission names to any signed-in
   user (product catalogue, not RECAFCO data).

## Remaining gaps

**Needs a RECAFCO decision**
- Real department list (current values are "dev sample") and final category list.
- Controllers membership; whether several separate confidential groups are
  needed (each needs its own document type).
- Confidential upload: who, and through which screen (not built).
- Correcting department/category after upload (nobody can today).

**Sessions and accounts**
- Sessions live in the portal's memory: restarting the portal signs everyone
  out, and only one portal process is supported. A shared store (e.g. Redis)
  is needed before running more than one instance.
- Mayan has one permanent token per user. Logout revokes it everywhere. An
  idle-expired portal session does not revoke it, but the token never left
  the server.
- Mayan's login lockout is off by default. If enabled with the default
  `username, ip_address` parameters, all portal sign-ins arrive from one IP
  and could lock out everyone; it must be configured by username only.
- Mayan rate limits: anonymous 5 requests/s **per IP** (all portal sign-ins
  share the portal's IP), 20 requests/s per user (a long document preview
  loads many images).

**Upload size and processing**
- Portal limit 50 MB (configurable). Tested: 20 MB in ~1 s locally. Not yet
  tested: 50 MB+, slow mobile networks, and the reverse proxy (to be
  configured) whose own body limit and timeout must be at least as large.
  Mayan's Gunicorn timeout is 120 s per request.
- **Possible duplicate on retry:** if the connection drops after Mayan has
  committed an upload but before the reply arrives, the employee sees an
  error. Uploading again creates a second copy. Not yet handled (an upload
  ID sent by the browser, checked by the extension, would fix it).
- Previews show up to 50 pages; longer documents say "download to see all".
- Office files (Word/Excel) previews not tested; images not tested.

**Search performance**
- Mayan uses its built-in **Whoosh** index (no Elasticsearch running).
  Indexing is asynchronous: in tests, new documents became searchable within
  seconds, but there is no figure for a large archive.
- Each search result page makes 2 calls (Mayan search + one batch summary
  for up to 20 results). Not load-tested.
- Mayan search has no "department" filter in the portal yet.

**Not built in Unit 1 (by design)**
- Departments and Favorites screens (favorites tested at API level only).
- Confidential upload, versions screen, admin screens.
- Production deployment, HTTPS, reverse proxy, backups, monitoring.

## Environment safety

- Existing installation (Compose project `mayan`, port 80) was **not**
  changed, restarted or reconfigured. Its containers kept running since
  06:13 UTC with 0 restarts; its 5 volumes are untouched.
- Dev stack `recafco-dms-dev`: own network and volumes
  (`recafco-dms-dev_app`, `_postgres`, `_redis`), `127.0.0.1:8091` only,
  memory capped (app 2.5 GB; it used ~2.0 GB under test).
- Mayan core source unchanged; the extension is mounted into the unmodified
  image.

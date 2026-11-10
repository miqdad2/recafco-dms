# Unit 3 report — Upload reliability and confidential document handling

Date: 2026-11-10 · Environment: isolated dev stack (`recafco-dms-dev`, port
8091) only · **Not deployed.** The existing Mayan installation (Compose project
`mayan`, port 80) was not touched.

## Result

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | clean |
| `npm run test:unit` | **10/10** (session store, incl. restart durability and encryption at rest) |
| `npm run test:integration` (final full run, files 01–08) | **159/159** (≈9 min) |
| Earlier full runs during the unit | 156/159 and 158/159; every failure was investigated (below) — none was resolved by simply rerunning |
| Screenshots | `docs/screenshots/unit-3/` (10 images, none scrolls sideways at 390 px) |

Unit 1 and Unit 2 behavior is preserved, including uploads into any active
department by authorized uploaders (files 01–05 still pass).

## 1. Duplicate uploads on retry — done

- Every upload carries an **operation ID** created by the browser (random,
  128-bit; works on plain-HTTP intranet pages). It is stored per user in
  `UploadOperation` (unique: user + ID). The upload endpoint now **requires** it.
- `pending` is committed before any work; `completed` is written **in the same
  transaction** that creates the document, so "completed" ⇔ "the document
  exists". On any failure the transaction rolls back, any file already written
  to storage is deleted, and the operation is marked `failed` (final).
- Repeat with the same ID and the same file and fields → the first document
  (HTTP 200, `replayed: true`). Same ID with a different file, file name,
  title, department, category or confidential group → **409**.
- Concurrent repeats wait for the first attempt and receive its result:
  4 parallel requests → **exactly one document** (tested).
- A `pending` attempt older than 10 minutes (its worker was killed; Gunicorn
  kills requests after 120 s) is reported as "not saved" and may be taken over
  by a retry (tested with a simulated dead attempt).
- Recovery: `GET /api/upload/operations/{id}` (portal) →
  `/recafco/uploads/operations/{id}/` (Mayan), only for the user's own
  operations. The upload page:
  - after a lost reply, checks automatically and shows "We are not sure your
    upload was saved" → the saved document, or "Your upload was not saved",
    or "We could not confirm your upload" with **Check again** and
    **Try sending again (safe – no copy is made)**;
  - remembers an unconfirmed upload in the browser, so after a reload it
    offers **Check whether it was saved**.
- Records and files tested: one document and one operation per ID; a failure
  injected *after* the file reached storage leaves no document and **no
  file**; the dev database has **0 stored files without a document record**.

## 2. Confidential document handling — done (with the rules given)

| Rule | Implementation | Test |
|---|---|---|
| Administrators manage groups and membership | Unit 2 admin area | Unit 2 |
| Only administrators classify as confidential | Upload with `confidential_group` and `/recafco/admin/documents/{id}/reclassify/` check `is_portal_admin` | employees, group members and controllers get 403 |
| Confidential upload needs an explicit group | `confidential_group` required for it; unknown → 400 | yes |
| Controllers cannot change confidentiality | Detail correction refuses the field | 400 |
| Administration alone gives no content access | Documents still filtered by Mayan ACLs | admin uploading to a group gets a **receipt only** (no file, no pages) and 404 on page, preview, download |
| Reclassifying needs authority **and** current access | Admin endpoint + document must be viewable, else 404 | yes |
| No confidential-to-general release | Not offered; a group is always required | 400 for `{}`, `null`, `"general"` |
| Atomic, never temporarily general | Upload creates the document directly in the group's type; reclassification is one UPDATE in a transaction; target type must carry both RECAFCO metadata types or the change is refused | document type checked right after creation |
| Immediate recheck everywhere | Every request checked live by Mayan | after reclassification, the uploader's **existing portal session** gets 404 on page, preview and download; search 0; department count −1; favorites, My uploads exclude it |

**Downloaded copies cannot be recalled.** Restricting a previously general
document only controls access inside the document system from that moment.
Copies already downloaded, printed or forwarded stay with whoever has them.
The admin screen says so and requires a tick box before confirming.

## 3. Original uploader vs. responsible person — done

Inspection of Unit 2: "change uploader" **overwrote** `PortalUpload.uploader`,
the original uploader. It had been used on 3 dev documents (62, 67, 89:
Employee A → Employee B).

- New `DocumentResponsibility` (person, assigned by, date). Without it, the
  original uploader is responsible.
- `PortalUpload.uploader` is now immutable (the model refuses changes).
- Migration 0004 restored the originals **from the audit log**: documents
  62, 67, 89 again show *Originally uploaded by Employee A*, *Responsible:
  Employee B* (assigned by `dev_admin`). Where the log shows no original (a
  record Unit 2 created for a document that had none), the record is removed
  and the page shows "Not recorded" — nothing is invented. (None of those
  existed in the dev data.)
- Audit entries were not changed. Unit 2 entries now read "changed the
  uploader of (before Unit 3; … became a responsibility transfer)". The old
  `/owner/` endpoint is gone (404); `/responsible/` replaces it.
- Pages show "Originally uploaded by" and, when assigned, "Responsible person".

## 4. Session durability — was in memory; now durable

Finding: sessions were **still held in portal memory** (Unit 1 design).

Now: SQLite file (`PORTAL_SESSION_DB`, default `portal/.data/sessions.sqlite`)
using Node's built-in `node:sqlite` (no new runtime dependency).
- Session IDs stored only as SHA-256; Mayan tokens encrypted with AES-256-GCM
  (`PORTAL_SESSION_KEY`, 64 hex chars, generated by `scripts/dev-env.mjs`).
  A copy of the file contains no usable cookie or token (unit-tested).
- Idle (30 min) and absolute (8 h) expiry enforced on every read; expired rows
  swept every minute. Changing the key signs everyone out.
- Tested with a second, independent portal process sharing the file: a session
  works across processes and **after a restart**; sign-out in one process ends
  it everywhere; **deactivation** and **permission revocation** still take
  effect at once.

## 5. The intermittent write failure — investigated

**What was seen:** `TypeError: fetch failed — other side closed` on a POST
(Unit 2 run 1, test 02 "My uploads…"; and twice more during this unit,
both in test 07 at the same step). Each failed within ~10 ms.

**Evidence that it happened before processing:**
- Unit 2 case: the documents created just before (`OWN-A-tmwak78p2`) and
  after (`PROC-tmwak78p2`) exist; `MINE-B-tmwak78p2` does not.
- Unit 3 case: every upload that reaches the view records its operation
  first; the failed request left **no operation row** (`dev_admin` had only
  its one successful operation).
- The third occurrence was absorbed by the test helper's safe resend (same
  operation ID — see below).

**Mechanism:** Mayan runs Gunicorn with gevent workers, 2-second keep-alive
and `--max-requests 500`. The client reused a kept-alive connection that the
server side was closing; the request bytes went into a closing socket and were
never read. Each occurrence came right after a `docker compose exec` of a Mayan
management command (test fixture), on the next reused connection.
**Not established:** the exact trigger. Isolated probes did not reproduce it —
idle gaps at 10 ms steps around 2 s, 3,000 requests across several worker
recycles, uploads with a real `docker compose exec` in between, and no
OOM-kill or worker-kill events (container `memory.events`: `oom_kill 0`;
Gunicorn logs only at error level). Docker Desktop's Windows port forwarding
is a likely contributor.

**Can a dropped connection happen after a write commits?** Yes, in general:
Gunicorn keeps running a view whose client disconnected, a worker can be
killed after commit, and a browser on a weak network can lose the reply.
The new targeted test reproduces **both** conditions with a TCP proxy in front
of Mayan — dropped *before* processing on a reused connection, and dropped
*after* commit — and shows the client gets the **identical error**
(`UND_ERR_SOCKET other side closed`) while the truth differs (0 vs 1
document). The operation status tells them apart, and a retry with the same
ID yields exactly one document in both cases.

**No blind retries:** the portal never resends an upload (its body is a
one-time stream); on a dropped connection it asks for the operation status
and returns the definite answer (saved → the document; not saved → 503 "you
can upload again safely"; unknown → 504 and the browser keeps checking).
Read-only GET/HEAD keep their single retry (Unit 1). The test helper resends
an upload once **only with the same operation ID**, which is safe by design.

Also found: a request cut halfway through the file **does** reach the upload
view — Django drops the incomplete file part but keeps the text fields. It is
refused ("Choose a file to upload"), the operation is `failed`, nothing is
saved (test 02 updated to assert exactly this).

## Other fixes

- Creating a confidential group no longer queues a Mayan task before commit
  (it logged `DocumentType matching query does not exist`); the metadata links
  are created without signals (a new type has no documents to update).
- Route order: the portal checks upload size (413/411) before the operation ID.
- `.gitattributes` keeps LF line endings (shell scripts run in Linux/Git Bash).
- `@types/node` 20 → 24 to match the Node 24 runtime.

## Screenshots (`docs/screenshots/unit-3/`)

1–2 confidential upload form (administrator, desktop/phone) · 3 receipt after a
confidential upload by a non-member · 4 "We are not sure your upload was
saved" (reply cut by the browser's DevTools after the server saved it) ·
5–6 "We could not confirm your upload" (desktop/phone) · 7 after reload:
"An earlier upload was not confirmed" · 8 the check found the saved document
(no copy made) · 9–10 admin document page: original uploader, responsible
person, "Make confidential" with the downloaded-copies warning.

## Files changed (since the Unit 1–2 baseline commit)

Extension `mayan-extensions/recafco_dms/`: `models.py` (UploadOperation,
DocumentResponsibility, immutable PortalUpload), `migrations/0003_…`,
`migrations/0004_restore_original_uploaders.py`, `uploads.py` (new),
`services.py`, `admin_services.py`, `api_views.py`, `admin_api_views.py`,
`urls.py`, `literals.py`, `management/commands/recafco_dev.py`
(`upload-fail-after-store`, `orphan-files`, `operation`,
`operation-make-stale`).

Portal `portal/`: `src/lib/session-store.ts` (SQLite), `config.ts`, `auth.ts`,
`mayan.ts`, `admin.ts`; `src/app/api/upload/route.ts`,
`src/app/api/upload/operations/[id]/route.ts` (new),
`src/app/upload/upload-form.tsx`, `upload/page.tsx`,
`src/app/documents/[id]/page.tsx`, `src/app/admin/actions.ts`,
`admin/documents/page.tsx`, `admin/documents/[id]/page.tsx`; tests
`tests/unit/session-store.test.ts`, `tests/integration/helpers.ts`,
`02-…`, `05-…`, `06-upload-reliability.test.ts` (new),
`07-confidential.test.ts` (new), `08-session-durability.test.ts` (new);
`package.json`/`package-lock.json` (`@types/node`), `.gitignore` (`.data/`).

Other: `.gitattributes` (new), `scripts/dev-env.mjs` (appends missing keys to
both env files), `scripts/screenshots-unit3.mjs` (new), `README.md`,
`docs/decisions.md`, `docs/permission-model.md`, `docs/progress.md`, this
report, `docs/screenshots/unit-3/`.

## Remaining gaps

**Needs a RECAFCO decision**
- Releasing a confidential document back to general, and who may do it.
- Whether administrators may add themselves to confidential groups (today:
  allowed and recorded in the activity log — so administration *can* lead to
  content access, visibly).
- Real department/category lists and real group membership.

**Technical**
- The exact trigger of the dropped keep-alive connection was not isolated
  (see 5). The portal handles it safely; a portal upload hit by it before
  processing shows "not saved — upload again".
- The portal → Mayan HTTP client uses Node's default keep-alive (4 s) against
  Gunicorn's 2 s. Setting the client's idle timeout below 2 s would narrow the
  window but needs the `undici` package as a dependency; not done.
- The "unconfirmed upload" note is kept per browser, not per user: on a shared
  computer, another user who checks it only learns "not saved" (operations are
  user-scoped).
- A failed operation is final for its ID: after a refusal the browser starts a
  new upload with a new ID (by design).
- Sessions are durable on one server (shared SQLite file). Several portal
  servers would need a shared store.
- Operation records are kept indefinitely; a retention/cleanup job is not built.
- The session database must be protected (file permissions) and its backups
  handled with care: it holds encrypted tokens; the key lives in the
  environment, not in the file. Losing it only signs everyone out.

## Environment safety

- `mayan` project containers untouched (still up, healthy).
- Dev app container restarted once (migrations 0003/0004), dev project only.
- Portal processes stopped only by their own PID; the second test portal
  (port 3108) is started and stopped by the test itself.
- No production database touched; nothing written to SAP; Mayan core unchanged.

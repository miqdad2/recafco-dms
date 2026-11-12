# Performance assessment — portal ↔ Mayan integration (2026-11-12)

Branch `perf-assessment`. Isolated development stack only (`recafco-dms-dev`,
port 8091). Nothing was deployed and no architecture was changed. The
company server was not used. The assessment itself changed no application
code; fixes 1 and 4 were implemented afterwards and are measured in
**"Optimizations: before and after"** at the end of this report.

Before measuring, Docker Desktop had to be started; with your approval the
original Mayan (project `mayan`) was then stopped with `docker stop` (no
configuration change, volumes kept). It was started again by someone else at
06:42:49 UTC during the last two runs; see "Test conditions".

## Summary

| # | Bottleneck (measured) | Effect | Targeted fix |
| --- | --- | --- | --- |
| 1 (done) | **Search**: the portal calls Mayan's search API (264 SQL queries, ~670 ms, most of it Python building preview data the portal discards), then a second call for summaries (63 queries) | Search is 1.0–1.4 s for one user; the system manages ~2.5 searches/s; in the mixed workload search is ~25 % of requests but most of the CPU | One extension endpoint that runs the same ACL-restricted Mayan search (`search_document_queryset`, already used by department search) and returns summaries in one call |
| 2 | **Gunicorn workers recycle together**: every ~500 requests (jitter ±50); evenly loaded workers reach it together and both restart | Every request stalled for ~30 s (measured twice); also the cause of the "other side closed" errors handled in Unit 5 | `MAYAN_GUNICORN_MAX_REQUESTS` higher with wide jitter, ≥3 workers (tested: no restarts, no stalls) |
| 3 | **Mayan memory ceiling**: ~13 Python processes of 200–300 MB in a 2.5 GiB container | The cgroup hit its limit 9,018 times in one 5-minute run; latency became erratic (1 user: 0.9 req/s instead of 2.6) | Give the Mayan container ≥4–6 GiB, or fewer worker processes; check on the server before go-live |
| 4 (done) | **Listing N+1**: `serialize_document` runs ~3 queries per document (page count, page IDs, "has pages") | A 20-row list = 65 queries (search summaries 63) | Annotate page count/state in the list query; read page IDs only on the document page |
| 5 | **Processing throughput**: OCR one page at a time; OCR and text extraction both run on every PDF, including PDFs that already contain text; file processing shares one consumer with ~16 search-index and event tasks per document | 1,900 documents took 45 min to process (~35 docs/min page detection at dev settings, ~121 with 3 file workers; OCR 16 → 26 pages/min) | More worker concurrency where CPU allows; schedule bulk imports off-hours; whether to skip OCR for born-digital PDFs is a RECAFCO decision |
| 6 | **Sign-in cost**: PBKDF2 1,000,000 iterations = 0.56 s CPU per sign-in, blocking a worker | 20 simultaneous sign-ins: p95 2.7–4.5 s | Keep the hashing strength; long portal sessions make sign-ins rare. More workers spread bursts |

No leak across user boundaries was found in any run (details under
"Caching and confidentiality"). No request failed in any run; slowness came
from queueing, not errors.

A rewrite is **not** indicated by these results. Fixes 1 and 4 are small
changes in the extension and portal; 2 and 3 are Mayan settings; 5 and 6 are
capacity and policy. The one architectural limit found is Whoosh (Mayan's
file-based search index, single node); Mayan also supports a self-hosted
Elasticsearch backend if the document volume or search rate outgrows it. That
is a configuration change, not a rewrite, and should be measured first with
the real document volume.

## Test conditions

**Hardware (one machine for everything).** Intel i7-1165G7 (4 cores / 8
threads, laptop CPU), 16 GB RAM, Windows 11 Pro. Docker Desktop WSL2 VM: 8
CPUs, 7.65 GiB. The load generator, the portal (Next.js 16.4.6 production
build, Node 24.17) and Mayan (image `mayanedms/mayanedms:s4.12`, PostgreSQL
15.17, Redis 7.4.8) all share these 4 cores, so absolute numbers are
pessimistic for a dedicated server and optimistic for a smaller one.
Comparisons between runs on this machine are the meaningful part.

**Mayan profiles compared.**

| | dev (committed `compose.yaml`) | tuned (`compose.loadtest-tuned.yaml`) |
| --- | --- | --- |
| Gunicorn workers (gevent) | 2 | 4 |
| Worker recycling | 500 ± 50 requests (image default) | 5,000 ± 2,500 |
| Celery: file processing / OCR / search | 1 / 1 / 1 | 3 / 2 / 2 |
| Memory limit | 2.5 GiB | 6 GiB (one run at 4 GiB) |

Mayan's image defaults are 3 Gunicorn workers and 8/2/4 Celery processes;
the production server's values were not inspected (out of scope).

**Dataset** (after seeding and full processing): 2,690 documents (2,000
synthetic: 1,800 general and 200 confidential; ~690 left by integration
tests), 2,665 pages (2,659 with OCR text), 14 departments, 12 categories,
~55 confidential document types (test leftovers), 359 user accounts (60
synthetic load-test employees). Synthetic documents are one-page PDFs with a
text layer; labels use a fixed vocabulary so searches return 0 to several
hundred results. The real RECAFCO document volume is not known; repeat the
test with a realistic count before sizing the server.

**What a "VU" is.** A virtual user (VU) is one closed request loop with
**no think time**: as soon as a response has fully arrived, the next request
starts. 10 VUs = 10 requests in flight continuously. A VU is not an
employee, and 1,000 accounts are not 1,000 VUs. How VUs relate to employees
depends on how often employees actually make requests, which has not been
measured (see "Capacity").

**Workloads.** Each VU uses its own account and portal session, signed in
through the real login form. Every request is timed to the last byte.

| Mix | home | department page 1 | deep page | search | department search | document page + first page image | download | upload (90 % 60 KB, 10 % 5 MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mixed | 15 | 20 | 5 | 20 | 5 | 15 | 12 | 8 |
| read | 25 | 30 | 5 | – | – | 25 | 15 | – |
| search | – | – | – | 80 | 20 | – | – | – |

**Other activity during runs.** The original Mayan was stopped for all runs
except the last two (`mixed-dev` rerun and `mixed-tuned` 6 GiB). It was
started by someone else 30 s into the `mixed-dev` rerun. Its startup
overlapped that run's 1- and 5-VU stages; afterwards it idled at ~6 % CPU and
2.9 GiB memory during the `mixed-tuned` run.

## Results

### Mixed workload (search, browsing, uploads, downloads)

**Tuned profile, 6 GiB** (primary result; the original Mayan was idling;
cgroup memory-limit events: 0; 113/113 administrator control responses
contained confidential documents; 0 leaks; 0 errors):

| VUs | req/s | p50 ms | p95 ms | errors | Mayan CPU avg/max % | Postgres CPU avg % | Portal CPU avg % | Mayan mem max MiB | Portal mem MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2.6 | 185 | 1,394 | 0 % | 205 / 495 | 66 | 14 | 2,881 | 253 |
| 5 | 5.2 | 519 | 3,260 | 0 % | 430 / 551 | 155 | 25 | 2,997 | 281 |
| 10 | 5.5 | 967 | 6,612 | 0 % | 524 / 583 | 181 | 26 | 3,089 | 298 |
| 20 | 5.8 | 1,817 | 12,008 | 0 % | 494 / 612 | 169 | 28 | 3,153 | 310 |
| 40 | 2.8 | 5,135 | 50,671 | 0 % | 520 / 660 | 201 | 18 | 3,113 | 309 |

CPU % is per core (800 % = all 8 threads). Per operation, p50 / p95 ms:

| Operation | 1 VU | 5 VUs | 10 VUs | 20 VUs | 40 VUs |
| --- | --- | --- | --- | --- | --- |
| Home (departments) | 80 / 114 | 183 / 436 | 323 / 1,717 | 704 / 2,261 | 2,490 / 7,629 |
| Department, page 1 | 227 / 849 | 630 / 1,201 | 1,249 / 3,093 | 2,402 / 5,584 | 7,744 / 34,445 |
| Department, deep page | 250 / 488 | 597 / 1,306 | 1,107 / 2,667 | 2,615 / 4,746 | 25,797 / 34,529 |
| Search, all departments | 1,190 / 3,413 | 2,557 / 5,005 | 4,906 / 9,878 | 10,869 / 15,687 | 26,144 / 76,721 |
| Search, one department | 382 / 3,428 | 1,202 / 2,204 | 2,325 / 4,706 | 3,861 / 5,717 | 15,445 / 32,161 |
| Document page | 98 / 261 | 219 / 527 | 408 / 794 | 853 / 2,664 | 3,284 / 24,018 |
| Page preview image | 97 / 299 | 287 / 1,159 | 399 / 1,025 | 634 / 2,255 | 1,513 / 7,262 |
| Download | 190 / 534 | 471 / 1,218 | 657 / 1,768 | 1,131 / 2,671 | 2,315 / 23,010 |
| Upload 60 KB | 350 / 630 | 823 / 1,694 | 1,932 / 4,880 | 4,066 / 7,577 | 5,974 / 18,529 |
| Upload 5 MB | – | 2,228 / 2,653 | 2,112 / 2,986 | – | 10,461 / 50,671 |

Throughput levels off at ~5.5 req/s from 5 VUs: the machine's CPU is the
limit (Mayan ~500 % of 800 %, plus portal, PostgreSQL and the load
generator). Beyond that, extra VUs only add queueing. At 40 VUs throughput
falls, because uploads add background processing that competes for the same
CPU.

**Earlier runs** (the original Mayan stopped; result files were overwritten
by the reruns, and the tables were copied from the run output). These runs
counted only HTTP status as errors; the later check for the portal's error
page (which can answer 200) had not been added yet.

| VUs | Tuned 4 GiB: req/s, p50 / p95 ms | Dev 2.5 GiB: req/s, p50 / p95 ms |
| --- | --- | --- |
| 1 | 1.8, 257 / 1,564 | 2.3, 212 / 1,487 |
| 5 | 3.7, 630 / 5,574 | 2.7, 852 / 6,058 |
| 10 | 3.7, 1,321 / 9,292 | 2.5, 1,775 / 14,895 |
| 20 | 3.3, 3,474 / 21,081 | 4.1, 3,119 / 16,586 |
| 40 | 3.5, 5,874 / 34,801 | 4.3, 5,131 / 29,857 |

At 4 GiB the tuned container also ran at its ceiling (3.8 of 4 GiB); raising
it to 6 GiB raised throughput from ~3.7 to ~5.5 req/s. In the first dev run,
24 of 119 administrator control responses lacked the confidential marker;
the cause was not recorded, which is why the driver now records it. The dev
rerun (strict checks, but the original Mayan started during it) measured
0.9–3.3 req/s, p95 up to 44 s, and 9,018 memory-limit events.

### Read-only and search-only (tuned 4 GiB, original Mayan stopped)

| Mix | VUs | req/s | p50 ms | p95 ms | Mayan CPU avg % | Postgres CPU avg % |
| --- | --- | --- | --- | --- | --- | --- |
| read | 1 | 7.1 | 112 | 303 | 96 | 70 |
| read | 10 | 23.6 | 324 | 906 | 299 | 260 |
| read | 20 | 25.2 | 570 | 1,951 | 313 | 287 |
| search | 1 | 1.2 | 922 | 1,272 | 122 | 30 |
| search | 5 | 2.4 | 2,018 | 3,641 | 231 | 65 |
| search | 10 | 2.5 | 3,048 | 8,740 | 333 | 82 |

Without search and uploads the same stack serves ~4.5× the mixed
throughput, with sub-second p95 at 10 VUs. Search alone tops out at ~2.5
searches/s. This is the clearest evidence that search is the first
bottleneck.

### During a processing backlog (dev profile, original Mayan stopped)

Read mix run right after 1,900 documents were added (~13,500 queued tasks):

| VUs | req/s | p50 ms | p95 ms | Note |
| --- | --- | --- | --- | --- |
| 1 | 3.2 | 285 | 517 | |
| 5 | 6.9 | 646 | 1,336 | |
| 10 | 1.5 | 2,136 | 30,407 | both Gunicorn workers restarted together (process ages confirmed it); every request waited ~30 s |

### Sign-in burst

| Profile | Simultaneous sign-ins | p50 ms | p95 ms |
| --- | --- | --- | --- |
| dev, during backlog | 10 | 5,026 | 5,102 |
| dev | 20 | 2,629 | 2,672 |
| tuned 6 GiB | 20 | 2,703 | 4,453 |

One password check takes 563 ms of CPU in Mayan (Django 5.2.17, PBKDF2,
1,000,000 iterations). A sign-in holds a Gunicorn worker for that time.

### Processing backlog (OCR, indexing)

| Measurement | Dev profile | Tuned profile |
| --- | --- | --- |
| Creating 1,900 documents (same code path as uploads) | 608 s (0.32 s each) | – |
| Page detection, documents/min | ~35 | ~121 |
| OCR, pages/min | ~16 | ~26 (CPU-bound; host at ~566 % of 800 %) |
| Tasks queued per document | ~16 search-index tasks, ~6 event tasks, 1 OCR per page | same |
| 100 documents fully processed (idle system) | 4 min 40 s | – |
| 1,900 documents fully processed | 45 min (15 min dev, then 30 min tuned) | |

Queues per Mayan worker: B = file processing **and** event recording
(`documents_file`, `events_fast`, …); D = OCR; E = search indexing. With one
process on B, file processing waited behind event recording (8,000+ event
tasks queued). New uploads become searchable only after OCR and indexing, so
during a bulk import, new documents appear in lists at once but in search
results only after the backlog clears.

## Request paths (code inspection plus query probe)

Query counts are measured in-process by `recafco_loadtest queries` (DRF test
client, one call, after warm-up) on the final dataset, as employee
`lt_emp_001`:

| Endpoint | SQL queries | Total ms | SQL ms |
| --- | --- | --- | --- |
| `recafco/me/` | 10 | 15 | 6 |
| `recafco/departments/` (cards with ACL-filtered counts) | 4 | 21 | 14 |
| `recafco/departments/{id}/` | 5 | 10 | 4 |
| `recafco/departments/{id}/documents/` page 1 (20 rows) | 65 | 119 | 51 |
| same, page 20 | 66 | 127 | 60 |
| same, with `q` (Mayan search inside the department) | 67 | 506 | 101 |
| Mayan `search/documents.documentsearchresult/` (20 results) | **264** | **668** | 117 |
| `recafco/documents/?id=…` (20 summaries) | 63 | 70 | 17 |
| `recafco/documents/{id}/` | 24 | 33 | 12 |
| `recafco/options/` | 3 | 4 | 0 |

Database time is small at this size; Python time dominates, mostly in Mayan's
search serializer (per result: layer transformations ×3, file pages ×2,
versions ×2, document, type, file, version page, content type).

**Requests per page view (portal → Mayan):**

| Page | Mayan calls | Sequential? |
| --- | --- | --- |
| Home | `me` + `departments` | parallel |
| Department | `department` → `documents` | sequential; the list streams in a Suspense boundary, so the header shows first |
| Search (all departments) | `departments` → Mayan search → summaries | **3 sequential**; `departments` does not depend on the search and could run in parallel |
| Document | `document` → `options` (only for people who may edit) | sequential for editors |
| Preview | one image request per page, lazy-loaded, first page eager | per page (max 50 listed) |

No list makes one API call per document: summaries are batched (≤50 IDs per
call). Each Mayan request authenticates the token (1 query) and passes the
password-policy middleware. The extra "is my token still valid" probe runs
only after a 401/403. Permission checks are Mayan's ACL `restrict_queryset`,
once per list query, not per row.

**Pagination.** Offset pagination with an exact `COUNT` per page; deep pages
cost the same as page 1 at this size (page 20: 127 ms). The global search page
is limited to 50 pages, department lists to 10,000. `COUNT` and the
department-count aggregate grow linearly with the number of visible
documents; fine at 2,690, worth re-measuring at the real volume.

**Uploads.** Browser → portal → Mayan is streamed: the portal pipes the
request body (no buffering in Node; no `proxy.ts`). Mayan's multipart parser
keeps up to 2.5 MB in memory and spools larger files to a temporary file;
the extension then hashes the file (idempotency fingerprint) and copies it to
storage inside one transaction. A 5 MB upload took ~0.5 s on an idle system.

**Downloads and previews.** Streamed end to end: Mayan answers with a
`FileResponse` (downloads) or a `StreamingHttpResponse` from its image cache
(previews); the portal passes the body through without reading it into
memory. Gunicorn uses gevent workers, so a slow client waiting on I/O does
not block other requests. That last point follows from the worker type; slow
clients were not simulated.

## Caching and confidentiality

- The portal has no shared cache: every page is `force-dynamic`, every Mayan
  fetch is `cache: 'no-store'`, and every streamed file or image is sent with
  `Cache-Control: private, no-store` (Mayan's own image cache header is
  replaced). There are no module-level caches of user data; per-request maps
  only. Cache Components is not enabled (`next.config.ts`).
- Mayan's Django cache is a per-process in-memory cache; it is not used to
  store responses for the API calls the portal makes.
- **Tested under load.** In every run the dev administrator kept opening
  confidential documents and searching for them while the employees ran
  (positive control: the administrator's responses did contain the
  confidential marker, e.g. 113/113 in the final run). Every employee HTML
  response was checked for (a) the confidential marker and (b) the page
  header showing exactly the signed-in employee and no other VU. **0 leaks
  in all measured runs**: ~4,450 employee pages in the saved result files,
  plus the two overwritten runs. (The first smoke run flagged 4 pages; those
  were other employees' names in the "uploaded by" column of general
  documents, which is correct. The check was narrowed to the page header
  before the measured runs.)
- Recommendation for the fixes below: keep all caching per request. If
  caching is ever added, key it by Mayan user and never cache document
  bodies, search results or counts across users.

## Targeted fixes, in order

1. **Search in one call** (extension + portal). New endpoint
   `recafco/search/?q=&page=` that calls `search_document_queryset` on
   `get_accessible_documents(user)` (Mayan search, ACL-restricted exactly as
   the department search already is) and returns summaries. The portal's
   search page then makes one call, with `departments` fetched in parallel.
   Expected from the probe: ~264 + 63 queries → ~67, ~740 ms → ~500 ms of
   Mayan time per search, one HTTP round trip instead of two. Must keep the
   integration tests for confidential search results green.
2. **Remove the listing N+1** (extension). Annotate `page_count` and "has
   pages" in the list query, and load `page_ids` only on the document detail
   view (lists never show them). Expected: 65 → ~5 queries per 20-row page.
3. **Gunicorn on the server** (settings, needs approval for the company
   server): `MAYAN_GUNICORN_WORKERS` ≥ 3 (one per core is a common start),
   `MAYAN_GUNICORN_MAX_REQUESTS` ≈ 5,000 with jitter ≈ 50 %. Tested here: no
   simultaneous restarts and no stalls.
4. **Memory for Mayan on the server**: measure the server's Mayan container
   under load, and keep it below its limit (this test needed ~3.1 GiB with 4
   web workers and 9 Celery processes).
5. **Processing capacity**: raise Celery concurrency for worker B (file
   processing and events), D (OCR) and E (search) to what the server's cores
   allow; run bulk imports off-hours. RECAFCO decision: whether
   born-digital PDFs need OCR (per document type in Mayan).
6. **Sign-in**: keep PBKDF2 strength; keep long portal sessions. More web
   workers spread a start-of-shift burst.

After 1 and 2, rerun `run.mjs` with the same dataset to verify.

## Capacity

Measured on this laptop: request throughput and latency per number of VUs
(tables above and in "Optimizations: before and after"). **No conversion to
a number of employees is made.** An earlier version of this report converted
5.2 req/s into "roughly 150 people" by assuming one request every 30 s per
person. That assumption has no evidence behind it and was withdrawn.
Converting needs measured usage: requests per active employee per minute
and the number of employees active at the busiest time (for example from
the portal's access logs during a pilot). The server's CPU count and the
real document volume must be measured on the server itself.

## How to repeat

Development stack only. Never against the company server (the driver
refuses any host except 127.0.0.1/localhost).

```sh
# 1. 60 synthetic accounts lt_emp_001..060. The random password is created
#    once in scripts/loadtest/.state/state.json (git-ignored) and never printed.
sh scripts/loadtest/setup-users.sh
# 2. Synthetic documents, then wait for the backlog to clear
sh scripts/dev-mayan.sh recafco_loadtest seed --count 1900
sh scripts/loadtest/backlog.sh                    # queue lengths
sh scripts/dev-mayan.sh recafco_loadtest status   # documents still processing
# 3. Query cost per endpoint
sh scripts/dev-mayan.sh recafco_loadtest queries --username lt_emp_001
# 4. Portal production build on 127.0.0.1:3107. Before each run, remove
#    the previous run's uploads and wait for an empty backlog:
sh scripts/loadtest/prepare.sh
node scripts/loadtest/run.mjs --mix mixed --stages 1,5,10,20,40 --stage-seconds 60 --label my-run --seed 1
node scripts/loadtest/summarize.mjs scripts/loadtest/.state/result-my-run-<timestamp>.json
# Optional tuned Mayan profile (dev only):
docker compose --project-name recafco-dms-dev -f deploy/dev/compose.yaml \
  -f deploy/dev/compose.loadtest-tuned.yaml up -d app
```

Each result file name includes a timestamp, and the driver refuses to
overwrite an existing file (two earlier result files in this assessment were
overwritten before that rule existed). `--seed` makes each VU repeat the same
sequence of operations, search words and documents; the result records the
code commit, Mayan settings, dataset size and whether the original Mayan was
running (observed with `docker stats` only).

## Files

- `mayan-extensions/recafco_dms/management/commands/recafco_loadtest.py`:
  synthetic accounts and documents, processing status, query probe. Refuses
  to run unless `RECAFCO_DEV_FIXTURES=1` (dev stack only), like `recafco_dev`.
- `scripts/loadtest/run.mjs` (driver), `summarize.mjs` (tables),
  `backlog.sh` (queues and held tasks), `setup-users.sh` (synthetic
  accounts), `prepare.sh` (same dataset and empty queues before each run),
  `drop-stale-search-tasks.mjs`, `compare.sh` (one before/after phase).
- `deploy/dev/compose.loadtest-tuned.yaml`: tuned profile for comparison.
- `.gitignore`: `scripts/loadtest/.state/` (password, results, logs).

## Dev stack state after the test

- The dev Mayan is back on the committed profile (2 workers, 2.5 GiB).
- The dev stack keeps the 2,000 synthetic documents and 60 `lt_emp_*`
  accounts (dev volumes only). The integration suite runs on the separate
  test stack `recafco-dms-test` (port 8092, own volumes; stopped, volumes
  kept), so the load-test data does not affect it.
- Every portal process started for the tests was stopped by its own PID.
- The original Mayan is running (started by someone else at 06:42:49 UTC);
  it was observed with `docker stats` only and not touched.

## Optimizations: before and after (2026-11-12)

Implemented in commit `31f33a0` (see `docs/decisions.md`):

1. **Search in one call**: `recafco/search/` runs the same Mayan search
   (`SearchBackend.search()` with the caller's ACLs and Mayan's results
   limit), returns the same count and pages, ordered by title (ties by ID),
   with summaries in the same response. The portal's search page makes one
   Mayan call and fetches the department list in parallel.
2. **No per-document page queries in lists**: page counts, first page IDs
   and "file has pages" for a whole list in 2–3 queries (`PageInfo`). Used
   by department lists, search, summaries, My uploads, favorites, recent
   documents and the admin document list. The single-document view is
   unchanged.

Not changed: permissions, confidentiality, uploads, OCR policy, password
hashing, Mayan worker and memory settings.

### Query cost per call (exact counts; times from a single call)

In-process probe (`recafco_loadtest queries`), employee `lt_emp_001`, same
dataset, fresh Mayan processes, round 2. Query counts are deterministic.
Times are one call each on a busy machine and indicative only.

| Call | Queries before → after | Time before → after (ms) |
| --- | --- | --- |
| Department list, page 1 (20 rows) | 65 → 7 | 121 → 58 |
| Department list, page 20 | 66 → 8 | 136 → 57 |
| Department search ("invoice") | 67 → 9 | 418 → 522 |
| Summaries for 20 IDs | 63 → 5 | 85 → 43 |
| My uploads (50 rows) | 163 → 5 | 193 → 80 |
| Company-wide search, 20 results | 264 + 63 in two calls → **9 in one call** | 818 + 85 → 899 (employee), 750 + 50 → 432 (administrator) |
| Document page (single document) | 24 → 24 (unchanged) | 41 → 44 |

Remaining search time is Mayan's Whoosh index lookup itself (SQL ~0.1 s of
each call), not database queries. Department search went from 67 to 9
queries, but its time is dominated by the same index lookup and varied
between single calls.

### Load test, round 2 (directly comparable)

Same machine, dataset (2,686 documents, 34 still without pages in both),
tuned dev profile (4 web workers, 6 GiB), seed, workload and procedure. The
code was verified per run (`--code-ref`): before = `5c7b4d4`, after =
`31f33a0`. Before every run, `prepare.sh` removed the previous run's
uploads, restarted the dev Mayan app, and waited until queues **and** tasks
held by workers were empty for 90 s. The original Mayan was running during
both phases and was recorded, not changed. Each run starts from freshly
started Mayan processes, so the 1-VU stage includes cold caches in both
phases.

| Workload | VUs | Before: req/s, p50 / p95 ms | After: req/s, p50 / p95 ms | Mayan CPU avg % before → after | Original Mayan CPU avg % before / after |
| --- | --- | --- | --- | --- | --- |
| Search only | 1 | 0.2, 2,748 / 10,083 | 1.0, 832 / 1,740 | 178 → 133 | 65 / 10 |
| Search only | 5 | 1.0, 4,696 / 9,066 | 1.8, 2,338 / 5,547 | 295 → 313 | 36 / 29 |
| Search only | 10 | 1.2, 7,603 / 15,804 | 1.8, 4,176 / 13,277 | 371 → 409 | 40 / 34 |
| Read only | 1 | 1.3, 602 / 1,896 | 4.1, 182 / 605 | 151 → 111 | 106 / 45 |
| Read only | 10 | 9.0, 831 / 2,781 | 9.1, 907 / 2,103 | 279 → 333 | 81 / 39 |
| Read only | 20 | 6.7, 2,266 / 6,887 | 8.5, 1,920 / 5,122 | 345 → 321 | 88 / 61 |
| Mixed | 1 | 1.0, 359 / 5,117 | 1.9, 261 / 1,443 | 244 → 199 | 51 / 23 |
| Mixed | 5 | 2.0, 1,321 / 8,647 | 6.4, 506 / 2,049 | 466 → 454 | 50 / 24 |
| Mixed | 10 | 1.4, 4,529 / 19,438 | 3.9, 1,583 / 6,703 | 547 → 551 | 59 / 45 |
| Mixed | 20 | 1.9, 5,798 / 28,188 | 3.2, 4,778 / 15,511 | 596 → 575 | 55 / 36 |
| Mixed | 40 | 1.9, 9,765 / 62,007 | 3.3, 9,180 / 31,745 | 610 → 577 | 51 / 52 |

Company-wide search inside the mixed workload, p50 / p95 ms: 1 VU 5,117 /
11,055 → 907 / 2,965; 5 VUs 5,222 / 13,125 → 1,276 / 3,010; 10 VUs 17,683 /
21,008 → 3,960 / 7,154; 40 VUs 54,626 / 69,755 → 12,414 / 25,804.

Errors: 0 in every run of both phases. Leak checks: 0 in every run; the
administrator received confidential documents in all concurrent control
responses (before 54 + 33 + 49, after 64 + 99 + 153). Memory: Mayan peak
2.6–3.3 GiB in both phases; portal ≤ 0.55 GiB. Processing backlog during the
runs: at most 82 tasks (uploads of the mixed workload) in either phase.
Sign-in bursts: 20 at once, p95 7.7–9.8 s before and 3.9–7.7 s after.
Hashing is unchanged, so this difference is noise and load, not an
improvement.

**How much of this is noise.** The same code (`5c7b4d4`) was measured twice
with the same procedure, apart from prepare.sh being improved between the
two rounds (round 1 and round 2 "before"). It differed by up to ~35 % in
throughput (mixed 10 VUs 1.9 vs 1.4 req/s; read 10 VUs 13.8 vs 9.0 req/s),
with the original Mayan using 15–106 % CPU on average and spiking to
~330 %. So only large differences are meaningful:

- **Search: clearly faster.** About 3× lower median at 1 VU (cold) and in
  the mixed workload, ~2× at 5–10 VUs in the search-only workload, and
  higher throughput of search requests (company-wide and department, 1.2 →
  1.8 per second at 10 VUs).
- **Mixed workload: clearly better.** 2–3× throughput at 5–10 VUs and
  roughly half the p95 latency at every level, mainly because search costs
  less CPU.
- **Read-only browsing: no measurable change at load** (9.0 vs 9.1 req/s at
  10 VUs, within noise), although each list now costs 7 instead of 65
  queries and about half the time in the probe. At this dataset size,
  database queries were not what limited browsing. The 1-VU read row
  (1.3 → 4.1 req/s) is mostly cold-start variance.

### Runs that are not comparable (kept, not used above)

| Run (result file prefix) | Why not comparable |
| --- | --- |
| `result-after-*` (round 1 "after", 08:36–08:48 UTC) | **Contaminated.** prepare.sh had deleted the previous run's uploads; Mayan kept retrying index tasks for those deleted objects (up to 40 retries, 60 s back-off), held by workers outside the queues where the backlog counter did not see them. The search queue grew to ~3,200 tasks during the runs, with ~3,000 more held. |
| `result-before-*` (round 1 "before") | Clean except the first search stage (up to 70 queued tasks left from an earlier purge). Its backlog column also did not count held tasks. Used only for the noise estimate. |
| Assessment runs before 2026-11-12 10:30 UTC | Different procedure (no dataset reset, no worker restart, unseeded workload). Two result files were overwritten before unique names existed. |
| Every run | The original Mayan was running from 06:42:49 UTC and used CPU (recorded per stage in each result). |

### Regression tests

`portal/tests/integration/12-search-and-lists.test.ts` (new) checks:
- the new endpoint against the previous two-call path for an employee, a
  confidential-group member and an administrator: same count, same
  documents and identical summaries;
- title order with ties by ID; pages of 10 cover each result once; 404 past
  the last page (same as Mayan); empty results; page size capped at 50;
  anonymous refused;
- confidential isolation: a word that occurs only inside a confidential
  file finds nothing for other employees, the confidential title is neither
  listed nor counted, group members find it by title and by file text, and
  responses contain no file text (the portal shows no excerpts, so there
  is no excerpt to leak);
- the portal search page shows the same counts, and "Show more results"
  pages through the results;
- department list, search results, My uploads, favorites and the admin list
  report the same pages and state as the single-document view.

Full suite on the separate test stack (fresh database, no load-test data):
**222 of 223 passed**. The failing test, "limits rapid sign-in requests per
username, not per address" (09), also failed in an earlier full run and
passed when its file was run alone. The limiter counts per calendar minute
(`window_start` = current minute), so the test's 11 sign-ins fail it
whenever they cross a minute boundary. This happened more often here
because each sign-in took 0.7–2 s on the busy machine. Search, lists and
sign-in code are separate, and the test was not changed at that point (it
is fixed in the release checkpoint below). The new tests and 08, 09 and 12
together passed 36/36 in a separate run.

## Release checkpoint (2026-11-12)

### Deletion and the search-index backlog

**Diagnosis.** While a document is deleted, Mayan's search handlers
(`dynamic_search/handlers.py`) queue a re-index of the *parent* of every
deleted part at once, inside the deletion transaction: the document for
each file, file page, version, version page, metadata entry and the like,
and the file for each of its pages and related records. After the deletion
commits, those parents no longer exist. Mayan's `task_index_instance`
answers "does not exist" with a retry (up to 40, back-off up to 60 s),
because an object may simply not be committed yet. For a deleted object,
every retry is wasted.

**Distinct tasks vs retries** (`scripts/loadtest/watch-index-tasks.mjs`
reads the dev queue and the tasks workers hold; a Celery task keeps its ID
across retries and carries its retry number). 20 one-page documents,
deleted through the administrators' path (recycle bin, then permanent
deletion), watched for 15 minutes, committed dev profile:

| | Before the fix | After the fix |
| --- | --- | --- |
| Distinct index tasks for the deleted objects | 780 (~39 per document: 422 for documents, 325 for files, 20 file pages, 20 version pages, 21 versions, 5 metadata) | same tasks are queued; the watcher's first sample caught 361, the rest had already finished |
| Attempts (first run + retries) seen in 15 min | 5,252 | 361 (each ran once) |
| Highest retry number seen | 6 of 40 (a single search worker process goes round all ~800 tasks per retry) | 0 |
| Index tasks still queued or held at the end | 812 (780 for deleted objects; 33 for existing objects, see note) | 0, from 17 s after the deletion |
| Targets that no longer exist | 780 of 780 for the deleted documents | 361 of 361 |

So the 11,195 tasks seen earlier for 280 deleted documents were about 40
**distinct** tasks per document (280 × 40), each in its retry cycle, not a
few tasks retried thousands of times. The 33 tasks for existing objects
were genuine retries for documents that existed, held by worker processes
I had restarted; Celery hands such tasks back after its 1-hour visibility
timeout.

**Fix** (extension only; Mayan's code unchanged): `search_cleanup.py` and
migration `0009_deletedobject`.
- A post-delete receiver writes a tombstone for each deleted document,
  file, file page, version, version page and metadata entry, in the same
  transaction as the deletion. A rolled-back deletion leaves none.
  Tombstones are removed after a day.
- Mayan's task is wrapped with Celery's own `Task.add_around('run', …)` when
  the Celery app is finalized. If the target is missing **and** has a
  tombstone, the task ends without retrying. Every other case runs Mayan's
  task unchanged.

Checked with `recafco_dev index-task-check`, which runs the task
synchronously:
- a deleted document ends at once (SUCCESS, tombstone present);
- an ID that never existed is still retried (RETRY on `DoesNotExist`);
- an existing document is indexed normally.

**Deletion leaves nothing reachable** (new test `13-permanent-deletion`,
plus the existing purge test in `11-admin-control`):
- record, file download and page preview are refused through Mayan and
  through the portal;
- neither the title nor a word that occurs only inside the file is found:
  not by the portal search, not by Mayan's search API, and not in the
  search index itself (raw index lookup);
- no index task for the deleted objects stays queued or held.

In the dev experiments, the raw index held no entry for either batch of
deleted documents.

### Sign-in limit test

The limit is unchanged: 10 sign-in requests per username per calendar
minute of Mayan's clock. Fixed windows: 10 just before and 10 just after a
minute boundary all pass. The test in `09-local-accounts` now:
- waits for a fresh server minute, read from Mayan's `Date` header, so the
  sign-in made while creating the account is not counted;
- requires all 11 answers to carry the same server minute (a precondition
  with its own message, not a retry);
- expects the first 10 to pass and the 11th to be refused with
  `Retry-After` between 1 and 60;
- checks that the next minute admits the user again.

A second test runs the real limiter with a fixed clock: 10 in a minute,
the 11th at :59.999 refused with a 1 s wait, :00.000 of the next minute
allowed, and a 10 + 10 burst across a boundary allowed with the 11th
refused. No assertion was weakened; the first test now checks all 10
successes (before: 9).

### Generated build directory

`portal/portal/.next` contained only Turbopack output: 11 files (loader
chunks, their source maps and a `package.json` with `{"type": "commonjs"}`),
all written at 08:20:21 on 2026-11-12 by the first build after the root
`package-lock.json` was removed the day before. Next.js infers its project
root from the nearest lockfile, so the root changed between two builds that
shared a cache. Writing to `portal/portal` fits that, but the cause could
not be reproduced. The files were deleted one by one, then the emptied
folders. The fix does not depend on the cause:
- `turbopack.root` and `outputFileTracingRoot` are pinned to the portal
  folder;
- ESLint ignores `.next` at any depth;
- Git already ignored `.next/` at any depth.

A later build wrote only to `portal/.next`, and the standard `npm run lint`
is clean.

### Final verification

Standard commands in `portal/`, on the final code:
- `npm run typecheck`, `npm run lint` (whole project) and `npm run build`:
  clean;
- `npm run test:unit`: 13/13;
- `npm run test:integration`: the complete suite on the separate test stack
  (fresh database, migration 0009 applied), **228/228 passed in 13 files**,
  in one run with no reruns (1,146 s). That includes:
  - the rewritten sign-in limit test (63 s, mostly waiting for minute
    boundaries) and the fixed-clock boundary test;
  - the four new permanent-deletion tests;
  - 12 (search and lists) and all earlier files.

No test failed.

### Remaining deployment constraints

- Nothing is deployed. On the server, after approval:
  - run migration `0009_deletedobject` (`migrate recafco_dms`; additive,
    one new table);
  - restart Mayan's app processes, so web and Celery workers load the
    extension (both the search endpoint and the deletion fix);
  - rebuild the portal.
- Worker counts, worker recycling (`MAYAN_GUNICORN_MAX_REQUESTS`) and memory
  limits are **not** approved production configuration. The measured
  simultaneous-recycling stall and memory ceiling still apply to any
  server running the defaults; they need measurement on the server.
- OCR policy is unchanged. Skipping OCR for text PDFs needs an evaluation
  of search completeness with real text-only and mixed scanned/text PDFs.
- Deletion still queues Mayan's ~39 index tasks per document; they now
  end on their first run. A large purge still causes one short burst of
  search-worker work.
- The fix relies on Celery's `add_around` and on Mayan's task name and
  argument names (`app_label`, `model_name`, `object_id`). A Mayan upgrade
  must re-run `13-permanent-deletion`. The test fails if the task is no
  longer wrapped.
- Deletions that bypass Django's post-delete signal (raw SQL) get no
  tombstone. Their tasks are retried as before.
- Search time is now mostly Mayan's Whoosh lookup. Larger document volumes
  should be measured before deciding whether a different search backend
  (Mayan supports Elasticsearch) is needed.
- No employee-count capacity figure is given (see "Capacity").

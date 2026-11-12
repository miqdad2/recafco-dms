# Performance assessment — portal ↔ Mayan integration (2026-11-12)

Branch `perf-assessment`. Isolated development stack only (`recafco-dms-dev`,
port 8091). Nothing was deployed, no architecture was changed, and no
application code was changed. The company server was not used.

Before measuring, Docker Desktop had to be started; with your approval the
original Mayan (project `mayan`) was then stopped with `docker stop` (no
configuration change, volumes kept). It was started again by someone else at
06:42:49 UTC during the last two runs; see "Test conditions".

## Summary

| # | Bottleneck (measured) | Effect | Targeted fix |
| --- | --- | --- | --- |
| 1 | **Search**: the portal calls Mayan's search API (264 SQL queries, ~670 ms, most of it Python building preview data the portal discards), then a second call for summaries (63 queries) | Search is 1.0–1.4 s for one user; the system manages ~2.5 searches/s; in the mixed workload search is ~25 % of requests but most of the CPU | One extension endpoint that runs the same ACL-restricted Mayan search (`search_document_queryset`, already used by department search) and returns summaries in one call |
| 2 | **Gunicorn workers recycle together**: every ~500 requests (jitter ±50); evenly loaded workers reach it together and both restart | Every request stalled for ~30 s (measured twice); also the cause of the "other side closed" errors handled in Unit 5 | `MAYAN_GUNICORN_MAX_REQUESTS` higher with wide jitter, ≥3 workers (tested: no restarts, no stalls) |
| 3 | **Mayan memory ceiling**: ~13 Python processes of 200–300 MB in a 2.5 GiB container | The cgroup hit its limit 9,018 times in one 5-minute run; latency became erratic (1 user: 0.9 req/s instead of 2.6) | Give the Mayan container ≥4–6 GiB, or fewer worker processes; check on the server before go-live |
| 4 | **Listing N+1**: `serialize_document` runs ~3 queries per document (page count, page IDs, "has pages") | A 20-row list = 65 queries (search summaries 63) | Annotate page count/state in the list query; read page IDs only on the document page |
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
starts. 10 VUs = 10 requests in flight continuously. A person reading
documents makes roughly one request every 20–60 s, so one VU represents
roughly 20–60 active people, and 1,000 accounts are not 1,000 VUs (most
accounts are idle at any moment). See "Capacity estimate".

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

## Capacity estimate (not a measurement)

On this laptop, with the tuned profile, the mixed workload stays at p95 ≈
3.3 s with 5 VUs (5.2 req/s) and the read-only workload at p95 < 1 s with 10
VUs (23.6 req/s). If an active employee makes one request every 30 s on
average, 5.2 req/s corresponds to roughly **150 people actively working at
the same moment** with today's search cost, or several hundred for
browsing only. How many of 1,000 accounts are active at once is unknown; ask
RECAFCO for peak usage instead of assuming. The server's CPU count, the real
document volume and fix 1 will change these numbers more than anything else.

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
  `backlog.sh` (queue lengths), `setup-users.sh` (synthetic accounts).
- `deploy/dev/compose.loadtest-tuned.yaml`: tuned profile for comparison.
- `.gitignore`: `scripts/loadtest/.state/` (password, results, logs).

## Dev stack state after the test

- The dev Mayan is back on the committed profile (2 workers, 2.5 GiB).
- The dev stack keeps the 2,000 synthetic documents and 60 `lt_emp_*`
  accounts (dev volumes only). The integration suite was **not** rerun
  against this larger dataset; tests that wait for the search index will be
  slower while any backlog is processing.
- The portal process started for the test was stopped by its PID.
- The original Mayan is running (started by someone else at 06:42:49 UTC);
  it was not touched after that.

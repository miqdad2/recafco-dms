#!/bin/sh
# Prints Celery queue lengths (dev Redis broker) and the dataset processing state.
# Usage: sh scripts/loadtest/backlog.sh   (dev stack only)
export MSYS_NO_PATHCONV=1
docker exec recafco-dms-dev-redis-1 sh -c 'for q in documents documents_fast documents_file documents_file_slow documents_version converter ocr ocr_slow parsing search search_slow indexing indexing_slow file_metadata file_caching file_caching_slow events_fast events_slow default statistics; do n=$(redis-cli -n 0 llen $q 2>/dev/null); [ "$n" != "0" ] && printf "%s=%s " $q $n; done; echo' 2>/dev/null

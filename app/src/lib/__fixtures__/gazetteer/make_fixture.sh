#!/usr/bin/env bash
# the two-place Parquet behind gazetteer.test.ts: NMS:CBNMS (one side of the antimeridian) and NMS:PMNM
# (split at +-180), cut from the repo copy of places.parquet with the native duckdb CLI.
# DuckDB closes a row group only after a whole 2048-row chunk, so ROW_GROUP_SIZE 1 still yields ONE row
# group for two rows; the test checks the id filter, not the row-group pruning (that needs the live file).
set -euo pipefail
cd "$(dirname "$0")"
duckdb -c "COPY (SELECT * FROM '../../../../../catalog/gazetteer/places/places.parquet' WHERE place_id IN ('NMS:PMNM', 'NMS:CBNMS') ORDER BY place_id) TO 'places.parquet' (FORMAT PARQUET, ROW_GROUP_SIZE 1, COMPRESSION ZSTD)"

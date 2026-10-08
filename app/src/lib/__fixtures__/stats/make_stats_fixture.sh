#!/bin/sh
# regenerates the tiny precomputed-stats fixtures (closed-form values, same columns and ZSTD
# compression as precompute/src/stats.ts writes). needs the native `duckdb` CLI.
#   continuous : 6 daily rows 2026-01-01..06, mean = 20 + day, mean_wt = mean + 0.5, n = 10
#   categorical: dates 2026-01-01 and 2026-01-09 x classes 1, 2 (fractions 0.75 / 0.25)
cd "$(dirname "$0")" || exit 1
duckdb -c "
COPY (
  SELECT (DATE '2026-01-01' + i::INT) AS date, 10::BIGINT AS n, 20.0 + i AS mean, 20.5 + i AS mean_wt,
         0.5 AS sd, 19.0 + i AS \"min\", 22.0 + i AS \"max\", 19.5 + i AS p10, 21.5 + i AS p90, 9.5 AS weight_sum,
         'NMS:TEST' AS place_id, 'dhw_5km' AS dataset_id, 'CRW_SST' AS variable
  FROM range(0, 6) t(i) ORDER BY 1
) TO 'continuous.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
COPY (
  SELECT * FROM (VALUES
    (DATE '2026-01-01', 1::BIGINT, 6::BIGINT, 7.5, 0.75, 60.0, 'NMS:TEST', 'noaa_aoml_seascapes_8day', 'CLASS'),
    (DATE '2026-01-01', 2::BIGINT, 4::BIGINT, 2.5, 0.25, 40.0, 'NMS:TEST', 'noaa_aoml_seascapes_8day', 'CLASS'),
    (DATE '2026-01-09', 1::BIGINT, 5::BIGINT, 5.0, 0.50, 50.0, 'NMS:TEST', 'noaa_aoml_seascapes_8day', 'CLASS'),
    (DATE '2026-01-09', 2::BIGINT, 5::BIGINT, 5.0, 0.50, 50.0, 'NMS:TEST', 'noaa_aoml_seascapes_8day', 'CLASS')
  ) t(date, class, n, weight, frac_area, pct_cells, place_id, dataset_id, variable)
) TO 'categorical.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
"

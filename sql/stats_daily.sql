-- daily key statistics for one place from an ERDDAP griddap slab.
--   {{var}}   variable column in the slab (e.g. CRW_SST)
--   {{slab}}  the registered griddap file (parquet) or view
--   {{mask}}  the mask table: latitude, longitude, weight (0,1]
-- the join is an exact equality on ROUND(x, 3): the ERDDAP axis is float32 in the parquet and float64
-- in the JS mask, so 21.375 arrives as 21.374999... on one side; rounding to the grid's 3 decimals
-- (0.05 spacing) makes the two match without a tolerance join.
SELECT
  s."time"::DATE                                    AS date,
  count(s.{{var}})                                  AS n,
  avg(s.{{var}})                                    AS mean,
  sum(s.{{var}} * m.weight) / sum(m.weight)         AS mean_wt,
  stddev_samp(s.{{var}})                            AS sd,
  min(s.{{var}})                                    AS min,
  max(s.{{var}})                                    AS max,
  quantile_cont(s.{{var}}, 0.10)                    AS p10,
  quantile_cont(s.{{var}}, 0.90)                    AS p90,
  sum(m.weight)                                     AS weight_sum
FROM {{slab}} s
JOIN {{mask}} m
  ON  ROUND(s.latitude::DOUBLE,  3) = ROUND(m.latitude::DOUBLE,  3)
  AND ROUND(s.longitude::DOUBLE, 3) = ROUND(m.longitude::DOUBLE, 3)
WHERE s.{{var}} IS NOT NULL
GROUP BY 1
ORDER BY 1

# AGENTS.md — Then vs Now: daily area series

- URL: `https://storage.oceanmetrics.io/gazetteer/series/{dataset_id}/{variable}/{place_id}.parquet`,
  e.g. `.../series/dhw_5km/CRW_SST/NMS:FKNMS.parquet` (colon kept).
- One row per day, 1985 to the last archived day; `mean` is the polygon **area-weighted** mean
  (cell coverage fraction), `mean_unwt` the plain one, plus `sd`, `min`, `max`, `n_cells`,
  `weight_sum`, and `mean_shiny` (the old climate-dashboard-app value).
- Day-of-year band of a date (matches the raster band): `dayofyear(make_date(2000, month(date), day(date)))`.
- A Then climatology of the area mean: `avg(mean)` grouped by that band over the baseline years.
- Pass a list of URLs, not a glob (no directory listing over HTTPS); take them from the
  `collection.json` item links or `summaries["erddap-places:place_id"]`.

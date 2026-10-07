# AGENTS.md — Then vs Now: daily rasters

- URL: `https://storage.oceanmetrics.io/gazetteer/rasters/{dataset_id}/{variable}/{place_id}/{year}.tif`,
  e.g. `.../rasters/dhw_5km/CRW_SST/NMS:FKNMS/2024.tif`. The colon in `place_id` stays in the path.
- What exists: `collection.json` `summaries` (`erddap-places:dataset_id`, `erddap-places:variable`,
  `erddap-places:place_id`, `year.minimum`/`year.maximum`), or the `rel: "item"` links.
- Band index: **band = day-of-year of the month-day in the year 2000** (a leap year). 1 Mar = 61
  always; band 60 (29 Feb) is NaN in non-leap years. In SQL: `dayofyear(make_date(2000, month(d), day(d)))`.
- Values: float32 °C, NaN = no data. EPSG:4326, 0.05° cells, bounding box = place bbox + 20 % buffer;
  mask to the polygon from [`../places/places.parquet`](../places/collection.json) yourself.
- One band = one ~6 kB range request (header ~150 kB, read once per file). Use geotiff.js
  `readRasters({ samples: [band - 1] })` in a browser, rasterio `ds.read(band)` or GDAL `/vsicurl/` elsewhere.
- Prebuilt baselines: [`../climatology/`](../climatology/AGENTS.md). Area means per day, already
  masked: [`../series/`](../series/AGENTS.md) — prefer them over reducing rasters yourself.

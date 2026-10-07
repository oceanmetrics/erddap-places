# AGENTS.md — Then vs Now: day-of-year climatologies

- URL: `https://storage.oceanmetrics.io/gazetteer/climatology/{dataset_id}/{variable}/{place_id}/{y0}-{y1}_{mean|sd|n}.tif`,
  e.g. `.../climatology/dhw_5km/CRW_SST/NMS:FKNMS/1985-2005_mean.tif`.
- Baselines: `1985-2005` and `2003-2012` (`summaries["erddap-places:baselines"]`; per Item
  `erddap-places:baseline` = `[y0, y1]`).
- 366 bands, band = day-of-year in 2000 (leap year); same grid as `../rasters/` for that place, so
  `now - then` is a per-pixel subtraction of the same band number.
- mean/sd float32 NaN nodata; n uint8 (0 = no year had a value). Raw day-of-year statistics, no
  smoothing window (`erddap-places:window_days` = 0).
- Other baselines: average the year files of `../rasters/` per band (see its README).

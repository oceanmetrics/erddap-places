# Then vs Now: FKNMS sample (interim, for the app)

The Florida Keys (`NMS:FKNMS`) SST cube is on S3. Update 2026-10-08: the other 12 sanctuaries are
also there, under the same paths (13 in all; TBNMS has no CRW data and is not published).
`summaries["erddap-places:place_id"]` in each collection lists them. Base URL: `https://storage.oceanmetrics.io/gazetteer/`. It answers with a 302 to
`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/...`, which serves range
requests (206) with `Access-Control-Allow-Origin: *` and exposes `Content-Range`. The S3 key keeps
the literal colon (`NMS:FKNMS`). A request for `NMS%3AFKNMS` or `NMS:FKNMS` reaches the same object
(both checked).

## Collections

| | URL |
|---|---|
| root catalog (3 new child links) | `https://storage.oceanmetrics.io/gazetteer/catalog.json` |
| rasters | `https://storage.oceanmetrics.io/gazetteer/rasters/collection.json` |
| climatology | `https://storage.oceanmetrics.io/gazetteer/climatology/collection.json` |
| series | `https://storage.oceanmetrics.io/gazetteer/series/collection.json` |

The `summaries` keys are `erddap-places:dataset_id` (`["dhw_5km"]`), `erddap-places:variable`
(`["CRW_SST"]`), `erddap-places:place_id`, `erddap-places:baselines`
(`["1985-2005", "2003-2012"]`) and `year` (`{minimum: 1985, maximum: 2026}`). Note that
`app/src/lib/thenNow/data.ts` (as of 2026-10-07) looks for the dataset under
`erddap-places:dataset` / `dataset`, not `erddap-places:dataset_id`.

## Year rasters: 366 bands, band i = day-of-year i of 2000

`https://storage.oceanmetrics.io/gazetteer/rasters/dhw_5km/CRW_SST/NMS:FKNMS/{year}.tif` for
1985…2026. The grid is 78 × 43 px at 0.05°, with bounds W −83.55, S 23.90, E −79.65, N 26.05. Values
are float32 °C with NaN as nodata. 2026 is partial: its last day is 2026-10-04, and later bands are
NaN.

| year | bytes |
|---|---|
| 1985 | 2,109,936 |
| 2000 | 2,148,028 |
| 2010 | 2,432,039 |
| 2020 | 2,423,221 |
| 2024 | 2,454,397 |
| 2025 | 2,450,449 |
| 2026 (to 10-04) | 1,949,251 |

All 42 years total 118 MB (2.1–2.5 MB each). Reading one band costs one range request of about
6 kB. The header is about 147 kB, read once per file. It holds the IFD plus the band descriptions
and the STATISTICS_* values, which Portolan requires to be embedded.

## Climatologies

`https://storage.oceanmetrics.io/gazetteer/climatology/dhw_5km/CRW_SST/NMS:FKNMS/{baseline}_{stat}.tif`

| file | bytes |
|---|---|
| `1985-2005_mean.tif` | 3,075,107 |
| `1985-2005_sd.tif` | 3,642,556 |
| `1985-2005_n.tif` (uint8) | 218,531 |
| `2003-2012_mean.tif` | 3,100,931 |
| `2003-2012_sd.tif` | 3,828,061 |
| `2003-2012_n.tif` (uint8) | 218,167 |

These are raw day-of-year statistics with no smoothing window.

## Series

`https://storage.oceanmetrics.io/gazetteer/series/dhw_5km/CRW_SST/NMS:FKNMS.parquet`: 677,844 bytes,
15,252 rows from 1985-01-01 to 2026-10-04 with no missing days. The columns are `date`, `mean`
(area-weighted over the polygon), `mean_unwt`, `sd`, `min`, `max`, `n_cells`, `weight_sum`,
`mean_shiny`, `place_id`, `dataset_id` and `variable`.

## Items

Each collection's `items/` folder holds one Item per file, e.g.
`rasters/items/dhw_5km_CRW_SST_NMS-FKNMS_2024.json`,
`climatology/items/dhw_5km_CRW_SST_NMS-FKNMS_1985-2005.json` and
`series/items/dhw_5km_CRW_SST_NMS-FKNMS.json`.

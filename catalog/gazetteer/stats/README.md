# Precomputed place statistics

One Parquet file per (ERDDAP dataset, variable, gazetteer place), covering the **last 365 days**
(or the dataset's full extent, if shorter). Published at
`https://storage.oceanmetrics.io/gazetteer/stats/`, refreshed weekly.

These are the same numbers the [browser app](https://oceanmetrics.io/erddap-places/) computes live:
the place polygon masks the dataset's own grid (a cell is in when its **centre** falls inside, and
boundary cells carry a **partial-area weight**), then `sql/stats_daily.sql` or
`sql/stats_categorical.sql` aggregates per day. The precompute script (`precompute/` in the repo)
imports the app's own `gridMask.ts`, `wkb.ts`, `erddap.ts` and `gazetteer.ts`, so a precomputed row
and a live in-browser row cannot drift. Use these when you want the answer *now*; run the live query
when you want *today*.

## Files

```
stats/
  collection.json                       # this collection
  items/<dataset>_<variable>_<place>.json   # one STAC Item per file
  dhw_5km/CRW_SST/NMS:HIHWNMS.parquet   # the data
  dhw_5km/CRW_SST/NMS:HIHWNMS.provenance.json   # the griddap URLs, mask size and SQL used
```

The object key keeps the place id verbatim, **colon and all** (`NMS:HIHWNMS.parquet`). A colon is a
legal S3 key character and a legal URL path character (RFC 3986 `pchar`), and `aws s3 sync`, `curl`
and DuckDB `httpfs` all round-trip it. STAC Item ids replace the colon with `-`
(`dhw_5km_CRW_SST_NMS-HIHWNMS`) so an id is always safe as a file name and a URL fragment.

## Read one

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:HIHWNMS.parquet')
ORDER BY date;
```

Read many at once by **listing** the URLs — DuckDB cannot glob over plain HTTPS (there is no
directory listing to expand `*` against), so pass an array. Every file carries `place_id`,
`dataset_id` and `variable`, so the union is self-describing:

```sql
SELECT place_id, avg(mean_wt) AS mean_sst
FROM read_parquet([
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:FKNMS.parquet',
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:HIHWNMS.parquet',
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:PMNM.parquet'])
GROUP BY place_id ORDER BY 2 DESC;
```

The URL list comes from `collection.json` (one `rel: "item"` link per file) or, with bucket
credentials, from a real glob: `read_parquet('s3://oceanmetrics.io-public/gazetteer/stats/dhw_5km/CRW_SST/*.parquet')`.

## Coverage

| dataset | variable | kind | places |
|---------|----------|------|--------|
| `dhw_5km` | `CRW_SST` | continuous (daily) | all 20 |
| `dhw_5km` | `CRW_BAA` | categorical (bleaching alert area 0–4) | all 20 |
| `noaa_aoml_seascapes_8day` | `CLASS` | categorical (seascape class 1–33) | the 5 reef/tropical places: `NMS:FKNMS`, `PSGID:939`, `NMS:HIHWNMS`, `NMS:NMSAS`, `NMS:PMNM` |

`NMS:PMNM` crosses the antimeridian, so it is fetched as **two lobes** (one each side of ±180) and
the two masks are unioned before aggregating.

## Schema

Continuous variables (`sql/stats_daily.sql`):

| Column | Type | Description |
|--------|------|-------------|
| date | date | UTC day of the time step |
| n | int64 | grid cells with a non-null value that day |
| mean | double | unweighted mean over the masked cells |
| mean_wt | double | area-weighted mean (partial boundary cells count for their overlap) |
| sd | double | sample standard deviation |
| min / max | double | extremes |
| p10 / p90 | double | 10th / 90th percentile |
| weight_sum | double | sum of the contributing cell weights |
| place_id, dataset_id, variable | string | so the files union cleanly |

Categorical variables (`sql/stats_categorical.sql`):

| Column | Type | Description |
|--------|------|-------------|
| date | date | UTC day of the time step |
| class | int64 | the class value (labels live in the dataset collection's `erddap-places:classes`) |
| n | int64 | cells in that class |
| weight | double | sum of those cells' area weights |
| frac_area | double | area-weighted share of the place; sums to 1 over a date (the SQL template calls this `fraction`) |
| pct_cells | double | unweighted percent of masked cells (the template calls this `percent_cells`) |
| place_id, dataset_id, variable | string | so the files union cleanly |

## Known gaps and one accepted warning

- `NMS:MNMS` (Monitor NMS, 2 km²) is **smaller than one 5 km grid cell** and no cell centre falls
  inside it, so its mask is empty and its files have 0 rows. That is the same answer the live app
  gives; a finer dataset (`jplMURSST41`, 0.01°) would resolve it.
- The Great Lakes sanctuaries (`NMS:TBNMS`, `NMS:LONMS`, `NMS:WSCNMS`) mask cells fine, but
  `dhw_5km` is an ocean product and is all-null there, so those files are 0 rows too. 4 of the 20
  `dhw_5km` places are empty for this reason; the other 16 have a full 364-day series.
- `rashid check` reports one warning on this collection, **PTL-CAT-001** ("45 children with no
  subcatalog grouping them"). Grouping the items into per-dataset subcatalogs would break the flat
  `stats/{dataset}/{variable}/{place_id}.parquet` path convention that makes the data guessable from
  a place id, so the warning is accepted deliberately. The catalog is at 0 errors.

## Provenance

Every parquet has a sibling `*.provenance.json` with the exact griddap request URLs, the number of
lobes and masked cells, the rendered SQL and the generation timestamp. The same URL list is on the
Item as `erddap-places:griddap_urls`.

## Regenerating

The parquet files are **not in git** (see `.gitignore`); the STAC Items and this collection are.
Rebuild them from the repo root:

```bash
cd precompute && npm ci && npm run stats       # ~25 min, polite: <=2 concurrent griddap requests
rashid check catalog/gazetteer
```

CI does exactly this weekly — see `.github/workflows/stats.yml`.

## License

CC-BY-4.0 for these derived files. The upstream grids are CC0-1.0 (NOAA CRW, NOAA AOML).

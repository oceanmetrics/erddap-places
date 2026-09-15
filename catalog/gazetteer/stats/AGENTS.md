# AGENTS.md — Precomputed place statistics

Guidance for AI agents and LLMs. **If a precomputed file exists for your (dataset, variable, place),
read it — it is one HTTP range-read instead of a minute of griddap.** Fall back to the live griddap
recipe in [`../erddap/AGENTS.md`](../erddap/AGENTS.md) only for a place/variable/date range not
covered here, or when you need data newer than the weekly refresh.

## 1. Statistics for place X from the precomputed items

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:HIHWNMS.parquet')
ORDER BY date;
```

The path is `stats/{dataset_id}/{variable}/{place_id}.parquet` and **`place_id` keeps its colon**
(`NMS:HIHWNMS`, `PSGID:939`, `MRGID:8439`). That is legal in an S3 key and in a URL path segment, so
no escaping is needed; if some client of yours chokes on the colon, percent-encode it as `%3A` — the
object key itself never changes.

Every file carries `place_id`, `dataset_id` and `variable` columns, so the files union cleanly.
**Pass a list, not a glob**: `*` cannot be expanded over plain HTTPS (no directory listing), and
DuckDB will tell you so. Take the URLs from `collection.json`'s `rel: "item"` links.

```sql
-- warmest of these sanctuaries over the last year
SELECT place_id, avg(mean_wt) AS mean_sst
FROM read_parquet([
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:FKNMS.parquet',
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:HIHWNMS.parquet',
  'https://storage.oceanmetrics.io/gazetteer/stats/dhw_5km/CRW_SST/NMS:PMNM.parquet'])
GROUP BY place_id ORDER BY 2 DESC;
```

## 2. Discover what is precomputed

Read [`collection.json`](collection.json): `summaries` lists every `erddap-places:dataset_id`,
`erddap-places:variable` and `erddap-places:place_id`, and each `rel: "item"` link points at an Item
under `items/`. An Item gives you:

- `assets.data.href` — the Parquet file (relative to `stats/`), plus `table:columns`, `file:size`
- `properties.erddap-places:place_id` / `:dataset_id` / `:variable`
- `properties.erddap-places:griddap_urls` — the exact ERDDAP requests behind the file
- `properties.start_datetime` / `end_datetime` — the covered window (`datetime` is `null`)
- `geometry` — the place's **lobe bounding boxes**, not its outline (the outlines run to ~40,000
  vertices; get the real polygon from [`../places/places.parquet`](../places/collection.json))

## 3. Continuous vs categorical

`CRW_SST` is continuous: one row per date with `mean`, `mean_wt`, `sd`, `min`, `max`, `p10`, `p90`.

`CRW_BAA` (bleaching alert area 0–4) and `CLASS` (seascape 1–33) are categorical: one row per
(date, class) with `frac_area` (area-weighted share, sums to 1 per date) and `pct_cells`. Class
labels are in the source collection's `cube:variables.<var>.erddap-places:classes`, e.g.
[`../erddap/dhw_5km/collection.json`](../erddap/dhw_5km/collection.json).

```sql
-- seascape composition of the Florida Keys, most recent date
SELECT class, round(frac_area, 3) AS frac_area
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/stats/noaa_aoml_seascapes_8day/CLASS/NMS:FKNMS.parquet')
WHERE date = (SELECT max(date) FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/stats/noaa_aoml_seascapes_8day/CLASS/NMS:FKNMS.parquet'))
ORDER BY frac_area DESC;
```

## What these numbers mean

`mean` is over grid cells whose **centre** falls inside the polygon; `mean_wt` weights each cell by
the fraction of its square the polygon covers, so a coastal place with many half-covered cells is
not biased by them. Antimeridian places (`NMS:PMNM`) are fetched as two lobes and unioned before
aggregation. The window is the last 365 days of the dataset's live extent, so `end_datetime` is the
dataset's last time step at the weekly refresh, not today.

## Do not

- Do not assume a row exists for every calendar date: `noaa_aoml_seascapes_8day` steps every 8 days,
  and a cloudy/missing day simply has no row.
- Do not compare `frac_area` across places as an *area*: it is a share of that place.
- Do not read an empty file as "no data available": `NMS:MNMS` is smaller than one 5 km cell, and
  the Great Lakes sanctuaries are outside `dhw_5km`'s ocean domain. Both give 0 rows on purpose.
- Do not re-derive a place mask from the bbox in an Item's `geometry` — that is the lobe box, not
  the polygon.

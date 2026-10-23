# precompute/

Builds `catalog/gazetteer/stats/` — one Parquet of daily statistics per (ERDDAP dataset, variable,
gazetteer place) — plus the STAC Collection and Items that describe them.

```bash
npm ci
npm run stats                                  # every target in src/targets.ts (~25 min)
npx tsx src/precompute.ts --place NMS:PMNM     # one place
npx tsx src/precompute.ts --dataset dhw_5km --days 30   # a quick smoke test
npx tsx src/precompute.ts --gazetteer noaa_nerrs --place NERRS:WEL --dataset dhw_5km   # a requested place of any collection
npx tsx src/precompute.ts --items-only         # rebuild the STAC from the existing provenance JSON
npx tsx src/precompute.ts --resume             # skip whatever already has a provenance JSON
```

## Why Node, and why it cannot drift from the app

The script imports the browser app's modules directly, so the mask is bit-for-bit the one the app
computes and the SQL is literally the same file:

| step | shared module |
|------|---------------|
| place polygons out of `places.parquet` (WKB) | `app/src/lib/wkb.ts`, `app/src/lib/gazetteer.ts` |
| split a place into griddap request lobes (±180) | `gazetteer.ts` `placeLobes()` |
| dataset description → base URL, variables, lat direction | `app/src/lib/catalog.ts` |
| the live time extent from `/erddap/info/<id>/index.json` | `app/src/lib/extent.ts` |
| the griddap URL and the axis vectors | `app/src/lib/erddap.ts` |
| which cells are in, and their partial-area weight | `app/src/lib/gridMask.ts` |
| the aggregation | `sql/stats_daily.sql`, `sql/stats_categorical.sql` |

Only the engine differs: native DuckDB (`@duckdb/node-api`) here, DuckDB-WASM in the browser. The one
local copy is `src/sql.ts`, which loads the templates with `fs` instead of Vite's `import.meta.glob`;
the `render()` / `lit()` rules are character-for-character the app's.

## One row per day

The final assembly (`assembleSql()` in `src/stats.ts`) keeps a day only from the chunk whose span
`<start>_<end>` holds it, and one row per `date` (plus `class` for categorical variables), the first chunk by name.
A chunk that ends on a day missing from the ERDDAP time axis gets its end snapped to the next available day, the next
chunk's first, and the two rows of that day differ in the last bits of the sums, so `SELECT DISTINCT` kept both (six
`CRW_SST` / `CRW_BAA` files carried a date twice, found by the Python engine's parity harness in
`oceanmetrics/extract`, which applies the same rule). Files published before this fix are corrected on their next
assembly; the aggregates and their thread order are unchanged.

## Being a good ERDDAP citizen

- one place at a time, per dataset; at most **2 concurrent** griddap requests, with a 750 ms pause
  between starts (`src/targets.ts`)
- the window is chunked to **≤ 90 days**, and shrunk further so a single request never asks for more
  than 100 k values (`MAX_REQUEST_VALUES`; a 39 k-cell bbox gets 2-day chunks; PMNM's main lobe, 101 k cells a step, gets
  one day per request)
- one retry, after 5 s, then the place is reported as failed and the run continues
- every download is cached under `.cache/`, so a re-run or a crash costs nothing at the server

## Output

```
catalog/gazetteer/stats/
  collection.json
  items/<dataset>_<variable>_<place-with-dashes>.json
  <dataset>/<variable>/<place_id>.parquet             # place_id keeps its colon
  <dataset>/<variable>/<place_id>.provenance.json     # griddap URLs, mask size, rendered SQL
```

The parquet and provenance files are gitignored; `collection.json` and `items/` are committed.
`src/stats.ts` has a `COLON_IN_KEYS` switch if a colon in an object key ever becomes a problem.

## Changing what is precomputed

Edit `src/targets.ts` (`TARGETS`, `DAYS`, chunk limits, concurrency) and re-run. A new dataset needs
an `erddap/<id>/collection.json` in the gazetteer first — the script reads the base URL, the
variables and `erddap:lat_descending` from there and never hardcodes a server.

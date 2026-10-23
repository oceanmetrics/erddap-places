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
- one retry, after 5 s, then the unit is given back to the scheduler (below) and the run continues
- every download is cached under `.cache/`, so a re-run or a crash costs nothing at the server

## Source host outages are a warning

The data come from three kinds of host: PacIOOS (`pae-paha.pacioos.hawaii.edu`), the mirror
(`erddap.oceanmetrics.io`) and coastwatch. A host that times out, drops the connection or answers 5xx, after the
retries (`liveExtent`, `download`, the app's `fetchAxis`), is down, not wrong. The rule (`src/outage.ts`, `src/run.ts`):

- each unit (dataset, variable, place) ends **completed**, **skipped** (its host did not answer), **error**
  or **deferred** (the deadline). `answered` records whether the host answered.
- a skipped unit is **untouched**: a unit's parquet and provenance are written beside the target and renamed
  over it only when whole, and nothing is published for it. Everything the other hosts gave is published as before.
- units of a host that is still down when the deadline comes are skipped too (`not reached`), not "deferred".
- `stats/outage.json` lists, per host, the skipped units and the first and last failure time. It is written
  only when a unit was skipped; a run that skipped none removes a stale one. It is git-ignored and never synced
  to S3. The workflow prints it as the step summary (`src/ci.ts outage-summary`), annotates one warning per host and
  uploads it as the `stats-outage` artifact.
- **the exit code is 1 only for an error**: a 4xx (the server refused the query), a SQL or parse error, a missing
  place, a bug, or a failed S3 upload. A run in which some units were skipped, or every unit was, exits 0.
  Nothing yet turns a unit that stays stale for days red (week 6 step 10); outage.json is where to see it.

### What PacIOOS's outage looked like (stats.yml, 2026-10-15 to 10-22)

The ten latest runs (`gh run list --workflow=stats.yml --limit 10`), all on the `macmini` runner. Scheduled runs
start 4 to 7 hours after the cron's 09:17 UTC (GitHub's queue), and this table's times are UTC.

| run (start) | length | red step | what happened on PacIOOS |
|---|---|---|---|
| 10-15 14:10 (schedule) | 3 h 27 | fail the job if the precompute reported failures | `NMS:PMNM` CRW_SST and CRW_BAA (the 1985-on one-request-a-day backfill): "fetch failed" and 503 on the griddap requests, given up after 3 tries; a 503 on `NMS:SBNMS` too |
| 10-15 23:07 (dispatch) | 2 h 37 | same | the same two units |
| 10-16 13:58 | 3 h 36 | same | the same two units |
| 10-17 12:59 | 5 h 54 | same | the same two units; connect failures rested the PacIOOS lane 10, 30, 60, 120 min |
| 10-18 13:18 | 3 h 08 | same | the same two units (`MRGID:8439`'s extent probe also got a 404) |
| 10-19 12:14 (dispatch), 16:28 (schedule) | to 20:58 | none: both cancelled during the precompute | |
| 10-20 14:19 | 8 h 44 | validate the catalog | over 40 retried requests on `NMS:PMNM` CRW_SST ("fetch failed" and 503), but it finished the backfill: 346 units computed, none given up |
| 10-21 14:30 | 37 min | validate the catalog | none: PacIOOS answered every request |
| 10-22 14:31 | 4 h 06 | validate the catalog | connect timeouts on the extent probe from 14:34 to 18:22, the lane resting 10, 30, 60, 120 min; recovered, 346 units computed |

So PacIOOS was unreliable from 10-15 to 10-18 and again on 10-20 and the morning of 10-22; 10-21 was clean. Only
10-15 to 10-18 were red **because of** PacIOOS (two units given up). **The red of 10-20, 10-21 and 10-22 was not
PacIOOS**: `rashid check` failed `PTL-LNK-002` ("contained object has no item link") on 6 Items that the workflow
fetches from S3 but `collection.json` does not list (the NERRS:WEL request, and `MRGID:8439` and `PSGID:939`,
removed from the `places` collection on 10-20, commit 6ece9e4). The workflow now drops those from the checkout
before the check (`src/ci.ts prune-unlisted`; S3 keeps them).

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

# AGENTS.md — erddap-places app

Rules for agents working in `app/` (Svelte 5 + Vite + TypeScript; see `README.md` for the why).

- Run `npm run check` (svelte-check + tsc) and `npm run test` (vitest; `ERDDAP_OFFLINE=1` skips the
  live network tests) before committing; both must be green. In a sandbox, set `TMPDIR` to a
  writable directory or vitest cannot start.
- Never hold place geometry in deep `$state` (see README "Never put place geometry in deep
  `$state`"); use `$state.raw` and `plainPlace()`.
- Map camera: only through `bind:bounds` in `MapView.svelte` (README, `mapView.svelte.test.ts`).
- SQL for the statistics mode lives in `../sql/*.sql`; the then-now series SQL is generated in
  `src/lib/thenNow/series.ts` and tested against the native `duckdb` CLI.

## Two views

- default: place statistics (`App.svelte`), hash `#place=…&dataset=…&variable=…&from=…&to=…`.
- `#mode=then-now`: Then vs Now (`src/lib/thenNow/ThenNow.svelte`, lazy chunk), hash
  `#mode=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0`
  (+ `pal=viridis`, `data=<root>`). `src/main.ts` picks the view and reloads when a link switches it.
  Mapping from the Shiny app and design notes: `docs/then-now.md`.

## Then-now data contract

Under the gazetteer root (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/`,
the bucket URL rather than the `storage.oceanmetrics.io` redirect, to save a 302 per range request);
`catalog.json` has child links to `rasters/`, `climatology/` and `series/` collections.

- `rasters/<dataset>/<variable>/<place_id>/<year>.tif` — COG, EPSG:4326, float32, nodata NaN,
  **366 bands: band i = day-of-year i of a leap year** (band 60 = 29 Feb, NaN in non-leap years;
  1 Mar = 61 always), INTERLEAVE=BAND, DEFLATE, 256 px tiles. Covers the place bbox + 20 %, **not
  masked** to the polygon.
- `climatology/<dataset>/<variable>/<place_id>/<y0>-<y1>_{mean,sd,n}.tif` — same grid, same bands.
  Baselines `1985-2005`, `2003-2012`.
- `series/<dataset>/<variable>/<place_id>.parquet` — one row per day: `date`, `mean` (area-weighted,
  masked), `sd`, `min`, `max`, `n_cells`, …
- `rasters/collection.json` `summaries`: `erddap-places:dataset_id`, `erddap-places:variable`,
  `erddap-places:place_id` (lists), `erddap-places:baselines`, `year.minimum/maximum`
  (`parseRasterCollection()` in `src/lib/thenNow/data.ts`).
- Place ids keep their colon in the object key; the app requests it as `%3A`.
- `rasters/items/<ds>_<var>_<NMS-XXX>_<year>.json` carry `erddap-places:n_days_valid`; 0 = an all-NaN
  year (`placeItemLinks()` / `emptyYears()` in `data.ts`). TBNMS has no rasters (not in the summaries).
- `CogReader` reads are memoised and shared: never pass a per-view AbortSignal into them.
- `src/lib/thenNow/thenNow.live.test.ts` reads FKNMS from S3 (skipped offline) and asserts the cost:
  ≤ 4 requests and < 64 kB for a first band, ≤ 16 kB for the next.
- Band ↔ month-day: `src/lib/thenNow/doy.ts` (`mdToBand`, `bandToMd`, `bandDate`).

The test fixture (`src/lib/thenNow/fixtures/`, < 1 MB) has the same layout for one 20 × 20 px place
`NMS:TEST` and two years; its values are a closed form documented in `make_fixture.mjs`, so tests
assert exact numbers.

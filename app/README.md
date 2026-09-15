# app — erddap-places in the browser

Svelte 5 + Vite + TypeScript. The whole pipeline runs client-side: a place polygon and an ERDDAP
dataset in, daily statistics out, with no server of ours in the request path.

```
place GeoJSON ─┐
               ├─ gridMask()  → cells + area weights   (src/lib/gridMask.ts)
ERDDAP axes  ──┘
                 griddapUrl() → one .parquet per lobe  (src/lib/erddap.ts)
                 DuckDB-WASM  → slab ⋈ mask, per day   (src/lib/engine.ts + ../sql/stats_daily.sql)
```

`src/App.svelte` picks a place from the published gazetteer (`places.parquet`, read with hyparquet,
WKB decoded by `src/lib/wkb.ts`), splits it into lobes (one griddap request each, grouped by side of
the antimeridian so PMNM works), and computes daily `CRW_SST` from PacIOOS `dhw_5km`.

## Run

```sh
npm install
npm run dev      # http://localhost:5179/
npm run test     # vitest: WKB decode, gazetteer/lobes, gridMask counts, ERDDAP URL shapes, SQL,
                 # time-extent parse + window clamp, FKNMS mask budget, run tokens
                 # (live PacIOOS/gazetteer tests skip when offline)
npm run build    # → dist/ (base './', so it works from any GitHub Pages path)
npm run check    # svelte-check + tsc
```

`ERDDAP_OFFLINE=1 npm run test` forces the live-network tests to skip.

## Notes

- `sql/` lives at the **repo root**, not in `app/`: `engine.ts` pulls the templates in with
  `import.meta.glob('../../sql/*.sql', { query: '?raw' })`, so the same SQL is runnable with the
  native `duckdb` CLI.
- `@duckdb/duckdb-wasm` is pinned exactly (1.29.0) and excluded from the dep optimizer; its wasm and
  worker bundles are imported with `?url` and self-hosted (no jsDelivr in the critical path).
- `static/` is the Vite public dir (empty: the app has no static place files any more).
  `src/lib/__fixtures__/*.geojson` are the four test sanctuaries (public NOAA data, from
  `noaa-onms/onmsR`).
- **Categorical grids** (`CLASS` in AOML Seascapes, `CRW_BAA` in `dhw_5km`) are marked in the
  catalog with `erddap-places:categorical` and an `erddap-places:classes` label map. They run
  `sql/stats_categorical.sql` instead of `stats_daily.sql`: per date × class, the number of cells,
  the area weight, the area-weighted `fraction` (sums to 1 per date) and the percent of cells. The
  chart is a stacked area of the class proportions (`Plot.areaY` with `offset: 'normalize'`), the
  colours being seascapeR's reversed ColorBrewer Spectral ramp (`src/lib/palette.ts`).
- **One run at a time** (`src/lib/runToken.ts`): each `run()` takes a token and an `AbortController`
  from `Runs`, which aborts whatever was in flight; every await checkpoint (extent, axes, slab,
  DuckDB) returns early when `stale()`, and the signal goes into every `fetch`. The results also
  carry the variable they came from (`shownVar`), so a superseded SST run can no longer render
  through the newly-picked categorical template as "class NaN" rows. The pickers stay live while a
  run is in flight and the button reads "Run (supersedes)".
- **Never put place geometry in deep `$state`** (verified 2026-09-15): Svelte 5's reactive proxy
  wraps every nested coordinate array, and `gridMask` reads each vertex many times — masking FKNMS
  (13 parts, 39,645 vertices) takes **0.24 s on plain arrays and 67 s through the proxy** (TBNMS:
  202 s), which is the main-thread freeze that was seen in the browser. `App.svelte` keeps
  `places`/`datasets`/`rows`/`urls` in `$state.raw` and calls `plainPlace()` (`src/lib/gazetteer.ts`)
  before `placeLobes`/`gridMask`; `structuredClone` cannot do that job (DataCloneError on a proxy).
  `maskPerf.test.ts` is the regression: the decode + lobes + weighted mask of FKNMS, plain and
  `proxy()`-wrapped, must finish in under 1 s. Selecting a place does no geometry work at all — the
  whole pipeline waits for Run — and the mask time is printed in the status line.
- **Time extent comes from the server, not the catalog** (`src/lib/extent.ts`): the STAC
  `cube:dimensions.time.extent` end is `null`/stale, so on dataset selection the app reads
  `<base>/info/<datasetID>/index.json` (the `time` `actual_range` row, seconds since epoch, with the
  `time_coverage_*` globals as the fallback) and caches it. The picker shows "data through
  2026-06-26"; the default window is the last 30 days ending at the **dataset's** last time step
  (widened to ~8 steps for a coarser product, so the 8-day Seascapes grid gets 65 days), and a
  user window is clamped to the extent — a start after the end snaps back and says so in the status
  line instead of 404ing on `"Start" is greater than the axis maximum=…`. `averageSpacing` from the
  same info table labels the chart x-axis and status ("8-day steps"), and the extent's own endpoints
  go into the griddap constraint verbatim so a non-noon axis (MUR is 09:00Z) cannot be overshot.
- Datasets and variables come from the STAC Collections under `erddap/` in the catalog
  (`src/lib/catalog.ts`): `cube:variables` fills the variable picker, `erddap:cors`/`erddap:formats`
  choose the format rung, `erddap:lat_descending` orients the latitude constraint, and a Kelvin unit
  becomes a `- 273.15` in the SQL (`valueExpr`).
- The gazetteer base URL is one constant in `src/lib/gazetteer.ts`
  (`https://storage.oceanmetrics.io/gazetteer/`), with the bucket URL
  (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/`) as the fallback on any
  fetch failure.
- SQL template loading/rendering lives in `src/lib/sql.ts`, separate from `engine.ts`, so the
  templates can be rendered and run in plain Node against the native `duckdb` CLI (`sql.test.ts`).
- ERDDAP wants each constraint's `[` `]` percent-encoded and nothing else, and it rejects an
  ascending constraint on a **descending** axis — `latitude` on the CRW grid must be `[(hi):1:(lo)]`.

## DuckDB-WASM gotchas (verified 2026-09-15)

- No ICU extension in the WASM build, so `TIMESTAMPTZ::DATE` is unimplemented; `sql/stats_daily.sql`
  goes through `make_timestamp(epoch_ms(time) * 1000)::DATE` instead (UTC day).
- `import.meta.glob` paths are relative to the importing file: `src/lib/engine.ts` reaches the repo-root
  `sql/` as `../../../sql/*.sql`.
- Arrow returns DATE values to JS as epoch milliseconds; format with `new Date(v)`.

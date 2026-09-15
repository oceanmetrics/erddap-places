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
npm run test     # vitest: WKB decode, gazetteer/lobes, gridMask counts, ERDDAP URL shapes, SQL
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

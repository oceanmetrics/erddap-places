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

The first slice (`src/App.svelte`) does daily `CRW_SST` for the Hawaiian Islands Humpback Whale
sanctuary (HIHWNMS) from PacIOOS `dhw_5km`: 124 grid cells, 30 days, one ~15–20 s griddap request.

## Run

```sh
npm install
npm run dev      # http://localhost:5179/
npm run test     # vitest: gridMask counts + ERDDAP URL shapes (live PacIOOS tests skip when offline)
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
- `static/` is the Vite public dir. `static/places/HIHWNMS.geojson` stands in for the gazetteer
  Parquet until it exists; `src/lib/__fixtures__/*.geojson` are the four test sanctuaries (public
  NOAA data, from `noaa-onms/onmsR`).
- ERDDAP wants each constraint's `[` `]` percent-encoded and nothing else, and it rejects an
  ascending constraint on a **descending** axis — `latitude` on the CRW grid must be `[(hi):1:(lo)]`.

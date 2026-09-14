# erddap-places

Place-based key statistics from ERDDAP™ gridded (and tabular) datasets, computed **in the browser**
with DuckDB-WASM, for places from a gazetteer (NOAA sanctuaries, MarineRegions MRGID, ProtectedSeas
PSGID). No server of ours in the request path except ERDDAP itself. Started 2026-09-14 after Roy
Mendelssohn's ioos_tech post "duckDB as an ERDDAP client".

## How it works

1. **Places** — `places.parquet` (GeoParquet, split at the antimeridian) + `places.pmtiles` for the map,
   published on S3 as a Portolan-conformant STAC catalog at `https://storage.oceanmetrics.io/gazetteer/`.
2. **Catalog** — one STAC Collection per ERDDAP dataset with the `datacube` extension and `erddap:*`
   fields (`base_url`, `dataset_id`, `protocol`, `version`, `cors`, `formats`, `lon_range`).
3. **Mask** — from the dataset's axis vectors and the place polygon, a JavaScript `gridMask()` marks
   grid cells in/out (scanline fill, turf point-in-polygon for small cases) and computes partial-cell
   **area weights** (`@turf/bbox-clip` + `@turf/area`). Sub-second for every sanctuary including PMNM.
4. **Fetch** — one griddap `.parquet` request per polygon lobe, tightened to the mask extent; fallback
   rungs `.csvp` (old servers with CORS) and `.json?…&.jsonp=` (servers without CORS).
5. **Stats** — DuckDB-WASM joins slab × mask and aggregates per time step: n, mean, area-weighted
   mean, sd, min, max, p10/p90, percent over threshold; monthly roll-ups in SQL.
6. **Deliver** — Svelte 5 + Vite + svelte-maplibre app on GitHub Pages; CSV/Parquet export with the
   exact URLs used; precomputed long series as STAC Items under `stats/`.

## Layout

```
app/        Svelte app (DuckDB-WASM engine, gridMask, URL builder, charts, map)
catalog/    builders: places (R/sf → GeoParquet + PMTiles), erddap collections, stats items
sql/        {{named}}-parameter SQL templates executed in the browser
spikes/     verified experiments (see spikes/README.md)
```

## Servers

- Direct: PacIOOS (`dhw_5km` CRW SST/DHW/BAA; CORS on, ERDDAP 2.29).
- Via `erddap.oceanmetrics.io` (`oceanmetrics/erddap`): CoastWatch MUR SST, VIIRS chl, AOML Seascapes
  re-served with CORS + Parquet.

## Status

Pre-P1: repo scaffold and spikes only. Plan phases P0–P3 target a demo at the MBON all-hands, Oct 14–16 2026.

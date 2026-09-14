# Spikes (2026-09-14)

Verified experiments behind the design. Inputs: NOAA sanctuary polygons from `noaa-onms/onmsR`
(`data-raw/sanctuary_polygons/*.geojson`) and a 30-day `CRW_SST` slab from PacIOOS ERDDAP
(`dhw_5km.parquet?CRW_SST[(2026-08-01T12:00:00Z):1:(2026-08-30T12:00:00Z)][(18.8):1:(22.4)][(-160.3):1:(-154.5)]`).

| File | What it shows |
| --- | --- |
| `duckdb_mask_proof.sql` | native DuckDB: ERDDAP Parquet slab → `ST_Within` mask → daily stats (124 cells in HIHWNMS; 0.4 s) |
| `duckdb_h3_mask_proof.sql` | H3 masks need `ST_Dump` (MULTIPOLYGON → 0 cells otherwise); res 8 → 126, res 9 → 122 |
| `gridmask_bench.mjs` | JS masking without extensions: turf point-in-polygon vs scanline fill, both exact; boundary area weights via `@turf/bbox-clip` + `@turf/area` (PMNM: 101k candidate cells, scanline 34 ms, weights 0.7 s) |
| `turf_grid_bench.mjs` | why not turf `pointGrid`/`squareGrid`: `pointGrid` misaligns to the ERDDAP lattice; `squareGrid({mask})` aligns but is ~1,000× slower on complex boundaries |

Run: `npm i @turf/boolean-point-in-polygon @turf/helpers @turf/bbox-clip @turf/area @turf/square-grid @turf/point-grid` then `node spikes/gridmask_bench.mjs` (expects the GeoJSON files beside it).

# AGENTS.md — erddap/

Guidance for AI agents and LLMs computing fresh place statistics from these ERDDAP collections.

## Pattern: fresh statistics for a place

1. Read the place's geometry and per-lobe bbox from `../places/places.parquet` (one bbox per
   MULTIPOLYGON lobe; antimeridian-crossing places like `NMS:PMNM` have >1 lobe).
2. Read `collection.json` for the dataset (e.g. `dhw_5km/collection.json`) and take the `griddap`
   asset `href` template plus `cube:dimensions` / `cube:variables`.
3. For each polygon lobe, build the griddap URL by substituting the template placeholders —
   `{variable}`, `{t0}`, `{t1}`, `{lat_max}`, `{lat_min}`, `{lon_min}`, `{lon_max}` — with the
   lobe's bbox and desired time range/variable. **Percent-encode each constraint separately**
   (the `()`, `:`, and sign characters), e.g.:

   ```
   https://pae-paha.pacioos.hawaii.edu/erddap/griddap/dhw_5km.parquet?CRW_DHW%5B(2024-01-01T12:00:00Z):1:(2024-01-31T12:00:00Z)%5D%5B(34.5):1:(33.0)%5D%5B(-119.9):1:(-118.9)%5D
   ```

4. `read_parquet(url)` directly in DuckDB (or duckdb-wasm in-browser; both `erddap:cors` fields
   are `true`).
5. Mask to grid cells whose centre falls inside the polygon lobe (e.g. `ST_Contains`/`ST_Within`
   in DuckDB spatial, or turf.js `booleanPointInPolygon` in the browser).
6. Aggregate per day (mean/min/max) across the masked cells.

`erddap:lat_descending` tells you whether to request `[(lat_max):1:(lat_min)]` (descending, as
above) or `[(lat_min):1:(lat_max)]` (ascending) — get this backwards and ERDDAP returns an error.

## Related

See [`../AGENTS.md`](../AGENTS.md) for the "find a place" pattern.

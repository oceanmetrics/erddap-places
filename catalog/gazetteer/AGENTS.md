# AGENTS.md — Ocean Metrics gazetteer

Guidance for AI agents and LLMs working with this catalog. Two patterns cover most needs.

## 1. Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/places/places.parquet')
WHERE place_id = 'NMS:HIHWNMS';
```

`place_id` is a prefixed id: `NMS:<code>` (sanctuary), `MRGID:<id>` (MarineRegions), or
`PSGID:<id>` (ProtectedSeas). See [`places/AGENTS.md`](places/AGENTS.md).

## 2. Fresh statistics for a place

1. Read an `erddap/*/collection.json` (e.g. [`erddap/dhw_5km/`](erddap/dhw_5km/collection.json)).
2. Take the place's bbox per polygon lobe (from `places.parquet`'s `bbox` column — a place can
   have multiple lobes, e.g. antimeridian-crossing `NMS:PMNM`).
3. Build the griddap URL from the collection's `griddap` asset href template, substituting
   `{variable}`, `{t0}`, `{t1}`, `{lat_min}`, `{lat_max}`, `{lon_min}`, `{lon_max}` — percent-encode
   each `[(...)...]` constraint separately.
4. `read_parquet(url)` (DuckDB or duckdb-wasm in-browser; both datasets are CORS-enabled).
5. Mask to grid cells whose centre falls inside the polygon lobe, aggregate per day.

Full walkthrough: [`erddap/AGENTS.md`](erddap/AGENTS.md).

## Collections

- [`places/`](places/) — the gazetteer (GeoParquet + PMTiles).
- [`erddap/dhw_5km/`](erddap/dhw_5km/) — NOAA Coral Reef Watch SST + DHW (live).
- [`erddap/jplMURSST41/`](erddap/jplMURSST41/) — JPL MUR SST v4.1 (mirror not yet live; use the
  `griddap_upstream` asset).

## License

CC-BY-4.0 for our derived `places/` files. ERDDAP collections describe upstream services under
their own licenses (see each collection's README).

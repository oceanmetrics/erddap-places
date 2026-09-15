# JPL MUR SST v4.1 (re-served)

STAC Collection describing (not mirroring) the JPL MUR SST v4.1 griddap dataset: 0.01° daily
global analysed sea surface temperature.

- Source: NASA JPL PO.DAAC MUR SST v4.1, served via NOAA CoastWatch ERDDAP.
- Server: `https://erddap.oceanmetrics.io/erddap` (planned mirror, **not yet live**).
- Upstream today: `https://coastwatch.pfeg.noaa.gov/erddap` (ERDDAP 2.31.1), CORS enabled — use
  the `griddap_upstream` asset until our mirror ships.
- Coverage: 2002-06-01 to present, daily, 0.01° grid, global.
- Variables: `analysed_sst`, `analysis_error`, `mask`, `sea_ice_fraction`.
- License/attribution: public domain (NASA JPL PO.DAAC / NOAA CoastWatch).

## How to read

```sql
SELECT * FROM read_parquet('<built griddap.parquet URL, from the griddap_upstream asset>');
```

See [`AGENTS.md`](AGENTS.md) for the full query-building pattern.

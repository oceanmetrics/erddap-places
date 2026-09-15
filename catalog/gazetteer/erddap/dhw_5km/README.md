# NOAA Coral Reef Watch — Daily Global 5km SST + DHW

STAC Collection describing (not mirroring) the PacIOOS ERDDAP `dhw_5km` griddap dataset: NOAA
Coral Reef Watch's daily global 5km coral bleaching heat-stress monitoring product.

- Source: NOAA Coral Reef Watch (CRW), served live via PacIOOS ERDDAP.
- Server: `https://pae-paha.pacioos.hawaii.edu/erddap` (ERDDAP 2.29), CORS enabled.
- Coverage: 1985-04-01 to present, daily, 0.05° grid, global.
- Variables: `CRW_SST`, `CRW_SSTANOMALY`, `CRW_DHW`, `CRW_BAA`, `CRW_HOTSPOT`.
- License/attribution: public domain (NOAA); attribute as "NOAA Coral Reef Watch (CRW)".

## How to read

```sql
-- DuckDB: build a griddap parquet URL from the `griddap` asset href template in collection.json,
-- percent-encoding each [()...] constraint separately, then:
SELECT * FROM read_parquet('<built griddap.parquet URL>');
```

See [`AGENTS.md`](AGENTS.md) for the full query-building pattern.

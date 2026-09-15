# NOAA AOML Seascapes — 8-day Global (categorical)

STAC Collection describing (not mirroring) the `noaa_aoml_seascapes_8day` ERDDAP griddap dataset:
global seascape classes, a biogeographic framework in which space and time are classified
simultaneously from synoptic satellite time series using hierarchical, topology-preserving machine
learning.

- Source: NOAA AOML / CoastWatch, OSU, USF, NASA, UAF, IOOS, NMS.
- Upstream server: `https://cwcgom.aoml.noaa.gov/erddap` (no CORS headers).
- Server used here: `https://erddap.oceanmetrics.io/erddap` (re-served with CORS + Parquet).
- Coverage: 2002-08-29 to present, 8-day composites, 0.05° grid, global, latitude **ascending**.
- Variables: `CLASS` (categorical seascape 1–33, 0 = fill) and `P` (class probability, 0–1).
- License/attribution: CC0-1.0 (public domain, NOAA); attribute as "NOAA AOML Seascapes".

`CLASS` is flagged `erddap-places:categorical: true` and carries `erddap-places:classes`, the
value → label map taken from the dataset's own `flag_values`/`flag_meanings` and from the seascape
class table in [`marinebon/seascapeR`](https://marinebon.org/seascapeR/). Categorical variables are
summarised per date as cell counts and area-weighted fractions per class, not as means.

## How to read

```sql
-- DuckDB: build a griddap parquet URL from the `griddap` asset href template in collection.json,
-- percent-encoding each [()...] constraint separately, then:
SELECT * FROM read_parquet('<built griddap.parquet URL>');
```

See [`AGENTS.md`](AGENTS.md) for the full query-building pattern.

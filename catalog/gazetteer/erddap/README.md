# ERDDAP dataset descriptions

STAC Collections describing two ERDDAP griddap datasets used to compute fresh place statistics
in the browser (DuckDB-WASM), rather than storing pre-computed values. Each collection carries the
[datacube extension](https://stac-extensions.github.io/datacube/v2.2.0/schema.json) (dimensions,
variables) plus custom `erddap:*` fields (base URL, dataset id, protocol, CORS support, formats)
and a templated `griddap` asset href for building query URLs.

- [`dhw_5km/`](dhw_5km/collection.json) — NOAA Coral Reef Watch daily 5km SST + degree heating
  weeks (DHW). Live on PacIOOS ERDDAP today.
- [`jplMURSST41/`](jplMURSST41/collection.json) — JPL MUR SST v4.1, 0.01-degree daily. Points at
  `erddap.oceanmetrics.io` (our planned re-serving mirror, **not yet live**); the collection also
  carries an `erddap:upstream_url` and a `griddap_upstream` asset pointing at the NOAA CoastWatch
  server, which is usable today.

## Note on Portolan/rashid validation

These are metadata-only collections that describe a remote, queryable API — there is no local data
asset to fetch or convert (`portolan add-external` intentionally never downloads the remote parquet,
and the query template itself is not a fetchable file). `rashid check` / `portolan check` pass with
0 errors on these collections, but leave 10 `PTL-AST-003` **warnings**: "asset '<name>' has no
file:checksum / file:size". That rule expects every asset to be a concrete file whose bytes can be
hashed and sized; the `griddap`, `griddap_upstream`, and `metadata` assets here are URL *templates*
(`{variable}`, `{t0}`, ... placeholders) and a live JSON endpoint, not static files — there is no
fixed byte content to checksum. This is the documented workaround: leave the warning in place rather
than inventing a checksum for a URL template. All other rules (structure, links, providers, license,
datacube extension) pass cleanly.

## Reading

See [`AGENTS.md`](AGENTS.md) for the query pattern (build a griddap URL from the template, read it
with DuckDB's `read_parquet`).

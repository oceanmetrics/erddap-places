# CalCOFI Bottle Database — observations

STAC Collection for the CalCOFI bottle (hydrographic) observations served as **tabledap** by
[`erddap.calcofi.io`](https://erddap.calcofi.io/erddap/info/calcofi_bottle/index.html), ERDDAP 2.30.

- **Coverage** 1949-02-28 → 2021-05-13; the California Current, roughly 18–51 °N, 164–106 °W.
- **Long format** — one row per (sample, measurement type). `measurement_type` names the quantity
  and `measurement_value` holds it; `erddap-places:long_format` records the pair, and the
  `cube:variables` here (temperature °C, salinity PSS-78, chlorophyll_a µg/L = mg m⁻³, nitrate,
  phosphate, silicate µmol/L, oxygen_ml_l ml/L) are *values of `measurement_type`*, not columns.
- **CORS + Parquet** — `Access-Control-Allow-Origin` echoes the origin and `.parquetWMeta` is
  served, so the browser reads it directly into DuckDB-WASM with no proxy of ours.

License: `other` — the ERDDAP dataset states "license: not specified"; see
[CalCOFI data access and terms of use](https://calcofi.org/data/), which the collection's
`rel: license` link points at.

See [`AGENTS.md`](AGENTS.md) for the query pattern.

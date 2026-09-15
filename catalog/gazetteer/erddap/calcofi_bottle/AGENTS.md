# AGENTS.md — CalCOFI Bottle Database — observations (tabledap)

## Overview

CalCOFI hydrographic bottle observations, 1949-02-28 to 2021-05-13 (nothing newer). A live ERDDAP
**tabledap** dataset on `https://erddap.calcofi.io/erddap` (ERDDAP 2.30), referenced in place, not
mirrored. This is the first tabledap collection in this catalog: every other one is griddap.

## Accessing the data

Build a URL from the `tabledap` asset template in `collection.json`. Each constraint is
percent-encoded **separately** — `%2C` between the requested columns, `%3E=` / `%3C=` for the
bounds — and the rest of the query is left literal, exactly as for griddap. `erddap:cors` is `true`
(verified: `Access-Control-Allow-Origin` echoes the requesting origin) and `.parquetWMeta` is
served, so a browser can read the result straight into DuckDB-WASM. A two-degree box over two years
is a few hundred kB.

## Schema & field notes

**Long format.** One row per (sample, measurement type): `measurement_type` names the quantity,
`measurement_value` holds it, `units` gives its unit. `erddap-places:long_format` records the two
column names, and each value of `measurement_type` that this catalog exposes appears as a
`cube:variables` entry — so "variable" means *a row filter*, `measurement_type = 'temperature'`,
not a column. The full list the server reports is longer (alkalinity, c14, nitrite, pigments, the
`r_*` reported-as-submitted duplicates); the seven listed here are the common ones.

Points are **sparse and irregular** in time and space, so place statistics group by month, not by
day, and cells are masked by point-in-polygon rather than by a grid mask.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

# AGENTS.md — MODIS-Aqua net primary productivity (VGPM) — monthly global 9 km

## Overview

Monthly net primary productivity (npp) from the Vertically Generalized Production Model (VGPM) applied to MODIS-Aqua, Oregon State University Ocean Productivity, 9 km global. 2002-07-31 to 2023-12-31.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.083372° lat, 0.083333° lon, latitude **descending**, longitude -180 → 179.9167.
Time: step P1M; the live extent is in `info/moda_npp_mo_glob/index.json`.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

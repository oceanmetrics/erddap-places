# AGENTS.md — NASA GPM IMERG — monthly global precipitation

## Overview

Monthly accumulated precipitation from the NASA Global Precipitation Measurement mission IMERG product, 0.1 degree global. 1998-01-01 to 2025-09-01.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.1° lat, 0.1° lon, latitude **descending**, longitude -179.95 → 179.95.
Time: step P1M; the live extent is in `info/IMERG_monthly_global_precip/index.json`.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

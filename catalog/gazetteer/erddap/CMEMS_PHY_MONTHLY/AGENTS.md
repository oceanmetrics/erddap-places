# AGENTS.md — CMEMS Global Ocean Physics — surface salinity (known NaN)

## Overview

Sea water salinity (so) at the surface level from the CMEMS global ocean physics analysis and forecast. 2022-06-01 to 2025-05-18.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

Known issue: the values on this dataset are all NaN as re-served (2026-10); use cmems_salinity instead. Not precomputed.

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.083333° lat, 0.083333° lon, latitude **ascending**, longitude -180 → 179.9167.
Time: irregular steps; the live extent is in `info/CMEMS_PHY_MONTHLY/index.json`.
Depth: the variables on the depth axis are 4-D (time, depth, latitude, longitude). Request one level, the
surface, `[(0.494025):1:(0.494025)]`, between the time and latitude constraints
(`erddap-places:depth`; the template already has it). The Parquet then carries a constant `depth` column.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

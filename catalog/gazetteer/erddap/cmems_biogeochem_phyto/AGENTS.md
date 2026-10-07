# AGENTS.md — CMEMS Global Biogeochemistry — monthly chlorophyll + phytoplankton

## Overview

Monthly mean total chlorophyll and phytoplankton carbon (chl, phyc) on 50 depth levels from the CMEMS global biogeochemistry analysis and forecast (0.25 degree). 2021-10-16 to 2025-02-15.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.25° lat, 0.25° lon, latitude **ascending**, longitude -180 → 179.75.
Time: step P1M; the live extent is in `info/cmems_biogeochem_phyto/index.json`.
Depth: the variables on the depth axis are 4-D (time, depth, latitude, longitude). Request one level, the
surface, `[(0.49402538):1:(0.49402538)]`, between the time and latitude constraints
(`erddap-places:depth`; the template already has it). The Parquet then carries a constant `depth` column.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

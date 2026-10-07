# AGENTS.md — CMEMS Global Ocean Physics — 2-D fields (MLD, bottom T, SSH, sea ice)

## Overview

Two-dimensional daily-mean fields from the CMEMS global ocean physics analysis and forecast (1/12 degree): mixed layer depth (mlotst), sea bottom temperature (tob) and salinity (sob), sea surface height (zos), sea floor pressure (pbo) and sea ice variables. The re-served time axis is irregular (about every 2-3 days), not monthly. 2022-06-01 to 2025-05-18.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.083333° lat, 0.083333° lon, latitude **ascending**, longitude -180 → 179.9167.
Time: irregular steps; the live extent is in `info/cmems_altimetry/index.json`.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

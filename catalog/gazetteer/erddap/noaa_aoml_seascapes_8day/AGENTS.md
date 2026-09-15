# AGENTS.md — NOAA AOML Seascapes — 8-day Global (categorical)

## Overview

8-day global seascape classifications (`CLASS` 1–33 plus probability `P`), 2002-08-29 to present.
Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is
`https://erddap.oceanmetrics.io/erddap`, which re-serves the upstream AOML dataset with CORS and
Parquet; `erddap:upstream_url` / the `griddap_upstream` asset point at
`https://cwcgom.aoml.noaa.gov/erddap`, which has the same data but **no CORS headers** (so a browser
can only reach it through `.json?...&.jsonp=`).

## Schema & field notes

Grid: 0.05° lat/lon, latitude **ascending** (-89.975 → 89.975), longitude -179.975 → 179.975 (no
antimeridian split needed); time steps are 8-day composites, not evenly spaced across year
boundaries. `CLASS` is categorical: summarise it as counts / area-weighted fractions per class per
date (as `seascapeR::sum_ss_grds_to_ts()` does), never as a mean. `0` is the fill value, not a class.
`erddap-places:classes` in `cube:variables` maps each value to its label.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

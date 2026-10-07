# AGENTS.md — JPL MUR SST v4.1 — monthly mean (pending)

## Overview

Monthly mean of the JPL MUR (Multi-scale Ultra-high Resolution) SST analysis v4.1, 0.01 degree global. 2002-06-16 to 2026-09-16.
Status: **pending** (`erddap-places:status: "pending"`): not served by `erddap.oceanmetrics.io` yet; the app lists it greyed out.

Pending: not served by erddap.oceanmetrics.io yet (its upstream, NOAA CoastWatch, is down); described from the USF server. Not precomputed.

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:base_url` is `https://erddap.oceanmetrics.io/erddap`, which
re-serves the USF IMaRS dataset with CORS and Parquet; `erddap:upstream_url` / the
`griddap_upstream` asset point at the source, `https://erddap.marine.usf.edu/erddap`.

## Schema & field notes

Grid: 0.01° lat, 0.01° lon, latitude **ascending**, longitude -179.99 → 180.
Time: step P1M; the live extent is in `info/jplMURSST41mday/index.json`.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

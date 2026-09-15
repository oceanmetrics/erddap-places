# AGENTS.md — JPL MUR SST v4.1 (re-served)

## Overview

0.01° daily global analysed SST, 2002-06-01 to present. `erddap:base_url` points at our planned
re-serving mirror `erddap.oceanmetrics.io`, which **is not yet live**. Use the `griddap_upstream`
asset (NOAA CoastWatch) instead until then.

## Accessing the data

Build a griddap URL from the `griddap_upstream` asset template; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:cors` is `true`.

## Schema & field notes

Variables: `analysed_sst` (°C — already Celsius, not Kelvin), `analysis_error` (°C), `mask`
(categorical byte), `sea_ice_fraction` (fraction, 0-1). Grid: 0.01° lat/lon, lat ascending
(-89.99 → 89.99), lon -179.99 → 180.0.

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

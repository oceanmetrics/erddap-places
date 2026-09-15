# AGENTS.md — NOAA Coral Reef Watch — Daily Global 5km SST + DHW

## Overview

Daily 5km global coral bleaching heat-stress fields (SST, SST anomaly, DHW, bleaching alert area,
hotspot), 1985-04-01 to present. Live ERDDAP griddap dataset, referenced in place (not mirrored).

## Accessing the data

Build a griddap URL from the `griddap` asset template in `collection.json`; see
[`../AGENTS.md`](../AGENTS.md) for the full pattern. `erddap:cors` is `true` so this works
directly from a browser via duckdb-wasm.

## Schema & field notes

Variables: `CRW_SST` (°C), `CRW_SSTANOMALY` (°C), `CRW_DHW` (°C·weeks), `CRW_BAA` (categorical),
`CRW_HOTSPOT` (°C). Grid: 0.05° lat/lon, lat stored descending (89.975 → -89.975), lon
-179.975 → 179.975 (no antimeridian split needed).

## Related collections

See [`../../places/`](../../places/) for place polygons and bboxes to query against.

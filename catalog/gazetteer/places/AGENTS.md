# AGENTS.md — Places

Guidance for AI agents and LLMs working with this collection.

## Overview

20 marine place polygons (18 NOAA National Marine Sanctuaries, 1 MarineRegions EEZ, 1
ProtectedSeas MPA) as GeoParquet (`places.parquet`) and PMTiles (`places.pmtiles`).

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/places/places.parquet')
WHERE place_id = 'NMS:HIHWNMS';
```

## Render on a map

Load `places.pmtiles` (layer `places`) into MapLibre GL via the PMTiles protocol.

## Related collections

Use a place's geometry with an `../erddap/` collection to compute fresh statistics — see
[`../AGENTS.md`](../AGENTS.md).

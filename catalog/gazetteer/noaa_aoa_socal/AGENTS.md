# AGENTS.md - NOAA Southern California Aquaculture Opportunity Areas

Guidance for AI agents and LLMs working with this collection.

## Overview

The ten Aquaculture Opportunity Areas (AOAs) NOAA identified in federal waters off Southern California (decision signed 2025-09-10, identified 2025-09-19) in two study areas (North, Central North). Source is the NOAA Fisheries shapefile (NAD83(2011) / California Albers), reprojected to EPSG:4326. `AOA` is the area code (e.g. N1-A, CN1-B).

Licence CC-PDDC; credit: NOAA Fisheries, West Coast Region, Southern California Aquaculture Opportunity Areas (2025). Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/noaa_aoa_socal/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `noaa_aoa_socal`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

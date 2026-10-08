# AGENTS.md - BOEM OCS oil and gas planning areas

Guidance for AI agents and LLMs working with this collection.

## Overview

The 27 Outer Continental Shelf planning areas BOEM uses for the National OCS Oil and Gas Leasing Program (Gulf 3, Pacific 4, Atlantic 4, Alaska 16). `PLANNING_AREA` is BOEM's three-letter code; `name` is the area's full name (hand-mapped in catalog/sources/boem/ocs_planning.yml).

Licence CC-PDDC; credit: Bureau of Ocean Energy Management (BOEM), Office of Strategic Resources (OSR), Geospatial Services Division (GSD), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_ocs_planning/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `boem_ocs_planning`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

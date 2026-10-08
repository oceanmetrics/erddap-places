# AGENTS.md - BOEM 11th National OCS Program, Draft Proposed Program areas

Guidance for AI agents and LLMs working with this collection.

## Overview

The 20 program areas in the Draft Proposed Program of the 11th National OCS Oil and Gas Leasing Program (November 2025), including the Northern, Central and Southern California Program Areas. A draft stage only: every row is `status` = draft_proposed.

Licence CC-PDDC; credit: Bureau of Ocean Energy Management (BOEM), Office of Strategic Resources (OSR), Geospatial Services Division (GSD), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_program_11_draft/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `boem_program_11_draft`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

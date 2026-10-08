# AGENTS.md - BOEM offshore wind planning areas (rescinded 2025-07-30)

Guidance for AI agents and LLMs working with this collection.

## Overview

Wind energy areas, call areas and proposed-sale areas that BOEM de-designated on 2025-07-30 (BOEM notice "BOEM Rescinds Designated Wind Energy Areas on the Outer Continental Shelf"). Two BOEM layers are combined: the dissolved outlines (`component` = outline) and the OCS blocks and sub-blocks that make them up (`component` = block). Every row is `status` = rescinded, `status_date` = 2025-07-30; the native `AREA_STATUS` column keeps BOEM's own, stale value (the Oregon areas are still marked Active). The outline layer holds one row with no geometry and no attributes (OBJECTID 2068); it is dropped.

Licence CC-PDDC; credit: Bureau of Ocean Energy Management (BOEM), Office of Renewable Energy Programs (OREP), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_planning_rescinded/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `boem_wind_planning_rescinded`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

# AGENTS.md - BOEM offshore wind lease outlines

Guidance for AI agents and LLMs working with this collection.

## Overview

Outlines of the offshore wind energy leases and grid/export easements issued by the Bureau of Ocean Energy Management (BOEM) on the U.S. Outer Continental Shelf (52 polygons, 5 of them off California). The layer itself carries no status field and still lists the five California leases (OCS-P 0561-0565) after BOEM's 2026 cancellations and relinquishment, so `status`, `status_source` and `status_date` come from a hand-maintained overlay (catalog/sources/boem/wind_lease_status.csv, from BOEM's California page) joined on the lease number. Every other lease is `active` as of the layer's last edit.

Licence CC-PDDC; credit: Bureau of Ocean Energy Management (BOEM), Office of Renewable Energy Programs (OREP), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_leases/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `boem_wind_leases`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

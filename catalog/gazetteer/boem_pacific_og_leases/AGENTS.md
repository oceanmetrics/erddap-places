# AGENTS.md - BOEM Pacific active oil and gas leases

Guidance for AI agents and LLMs working with this collection.

## Overview

The 34 active oil and gas leases in the Pacific OCS (off California), from BOEM's Pacific Region map service (POC_Layers layer 7). `LEASE_STATUS_CD` is BOEM's own code (UNIT = committed to a unit, PROD = producing, RENACV is kept as served); `status` is `active` for all of them because the layer lists active leases only. Lease numbers are served as P00202 and published in BOEM's formal form `OCS-P 0202`.

Licence CC-PDDC; credit: Bureau of Ocean Energy Management (BOEM) and Bureau of Safety and Environmental Enforcement (BSEE), Pacific Region. Public domain. Processed by Ocean Metrics.

## Find a place

```sql
SELECT * FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_pacific_og_leases/places.parquet')
WHERE name ILIKE '%california%';
```

`place_id` is unique and prefixed; `status` / `status_source` / `status_date` say whether the place is current and
where that is documented. Check `status` before treating a lease or area as live.

## Render on a map

Load `places.pmtiles` (layer `boem_pacific_og_leases`) into MapLibre GL via the PMTiles protocol; `styles/default.json` is a starting style.

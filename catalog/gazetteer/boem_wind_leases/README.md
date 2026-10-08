# BOEM offshore wind lease outlines

Outlines of the offshore wind energy leases and grid/export easements issued by the Bureau of Ocean Energy Management (BOEM) on the U.S. Outer Continental Shelf (52 polygons, 5 of them off California). The layer itself carries no status field and still lists the five California leases (OCS-P 0561-0565) after BOEM's 2026 cancellations and relinquishment, so `status`, `status_source` and `status_date` come from a hand-maintained overlay (catalog/sources/boem/wind_lease_status.csv, from BOEM's California page) joined on the lease number. Every other lease is `active` as of the layer's last edit.

- **Collection**: `boem_wind_leases` v1.0.0, 52 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `boem_wind_leases`)
- **Licence**: CC-PDDC - U.S. federal government work (BOEM), public domain; the AGOL item carries the usa.gov public-domain label. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: Bureau of Ocean Energy Management (BOEM), Office of Renewable Energy Programs (OREP), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.
- **Refresh**: weekly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Status overlay

The source layer has no status field. `status`, `status_source` and `status_date` come from the hand-maintained `catalog/sources/boem/wind_lease_status.csv`, joined on the exact `LEASE_NUMBER`; leases not in the overlay are `active` as of the layer's last edit. The overlay is the place to record BOEM's changes until the layer catches up.

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| - | https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Wind_Lease_Boundaries__BOEM_/FeatureServer/8 | 709831444a234968966667d84bcc0357 | 2025-03-04T19:31:41Z | 2026-10-08T13:34:48Z | 52 | `530364bc2e73de9f...` |

Machine-readable copy: [`provenance.json`](./provenance.json) (also in `collection.json` and the Parquet footer).

## Schema

| Column | Type | Description |
|---|---|---|
| place_id | string | prefixed, unique id (e.g. BOEM:OCS-P 0561, BOEM:PA:SOC, AOA:N1-A) |
| authority | string | organisation that publishes the boundary (BOEM, AOA = NOAA Aquaculture Opportunity Areas) |
| source_id | string | the source layer's own identifier for the feature (lease number, planning-area code, OBJECTID, AOA code) |
| name | string | human-readable name |
| place_type | string | kind of place: lease, planning_area or aoa |
| geom_type | string | geometry type after normalisation (MultiPolygon) |
| status | string | lifecycle status (e.g. active, cancelled, relinquished, settlement_pending, rescinded, draft_proposed, identified) |
| status_source | string | URL that documents the status |
| status_date | string | ISO date (or year) the status took effect or was last confirmed; may be empty |
| source_url | string | the service endpoint or download the boundary was fetched from |
| source_date | date32[day] | date of the source's last data edit (retrieval date when the source serves none) |
| retrieved | timestamp[ms, tz=UTC] | UTC time the boundary was fetched |
| version | string | collection release version this row was built for |
| license | string | SPDX identifier of the licence (CC-PDDC = public-domain U.S. government work) |
| attribution | string | credit line to show with the data |
| OBJECTID | int64 | native attribute of the source layer (OBJECTID) |
| LEASE_NUMBER | string | native attribute of the source layer (LEASE_NUMBER) |
| LEASE_DOCUMENT1 | string | native attribute of the source layer (LEASE_DOCUMENT1) |
| LEASE_DOCUMENT2 | string | native attribute of the source layer (LEASE_DOCUMENT2) |
| LEASE_TYPE | string | native attribute of the source layer (LEASE_TYPE) |
| RESOURCE | string | native attribute of the source layer (RESOURCE) |
| COMPANY | string | native attribute of the source layer (COMPANY) |
| LEASE_NUMBER_COMPANY | string | native attribute of the source layer (LEASE_NUMBER_COMPANY) |
| LEASE_DATE | string | native attribute of the source layer (LEASE_DATE) |
| LEASE_TERM | string | native attribute of the source layer (LEASE_TERM) |
| PROJECT_EASEMENT | string | native attribute of the source layer (PROJECT_EASEMENT) |
| ACRES | int64 | native attribute of the source layer (ACRES) |
| STATE | string | native attribute of the source layer (STATE) |
| PROTRACTION_NUMBER | string | native attribute of the source layer (PROTRACTION_NUMBER) |
| PROTRACTION_NAME | string | native attribute of the source layer (PROTRACTION_NAME) |
| PROJECT_NAME_1 | string | native attribute of the source layer (PROJECT_NAME_1) |
| PROJECT_NAME_2 | string | native attribute of the source layer (PROJECT_NAME_2) |
| PROJECT_NAME_3 | string | native attribute of the source layer (PROJECT_NAME_3) |
| FAST41 | string | native attribute of the source layer (FAST41) |
| Shape__Area | double | native attribute of the source layer (Shape__Area) |
| Shape__Length | double | native attribute of the source layer (Shape__Length) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 2.7 MB | `1220784239e69642...` |
| places-tiles | 5.0 MB | `12206a9f8d07922f...` |
| styles/default | 1 kB | `122079db7bca2e45...` |
| provenance | 1 kB | `12200e1ff62091a8...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_leases/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

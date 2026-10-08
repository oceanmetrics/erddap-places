# NOAA Southern California Aquaculture Opportunity Areas

The ten Aquaculture Opportunity Areas (AOAs) NOAA identified in federal waters off Southern California (decision signed 2025-09-10, identified 2025-09-19) in two study areas (North, Central North). Source is the NOAA Fisheries shapefile (NAD83(2011) / California Albers), reprojected to EPSG:4326. `AOA` is the area code (e.g. N1-A, CN1-B).

- **Collection**: `noaa_aoa_socal` v1.0.0, 10 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `noaa_aoa_socal`)
- **Licence**: CC-PDDC - U.S. federal government work (NOAA Fisheries). The download page states no terms; treated as public domain under 17 U.S.C. 105. Credit NOAA and do not imply endorsement. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: NOAA Fisheries, West Coast Region, Southern California Aquaculture Opportunity Areas (2025). Public domain. Processed by Ocean Metrics.
- **Refresh**: monthly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| - | https://www.fisheries.noaa.gov/s3//2025-09/aoa-socal.zip | - | 2025-08-19T00:00:00Z | 2026-10-08T13:35:07Z | 10 | `a47945d257a273e2...` |

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
| Shape_Leng | double | native attribute of the source layer (Shape_Leng) |
| Shape_Area | double | native attribute of the source layer (Shape_Area) |
| StudyArea | string | native attribute of the source layer (StudyArea) |
| AOA | string | native attribute of the source layer (AOA) |
| Acres | int64 | native attribute of the source layer (Acres) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 24 kB | `12205ec215017f85...` |
| places-tiles | 5 kB | `1220a3939bed5f24...` |
| styles/default | 1 kB | `122036308fff3ffd...` |
| provenance | 1 kB | `1220c17cd50cdb85...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/noaa_aoa_socal/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

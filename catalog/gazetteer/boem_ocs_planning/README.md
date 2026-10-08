# BOEM OCS oil and gas planning areas

The 27 Outer Continental Shelf planning areas BOEM uses for the National OCS Oil and Gas Leasing Program (Gulf 3, Pacific 4, Atlantic 4, Alaska 16). `PLANNING_AREA` is BOEM's three-letter code; `name` is the area's full name (hand-mapped in catalog/sources/boem/ocs_planning.yml).

- **Collection**: `boem_ocs_planning` v1.0.0, 27 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `boem_ocs_planning`)
- **Licence**: CC-PDDC - U.S. federal government work (BOEM), public domain; the AGOL item carries the usa.gov public-domain label. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: Bureau of Ocean Energy Management (BOEM), Office of Strategic Resources (OSR), Geospatial Services Division (GSD), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.
- **Refresh**: weekly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| - | https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/OCS_Planning_Area_Polygons/FeatureServer/5 | 49604c94c8244f5fb42d6b021446b0d6 | 2025-04-10T16:51:02Z | 2026-10-08T13:33:34Z | 27 | `754e2e4f10089ff0...` |

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
| REGION | string | native attribute of the source layer (REGION) |
| PLANNING_AREA | string | native attribute of the source layer (PLANNING_AREA) |
| Shape__Area | double | native attribute of the source layer (Shape__Area) |
| Shape__Length | double | native attribute of the source layer (Shape__Length) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 13.1 MB | `1220d5f0be817565...` |
| places-tiles | 3.3 MB | `12200a92c6a9c648...` |
| styles/default | 1 kB | `12203ec3f9758a6f...` |
| provenance | 1 kB | `12203c943b2a7898...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_ocs_planning/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

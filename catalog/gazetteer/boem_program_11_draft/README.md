# BOEM 11th National OCS Program, Draft Proposed Program areas

The 20 program areas in the Draft Proposed Program of the 11th National OCS Oil and Gas Leasing Program (November 2025), including the Northern, Central and Southern California Program Areas. A draft stage only: every row is `status` = draft_proposed.

- **Collection**: `boem_program_11_draft` v1.0.0, 20 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `boem_program_11_draft`)
- **Licence**: CC-PDDC - U.S. federal government work (BOEM), public domain; the AGOL item carries the usa.gov public-domain label. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: Bureau of Ocean Energy Management (BOEM), Office of Strategic Resources (OSR), Geospatial Services Division (GSD), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.
- **Refresh**: weekly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| - | https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/11th_National_Draft_Proposed_Program_Areas/FeatureServer/16 | ed65f4351e494ff3a3c5589bb1960bae | 2025-11-03T18:15:16Z | 2026-10-08T13:34:40Z | 20 | `5692afb6da159d5a...` |

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
| NAME_src | string | native attribute of the source layer (NAME_src) |
| PROGRAM_DESIG | string | native attribute of the source layer (PROGRAM_DESIG) |
| BOEM_OCS_REGION | string | native attribute of the source layer (BOEM_OCS_REGION) |
| PLANNING_AREA | string | native attribute of the source layer (PLANNING_AREA) |
| SOURCE | string | native attribute of the source layer (SOURCE) |
| Label | string | native attribute of the source layer (Label) |
| Shape__Area | double | native attribute of the source layer (Shape__Area) |
| Shape__Length | double | native attribute of the source layer (Shape__Length) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 6.6 MB | `12209e523db18f15...` |
| places-tiles | 1.4 MB | `122071d714a17e49...` |
| styles/default | 1 kB | `12200bc79867dd40...` |
| provenance | 1 kB | `1220568cd9ef40d9...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_program_11_draft/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

# BOEM offshore wind planning areas (rescinded 2025-07-30)

Wind energy areas, call areas and proposed-sale areas that BOEM de-designated on 2025-07-30 (BOEM notice "BOEM Rescinds Designated Wind Energy Areas on the Outer Continental Shelf"). Two BOEM layers are combined: the dissolved outlines (`component` = outline) and the OCS blocks and sub-blocks that make them up (`component` = block). Every row is `status` = rescinded, `status_date` = 2025-07-30; the native `AREA_STATUS` column keeps BOEM's own, stale value (the Oregon areas are still marked Active). The outline layer holds one row with no geometry and no attributes (OBJECTID 2068); it is dropped.

- **Collection**: `boem_wind_planning_rescinded` v1.0.0, 3325 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `boem_wind_planning_rescinded`)
- **Licence**: CC-PDDC - U.S. federal government work (BOEM), public domain; the AGOL items carry the usa.gov public-domain label. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: Bureau of Ocean Energy Management (BOEM), Office of Renewable Energy Programs (OREP), via MarineCadastre.gov. Public domain. Processed by Ocean Metrics.
- **Refresh**: weekly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| outline | https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Wind_Planning_Area_Boundaries__BOEM_/FeatureServer/0 | f4bafa57366c49ffb84db33fa52c134c | 2025-02-20T16:17:31Z | 2026-10-08T13:35:00Z | 19 | `bc0623cee11e64bb...` |
| block | https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Wind_Planning_Areas__BOEM_/FeatureServer/7 | ad4e83ed78d24319b641ebbaf1f7298e | 2025-02-20T16:28:20Z | 2026-10-08T13:35:04Z | 3307 | `be6ec83f2884718c...` |

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
| component | string | which source layer of the collection the row comes from |
| OBJECTID | int64 | native attribute of the source layer (OBJECTID) |
| PROTRACTION_NUMBER | string | native attribute of the source layer (PROTRACTION_NUMBER) |
| ADDITIONAL_INFORMATION | string | native attribute of the source layer (ADDITIONAL_INFORMATION) |
| CATEGORY1 | string | native attribute of the source layer (CATEGORY1) |
| CATEGORY2 | string | native attribute of the source layer (CATEGORY2) |
| URL1 | string | native attribute of the source layer (URL1) |
| URL2 | string | native attribute of the source layer (URL2) |
| AREA_STATUS | string | native attribute of the source layer (AREA_STATUS) |
| Shape__Area | double | native attribute of the source layer (Shape__Area) |
| Shape__Length | double | native attribute of the source layer (Shape__Length) |
| BLOCK_NUMBER | string | native attribute of the source layer (BLOCK_NUMBER) |
| BLOCK_LABEL | string | native attribute of the source layer (BLOCK_LABEL) |
| SUB_BLOCK | string | native attribute of the source layer (SUB_BLOCK) |
| PRIMARY_WPA_CATEGORY | string | native attribute of the source layer (PRIMARY_WPA_CATEGORY) |
| SECONDARY_WPA_CATEGORY | string | native attribute of the source layer (SECONDARY_WPA_CATEGORY) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 520 kB | `1220e3e4dadcd6e7...` |
| places-tiles | 435 kB | `1220cbfae5c5f8b4...` |
| styles/default | 1 kB | `1220ed2e8aa33943...` |
| provenance | 2 kB | `1220357881b872f3...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_planning_rescinded/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

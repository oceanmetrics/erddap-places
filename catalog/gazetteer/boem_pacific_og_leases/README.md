# BOEM Pacific active oil and gas leases

The 34 active oil and gas leases in the Pacific OCS (off California), from BOEM's Pacific Region map service (POC_Layers layer 7). `LEASE_STATUS_CD` is BOEM's own code (UNIT = committed to a unit, PROD = producing, RENACV is kept as served); `status` is `active` for all of them because the layer lists active leases only. Lease numbers are served as P00202 and published in BOEM's formal form `OCS-P 0202`.

- **Collection**: `boem_pacific_og_leases` v1.0.0, 34 features, GeoParquet 1.1 (`places.parquet`) and PMTiles (`places.pmtiles`, layer `boem_pacific_og_leases`)
- **Licence**: CC-PDDC - U.S. federal government work (BOEM / BSEE), public domain; the service carries no separate terms. https://www.usa.gov/publicdomain/label/1.0/
- **Attribution**: Bureau of Ocean Energy Management (BOEM) and Bureau of Safety and Environmental Enforcement (BSEE), Pacific Region. Public domain. Processed by Ocean Metrics.
- **Refresh**: weekly, by `.github/workflows/gazetteer-sync.yml` (re-fetched only when the source's `editingInfo.dataLastEditDate` or record count changed)

## Sources and provenance

| Component | Source | Item | Data last edit | Retrieved | Records | Checksum (sha-256 of payload) |
|---|---|---|---|---|---|---|
| - | https://gis.boem.gov/server/rest/services/BOEM_BSEE/POC_Layers/MapServer/7 | - | not served | 2026-10-08T13:34:33Z | 34 | `da6bd112b876f923...` |

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
| SN_TRACTS_FK | double | native attribute of the source layer (SN_TRACTS_FK) |
| BID_SYSTEM_CODE | string | native attribute of the source layer (BID_SYSTEM_CODE) |
| IBLA_APPEAL_FLAG | string | native attribute of the source layer (IBLA_APPEAL_FLAG) |
| LEASE_EXPIR_DATE | timestamp[ms, tz=UTC] | native attribute of the source layer (LEASE_EXPIR_DATE) |
| LEASE_SECT_AREA | double | native attribute of the source layer (LEASE_SECT_AREA) |
| LEASE_SEGR_FLAG | string | native attribute of the source layer (LEASE_SEGR_FLAG) |
| MINERAL_TYPE_CD | string | native attribute of the source layer (MINERAL_TYPE_CD) |
| LSE_STAT_EFF_DT | timestamp[ms, tz=UTC] | native attribute of the source layer (LSE_STAT_EFF_DT) |
| TRACT_NUMBER | string | native attribute of the source layer (TRACT_NUMBER) |
| SERIAL_TYPE_CODE | string | native attribute of the source layer (SERIAL_TYPE_CODE) |
| SEGR_XREF_NUM | string | native attribute of the source layer (SEGR_XREF_NUM) |
| RGN_APPEAL_FLAG | string | native attribute of the source layer (RGN_APPEAL_FLAG) |
| PEND_LITIG_FLAG | string | native attribute of the source layer (PEND_LITIG_FLAG) |
| LEASE_STATUS_CD | string | native attribute of the source layer (LEASE_STATUS_CD) |
| LEASE_EFF_DATE | timestamp[ms, tz=UTC] | native attribute of the source layer (LEASE_EFF_DATE) |
| CURRENT_AREA | double | native attribute of the source layer (CURRENT_AREA) |
| LEASE_EXPT_EXPIR | timestamp[ms, tz=UTC] | native attribute of the source layer (LEASE_EXPT_EXPIR) |
| ROYALTY_RATE | double | native attribute of the source layer (ROYALTY_RATE) |
| INITIAL_AREA | double | native attribute of the source layer (INITIAL_AREA) |
| SALE_NUMBER | string | native attribute of the source layer (SALE_NUMBER) |
| RENT_PER_UNIT | double | native attribute of the source layer (RENT_PER_UNIT) |
| LEASE_STATUS_CHANGE_DT | timestamp[ms, tz=UTC] | native attribute of the source layer (LEASE_STATUS_CHANGE_DT) |
| REN_ACQUISITION_FEE_AMT | double | native attribute of the source layer (REN_ACQUISITION_FEE_AMT) |
| REN_AUCTION_FORMAT_CD | string | native attribute of the source layer (REN_AUCTION_FORMAT_CD) |
| REN_FERC_APPROVAL_FL | string | native attribute of the source layer (REN_FERC_APPROVAL_FL) |
| REN_LEASE_TYPE_CD | string | native attribute of the source layer (REN_LEASE_TYPE_CD) |
| REN_MULT_ACTIVITY_FL | string | native attribute of the source layer (REN_MULT_ACTIVITY_FL) |
| SHAPE.AREA | double | native attribute of the source layer (SHAPE.AREA) |
| SHAPE.LEN | double | native attribute of the source layer (SHAPE.LEN) |
| ACLABS | string | native attribute of the source layer (ACLABS) |
| bbox | struct<xmin: double, ymin: double, xmax: double, ymax: double> | GeoParquet bbox-covering column (xmin, ymin, xmax, ymax) |
| geometry | binary | MULTIPOLYGON, EPSG:4326, split at +/-180 antimeridian |

Native attributes keep the source layer's names; a native name equal to a gazetteer column ignoring case
(`NAME` vs `name`) is suffixed `_src`.

## Files

| File | Size | Checksum |
|---|---|---|
| places | 53 kB | `122071e1eb4dee66...` |
| places-tiles | 29 kB | `122002f2f0c49bfa...` |
| styles/default | 1 kB | `1220535d334b8d0e...` |
| provenance | 1 kB | `122072aef5af6a8e...` |
| documentation | 0 kB | `1220e3b0c44298fc...` |

## Quick start

```sql
SELECT place_id, name, status, status_date
FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_pacific_og_leases/places.parquet')
ORDER BY place_id;
```

## Changes

- **1.0.0**: first release.

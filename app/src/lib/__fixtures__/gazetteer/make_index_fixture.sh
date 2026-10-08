#!/usr/bin/env bash
# a small slice of the published place index (index/places_index.parquet, all 14 columns): the 20 `places`,
# the three BOEM ids that exist in two collections, ids with spaces and extra colons, lines and points
# (not selectable), a few polygons of other collections. needs the native duckdb CLI and the network.
set -euo pipefail
cd "$(dirname "$0")"
U=https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/index/places_index.parquet
duckdb -c "
COPY (
  SELECT * FROM '$U' WHERE collection = 'places'
  UNION ALL SELECT * FROM '$U' WHERE place_id IN ('BOEM:OCS-P 0562', 'BOEM:OCS-P 0563', 'BOEM:OCS-P 0564')
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'boem_wind_leases' AND place_id NOT IN ('BOEM:OCS-P 0562', 'BOEM:OCS-P 0563', 'BOEM:OCS-P 0564') ORDER BY place_id LIMIT 4)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'mpa_inventory' ORDER BY place_id LIMIT 6)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'noaa_marine_monuments' ORDER BY place_id LIMIT 3)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'noaa_sanctuaries' ORDER BY place_id LIMIT 4)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'calcofi_lines' ORDER BY place_id LIMIT 2)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'calcofi_stations' ORDER BY place_id LIMIT 2)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'boem_wind_planning_rescinded' ORDER BY place_id LIMIT 3)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'noaa_submarine_cables' ORDER BY place_id LIMIT 3)
  UNION ALL (SELECT * FROM '$U' WHERE collection = 'gebco_undersea' AND geom_type = 'MultiPolygon' ORDER BY place_id LIMIT 2)
) TO 'places_index.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)"

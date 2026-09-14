LOAD spatial; LOAD h3;
CREATE TABLE ply AS SELECT ST_Union_Agg(geom) AS geom FROM ST_Read('HIHWNMS.geojson');
SELECT ST_GeometryType(geom) AS gtype FROM ply;
CREATE TABLE grid AS SELECT DISTINCT latitude, longitude FROM 'hi_sst.parquet';
CREATE TABLE ply_h3 AS SELECT DISTINCT unnest(h3_polygon_wkt_to_cells(ST_AsText(p.geom), 8)) AS h3
  FROM (SELECT unnest(ST_Dump(geom)) AS d FROM ply) t, LATERAL (SELECT t.d.geom AS geom) p;
SELECT count(*) AS n_h3_cells_res8 FROM ply_h3;
SELECT count(*) AS n_in_ply_h3 FROM grid g WHERE h3_latlng_to_cell(g.latitude, g.longitude, 8) IN (SELECT h3 FROM ply_h3);
SELECT count(*) AS n_in_ply_h3_res9 FROM grid g WHERE h3_latlng_to_cell(g.latitude, g.longitude, 9) IN (
  SELECT DISTINCT unnest(h3_polygon_wkt_to_cells(ST_AsText(p.geom), 9)) FROM (SELECT unnest(ST_Dump(geom)) AS d FROM ply) t, LATERAL (SELECT t.d.geom AS geom) p);

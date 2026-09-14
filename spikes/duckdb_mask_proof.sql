INSTALL spatial; LOAD spatial; INSTALL h3 FROM community; LOAD h3;
CREATE TABLE ply AS SELECT ST_Union_Agg(geom) AS geom FROM ST_Read('HIHWNMS.geojson');
CREATE TABLE grid AS SELECT DISTINCT latitude, longitude FROM 'hi_sst.parquet';
SELECT count(*) AS n_grid_cells FROM grid;
-- approach A: exact point-in-polygon via spatial
CREATE TABLE mask_a AS SELECT g.latitude, g.longitude FROM grid g, ply WHERE ST_Within(ST_Point(g.longitude, g.latitude), ply.geom);
SELECT count(*) AS n_in_ply_spatial FROM mask_a;
-- approach B: H3 res 8 cell set for polygon, cell centers indexed to res 8
CREATE TABLE ply_h3 AS SELECT unnest(h3_polygon_wkt_to_cells(ST_AsText(geom), 8)) AS h3 FROM ply;
SELECT count(*) AS n_h3_cells_res8 FROM ply_h3;
CREATE TABLE mask_b AS SELECT g.latitude, g.longitude FROM grid g WHERE h3_latlng_to_cell(g.latitude, g.longitude, 8) IN (SELECT h3 FROM ply_h3);
SELECT count(*) AS n_in_ply_h3 FROM mask_b;
-- key statistics per day within place (spatial mask)
SELECT time::DATE AS date, count(CRW_SST) AS n, round(avg(CRW_SST),2) AS mean, round(stddev(CRW_SST),2) AS sd, round(min(CRW_SST),2) AS min, round(max(CRW_SST),2) AS max, round(quantile_cont(CRW_SST,0.9),2) AS p90
FROM 'hi_sst.parquet' s JOIN mask_a m USING (latitude, longitude) GROUP BY 1 ORDER BY 1 LIMIT 6;

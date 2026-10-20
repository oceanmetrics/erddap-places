# build the `places` gazetteer collection: the 18 noaa national marine sanctuaries (NMS:<code>) from the
# official onms boundary downloads, each with source_url and source_date
# (until places 1.2.1 it also held the pitcairn eez, MRGID:8439, and a tortugas reserve as PSGID:939, a
# navigator gid that is not a protectedseas site id; both were removed in 2.0.0, see the README "Changes")
# run with: Rscript catalog/build_places.R

librarian::shelf(
  sf, dplyr, purrr, glue, here, fs, stringr, units, readr,
  quiet = TRUE)

sf::sf_use_s2(TRUE)

dir_repo   <- here::here()
dir_cache  <- fs::path(dir_repo, "catalog", "cache")
dir_places <- fs::path(dir_repo, "catalog", "places")
fs::dir_create(dir_cache)
fs::dir_create(dir_places)

# helper: finalize geometry per spec (valid, 4326, dateline-wrapped, multipolygon) ----
finalize_geom <- function(x) {
  x |>
    sf::st_make_valid() |>
    sf::st_transform(4326) |>
    sf::st_wrap_dateline(options = c("WRAPDATELINE=YES", "DATELINEOFFSET=180")) |>
    sf::st_cast("MULTIPOLYGON")
}

# 1. noaa sanctuaries (official onms boundary downloads) -----------------------------------

# official boundaries are the zipped shapefiles listed at
#   https://sanctuaries.noaa.gov/library/imast_gis.html
# sanctuaries.csv (onmsR) holds the authoritative name and the download url (url_zip) per nms code.
# zips are cached in catalog/cache/imast/<NMS>.zip (git-ignored); delete a zip to re-download it.
sanctuaries <- readr::read_csv(
  "~/Github/noaa-onms/onmsR/data-raw/sanctuaries.csv" |> path.expand(),
  show_col_types = FALSE)

dir_imast <- fs::path(dir_cache, "imast")
fs::dir_create(dir_imast)

read_sanctuary <- function(nms, sanctuary, url_zip) {
  f_zip <- fs::path(dir_imast, glue::glue("{nms}.zip"))
  if (!fs::file_exists(f_zip)) {
    download.file(url_zip, f_zip, mode = "wb", quiet = TRUE)
  }

  # pick the geographic shapefile; skip macos resource forks and the projected albers twin (pmnm)
  shp <- unzip(f_zip, list = TRUE)$Name |>
    stringr::str_subset("\\.shp$") |>
    stringr::str_subset("__MACOSX|Albers", negate = TRUE)
  stopifnot(length(shp) == 1)
  x <- sf::st_read(paste0("/vsizip/", f_zip, "/", shp), quiet = TRUE) |>
    sf::st_zm(drop = TRUE)

  # every zip ships a .prj (nad83, except fknms "GCS_Assumed_Geographic_1" = nad27), so
  # st_transform() below applies the right datum shift; fail loudly if one ever arrives without
  stopifnot(!is.na(sf::st_crs(x)))

  nm <- if (nms == "PMNM") {
    glue::glue("{sanctuary} Marine National Monument")
  } else {
    glue::glue("{sanctuary} National Marine Sanctuary")
  }

  # union all zones / polygons in the zip into one multipolygon per site
  geom <- x |>
    sf::st_make_valid() |>
    sf::st_transform(4326) |>
    sf::st_geometry() |>
    sf::st_union()

  sf::st_sf(
    place_id    = glue::glue("NMS:{nms}"),
    gazetteer   = "NMS",
    name        = nm,
    source_url  = url_zip,
    source_date = format(as.Date(fs::file_info(f_zip)$modification_time)),
    geometry    = geom)
}

places_nms <- purrr::pmap(
  sanctuaries |> select(nms, sanctuary, url_zip),
  read_sanctuary) |>
  bind_rows()

# finalize geometry, compute area and bbox --------------------------------------

# the 18 sanctuaries and nothing else: every row is an NMS:<code> place
stopifnot(nrow(places_nms) == 18, all(startsWith(places_nms$place_id, "NMS:")))

places <- places_nms |>
  mutate(geometry = finalize_geom(geometry))

places <- places |>
  mutate(
    area_km2 = sf::st_area(geometry) |>
      units::set_units(km^2) |>
      as.numeric() |>
      round(1)) |>
  select(place_id, gazetteer, name, area_km2, source_url, source_date, geometry) |>
  arrange(gazetteer, place_id)

# outputs ------------------------------------------------------------------------------

f_parquet <- fs::path(dir_places, "places.parquet")
f_geojson <- fs::path(dir_places, "places.geojson")
f_pmtiles <- fs::path(dir_places, "places.pmtiles")

# write geoparquet via duckdb's spatial extension rather than sfarrow: sfarrow's geo metadata
# (key "schema_version" instead of "version", no "geometry_types") is not readable by duckdb's
# geoparquet reader, so round-trip through a temp geojson and let duckdb write valid geoparquet.
f_tmp_geojson <- fs::path(dir_cache, "places_tmp.geojson")
if (fs::file_exists(f_tmp_geojson)) fs::file_delete(f_tmp_geojson)
sf::st_write(places, f_tmp_geojson, delete_dsn = TRUE, quiet = TRUE)

if (fs::file_exists(f_parquet)) fs::file_delete(f_parquet)
system(glue::glue(
  "duckdb -c \"",
  "INSTALL spatial; LOAD spatial; ",
  "COPY (SELECT place_id, gazetteer, name, area_km2, source_url, CAST(source_date AS DATE) AS source_date, ",
  # bbox is the geoparquet bbox-covering struct (per row, plain min/max: for antimeridian-crossing places
  # such as PMNM it spans -180..180, which readers' xmin <= x <= xmax filters need); written here so the
  # output matches what portolan publishes
  "{{'xmin': ST_XMin(geom), 'ymin': ST_YMin(geom), 'xmax': ST_XMax(geom), 'ymax': ST_YMax(geom)}} AS bbox, ",
  "geom AS geometry FROM ST_Read('{f_tmp_geojson}')) ",
  "TO '{f_parquet}' (FORMAT PARQUET);\""))
# the FILE-level geo bbox crosses +/-180 (west > east, RFC 7946) when the places do, so the STAC extent
# portolan derives from it is not the band round the globe (rule and tests: catalog/erin_layers/bbox.py)
stopifnot(system2("uv", c("run", "catalog/antimeridian.py", "geo-bbox", f_parquet)) == 0)
fs::file_delete(f_tmp_geojson)

if (fs::file_exists(f_geojson)) fs::file_delete(f_geojson)
sf::st_write(places, f_geojson, delete_dsn = TRUE, quiet = TRUE)

# tile metadata: name, description and attribution (shown by maplibre's attribution control)
tile_name <- "places"
tile_desc <- paste(
  "Ocean Metrics gazetteer: 18 NOAA National Marine Sanctuaries and Marine National Monuments",
  "(NMS:<code> ids); layer 'places', keyed by place_id.")
tile_attr <- '<a href="https://sanctuaries.noaa.gov" target="_blank">NOAA ONMS</a>'

system2(
  "/opt/homebrew/bin/tippecanoe",
  c("-o", shQuote(f_pmtiles), "-l", "places", "-zg",
    "-n", shQuote(tile_name), "-N", shQuote(tile_desc), "--attribution", shQuote(tile_attr),
    "--drop-densest-as-needed", "--extend-zooms-if-still-dropping", "--force", shQuote(f_geojson)))

fs::file_delete(f_geojson)

# summary --------------------------------------------------------------------------------

summary_tbl <- places |>
  sf::st_drop_geometry() |>
  bind_cols(n_parts = sapply(sf::st_geometry(places), \(g) length(g))) |>
  select(place_id, name, n_parts, area_km2)

print(summary_tbl)

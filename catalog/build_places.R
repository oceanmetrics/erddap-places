# build a gazetteer of 20 marine places (18 noaa sanctuaries + 1 marineregions eez + 1 protectedseas mpa)
# run with: Rscript catalog/build_places.R

librarian::shelf(
  sf, dplyr, mregions2, sfarrow, jsonlite, glue, geojsonsf, here, fs, stringr, units,
  quiet = TRUE)

sf::sf_use_s2(TRUE)

dir_repo   <- here::here()
dir_cache  <- fs::path(dir_repo, "catalog", "cache")
dir_places <- fs::path(dir_repo, "catalog", "places")
fs::dir_create(dir_cache)
fs::dir_create(dir_places)

# helper: pick the first available column (case-insensitive) from a set of candidate names ----
pick_col <- function(df, candidates) {
  nms <- names(df)
  hit <- candidates[tolower(candidates) %in% tolower(nms)]
  if (length(hit) == 0) return(NA_character_)
  nms[match(tolower(hit[1]), tolower(nms))]
}

# helper: finalize geometry per spec (valid, 4326, dateline-wrapped, multipolygon) ----
finalize_geom <- function(x) {
  x |>
    sf::st_make_valid() |>
    sf::st_transform(4326) |>
    sf::st_wrap_dateline(options = c("WRAPDATELINE=YES", "DATELINEOFFSET=180")) |>
    sf::st_cast("MULTIPOLYGON")
}

# 1. noaa sanctuaries ----------------------------------------------------------------------

dir_sanct <- "~/Github/noaa-onms/onmsR/data-raw/sanctuary_polygons" |>
  path.expand()
files_sanct <- fs::dir_ls(dir_sanct, glob = "*.geojson") |>
  sort()

read_sanctuary <- function(f) {
  stem <- fs::path_ext_remove(fs::path_file(f))
  x    <- sf::st_read(f, quiet = TRUE)

  # note: source geojson property names vary widely by file (e.g. AREA_NAME, area_name,
  # name, sanctuary, label). fall back through the most descriptive available column.
  col_name <- pick_col(x, c("area_name", "AREA_NAME", "name", "NAME", "sanctuary", "SANCTUARY", "label", "LABEL"))
  nm <- if (is.na(col_name)) stem else as.character(x[[col_name]][1])

  # union multi-feature files (e.g. CINMS has 2 polygons) into one multipolygon per sanctuary
  geom <- sf::st_union(sf::st_geometry(x))

  sf::st_sf(
    place_id  = glue::glue("NMS:{stem}"),
    gazetteer = "NMS",
    name      = nm,
    geometry  = geom)
}

places_nms <- lapply(files_sanct, read_sanctuary) |>
  bind_rows()

# 2. marineregions mrgid 8439 (pitcairn eez) ------------------------------------------------

mrgid <- 8439
geom_mrgid <- tryCatch(
  mregions2::gaz_geometry(mrgid),
  error = function(e) mregions2::gaz_search(mrgid) |> mregions2::gaz_geometry())
name_mrgid <- mregions2::gaz_search(mrgid)$preferredGazetteerName

place_mrgid <- sf::st_sf(
  place_id  = glue::glue("MRGID:{mrgid}"),
  gazetteer = "MRGID",
  name      = name_mrgid,
  geometry  = sf::st_geometry(geom_mrgid))

# 3. protectedseas psgid 939 (tortugas ecological reserve) --------------------------------

psgid    <- 939
# note: the site's api is actually served under /v2/ (the bare /api/ path 404s)
url_ps   <- glue::glue("https://map.navigatormap.org/v2/api/boundary/area/?gid={psgid}")
f_cache  <- fs::path(dir_cache, glue::glue("psgid_{psgid}.json"))

if (!fs::file_exists(f_cache)) {
  download.file(url_ps, f_cache, quiet = TRUE)
}

body_ps <- readLines(f_cache, warn = FALSE) |>
  paste(collapse = "") |>
  stringr::str_replace('\\{"bounds":(.*)\\}', '\\1')

x_ps <- geojsonsf::geojson_sf(body_ps) |>
  sf::st_zm(drop = TRUE)

col_name_ps <- pick_col(x_ps, c("site_name", "SITE_NAME", "name", "NAME"))
name_ps <- if (is.na(col_name_ps)) "Tortugas Ecological Reserve" else as.character(x_ps[[col_name_ps]][1])

place_psgid <- sf::st_sf(
  place_id  = glue::glue("PSGID:{psgid}"),
  gazetteer = "PSGID",
  name      = name_ps,
  geometry  = sf::st_union(sf::st_geometry(x_ps)))

# combine, finalize geometry, compute area and bbox --------------------------------------

places <- bind_rows(places_nms, place_mrgid, place_psgid) |>
  mutate(geometry = finalize_geom(geometry))

places <- places |>
  mutate(
    area_km2 = sf::st_area(geometry) |>
      units::set_units(km^2) |>
      as.numeric() |>
      round(1),
    # note: for antimeridian-crossing places (e.g. PMNM), bbox spans nearly -180..180
    bbox = sapply(sf::st_geometry(geometry), \(g) {
      b <- sf::st_bbox(g)
      jsonlite::toJSON(as.numeric(b), digits = 6)
    })) |>
  select(place_id, gazetteer, name, area_km2, bbox, geometry) |>
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
  "COPY (SELECT place_id, gazetteer, name, area_km2, bbox, geom AS geometry FROM ST_Read('{f_tmp_geojson}')) ",
  "TO '{f_parquet}' (FORMAT PARQUET);\""))
fs::file_delete(f_tmp_geojson)

if (fs::file_exists(f_geojson)) fs::file_delete(f_geojson)
sf::st_write(places, f_geojson, delete_dsn = TRUE, quiet = TRUE)

system(glue::glue(
  "/opt/homebrew/bin/tippecanoe -o {f_pmtiles} -l places -zg ",
  "--drop-densest-as-needed --extend-zooms-if-still-dropping --force {f_geojson}"))

fs::file_delete(f_geojson)

# summary --------------------------------------------------------------------------------

summary_tbl <- places |>
  sf::st_drop_geometry() |>
  bind_cols(n_parts = sapply(sf::st_geometry(places), \(g) length(g))) |>
  select(place_id, name, n_parts, area_km2)

print(summary_tbl)

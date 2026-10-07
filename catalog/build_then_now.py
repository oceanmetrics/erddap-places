# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "rasterio>=1.4",
#   "numpy>=1.26",
#   "pandas>=2.2",
#   "pyarrow>=17",
#   "shapely>=2.0",
#   "matplotlib>=3.8",
# ]
# ///
"""build the "Then vs Now" collections of the gazetteer from the climate-dashboard-app archive.

the old Shiny pipeline (noaa-onms/climate-dashboard-app, process/erddap.qmd -> extractr::ed_extract)
left one multi-band GeoTIFF per sanctuary x year (one band per available day, float64, the sanctuary's
bounding box buffered by 20 % of sqrt(area)) plus a CSV of the daily polygon mean
(terra::zonal(exact = TRUE)). this script turns that archive into three Portolan/STAC collections:

  rasters/<dataset>/<variable>/<place_id>/<year>.tif               366-band COG, band i = day i of a leap year
  climatology/<dataset>/<variable>/<place_id>/<y0>-<y1>_{mean,sd,n}.tif   366-band day-of-year climatology
  series/<dataset>/<variable>/<place_id>.parquet                    daily area statistics over the place polygon

usage (from the repo root; the archive is ~1 GB, run on the Mac mini):

  uv run catalog/build_then_now.py --src ~/data/noaa-onms/climate-dashboard-app/erddap_sst \\
      --gazetteer catalog/gazetteer [--codes FKNMS ...] [--steps rasters,climatology,series,stac]

`--steps stac` alone rewrites every Item and the three collection.json from the files on disk (it
scans all places, not only --codes), so the catalog always describes exactly what exists.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import rasterio
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.transform import Affine
from rasterio.shutil import copy as gdal_copy
import shapely

# ── configuration ─────────────────────────────────────────────────────────────
N_BANDS   = 366
REF_YEAR  = 2000                 # a leap year: the calendar the bands follow (band 60 = 29 Feb)
BASELINES = [(1985, 2005), (2003, 2012)]
BASE_URL  = "https://storage.oceanmetrics.io/gazetteer/"

# archive folder -> gazetteer place id (CPNMS was the proposed name of Chumash Heritage)
CODE_TO_PLACE = {"CPNMS": "NMS:CHNMS"}
# archive folders with a gazetteer place but no usable data
NO_DATA = {"TBNMS": "CRW CoralTemp has no SST over the Great Lakes: the archive is all NaN (bar a spurious 0 on 2022-12-01)"}

PRODUCTS = {
  "erddap_sst": {
    "dataset_id"     : "dhw_5km",
    "variable"       : "CRW_SST",
    "units"          : "degree_C",
    "long_name"      : "sea surface temperature",
    "title"          : "NOAA Coral Reef Watch — Daily Global 5km SST + DHW",
    "source_dataset" : "noaacrwsstDaily",
    "source_variable": "analysed_sst",
    "source_url"     : "https://coastwatch.noaa.gov/erddap/griddap/noaacrwsstDaily.html",
    "via_url"        : "https://pae-paha.pacioos.hawaii.edu/erddap/info/dhw_5km/index.html",
    "res"            : 0.05,
  },
}
ARCHIVE_ON_VM = "mbon:/share/data/noaa-onms/climate-dashboard-app"
PIPELINE = ("noaa-onms/climate-dashboard-app process/erddap.qmd -> extractr::ed_extract() "
            "(one band per ERDDAP time step, bbox = sanctuary polygon buffered by 20% of sqrt(area), "
            "rounded to 0.01 deg; daily polygon mean by terra::zonal(exact=TRUE) into <year>.csv)")

COG_TYPE = "image/tiff; application=geotiff; profile=cloud-optimized"
PQ_TYPE  = "application/vnd.apache.parquet"
EXT_FILE = "https://stac-extensions.github.io/file/v2.1.0/schema.json"
EXT_PROJ = "https://stac-extensions.github.io/projection/v2.0.0/schema.json"
EXT_TAB  = "https://stac-extensions.github.io/table/v1.2.0/schema.json"
EXT_PTL  = "https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json"


def log(*a):
  print(time.strftime("%H:%M:%S"), *a, flush=True)


# ── calendar ──────────────────────────────────────────────────────────────────
def date_to_band(d: dt.date) -> int:
  """day of year of the same month-day in a leap year: 1 Mar is 61 in every year."""
  return (dt.date(REF_YEAR, d.month, d.day) - dt.date(REF_YEAR, 1, 1)).days + 1


def band_md(band: int) -> str:
  d = dt.date(REF_YEAR, 1, 1) + dt.timedelta(days=band - 1)
  return f"{d.month:02d}-{d.day:02d}"


def is_leap(y: int) -> bool:
  return (y % 4 == 0 and y % 100 != 0) or y % 400 == 0


def band_descriptions(year: int | None) -> list[str]:
  """ISO dates for a year file; `--MM-DD` (ISO 8601 month-day) for the non-date 29 Feb and for climatologies."""
  out = []
  for b in range(1, N_BANDS + 1):
    md = band_md(b)
    if year is None or (md == "02-29" and not is_leap(year)):
      out.append(f"--{md}")
    else:
      out.append(f"{year}-{md}")
  return out


# ── small helpers ─────────────────────────────────────────────────────────────
def multihash(path: Path) -> str:
  h = hashlib.sha256()
  with open(path, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
      h.update(chunk)
  return "1220" + h.hexdigest()


def place_of(code: str) -> str:
  return CODE_TO_PLACE.get(code, f"NMS:{code}")


def safe_id(place_id: str) -> str:
  return place_id.replace(":", "-")


def snap_transform(t: Affine, res: float) -> Affine:
  """the archive's transforms carry float32 noise (0.04999998 deg); snap them to the 0.05 grid."""
  x0, y0 = round(t.c / res) * res, round(t.f / res) * res
  if abs(x0 - t.c) > res / 10 or abs(y0 - t.f) > res / 10 or abs(abs(t.a) - res) > 1e-5 or abs(abs(t.e) - res) > 1e-5:
    raise ValueError(f"transform {t} is not on the {res} grid")
  return Affine(res, 0, round(x0, 6), 0, -res, round(y0, 6))


def band_stats(a: np.ndarray, nodata) -> dict:
  """GDAL STATISTICS_* tags (Portolan requires them embedded on every COG band); `nan` when empty."""
  a = a.astype("float64")
  ok = ~np.isnan(a) if nodata is not None else np.ones(a.shape, bool)
  v = a[ok]
  f = (lambda x: f"{float(x):.6g}") if v.size else (lambda x: "nan")
  return {"STATISTICS_MINIMUM": f(v.min() if v.size else 0), "STATISTICS_MAXIMUM": f(v.max() if v.size else 0),
          "STATISTICS_MEAN": f(v.mean() if v.size else 0), "STATISTICS_STDDEV": f(v.std() if v.size else 0),
          "STATISTICS_VALID_PERCENT": repr(round(100 * v.size / a.size, 4))}


def write_cog(path: Path, arr: np.ndarray, transform: Affine, descriptions: list[str], tags: dict,
              nodata=float("nan")):
  """write a band-interleaved, 256 px tiled, DEFLATE + predictor COG with GDAL's COG driver (>= 3.11
  for INTERLEAVE=BAND), keeping band descriptions and the per-band STATISTICS_* tags. overviews AUTO:
  none for a grid that fits one tile, which is every sanctuary here."""
  path.parent.mkdir(parents=True, exist_ok=True)
  count, h, w = arr.shape
  src_profile = dict(driver="GTiff", dtype=arr.dtype.name, count=count, height=h, width=w,
                     crs="EPSG:4326", transform=transform, nodata=nodata)
  tmp = path.with_suffix(".tmp.tif")
  with MemoryFile() as mem:
    with mem.open(**src_profile) as ds:
      ds.write(arr)
      for i, d in enumerate(descriptions, start=1):
        ds.set_band_description(i, d)
        ds.update_tags(i, **band_stats(arr[i - 1], nodata))
      ds.update_tags(**tags)
    with mem.open() as ds:
      gdal_copy(ds, str(tmp), driver="COG", COMPRESS="DEFLATE", LEVEL=9, PREDICTOR="YES",
                BLOCKSIZE=256, INTERLEAVE="BAND", OVERVIEWS="AUTO", RESAMPLING="AVERAGE", BIGTIFF="NO")
  os.replace(tmp, path)


# ── step 1: rasters ───────────────────────────────────────────────────────────
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def read_archive_year(tif: Path, res: float):
  """-> (array 366 x h x w float32, snapped transform, dates present)."""
  with rasterio.open(tif) as ds:
    data = ds.read().astype("float32")
    if ds.nodata is not None and not math.isnan(ds.nodata):
      data[data == ds.nodata] = np.nan
    dates = []
    for i in range(1, ds.count + 1):
      desc = ds.descriptions[i - 1] or ds.tags(i).get("DATE_TIME", "")
      m = DATE_RE.search(desc)
      if not m:
        raise ValueError(f"{tif}: band {i} has no date ({desc!r})")
      dates.append(dt.date.fromisoformat(m.group(1)))
    transform = snap_transform(ds.transform, res)
    h, w = ds.height, ds.width
  out = np.full((N_BANDS, h, w), np.nan, dtype="float32")
  seen = {}
  for i, d in enumerate(dates):
    b = date_to_band(d)
    if b in seen:
      log(f"  warn {tif.name}: {d} appears twice (bands {seen[b] + 1} and {i + 1}); keeping the later")
    seen[b] = i
    out[b - 1] = data[i]
  return out, transform, sorted(set(dates))


def build_rasters(src: Path, gaz: Path, prod: dict, code: str, years: list[int]):
  place = place_of(code)
  out_dir = gaz / "rasters" / prod["dataset_id"] / prod["variable"] / place
  grid = None
  for y in years:
    tif = src / code / f"{y}.tif"
    if not tif.exists():
      log(f"  {code} {y}: no archive file, skipped")
      continue
    arr, transform, dates = read_archive_year(tif, prod["res"])
    if grid is None:
      grid = (arr.shape, transform)
    elif grid != (arr.shape, transform):
      raise ValueError(f"{code} {y}: grid {arr.shape} {transform} differs from {grid}")
    mtime = dt.datetime.fromtimestamp(tif.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tags = {
      "TITLE"             : f"{prod['long_name']} ({prod['units']}), {place}, {y}, one band per day",
      "BANDS"             : "band i = day-of-year i of a leap-year calendar (band 60 = 29 Feb, all NaN in a non-leap year); band description = ISO date",
      "UNITS"             : prod["units"],
      "PLACE_ID"          : place,
      "YEAR"              : str(y),
      "N_DAYS"            : str(len(dates)),
      "FIRST_DATE"        : dates[0].isoformat(),
      "LAST_DATE"         : dates[-1].isoformat(),
      "GAZETTEER_DATASET" : prod["dataset_id"],
      "GAZETTEER_VARIABLE": prod["variable"],
      "SOURCE_URL"        : prod["source_url"],
      "SOURCE_DATASET"    : prod["source_dataset"],
      "SOURCE_VARIABLE"   : prod["source_variable"],
      "SOURCE_ARCHIVE"    : f"{ARCHIVE_ON_VM}/{src.name}/{code}/{y}.tif (modified {mtime})",
      "PROVENANCE"        : PIPELINE,
      "PROCESSING"        : "float64 -> float32, bands placed on the 366-day calendar, transform snapped to the 0.05 deg grid; catalog/build_then_now.py (oceanmetrics/erddap-places)",
    }
    write_cog(out_dir / f"{y}.tif", arr, transform, band_descriptions(y), tags)
    log(f"  {place} {y}: {len(dates)} days -> {(out_dir / f'{y}.tif').stat().st_size / 1e6:.2f} MB")


# ── step 2: climatology ───────────────────────────────────────────────────────
def build_climatology(gaz: Path, prod: dict, code: str, baselines, window: int = 0):
  place = place_of(code)
  r_dir = gaz / "rasters" / prod["dataset_id"] / prod["variable"] / place
  c_dir = gaz / "climatology" / prod["dataset_id"] / prod["variable"] / place
  for y0, y1 in baselines:
    files = [r_dir / f"{y}.tif" for y in range(y0, y1 + 1)]
    missing = [f.name for f in files if not f.exists()]
    if missing:
      raise FileNotFoundError(f"{place} {y0}-{y1}: missing year files {missing}")
    stack = []
    for f in files:
      with rasterio.open(f) as ds:
        stack.append(ds.read())
        transform = ds.transform
    stack = np.stack(stack)                          # years x 366 x h x w
    if window > 0:
      # pool every year's values within +-window days (circular over the 366 bands)
      stack = np.concatenate([np.roll(stack, k, axis=1) for k in range(-window, window + 1)], axis=0)
    valid = ~np.isnan(stack)
    n     = valid.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
      s1   = np.nansum(stack, axis=0)
      mean = np.where(n > 0, s1 / np.maximum(n, 1), np.nan).astype("float32")
      ss   = np.nansum((stack - mean[None]) ** 2, axis=0)
      sd   = np.where(n > 1, np.sqrt(ss / np.maximum(n - 1, 1)), np.nan).astype("float32")
    n = n.astype("uint8") if n.max() < 256 else n.astype("uint16")
    base = f"{y0}-{y1}"
    common = {
      "PLACE_ID"          : place,
      "BASELINE"          : base,
      "WINDOW_DAYS"       : str(window),
      "BANDS"             : "band i = day-of-year i of a leap-year calendar (band 60 = 29 Feb, from the leap years only); band description = --MM-DD",
      "UNITS"             : prod["units"],
      "GAZETTEER_DATASET" : prod["dataset_id"],
      "GAZETTEER_VARIABLE": prod["variable"],
      "SOURCE_URL"        : prod["source_url"],
      "PROVENANCE"        : f"per-pixel statistics over the year COGs rasters/{prod['dataset_id']}/{prod['variable']}/{place}/{y0}..{y1}.tif; " + PIPELINE,
      "PROCESSING"        : "catalog/build_then_now.py (oceanmetrics/erddap-places); raw day-of-year statistics" + (f", pooled over +-{window} days" if window else ", no smoothing"),
    }
    descs = band_descriptions(None)
    write_cog(c_dir / f"{base}_mean.tif", mean, transform, descs,
              {**common, "TITLE": f"day-of-year mean {prod['long_name']} ({prod['units']}), {place}, {base}", "STATISTIC": "mean"})
    write_cog(c_dir / f"{base}_sd.tif", sd, transform, descs,
              {**common, "TITLE": f"day-of-year sample standard deviation, {place}, {base}", "STATISTIC": "sd (ddof=1)"})
    write_cog(c_dir / f"{base}_n.tif", n, transform, descs,
              {**common, "TITLE": f"number of years with a value per day and pixel, {place}, {base}", "STATISTIC": "n", "UNITS": "1"},
              nodata=None)
    log(f"  {place} {base}: mean/sd/n written (n max {int(n.max())})")


# ── step 3: series ────────────────────────────────────────────────────────────
def load_places(gaz: Path) -> dict:
  t = pq.read_table(gaz / "places" / "places.parquet", columns=["place_id", "name", "geometry"])
  out = {}
  for pid, name, g in zip(t["place_id"].to_pylist(), t["name"].to_pylist(), t["geometry"].to_pylist()):
    out[pid] = {"name": name, "geom": shapely.from_wkb(g)}
  return out


def coverage(geom, transform: Affine, h: int, w: int, ss: int = 20) -> np.ndarray:
  """fraction of each cell covered by the polygon, by rasterising on a ss x ss finer grid."""
  fine = transform * Affine.scale(1 / ss)
  burn = rasterize([(geom, 1)], out_shape=(h * ss, w * ss), transform=fine, fill=0, dtype="uint8")
  return burn.reshape(h, ss, w, ss).mean(axis=(1, 3))


def build_series(src: Path, gaz: Path, prod: dict, code: str, years: list[int], places: dict):
  place = place_of(code)
  r_dir = gaz / "rasters" / prod["dataset_id"] / prod["variable"] / place
  geom = places[place]["geom"]
  rows, wt = [], None
  for y in years:
    f = r_dir / f"{y}.tif"
    if not f.exists():
      continue
    with rasterio.open(f) as ds:
      arr = ds.read()
      if wt is None:
        wt = coverage(geom, ds.transform, ds.height, ds.width)
        cells = wt > 0
        w = wt[cells]
        log(f"  {place}: {int(cells.sum())} cells touch the polygon ({int((wt > 0.5).sum())} > half covered)")
    for b in range(1, N_BANDS + 1):
      md = band_md(b)
      if md == "02-29" and not is_leap(y):
        continue
      v = arr[b - 1][cells]
      ok = ~np.isnan(v)
      if not ok.any():
        continue
      vv, ww = v[ok].astype("float64"), w[ok]
      rows.append({
        "date"      : dt.date(y, int(md[:2]), int(md[3:])),
        "mean"      : float((vv * ww).sum() / ww.sum()),
        "mean_unwt" : float(vv.mean()),
        "sd"        : float(vv.std(ddof=1)) if vv.size > 1 else float("nan"),
        "min"       : float(vv.min()),
        "max"       : float(vv.max()),
        "n_cells"   : int(ok.sum()),
        "weight_sum": float(ww.sum()),
      })
  df = pd.DataFrame(rows)
  # the old pipeline's own number (terra::zonal(exact=TRUE) over the climate-dashboard polygon)
  csvs = [src / code / f"{y}.csv" for y in years if (src / code / f"{y}.csv").exists()]
  shiny = pd.concat([pd.read_csv(c) for c in csvs])
  shiny["date"] = pd.to_datetime(shiny["time"].str.slice(0, 10)).dt.date
  shiny = shiny.groupby("date", as_index=False)["mean"].last().rename(columns={"mean": "mean_shiny"})
  df = df.merge(shiny, on="date", how="left")
  df["place_id"], df["dataset_id"], df["variable"] = place, prod["dataset_id"], prod["variable"]
  table = pa.Table.from_pandas(df, preserve_index=False, schema=pa.schema([
    ("date", pa.date32()), ("mean", pa.float64()), ("mean_unwt", pa.float64()), ("sd", pa.float64()),
    ("min", pa.float64()), ("max", pa.float64()), ("n_cells", pa.int32()), ("weight_sum", pa.float64()),
    ("mean_shiny", pa.float64()), ("place_id", pa.string()), ("dataset_id", pa.string()), ("variable", pa.string()),
  ]))
  out = gaz / "series" / prod["dataset_id"] / prod["variable"] / f"{place}.parquet"
  out.parent.mkdir(parents=True, exist_ok=True)
  pq.write_table(table, out, compression="zstd")
  d = (df["mean"] - df["mean_shiny"]).abs()
  log(f"  {place}: {len(df)} days, |mean - mean_shiny| median {d.median():.3f} max {d.max():.3f}, r = {df['mean'].corr(df['mean_shiny']):.4f}")


# ── thumbnails ────────────────────────────────────────────────────────────────
THUMB_PLACE = "NMS:FKNMS"
THUMB_MD    = "08-15"


def make_thumb(kind: str, gaz: Path, prod: dict, places: dict) -> tuple[Path, str]:
  """a small PNG per collection (Portolan requires one): FKNMS on 15 Aug, or its day-of-year curves."""
  import matplotlib
  matplotlib.use("Agg")
  import matplotlib.pyplot as plt
  ds_id, var = prod["dataset_id"], prod["variable"]
  out = gaz / kind / f"{kind}.thumb.png"
  fig, ax = plt.subplots(figsize=(3.2, 2.0), dpi=100)
  b = date_to_band(dt.date(REF_YEAR, int(THUMB_MD[:2]), int(THUMB_MD[3:])))
  if kind == "series":
    df = pq.read_table(gaz / "series" / ds_id / var / f"{THUMB_PLACE}.parquet", columns=["date", "mean"]).to_pandas()
    df["date"] = pd.to_datetime(df["date"])
    df["band"] = [date_to_band(d.date()) for d in df["date"]]
    df["year"] = df["date"].dt.year
    last_full = int(df.groupby("year").size().loc[lambda x: x >= 365].index.max())
    for y, g in df.groupby("year"):
      ax.plot(g["band"], g["mean"], lw=0.4, color="0.75")
    clim = df[df["year"].between(1985, 2005)].groupby("band")["mean"].mean()
    ax.plot(clim.index, clim.values, lw=1.2, color="k")
    g = df[df["year"] == last_full]
    ax.plot(g["band"], g["mean"], lw=1.0, color="tab:red")
    ax.set_xticks([]); ax.set_yticks([])
    title = f"{THUMB_PLACE} daily mean SST: every year (grey), 1985-2005 mean (black), {last_full} (red)"
  else:
    if kind == "rasters":
      fs = sorted((gaz / "rasters" / ds_id / var / THUMB_PLACE).glob("*.tif"))
      f = [x for x in fs if int(x.stem) < max(int(y.stem) for y in fs)][-1]
      title = f"{THUMB_PLACE} SST on {f.stem}-{THUMB_MD} (band {b})"
    else:
      f = gaz / "climatology" / ds_id / var / THUMB_PLACE / "1985-2005_mean.tif"
      title = f"{THUMB_PLACE} SST 1985-2005 mean for {THUMB_MD} (band {b})"
    with rasterio.open(f) as r:
      a, bnd = r.read(b), r.bounds
    ax.imshow(a, extent=(bnd.left, bnd.right, bnd.bottom, bnd.top), cmap="turbo", interpolation="nearest")
    gm = places[THUMB_PLACE]["geom"]
    for poly in getattr(gm, "geoms", [gm]):
      x, y = poly.exterior.xy
      ax.plot(x, y, color="k", lw=0.5)
    ax.set_axis_off()
  fig.subplots_adjust(0, 0, 1, 1)
  fig.savefig(out, dpi=100)
  plt.close(fig)
  return out, title


def attach_thumb(col: dict, kind: str, gaz: Path, prod: dict, places: dict):
  p, title = make_thumb(kind, gaz, prod, places)
  col["assets"]["thumbnail"].update({"title": title, **file_props(p)})


# ── step 4: STAC ──────────────────────────────────────────────────────────────
SERIES_COLUMNS = [
  ("date"      , "date"  , "UTC day"),
  ("mean"      , "double", "area-weighted mean over the place polygon: each 0.05 deg cell weighted by the fraction of it inside the polygon (as terra::zonal(exact=TRUE) and the app's mean_wt)"),
  ("mean_unwt" , "double", "unweighted mean over the cells that touch the polygon"),
  ("sd"        , "double", "sample standard deviation over those cells (unweighted)"),
  ("min"       , "double", "minimum over those cells"),
  ("max"       , "double", "maximum over those cells"),
  ("n_cells"   , "int32" , "cells with a value that touch the polygon"),
  ("weight_sum", "double", "sum of the coverage weights of those cells (cell-equivalents of polygon area)"),
  ("mean_shiny", "double", "the climate-dashboard-app's own daily mean (its CSV; terra::zonal(exact=TRUE) over its sanctuary polygon), for comparison"),
  ("place_id"  , "string", "gazetteer place id, e.g. NMS:FKNMS"),
  ("dataset_id", "string", "gazetteer dataset id, e.g. dhw_5km"),
  ("variable"  , "string", "gazetteer variable, e.g. CRW_SST"),
]


def iso(d: dt.date, end=False) -> str:
  return f"{d.isoformat()}T{'23:59:59' if end else '00:00:00'}Z"


def bbox_geom(b):
  w, s, e, n = b
  return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def item_links(extra=()):
  return [
    {"rel": "root"      , "href": "../../catalog.json"   , "type": "application/json"},
    {"rel": "parent"    , "href": "../collection.json"   , "type": "application/json"},
    {"rel": "collection", "href": "../collection.json"   , "type": "application/json"},
    *extra,
  ]


def related(prod):
  return [
    {"rel": "related", "href": f"../../erddap/{prod['dataset_id']}/collection.json", "type": "application/json", "title": prod["title"]},
    {"rel": "related", "href": "../../places/collection.json", "type": "application/json", "title": "Places"},
    {"rel": "via", "href": prod["source_url"], "type": "text/html", "title": f"source: {prod['source_dataset']} {prod['source_variable']} (NOAA CoastWatch ERDDAP)"},
  ]


def file_props(p: Path) -> dict:
  return {"file:size": p.stat().st_size, "file:checksum": multihash(p)}


def proj_props(ds) -> dict:
  b = ds.bounds
  return {"proj:code": "EPSG:4326", "proj:shape": [ds.height, ds.width],
          "proj:transform": [round(x, 6) for x in list(ds.transform)[:6]],
          "proj:bbox": [round(b.left, 6), round(b.bottom, 6), round(b.right, 6), round(b.top, 6)]}


def write_json(p: Path, obj):
  p.parent.mkdir(parents=True, exist_ok=True)
  p.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def now_iso():
  return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


PROVIDERS = [
  {"name": "NOAA Coral Reef Watch (CRW)", "roles": ["producer", "licensor"], "url": "https://coralreefwatch.noaa.gov"},
  {"name": "NOAA ONMS climate-dashboard-app (MarineBON)", "roles": ["processor"], "url": "https://github.com/noaa-onms/climate-dashboard-app"},
  {"name": "Ocean Metrics LLC", "roles": ["processor", "host"], "url": "https://oceanmetrics.io"},
]


def collection(cid, title, description, keywords, bbox, interval, summaries, items, prod, exts, extra=None, thumb_title=""):
  links = [
    {"rel": "root"  , "href": "../catalog.json", "type": "application/json", "title": "Ocean Metrics gazetteer"},
    {"rel": "parent", "href": "../catalog.json", "type": "application/json"},
    {"rel": "agents", "href": "./AGENTS.md", "type": "text/markdown", "title": "Agent/LLM usage guide"},
    {"rel": "describedby", "href": "./README.md", "type": "text/markdown", "title": "Human-readable documentation"},
    {"rel": "related", "href": f"../erddap/{prod['dataset_id']}/collection.json", "type": "application/json", "title": prod["title"]},
    {"rel": "related", "href": "../places/collection.json", "type": "application/json", "title": "Places"},
    *[{"rel": "related", "href": f"../{o}/collection.json", "type": "application/json", "title": t}
      for o, t in [("rasters", "Then vs Now: daily rasters"), ("climatology", "Then vs Now: day-of-year climatologies"),
                   ("series", "Then vs Now: daily area series")] if o != cid],
    {"rel": "via", "href": prod["source_url"], "type": "text/html", "title": f"source: {prod['source_dataset']} (NOAA CoastWatch ERDDAP)"},
    *[{"rel": "item", "href": f"./items/{i}.json", "type": "application/geo+json", "title": i} for i in items],
  ]
  col = {
    "type": "Collection", "id": cid, "stac_version": "1.1.0",
    "stac_extensions": [EXT_FILE, *exts, EXT_PTL],
    "title": title, "description": description,
    "license": "CC-BY-4.0", "keywords": keywords,
    "extent": {"spatial": {"bbox": [bbox]}, "temporal": {"interval": [interval]}},
    "providers": PROVIDERS, "summaries": summaries,
    **(extra or {}),
    "assets": {"thumbnail": {"href": f"./{cid}.thumb.png", "type": "image/png", "title": thumb_title, "roles": ["thumbnail"]}},
    "updated": now_iso(), "links": links,
  }
  return col


def union_bbox(bbs):
  return [round(min(b[0] for b in bbs), 6), round(min(b[1] for b in bbs), 6),
          round(max(b[2] for b in bbs), 6), round(max(b[3] for b in bbs), 6)]


def build_stac(gaz: Path, prod: dict, places: dict):
  ds_id, var = prod["dataset_id"], prod["variable"]
  # rasters ----
  r_root = gaz / "rasters"
  items, bbs, years_all, pids, lasts = [], [], [], [], []
  for f in sorted((r_root / ds_id / var).glob("*/*.tif")):
    place, y = f.parent.name, int(f.stem)
    with rasterio.open(f) as ds:
      tags = ds.tags()
      pp = proj_props(ds)
      n_valid = sum(float(ds.tags(b).get("STATISTICS_VALID_PERCENT", 0)) > 0 for b in range(1, ds.count + 1))
    first, last = dt.date.fromisoformat(tags["FIRST_DATE"]), dt.date.fromisoformat(tags["LAST_DATE"])
    iid = f"{ds_id}_{var}_{safe_id(place)}_{y}"
    bb = pp["proj:bbox"]
    item = {
      "type": "Feature", "stac_version": "1.1.0", "stac_extensions": [EXT_FILE, EXT_PROJ],
      "id": iid, "collection": "rasters", "geometry": bbox_geom(bb), "bbox": bb,
      "properties": {
        "title": f"{places[place]['name']} — {var} ({ds_id}), {y}, one band per day",
        "description": f"Daily {prod['long_name']} ({prod['units']}) for {y} on the 0.05 deg CRW grid over a 20 %-buffered box around {places[place]['name']} ({place}): 366 bands, band i = day-of-year i of a leap-year calendar (band 60 = 29 Feb, NaN in non-leap years). {tags['N_DAYS']} days in the archive, {first} to {last}, {n_valid} with any value" + (" (this year is all NaN in the source archive)" if n_valid == 0 else "") + ".",
        "datetime": None, "start_datetime": iso(first), "end_datetime": iso(last, end=True),
        "created": now_iso(),
        **pp,
        "erddap-places:place_id": place, "erddap-places:dataset_id": ds_id, "erddap-places:variable": var,
        "erddap-places:year": y, "erddap-places:n_days": int(tags["N_DAYS"]), "erddap-places:n_days_valid": n_valid,
        "erddap-places:first_date": str(first), "erddap-places:last_date": str(last),
        "erddap-places:bands": "band i = day-of-year i of a leap year (band 60 = 29 Feb)",
      },
      "assets": {"data": {
        "href": f"../{ds_id}/{var}/{place}/{y}.tif", "type": COG_TYPE,
        "title": f"{var} {place} {y} (366-band COG, {prod['units']})", "roles": ["data"],
        **file_props(f)}},
      "links": item_links(related(prod)),
    }
    write_json(r_root / "items" / f"{iid}.json", item)
    items.append(iid); bbs.append(bb); years_all.append(y); pids.append(place); lasts.append(last)
  if items:
    upids = sorted(set(pids))
    desc = (f"Daily grids of {prod['source_dataset']} {prod['source_variable']} (NOAA Coral Reef Watch CoralTemp 5 km SST, the product PacIOOS re-serves as {ds_id}/{var}) "
            f"around each sanctuary, one cloud-optimized GeoTIFF per place and year: 366 bands, band i = day-of-year i of a leap-year calendar, so a month-day is the same band in every year "
            f"(band 60 = 29 Feb is NaN in non-leap years). Float32, nodata NaN, INTERLEAVE=BAND, 256 px tiles, DEFLATE with the floating-point predictor, EPSG:4326, 0.05 deg cells; "
            f"every grid fits one tile, so reading one day for one place is one HTTP range request of a few kB. Converted from the archive of the NOAA ONMS climate-dashboard-app "
            f"(extractr::ed_extract over a 20 %-buffered bounding box per sanctuary) by catalog/build_then_now.py. Read a band with geotiff.js; average the same band across year files for a custom 'Then'.")
    col = collection("rasters", "Then vs Now: daily rasters", desc,
                     ["sea surface temperature", "Coral Reef Watch", "COG", "day of year", "marine protected areas", "then vs now"],
                     union_bbox(bbs), [iso(dt.date(min(years_all), 1, 1)), iso(max(lasts), end=True)],
                     {"erddap-places:dataset_id": [ds_id], "erddap-places:variable": [var], "erddap-places:place_id": upids,
                      "erddap-places:baselines": [f"{a}-{b}" for a, b in BASELINES],
                      "year": {"minimum": min(years_all), "maximum": max(years_all)}},
                     items, prod, [EXT_PROJ])
    attach_thumb(col, "rasters", gaz, prod, places)
    write_json(r_root / "collection.json", col)
    log(f"stac rasters: {len(items)} items")
  # climatology ----
  c_root = gaz / "climatology"
  items, bbs, ivs, pids = [], [], [], []
  for d in sorted((c_root / ds_id / var).glob("*")):
    place = d.name
    for mf in sorted(d.glob("*_mean.tif")):
      base = mf.name.removesuffix("_mean.tif")
      y0, y1 = (int(x) for x in base.split("-"))
      with rasterio.open(mf) as ds:
        pp, window = proj_props(ds), int(ds.tags().get("WINDOW_DAYS", 0))
      iid = f"{ds_id}_{var}_{safe_id(place)}_{base}"
      bb = pp["proj:bbox"]
      assets = {}
      for stat, title in [("mean", "day-of-year mean"), ("sd", "day-of-year sample standard deviation"), ("n", "years with a value (uint8, no nodata)")]:
        p = d / f"{base}_{stat}.tif"
        assets[stat] = {"href": f"../{ds_id}/{var}/{place}/{base}_{stat}.tif", "type": COG_TYPE,
                        "title": f"{title}, {base}", "roles": ["data"], **file_props(p)}
      item = {
        "type": "Feature", "stac_version": "1.1.0", "stac_extensions": [EXT_FILE, EXT_PROJ],
        "id": iid, "collection": "climatology", "geometry": bbox_geom(bb), "bbox": bb,
        "properties": {
          "title": f"{places[place]['name']} — {var} ({ds_id}) day-of-year climatology {base}",
          "description": f"Per-pixel day-of-year mean, standard deviation and count of daily {prod['long_name']} over {base} for {places[place]['name']} ({place}); 366 bands on the leap-year calendar, same grid as the rasters collection. Raw day-of-year statistics (no smoothing window).",
          "datetime": None, "start_datetime": iso(dt.date(y0, 1, 1)), "end_datetime": iso(dt.date(y1, 12, 31), end=True),
          "created": now_iso(), **pp,
          "erddap-places:place_id": place, "erddap-places:dataset_id": ds_id, "erddap-places:variable": var,
          "erddap-places:baseline": [y0, y1], "erddap-places:window_days": window,
          "erddap-places:bands": "band i = day-of-year i of a leap year (band 60 = 29 Feb, leap years only)",
        },
        "assets": assets,
        "links": item_links([{"rel": "derived_from", "href": f"../../rasters/items/{ds_id}_{var}_{safe_id(place)}_{y}.json", "type": "application/geo+json"} for y in range(y0, y1 + 1)] + related(prod)),
      }
      write_json(c_root / "items" / f"{iid}.json", item)
      items.append(iid); bbs.append(bb); ivs.append((y0, y1)); pids.append(place)
  if items:
    desc = ("Day-of-year climatologies of the rasters collection: for each place and baseline, three 366-band COGs (`<y0>-<y1>_mean.tif`, `_sd.tif`, `_n.tif`) "
            "holding the per-pixel mean, sample standard deviation and number of years with a value for each calendar day (band i = day-of-year i of a leap year; band 60 = 29 Feb from the leap years only). "
            "Raw day-of-year statistics, no smoothing window (catalog/build_then_now.py --window N pools +-N days if ever wanted). Baselines: 1985-2005 (the climate-dashboard-app's default first 20 years) "
            "and 2003-2012 (the NMS EcoIndicators baseline). Same grid, encoding and reading pattern as the rasters collection: one band = one HTTP range request.")
    col = collection("climatology", "Then vs Now: day-of-year climatologies", desc,
                     ["sea surface temperature", "climatology", "baseline", "COG", "day of year", "then vs now"],
                     union_bbox(bbs), [iso(dt.date(min(a for a, _ in ivs), 1, 1)), iso(dt.date(max(b for _, b in ivs), 12, 31), end=True)],
                     {"erddap-places:dataset_id": [ds_id], "erddap-places:variable": [var], "erddap-places:place_id": sorted(set(pids)),
                      "erddap-places:baselines": [f"{a}-{b}" for a, b in BASELINES], "erddap-places:window_days": [0]},
                     items, prod, [EXT_PROJ])
    attach_thumb(col, "climatology", gaz, prod, places)
    write_json(c_root / "collection.json", col)
    log(f"stac climatology: {len(items)} items")
  # series ----
  s_root = gaz / "series"
  items, bbs, d0s, d1s, pids = [], [], [], [], []
  rcols = [{"name": n, "type": t, "description": d} for n, t, d in SERIES_COLUMNS]
  for f in sorted((s_root / ds_id / var).glob("*.parquet")):
    place = f.stem
    t = pq.read_table(f, columns=["date"])
    d0, d1 = min(t["date"].to_pylist()), max(t["date"].to_pylist())
    b = shapely.bounds(places[place]["geom"])
    bb = [round(float(x), 6) for x in b]
    iid = f"{ds_id}_{var}_{safe_id(place)}"
    item = {
      "type": "Feature", "stac_version": "1.1.0", "stac_extensions": [EXT_TAB, EXT_FILE],
      "id": iid, "collection": "series", "geometry": bbox_geom(bb), "bbox": bb,
      "properties": {
        "title": f"{places[place]['name']} — {var} ({ds_id}) daily area series",
        "description": f"Daily statistics of {prod['long_name']} over the {places[place]['name']} ({place}) polygon from the rasters collection, {d0} to {d1}: area-weighted mean (cell coverage fraction), unweighted mean, sd, min, max, n_cells, plus the climate-dashboard-app's own mean for comparison.",
        "datetime": None, "start_datetime": iso(d0), "end_datetime": iso(d1, end=True), "created": now_iso(),
        "table:row_count": t.num_rows,
        "erddap-places:place_id": place, "erddap-places:dataset_id": ds_id, "erddap-places:variable": var,
      },
      "assets": {"data": {"href": f"../{ds_id}/{var}/{place}.parquet", "type": PQ_TYPE,
                          "title": f"{var} daily area series for {places[place]['name']}", "roles": ["data"],
                          "table:columns": rcols, **file_props(f)}},
      "links": item_links(related(prod)),
    }
    write_json(s_root / "items" / f"{iid}.json", item)
    items.append(iid); bbs.append(bb); d0s.append(d0); d1s.append(d1); pids.append(place)
  if items:
    desc = ("Daily area statistics per place for the Then vs Now day-of-year chart: one Parquet per (dataset, variable, place) over the full record, computed from the rasters collection "
            "over the gazetteer polygon (places.parquet) with each 0.05 deg cell weighted by the fraction of it inside the polygon (the same weighting as terra::zonal(exact=TRUE) in the "
            "climate-dashboard-app and mean_wt in the app's live statistics). `mean` is that area-weighted mean; `mean_shiny` keeps the old app's CSV value (its own sanctuary polygon) for comparison.")
    col = collection("series", "Then vs Now: daily area series", desc,
                     ["sea surface temperature", "time series", "zonal statistics", "day of year", "then vs now"],
                     union_bbox(bbs), [iso(min(d0s)), iso(max(d1s), end=True)],
                     {"erddap-places:dataset_id": [ds_id], "erddap-places:variable": [var], "erddap-places:place_id": sorted(set(pids))},
                     items, prod, [EXT_TAB], extra={"table:columns": rcols})
    attach_thumb(col, "series", gaz, prod, places)
    write_json(s_root / "collection.json", col)
    log(f"stac series: {len(items)} items")


# ── main ──────────────────────────────────────────────────────────────────────
def main():
  ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument("--src", required=True, type=Path, help="archive folder, e.g. ~/data/noaa-onms/climate-dashboard-app/erddap_sst")
  ap.add_argument("--gazetteer", default=Path("catalog/gazetteer"), type=Path)
  ap.add_argument("--codes", nargs="*", help="archive sanctuary codes (default: every folder with a gazetteer match)")
  ap.add_argument("--years", nargs=2, type=int, default=[1985, 2026])
  ap.add_argument("--steps", default="rasters,climatology,series,stac")
  ap.add_argument("--window", type=int, default=0, help="climatology: pool +-N days (default 0 = raw day-of-year)")
  a = ap.parse_args()
  src, gaz = a.src.expanduser(), a.gazetteer.expanduser()
  prod = PRODUCTS[src.name]
  places = load_places(gaz)
  codes = a.codes or sorted(p.name for p in src.iterdir() if p.is_dir())
  skipped = [c for c in codes if place_of(c) not in places]
  if skipped:
    log(f"no gazetteer place for {skipped}: skipped")
  codes = [c for c in codes if place_of(c) in places]
  for c in [c for c in codes if c in NO_DATA]:
    log(f"{c}: skipped, {NO_DATA[c]}")
  codes = [c for c in codes if c not in NO_DATA]
  years = list(range(a.years[0], a.years[1] + 1))
  steps = a.steps.split(",")
  t0 = time.time()
  for c in codes:
    log(f"{c} -> {place_of(c)}")
    if "rasters" in steps:
      build_rasters(src, gaz, prod, c, years)
    if "climatology" in steps:
      build_climatology(gaz, prod, c, BASELINES, a.window)
    if "series" in steps:
      build_series(src, gaz, prod, c, years, places)
  if "stac" in steps:
    build_stac(gaz, prod, places)
  log(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
  sys.exit(main())

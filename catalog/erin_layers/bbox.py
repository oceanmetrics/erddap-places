"""antimeridian-aware bboxes for the published metadata (STAC extents, the GeoParquet `geo` bbox).

RFC 7946 section 5, which STAC and GeoParquet both follow: [west, south, east, north] with west > east crosses
+/-180. Geometries are stored split at +/-180 (`geom.split_antimeridian`), so a plain min/max over their
coordinates gives a place like PMNM (177.8..180 plus -180..-161) the band round the whole globe. The rule here
gives it [177.8, s, -161, n] instead.

The per-row `bbox` covering column is NOT changed: readers filter it with plain xmin <= x <= xmax comparisons.

Twin of `unionBbox()` / `placeBbox()` in app/src/lib/gazetteer.ts; both run catalog/tests/union_bbox_cases.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import pyarrow.parquet as pq
import shapely

from .geom import _polygons


def union_bbox(boxes) -> list[float]:
  """the smallest [west, south, east, north] holding every box (a box may itself cross +/-180).

  longitude is a circle: the result leaves out the widest stretch no box covers. boxes covering every longitude
  give -180..180; a tie keeps the box that does not cross.
  """
  boxes = [list(b)[:4] for b in boxes]
  if not boxes:
    raise ValueError("union_bbox: no boxes")
  s, n = min(b[1] for b in boxes), max(b[3] for b in boxes)
  spans = sorted(s_ for w, _, e, _ in boxes for s_ in ([(w, e)] if w <= e else [(w, 180.0), (-180.0, e)]))
  merged: list[list[float]] = []
  for a, b in spans:
    if merged and a <= merged[-1][1]:
      merged[-1][1] = max(merged[-1][1], b)
    else:
      merged.append([a, b])
  # the widest gap: round the back of the globe (last span to first) or between two spans
  w, e = merged[0][0], merged[-1][1]
  gap = w + 360 - e
  for left, right in zip(merged, merged[1:]):
    if right[0] - left[1] > gap:
      gap, w, e = right[0] - left[1], right[0], left[1]
  return [w, s, e, n]


def place_bbox(geom) -> list[float] | None:
  """one place's bbox: its polygon parts grouped by side of +/-180 when they span more than 180 degrees of
  longitude (as `placeLobes()` groups them), then unioned. None for an empty geometry."""
  parts = [p.bounds for p in _polygons(geom)]
  if not parts:
    return None
  if max(b[2] for b in parts) - min(b[0] for b in parts) <= 180:
    return union_bbox([[min(b[0] for b in parts), min(b[1] for b in parts),
                        max(b[2] for b in parts), max(b[3] for b in parts)]])
  sides = [[b for b in parts if (b[0] + b[2]) / 2 < 0], [b for b in parts if (b[0] + b[2]) / 2 >= 0]]
  return union_bbox([[min(b[0] for b in g), min(b[1] for b in g), max(b[2] for b in g), max(b[3] for b in g)]
                     for g in sides if g])


def geometries_bbox(geoms) -> list[float]:
  """the union of every place's bbox, for a whole file or collection."""
  boxes = [b for b in (place_bbox(g) for g in geoms) if b is not None]
  return union_bbox(boxes)


def parquet_bbox(path: Path, column: str = "geometry") -> list[float]:
  """`geometries_bbox()` of a GeoParquet file's WKB geometry column."""
  wkb = pq.read_table(path, columns=[column]).column(column).to_pylist()
  return geometries_bbox(shapely.from_wkb([w for w in wkb if w is not None]))


def set_geo_bbox(path: Path) -> list[float]:
  """rewrite the file-level `geo` bbox of a GeoParquet file with `parquet_bbox()` (data, row groups and
  compression kept); returns the bbox. a no-op when it already holds that value."""
  f = pq.ParquetFile(path)
  meta = dict(f.schema_arrow.metadata or {})
  geo = json.loads(meta[b"geo"])
  col = geo.get("primary_column", "geometry")
  bbox = parquet_bbox(path, col)
  if geo["columns"][col].get("bbox") == bbox:
    return bbox
  geo["columns"][col]["bbox"] = bbox
  meta[b"geo"] = json.dumps(geo).encode()
  codec = f.metadata.row_group(0).column(0).compression.lower() if f.metadata.num_row_groups else "zstd"
  rows = max(f.metadata.row_group(i).num_rows for i in range(f.metadata.num_row_groups)) if f.metadata.num_row_groups else None
  table = f.read()
  tmp = path.with_suffix(".bbox.tmp")
  pq.write_table(table.replace_schema_metadata(meta), tmp, compression=codec, row_group_size=rows)
  tmp.replace(path)
  return bbox


def join_extent(collection_json: Path, data: list[Path] | None = None) -> list[list[float]]:
  """portolan writes a crossing extent as its two halves ([-180..e], [w..180]); STAC reads the FIRST bbox as
  the overall extent, so join every extent bbox into one `union_bbox()`. returns the new extent.

  with `data` (GeoParquet files) the extent is measured from them instead: portolan unions the new bbox with
  the extent already in collection.json, so a collection first published as -180..180 would keep it."""
  c = json.loads(collection_json.read_text())
  boxes = c["extent"]["spatial"]["bbox"]
  joined = [union_bbox([parquet_bbox(d) for d in data] if data else boxes)]
  if joined != boxes:
    c["extent"]["spatial"]["bbox"] = joined
    collection_json.write_text(json.dumps(c, indent=2, ensure_ascii=False) + "\n")
  return joined

"""the antimeridian bbox rule (erin_layers/bbox.py); the cases are shared with app/src/lib/gazetteer.test.ts."""
import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest
from shapely.geometry import MultiPolygon, box

from erin_layers.bbox import geometries_bbox, join_extent, place_bbox, set_geo_bbox, union_bbox
from erin_layers.table import geo_metadata

CASES = json.loads((Path(__file__).parent / "union_bbox_cases.json").read_text())["cases"]
PMNM = MultiPolygon([box(-180, 19, -161, 32), box(177, 25, 180, 30)])
GRNMS = MultiPolygon([box(-80.92, 31.36, -80.83, 31.42)])


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_union_bbox_shared_cases(case):
  assert union_bbox(case["boxes"]) == case["want"]


def test_union_bbox_refuses_empty():
  with pytest.raises(ValueError):
    union_bbox([])


def test_place_bbox_crosses_for_an_antimeridian_place():
  assert place_bbox(PMNM) == [177, 19, -161, 32]


def test_place_bbox_is_the_plain_bounds_otherwise():
  assert place_bbox(GRNMS) == [-80.92, 31.36, -80.83, 31.42]
  assert place_bbox(MultiPolygon()) is None


def test_geometries_bbox_of_a_collection_with_pmnm():
  assert geometries_bbox([PMNM, GRNMS]) == [177, 19, -80.83, 32]


def _write(tmp_path, geoms):
  import pyarrow as pa, shapely
  t = pa.table({"place_id": [f"p{i}" for i in range(len(geoms))],
                "geometry": pa.array(shapely.to_wkb(geoms), type=pa.binary())})
  geo = {"version": "1.1.0", "primary_column": "geometry",
         "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["MultiPolygon"], "bbox": [-180, 19, 180, 32]}}}
  p = tmp_path / "places.parquet"
  pq.write_table(t.replace_schema_metadata({b"geo": json.dumps(geo).encode(), b"other": b"kept"}), p, compression="zstd")
  return p


def test_set_geo_bbox_rewrites_only_the_file_bbox(tmp_path):
  p = _write(tmp_path, [PMNM, GRNMS])
  assert set_geo_bbox(p) == [177, 19, -80.83, 32]
  f = pq.ParquetFile(p)
  assert json.loads(f.schema_arrow.metadata[b"geo"])["columns"]["geometry"]["bbox"] == [177, 19, -80.83, 32]
  assert f.schema_arrow.metadata[b"other"] == b"kept"
  assert f.metadata.row_group(0).column(0).compression == "ZSTD"
  assert f.read().num_rows == 2
  mtime = p.stat().st_mtime_ns
  set_geo_bbox(p)                                          # already right: the file is left alone
  assert p.stat().st_mtime_ns == mtime


def test_join_extent_joins_portolans_halves(tmp_path):
  p = tmp_path / "collection.json"
  p.write_text(json.dumps({"extent": {"spatial": {"bbox": [[-180, -28.4, -64.5, 48.5], [177.8, -28.4, 180, 48.5]]}}}))
  assert join_extent(p) == [[177.8, -28.4, -64.5, 48.5]]
  assert json.loads(p.read_text())["extent"]["spatial"]["bbox"] == [[177.8, -28.4, -64.5, 48.5]]


def test_join_extent_leaves_a_plain_extent(tmp_path):
  p = tmp_path / "collection.json"
  body = json.dumps({"extent": {"spatial": {"bbox": [[-125, 24, -80, 40]]}}})
  p.write_text(body)
  assert join_extent(p) == [[-125, 24, -80, 40]]
  assert p.read_text() == body


def test_layer_geo_metadata_bbox_crosses_for_pmnm():
  import pyarrow as pa, shapely
  t = pa.table({"geometry": pa.array(shapely.to_wkb([PMNM, GRNMS]), type=pa.binary())})
  assert geo_metadata(t)["columns"]["geometry"]["bbox"] == [177, 19, -80.83, 32]


def test_join_extent_from_data_replaces_a_stale_global_extent(tmp_path):
  data = _write(tmp_path, [PMNM, GRNMS])
  p = tmp_path / "collection.json"
  p.write_text(json.dumps({"extent": {"spatial": {"bbox": [[-180, 19, 180, 32]]}}}))
  assert join_extent(p, [data]) == [[177, 19, -80.83, 32]]

# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pyarrow>=17",
#   "shapely>=2.1",
#   "numpy>=1.26",
# ]
# ///
"""antimeridian-aware bboxes for the gazetteer's published metadata (rule and tests: catalog/erin_layers/bbox.py).

  uv run catalog/antimeridian.py geo-bbox    <file.parquet> ...     # file-level `geo` bbox crosses +/-180 (west > east) when the places do
  uv run catalog/antimeridian.py join-extent <collection.json> ...  # portolan's two halves of a crossing extent -> one bbox
  uv run catalog/antimeridian.py join-extent <collection.json> --data <file.parquet> ...  # the extent measured from the data

build_places.R runs geo-bbox on places.parquet; publish_places.sh runs join-extent after `portolan add`.
"""
import argparse
import sys
from pathlib import Path

from erin_layers.bbox import join_extent, set_geo_bbox


def main(argv=None) -> int:
  ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument("cmd", choices=["geo-bbox", "join-extent"])
  ap.add_argument("paths", nargs="+", type=Path)
  ap.add_argument("--data", nargs="+", type=Path, help="join-extent: measure the extent from these GeoParquet files")
  a = ap.parse_args(argv)
  for p in a.paths:
    out = set_geo_bbox(p) if a.cmd == "geo-bbox" else join_extent(p, a.data)
    print(f"{p}: {out}")
  return 0


if __name__ == "__main__":
  sys.exit(main())

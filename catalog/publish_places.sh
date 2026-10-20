#!/usr/bin/env bash
# publish the places collection: build -> copy -> portolan add -> version bump -> check -> upload
#
# usage: catalog/publish_places.sh <new_version> [-m "release note"] [--no-build] [--no-upload] [--upload-only]
#   e.g. catalog/publish_places.sh 1.2.0 -m "tile metadata + attribution"
#   --upload-only: steps 1-4 were already done and committed (places/versions.json already at <new_version>,
#   as after a --no-upload dry run); run only the check and the upload
#
# - build:  Rscript catalog/build_places.R   (reuses catalog/cache/; --no-build skips it)
# - copy:   catalog/places/places.{parquet,pmtiles} -> catalog/gazetteer/places/
# - add:    portolan add places/             (adds the bbox covering metadata, refreshes STAC)
# - bump:   portolan version bump places <new_version>
# - check:  rashid check (a failure stops the script before anything is uploaded)
# - upload: portolan push ... --collection places, then the places entry of the published root versions.json
#           (overwrites places/ in place; never deletes other objects in the bucket)
#
# edit CHANGELOG-style notes in gazetteer/places/README.md ("Changes") before running, since
# portolan checksums the README.

set -euo pipefail

version=""
note="places rebuilt"
do_build=1
do_upload=1
upload_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m)          note="$2"; shift 2 ;;
    --no-build)  do_build=0; shift ;;
    --no-upload) do_upload=0; shift ;;
    --upload-only) upload_only=1; shift ;;
    *)           version="$1"; shift ;;
  esac
done
[[ -n "$version" ]] || { echo "usage: $0 <new_version> [-m note] [--no-build] [--no-upload] [--upload-only]" >&2; exit 1; }

dir_catalog="$(cd "$(dirname "$0")" && pwd)"
dir_repo="$(dirname "$dir_catalog")"
dir_gaz="$dir_catalog/gazetteer"
s3_dest="s3://oceanmetrics.io-public/gazetteer"

if [[ $upload_only -eq 0 ]]; then
# 1. build ----
if [[ $do_build -eq 1 ]]; then
  (cd "$dir_repo" && Rscript catalog/build_places.R)
fi

# 2. copy ----
cp "$dir_catalog/places/places.parquet" "$dir_catalog/places/places.pmtiles" "$dir_gaz/places/"

# 3. add (portolan add also rewrites the other collections' collection.json and the root
#    catalog.json; snapshot and restore them so only places changes) ----
snap="$(mktemp -d)"
trap 'rm -rf "$snap"' EXIT
others=$(cd "$dir_gaz" && find . -name collection.json -not -path './places/*' -not -path '*/items/*' | sort)
# also snapshot the places version ledger: add auto-creates a patch version that would leave bump with
# "no changes", so the requested version is made by bump from the restored ledger
for f in $others catalog.json places/versions.json; do
  mkdir -p "$snap/$(dirname "$f")"
  cp "$dir_gaz/$f" "$snap/$f"
done

cd "$dir_gaz"
portolan add places/ --no-thumbnails
# add rewrites places.parquet (it adds the bbox covering) and with it the file-level geo bbox, back to
# -180..180 for PMNM: set it to cross +/-180 again (west > east) before bump records the file
uv run "$dir_catalog/antimeridian.py" geo-bbox "$dir_gaz/places/places.parquet"

for f in $others catalog.json places/versions.json; do
  cp "$snap/$f" "$dir_gaz/$f"
done

# 4. version bump (also sync the root versions.json summary, which bump leaves at the old version) ----
portolan version bump places "$version" -m "$note" -y
python3 - "$dir_gaz" <<'PYEOF'
import datetime, json, os, sys
d = sys.argv[1]
led = json.load(open(os.path.join(d, "places", "versions.json")))
cur = next(v for v in led["versions"] if v["version"] == led["current_version"])
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
p = os.path.join(d, "versions.json")
root = json.load(open(p))
root["collections"]["places"] = {
    "current_version": led["current_version"],
    "updated": now,
    "asset_count": len(cur["assets"]),
    "total_size_bytes": sum(a["size_bytes"] for a in cur["assets"].values())}
root["updated"] = now
with open(p, "w") as f:
    json.dump(root, f, indent=2)
    f.write("\n")
PYEOF

# portolan add leaves some declared assets (parquet, style) with stale file:size / file:checksum
# and re-extracts the PMTiles role as "data": refresh sizes and checksums from the bytes and keep
# the PMTiles role "visual"
python3 - "$dir_gaz/places" <<'PYEOF'
import hashlib, json, os, sys
d = sys.argv[1]
p = os.path.join(d, "collection.json")
c = json.load(open(p))
for a in c["assets"].values():
    b = open(os.path.join(d, a["href"]), "rb").read()
    a["file:size"] = len(b)
    a["file:checksum"] = "1220" + hashlib.sha256(b).hexdigest()
c["assets"]["places-tiles"]["roles"] = ["visual"]
with open(p, "w") as f:
    json.dump(c, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF

# the extent from the data: portolan writes a crossing extent as two halves (STAC reads the first bbox as the
# whole extent) and unions it with the old -180..180 extent; one bbox with west > east instead (PMNM)
uv run "$dir_catalog/antimeridian.py" join-extent "$dir_gaz/places/collection.json" --data "$dir_gaz/places/places.parquet"

fi   # upload_only skips steps 1-4

# 5. check: rashid check is the gate (hard stop; portolan check also lists pre-existing warnings
#    for other collections) ----
rashid check "$dir_gaz" --data-scope local

# 6. upload ----
if [[ $do_upload -eq 1 ]]; then
  # push also uploads the local root catalog.json, which lists only this repo's collections (it dropped the 15
  # oceanmetrics/places children on 2026-10-16): keep the published one, adding a places link if it lacks one
  pub_cat="$(mktemp)"
  aws s3 cp "$s3_dest/catalog.json" "$pub_cat" --only-show-errors
  portolan push "$s3_dest" --collection places --catalog "$dir_gaz"
  python3 - "$pub_cat" "$dir_gaz/catalog.json" <<'PYEOF'
import json, sys
pub, mine = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
have = {l.get("href") for l in pub["links"]}
pub["links"] += [l for l in mine["links"] if l.get("rel") == "child" and l.get("href") == "./places/collection.json"
                 and l["href"] not in have]
with open(sys.argv[1], "w") as f:
    json.dump(pub, f, indent=2, ensure_ascii=False)
    f.write("\n")
PYEOF
  aws s3 cp "$pub_cat" "$s3_dest/catalog.json" --content-type application/json
  rm -f "$pub_cat"
  # push does not upload the root versions.json summary. the bucket has a second publisher (oceanmetrics/places), so
  # the local root file is stale for its collections: update only the places entry of the published one
  pub_root="$(mktemp)"
  aws s3 cp "$s3_dest/versions.json" "$pub_root" --only-show-errors
  python3 - "$pub_root" "$dir_gaz/versions.json" <<'PYEOF'
import json, sys
pub, mine = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
pub["collections"]["places"] = mine["collections"]["places"]
pub["updated"] = max(pub.get("updated") or "", mine["collections"]["places"]["updated"])
with open(sys.argv[1], "w") as f:
    json.dump(pub, f, indent=2)
    f.write("\n")
PYEOF
  aws s3 cp "$pub_root" "$s3_dest/versions.json" --content-type application/json
  rm -f "$pub_root"
  echo "published: https://storage.oceanmetrics.io/gazetteer/places/collection.json"
fi

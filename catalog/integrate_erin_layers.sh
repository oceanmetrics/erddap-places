#!/usr/bin/env bash
# integrate the six staged "Erin's layers" collections into the published gazetteer:
# copy -> portolan add -> restore shared files -> fix sizes/checksums -> rashid check -> upload -> verify
#
# usage: catalog/integrate_erin_layers.sh [--no-upload]
#
# prerequisites: catalog/staging/<slug>/ built and green (cd catalog && uv run --group dev pytest -q
# && uv run build_erin_layers.py check). see catalog/staging/RUNBOOK.md for the full story.
#
# written 2026-10-08 because the autonomous session's permission mode blocked writes into
# catalog/gazetteer/; running this script is the one manual step. it follows publish_places.sh's
# guards against portolan 0.8.0 quirks (collateral rewrites, stale checksums, pmtiles role flip).

set -euo pipefail

do_upload=1
[[ "${1:-}" == "--no-upload" ]] && do_upload=0

dir_catalog="$(cd "$(dirname "$0")" && pwd)"
dir_gaz="$dir_catalog/gazetteer"
s3_dest="s3://oceanmetrics.io-public/gazetteer"
slugs="boem_wind_leases boem_wind_planning_rescinded boem_ocs_planning boem_program_11_draft boem_pacific_og_leases noaa_aoa_socal"

# 1. snapshot every shared file portolan add may rewrite ----
snap="$(mktemp -d)"
trap 'rm -rf "$snap"' EXIT
shared=$(cd "$dir_gaz" && find . -name collection.json -not -path '*/items/*' | sort)
for f in $shared catalog.json versions.json places/versions.json; do
  mkdir -p "$snap/$(dirname "$f")"
  cp "$dir_gaz/$f" "$snap/$f"
done

# 2. copy staging into the catalog (into the folder; versions.json history is portolan's) ----
for s in $slugs; do
  mkdir -p "$dir_gaz/$s"
  cp -R "$dir_catalog/staging/$s/." "$dir_gaz/$s/"
done

# 3. portolan add (records 1.0.0 itself; renders thumbnails for rashid PTL-VIZ-001) ----
cd "$dir_gaz"
# shellcheck disable=SC2046
portolan add $(for s in $slugs; do echo "$s/"; done) --force --force-thumbnails

# 4. restore the snapshotted shared files, then re-apply only the six child links + version rows ----
for f in $shared catalog.json versions.json places/versions.json; do
  cp "$snap/$f" "$dir_gaz/$f"
done
python3 - "$dir_gaz" "$slugs" <<'PYEOF'
import datetime, hashlib, json, os, sys
d, slugs = sys.argv[1], sys.argv[2].split()
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
# child links in catalog.json (idempotent)
p = os.path.join(d, "catalog.json")
cat = json.load(open(p))
have = {l.get("href") for l in cat["links"]}
for s in slugs:
    href = f"./{s}/collection.json"
    if href not in have:
        cat["links"].append({"rel": "child", "href": href, "type": "application/json", "title": s})
with open(p, "w") as f:
    json.dump(cat, f, indent=2, ensure_ascii=False); f.write("\n")
# per-collection: fresh file:size / file:checksum from the bytes, pmtiles role stays visual,
# and a row in the root versions.json
rp = os.path.join(d, "versions.json")
root = json.load(open(rp))
for s in slugs:
    cp_ = os.path.join(d, s, "collection.json")
    c = json.load(open(cp_))
    for a in c["assets"].values():
        fp = os.path.join(d, s, a["href"])
        if os.path.exists(fp):
            b = open(fp, "rb").read()
            a["file:size"] = len(b)
            a["file:checksum"] = "1220" + hashlib.sha256(b).hexdigest()
        if a["href"].endswith(".pmtiles"):
            a["roles"] = ["visual"]
    with open(cp_, "w") as f:
        json.dump(c, f, indent=2, ensure_ascii=False); f.write("\n")
    led = json.load(open(os.path.join(d, s, "versions.json")))
    cur = next(v for v in led["versions"] if v["version"] == led["current_version"])
    root["collections"][s] = {
        "current_version": led["current_version"],
        "updated": now,
        "asset_count": len(cur["assets"]),
        "total_size_bytes": sum(a["size_bytes"] for a in cur["assets"].values())}
root["updated"] = now
with open(rp, "w") as f:
    json.dump(root, f, indent=2); f.write("\n")
PYEOF

# 5. gate ----
rashid check "$dir_gaz" --data-scope local

# 6. upload (new prefixes plus the two root files; nothing deleted, no --delete anywhere) ----
if [[ $do_upload -eq 1 ]]; then
  for s in $slugs; do
    aws s3 sync "$dir_gaz/$s/" "$s3_dest/$s/" --exclude '.portolan/*'
  done
  aws s3 cp "$dir_gaz/versions.json" "$s3_dest/versions.json" --content-type application/json
  aws s3 cp "$dir_gaz/catalog.json"  "$s3_dest/catalog.json"  --content-type application/json

  # 7. verify ----
  for s in $slugs; do
    curl -sI "https://storage.oceanmetrics.io/gazetteer/$s/places.parquet" | head -1
  done
  curl -s https://storage.oceanmetrics.io/gazetteer/catalog.json | grep -c boem_ || true
  duckdb -c "SELECT place_id, status, status_date FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_leases/places.parquet') WHERE place_id LIKE 'BOEM:OCS-P%' ORDER BY 1"
  echo "expect: 0561 relinquished 2026-09-03 · 0562 active · 0563 active · 0564 settlement_pending · 0565 cancelled"
fi

# 8. commit the integrated collections (MUST land before monday's stats.yml run, which syncs the
#    checkout to s3 with --delete and would otherwise remove the six collections from the bucket) ----
cd "$dir_catalog/.."
# shellcheck disable=SC2046
git add catalog/gazetteer/catalog.json catalog/gazetteer/versions.json $(for s in $slugs; do echo "catalog/gazetteer/$s"; done)
git commit -m "gazetteer: publish the six BOEM / NOAA collections (Erin's layers) at 1.0.0"
git push origin main
echo "done: six collections integrated, published and committed"

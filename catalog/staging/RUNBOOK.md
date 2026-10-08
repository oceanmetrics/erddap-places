# RUNBOOK: integrate "Erin's layers" into the published gazetteer

Six staged collections in `catalog/staging/<slug>/` (built 2026-10-08, nothing integrated, committed or uploaded yet):

| slug | features | places.parquet | places.pmtiles | licence |
|---|---|---|---|---|
| `boem_wind_leases` | 52 | 2.7 MB | 5.0 MB (z0-16) | CC-PDDC |
| `boem_wind_planning_rescinded` | 3,325 (18 outlines + 3,307 blocks) | 0.5 MB | 0.4 MB | CC-PDDC |
| `boem_ocs_planning` | 27 | 13.1 MB | 3.3 MB | CC-PDDC |
| `boem_program_11_draft` | 20 | 6.6 MB | 1.4 MB | CC-PDDC |
| `boem_pacific_og_leases` | 34 | 53 kB | 29 kB | CC-PDDC |
| `noaa_aoa_socal` | 10 | 24 kB | 5 kB | CC-PDDC |

Each staged folder holds `places.parquet`, `places.pmtiles`, `collection.json`, `README.md`, `AGENTS.md`,
`provenance.json` and `styles/default.json`. The commands were dry-run on a scratch copy of the catalog
(`portolan add` on all six, then `rashid check`: no finding on the new collections apart from the info-level
PTL-PRO-002); the real tree has not been touched.

All commands run from the repository root, `/Users/bbest/Github/oceanmetrics/erddap-places`.

## 0. Preconditions

- The `places` builder work (`catalog/build_places.R`, `catalog/gazetteer/places/`, `catalog/gazetteer/versions.json`)
  is finished and committed. Step 3 rewrites the two shared files `catalog/gazetteer/catalog.json` and
  `catalog/gazetteer/versions.json`; do it after that work lands, not concurrently.
- `portolan` 0.8.x, `rashid` 0.1.x, `aws`, `uv` and `tippecanoe` on PATH; `aws sts get-caller-identity` works for the
  `oceanmetrics.io-public` bucket.

## 1. Re-verify (and rebuild if the staging is old)

```bash
cd catalog
uv run --group dev pytest -q                     # unit tests + checks on the staged outputs; red = stop
uv run build_erin_layers.py check                # parquet / PMTiles checks on every staged collection
# only if the staging is stale (re-fetches all six sources, about 2 minutes; add --slug <slug> for one):
# uv run build_erin_layers.py build && uv run --group dev pytest -q
cd ..
```

## 2. Copy staging into the catalog

Copy into the folder; never replace it later (`catalog/gazetteer/<slug>/versions.json` is Portolan's version history).

```bash
SLUGS="boem_wind_leases boem_wind_planning_rescinded boem_ocs_planning boem_program_11_draft boem_pacific_og_leases noaa_aoa_socal"
for s in $SLUGS; do mkdir -p catalog/gazetteer/$s && cp -R catalog/staging/$s/. catalog/gazetteer/$s/; done
```

## 3. Register with Portolan (checksums, thumbnail, STAC links, versions)

`portolan add` renders `places.thumb.jpg` (rashid PTL-VIZ-001 requires one), adds the `child` link to
`catalog/gazetteer/catalog.json`, writes `<slug>/versions.json` and `versions.json`. A first `add` records
version **1.0.0** by itself, which is the version stamped into every row (`version` column), so there is **no
`portolan version bump`** for this release. (For later rebuilds, `add` records the next patch version itself; use
`portolan version bump <slug> <x.y.z> -m "..."` before `add` only for a deliberate minor/major bump, and rebuild with
`uv run catalog/build_erin_layers.py build --slug <slug> --version <x.y.z>` so the rows agree.)

```bash
cd catalog/gazetteer
portolan add $(for s in $SLUGS; do echo $s/; done) --force --force-thumbnails
for s in $SLUGS; do portolan version current $s; done      # each 1.0.0
cd ../..
```

## 4. Validate

```bash
rashid check catalog/gazetteer --data-scope local --all | grep -E "error|boem_|noaa_aoa" | head -40
# expected: no error rows; only `info PTL-PRO-002` (no rel:canonical) on the six collections.
# the repo-wide `rashid check catalog/gazetteer` also reads asset bytes over the network for erddap/*: its
# existing PTL-DAT-001 / PTL-AST-003 findings are not from these collections.
```

Hand edits worth making while here (not required by any check): add the six collections to the list in
`catalog/gazetteer/AGENTS.md` ("Collections") and `catalog/gazetteer/README.md`, and one line each to the
`description` of `catalog/gazetteer/catalog.json`.

## 5. Commit (git is the source of truth: stats.yml syncs the checkout to S3 with `--delete`)

Commit **before** the next `stats` run (Mondays 09:17 UTC), or that run deletes the new collections from the bucket.

```bash
git status --short catalog/gazetteer .github/workflows/gazetteer-sync.yml catalog/sources catalog/erin_layers catalog/tests
git add catalog/build_erin_layers.py catalog/erin_layers catalog/tests catalog/sources catalog/pyproject.toml catalog/uv.lock catalog/.gitignore
git add catalog/staging/RUNBOOK.md .github/workflows/gazetteer-sync.yml
git add catalog/gazetteer/catalog.json catalog/gazetteer/versions.json $(for s in $SLUGS; do echo catalog/gazetteer/$s; done)
git commit -m "gazetteer: six BOEM / NOAA collections (wind leases, rescinded wind planning areas, OCS planning areas, 11th Program draft areas, Pacific oil and gas leases, SoCal AOAs) and the weekly sync"
# catalog/staging/<slug>/ can stay untracked (build output) or be added to .gitignore: catalog/gazetteer/<slug>/ is the published copy.
```

## 6. Upload to S3 (`s3://oceanmetrics.io-public/gazetteer/` = https://storage.oceanmetrics.io/gazetteer/)

No `--delete` on the catalog-level files; per collection, `--delete` only inside that collection's own prefix.

```bash
for s in $SLUGS; do
  aws s3 sync catalog/gazetteer/$s/ s3://oceanmetrics.io-public/gazetteer/$s/ --delete --exclude '.portolan/*'
done
aws s3 cp catalog/gazetteer/versions.json s3://oceanmetrics.io-public/gazetteer/versions.json
aws s3 cp catalog/gazetteer/catalog.json  s3://oceanmetrics.io-public/gazetteer/catalog.json
# (equivalent with Portolan, which also checks for remote divergence: portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection <slug> --dry-run)
```

## 7. Verify the published copy

```bash
for s in $SLUGS; do
  curl -sI "https://storage.oceanmetrics.io/gazetteer/$s/places.parquet" | head -1
  curl -sIL -H 'Range: bytes=0-15' "https://storage.oceanmetrics.io/gazetteer/$s/places.pmtiles" | grep -iE "^HTTP|content-range"
done
curl -s https://storage.oceanmetrics.io/gazetteer/catalog.json | grep -c boem_
rashid check catalog/gazetteer --live --live-base-url https://storage.oceanmetrics.io/gazetteer --no-data 2>&1 | tail -5
duckdb -c "SELECT place_id, status, status_date FROM read_parquet('https://storage.oceanmetrics.io/gazetteer/boem_wind_leases/places.parquet') WHERE place_id LIKE 'BOEM:OCS-P%' ORDER BY 1"
# expect: 0561 relinquished 2026-09-03, 0562 active, 0563 active, 0564 settlement_pending, 0565 cancelled
```

## 8. Turn on the weekly sync

`.github/workflows/gazetteer-sync.yml` (Mondays 07:43 UTC) runs on the `msens` self-hosted runner. Before the first
run, once on msens: `sudo apt-get install -y build-essential libsqlite3-dev zlib1g-dev` (the workflow builds
tippecanoe 2.79.0 from source into `~/.local`; there is no tippecanoe on msens yet). It also needs a branch that
`github-actions[bot]` may push to (it commits the rebuilt collections to `main`; if `main` is protected, change the
commit step to open a PR). S3 credentials: the repository has no AWS secrets; like `stats.yml` the publish step uses the
msens host profile and takes `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` repository secrets if they are ever added.

```bash
git push
gh workflow run gazetteer-sync -R oceanmetrics/erddap-places -f publish=false     # dry run: detect + rebuild, no commit, no S3
gh run watch -R oceanmetrics/erddap-places
```

## Rollback

```bash
for s in $SLUGS; do aws s3 rm s3://oceanmetrics.io-public/gazetteer/$s/ --recursive; done
git revert <the commit from step 5>; aws s3 cp catalog/gazetteer/catalog.json s3://oceanmetrics.io-public/gazetteer/catalog.json
aws s3 cp catalog/gazetteer/versions.json s3://oceanmetrics.io-public/gazetteer/versions.json
```

---

# Build notes (what was decided and assumed)

**Where things are.** Code `catalog/build_erin_layers.py` (CLI, inline `uv` deps) + `catalog/erin_layers/` (config,
fetch, geom, ids, fmt, status, table, tiles, stac, validate, pipeline, cli); per-layer settings
`catalog/sources/<authority>/<layer>.yml`; overlay `catalog/sources/boem/wind_lease_status.csv`; tests
`catalog/tests/` (`cd catalog && uv run --group dev pytest -q`; `catalog/pyproject.toml` makes the folder movable to a
standalone repo). Commands: `build`, `detect` (change detection against the published `provenance.json`),
`check`, `next-version`. Raw API pages are cached in `catalog/cache/erin/` (git-ignored).

**Licence string.** The existing `places` collection uses an SPDX id (`CC-BY-4.0`), so these use the SPDX id
`CC-PDDC` (Creative Commons Public Domain Dedication and Certification), the nearest SPDX identifier for a U.S.
federal government work in the public domain. `license` rows, the collection `license` field and a `rel: license` link
to https://www.usa.gov/publicdomain/label/1.0/ (the label BOEM's AGOL items carry) all say so. If you prefer
`CC0-1.0`, change `license:` in the six ymls and rebuild. The NOAA AOA download page states no terms; it is treated as
a federal work (17 U.S.C. 105) and the yml says so.

**Row ids.** `place_id` is `BOEM:<normalised lease number>` for leases (`P00202` in the Pacific service becomes
`OCS-P 0202`; the native `LEASE_NUMBER` column keeps `P00202`; `OCS-G 37334 Provisional` becomes `OCS-G 37334`).
Seven easement polygons share a lease number with a commercial polygon (OCS-A 0487, 0497, 0498 x2, 0501 x2, 0517): the
commercial polygon keeps the bare id, the others get `:easement`, `:easement-2` (ids stay unique). Planning/draft areas use a namespace so ids cannot collide:
`BOEM:PA:<code>` (OCS planning areas), `BOEM:DPP11:<OBJECTID>` (11th Program draft), `BOEM:WPA:<OBJECTID>` (rescinded
outlines), `BOEM:WPA-BLK:<protraction>-<block>[-<sub>]` (rescinded blocks); AOAs `AOA:<AOA code>`.

**Assumptions to confirm.**
1. The wind lease layer has **no status field**, so "the layer's own status" is `active` (it lists leases that exist),
   dated by the layer's last data edit (2025-03-04), with `status_source` = the layer URL. Same for the OCS planning
   areas (`active`), the Pacific leases (`active`, dated by `LSE_STAT_EFF_DT`; native `LEASE_STATUS_CD` UNIT/PROD/RENACV
   is kept), the 11th Program areas (`draft_proposed`) and the AOAs (`identified`, 2025-09-19).
2. `OCS-P 0564 settlement_pending` carries `status_date` 2026-04-27 (the settlement date in the research digest; your brief
   gave no date); `OCS-P 0562` and `0563` `active` have an empty `status_date`.
3. The rescinded collection combines both items (18 outline polygons + 3,307 blocks, column `component` = outline|block).
   The outline layer's all-null row (OBJECTID 2068, no geometry) is dropped and listed in `provenance.json` `dropped`.
4. The OCS planning area codes were given full names by hand (`maps:` in `ocs_planning.yml`); verify NAL / NAV / GEO / MAT.
5. gis.boem.gov serves an incomplete TLS chain (no client can verify it, curl error 60 as in the digest), so
   `boem_pacific_og_leases.yml` sets `tls_verify: false` for that one host. Public data; every row records its `source_url`.
6. PMTiles carry only `place_id, name, place_type, status, status_date, source_id, component` as feature properties
   (all fields stay in the GeoParquet, join on `place_id`): with all fields the 52-lease archive was 19 MB instead of 5 MB
   because every property is repeated in each tile a polygon touches. `-zg` is used as decided in D6.
7. BOEM's Alaska polygons come already cut at the dateline in Web Mercator, about 1e-5 degrees short of +/-180; vertices
   within 1e-4 degrees of +/-180 are snapped onto the meridian. Native `NAME` (11th Program) collides with `name` ignoring
   case, so the native column is `NAME_src` (DuckDB column names are case-insensitive).
8. `version` in each row is the collection release version (1.0.0); `source_date` is the source's last data edit
   (retrieval date for the Pacific service, which serves none); `retrieved` is the fetch time.

**Provenance** (per source, in `provenance.json`, `collection.json` `gazetteer:provenance` and the Parquet footer):
`source_url`, `source_item_id`, `data_last_edit`, `retrieved`, `record_count`, `checksum` (sha-256 of the raw payload), plus
the item's licence text, credits and modified date.

**Not done / not available.** No thumbnails in staging (Portolan renders them in step 3). The NOAA AOA zip is 79 MB and
cached under `catalog/cache/erin/noaa_aoa_socal/zip/`; only `AOA_SOCAL.*` is extracted (`.../shp/`). Gulf AOAs (3 off Texas)
are not included (no GIS link found in the digest). `catalog/README.md` and the catalog-level `README.md` / `AGENTS.md`
were left alone (another agent is editing nearby); step 4 lists the hand edits.

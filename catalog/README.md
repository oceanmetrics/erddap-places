# catalog/

- `build_places.R` — builds `places/places.parquet` and `places/places.pmtiles` (20 marine place
  polygons: NOAA sanctuaries, MarineRegions MRGID, ProtectedSeas PSGID). Sanctuary boundaries are the
  official NOAA ONMS shapefile downloads (urls in onmsR `sanctuaries.csv`, cached in `cache/imast/`,
  git-ignored; delete a zip to re-download). The PMTiles carry `name`, `description` and an HTML
  `attribution` (NOAA ONMS, MarineRegions.org, ProtectedSeas) in their metadata. Run with
  `Rscript catalog/build_places.R`, or do the whole release (build, copy to `gazetteer/places/`,
  `portolan add`, `portolan version bump`, `rashid check`, upload) with `publish_places.sh`.
- `publish_places.sh` — `catalog/publish_places.sh <new_version> -m "note" [--no-build] [--no-upload]`.
  Edit the "Changes" list in `gazetteer/places/README.md` first. Leaves the other collections'
  STAC untouched, stops if `rashid check` fails, and uploads only `places/` and the root
  `versions.json` (no deletes).
- `build_erddap_collections.ts` — (re)generates the `gazetteer/erddap/<id>/` collections (plus
  README/AGENTS and the `catalog.json` child links) for the datasets re-served from the USF IMaRS
  ERDDAP, from each server's `info/<id>/index.json`. Run with
  `cd precompute && npx tsx ../catalog/build_erddap_collections.ts [<id> ...]`.
- `places/` — build output directory. `gazetteer/places/` is the published copy tracked by
  Portolan (synced from here by `publish_places.sh`).
- `build_then_now.py` — builds the Then vs Now `gazetteer/rasters/`, `climatology/`, `series/`
  collections (see below).
- `gazetteer/` — the published Portolan/STAC catalog (`places` + `erddap/*` + `stats` + Then vs Now collections).
  Validate with `rashid check catalog/gazetteer` / `portolan check catalog/gazetteer`.

## Precomputed statistics (`gazetteer/stats/`)

One Parquet per (ERDDAP dataset, variable, place) for the last 365 days (full record for the monthly
sanctuaries series), built by `../precompute/`
with the browser app's own mask and SQL. See [`gazetteer/stats/README.md`](gazetteer/stats/README.md).

```bash
cd precompute && npm ci && npm run stats     # ~25 min; writes catalog/gazetteer/stats/
rashid check catalog/gazetteer
```

The `*.parquet` / `*.provenance.json` files are **not in git** (see
`gazetteer/stats/.gitignore`) — only `collection.json`, `items/` and the docs are. A fresh clone
therefore has Items whose data asset is missing until the precompute has run; run it before
`rashid check` if you want a clean asset verification.

## Then vs Now data (`gazetteer/rasters/`, `gazetteer/climatology/`, `gazetteer/series/`)

`build_then_now.py` converts the sanctuary SST archive of the NOAA ONMS climate-dashboard-app
(`mbon:/share/data/noaa-onms/climate-dashboard-app/erddap_sst/<NMS>/<year>.{tif,csv}`: one float64
band per day of CRW `noaacrwsstDaily` `analysed_sst`, 0.05°, the sanctuary bbox + 20 % buffer;
CSV `lyr, mean, time`) into three collections:

- `rasters/dhw_5km/CRW_SST/<place_id>/<year>.tif`: 366-band COG per place × year, band i =
  day-of-year i of a leap year (band 60 = 29 Feb, NaN in non-leap years), float32, NaN nodata,
  `INTERLEAVE=BAND`, 256 px tiles, DEFLATE + predictor 3, band descriptions = ISO dates.
- `climatology/dhw_5km/CRW_SST/<place_id>/<y0>-<y1>_{mean,sd,n}.tif`: raw day-of-year climatology
  for 1985–2005 and 2003–2012 (`--window N` pools ±N days; default 0).
- `series/dhw_5km/CRW_SST/<place_id>.parquet`: daily polygon area-weighted mean etc.

See each collection's README for how a browser reads them. The data files are git-ignored (only the
STAC and docs are tracked) and are uploaded from the Mac mini, where the 1.1 GB archive lives at
`~/data/noaa-onms/climate-dashboard-app/erddap_sst/`. The weekly stats workflow excludes the three
prefixes from its `--delete` sync.

```bash
# on the mini (`ssh macmini`); ~60-150 s per sanctuary, ~16 min for all 13
rsync -a mbon:/share/data/noaa-onms/climate-dashboard-app/erddap_sst ~/data/noaa-onms/climate-dashboard-app/
uv run catalog/build_then_now.py --src ~/data/noaa-onms/climate-dashboard-app/erddap_sst \
  --gazetteer catalog/gazetteer                       # [--codes FKNMS ...] [--steps rasters,climatology,series,stac]
uvx --from rasterio --with rio-cogeo rio cogeo validate catalog/gazetteer/rasters/dhw_5km/CRW_SST/NMS:FKNMS/2024.tif
rashid check catalog/gazetteer --data-scope local     # 0 errors
for d in rasters climatology series; do
  aws s3 sync catalog/gazetteer/$d/ s3://oceanmetrics.io-public/gazetteer/$d/ --exclude .gitignore
done
aws s3 cp catalog/gazetteer/catalog.json s3://oceanmetrics.io-public/gazetteer/catalog.json
```

No `--delete`: a rebuild overwrites in place. Archive folders without a gazetteer place are skipped
(`MBNMS-david`, `MBNMS-main`), as is `TBNMS` (no CRW SST over the Great Lakes); `CPNMS` is
`NMS:CHNMS`. Nine place-years are all NaN in the archive: see `gazetteer/rasters/README.md`. The current year is partial: re-run for that
year (`--years 2026 2026 --steps rasters,series,stac` after a fresh rsync) to extend it.
`erddap_sss/` (SMOS 3-day SSS, 2010–) and `erddap_precip/` (IMERG monthly, 1998–) have the same
layout and are not converted yet.

## Publish

```bash
catalog/publish_places.sh 1.2.0 -m "note"     # places: build, copy, add, bump, check, upload
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection places
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection erddap/dhw_5km
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer --collection erddap/jplMURSST41
# or push everything, and push the catalog root files (catalog.json/README.md/AGENTS.md):
portolan push catalog/gazetteer s3://oceanmetrics.io-public/gazetteer
```

Or, the way CI does it (`.github/workflows/stats.yml`), which is also what to run by hand after a
local precompute:

```bash
aws s3 sync catalog/gazetteer/ s3://oceanmetrics.io-public/gazetteer/ --delete --exclude '.portolan/*'
```

Public base URL: `https://storage.oceanmetrics.io/gazetteer/`.

### Where it runs

`.github/workflows/stats.yml` refreshes the statistics weekly (Mondays 09:17 UTC) and syncs the whole
gazetteer to S3. It runs on a **self-hosted runner on the msens VM** (`ssh msens`), not on a
GitHub-hosted machine:

- runner name `msens`, labels `self-hosted, linux, x64, msens`, installed in
  `/share/github/oceanmetrics/actions-runner` as the systemd service
  `actions.runner.oceanmetrics-erddap-places.msens` (user `ubuntu`).
- host tools: node 22 (NodeSource apt package), `python3` 3.10 + `python3-pip`, `rashid` in
  `~ubuntu/.local` (the workflow upgrades it each run), aws cli (snap).
- S3 credentials: the host's AWS profile (`~ubuntu/.aws`, IAM user `ben`). The repository has **no**
  AWS secrets; if `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are ever added they take precedence.

Status: `gh api repos/oceanmetrics/erddap-places/actions/runners --jq '.runners[] | "\(.name) \(.status)"'`;
on msens `sudo systemctl status actions.runner.oceanmetrics-erddap-places.msens`.

Re-register (e.g. after the VM is rebuilt or the runner was removed in Settings → Actions → Runners):

```bash
# on the laptop (repo admin)
gh api -X POST repos/oceanmetrics/erddap-places/actions/runners/registration-token --jq .token
# on msens, in /share/github/oceanmetrics/actions-runner
sudo ./svc.sh stop && sudo ./svc.sh uninstall && ./config.sh remove --token <token>
./config.sh --unattended --url https://github.com/oceanmetrics/erddap-places --token <token> \
  --name msens --labels self-hosted,linux,x64,msens --work _work
sudo ./svc.sh install ubuntu && sudo ./svc.sh start
```

Run by hand: prefer `gh workflow run stats -R oceanmetrics/erddap-places -f dataset=<id> -f publish=false`
(blank `dataset` = every target). The runner's checkout under `actions-runner/_work/` is **not** a
place to work in (it is wiped by the next run); for a manual precompute on msens `git clone` the repo
elsewhere and follow "Precomputed statistics" above, then the `aws s3 sync` commands from the workflow.

#### Monthly obis-h3 refresh (`obis-h3.yml`)

`.github/workflows/obis-h3.yml` runs on the same `msens` runner on the 1st of each month (03:17 UTC; also
`workflow_dispatch` with a release override and skip flags) and publishes the release that the obis-hex app
reads. The workflow only updates the `/share/github/marinebon/obisindicators` checkout (branch `export-parquet`
until `R/export.R` is merged to `main`; change `OBIS_BRANCH` then) and runs
`data-raw/refresh_obis_h3.sh` there: sync OBIS open data, build the H3 store in the `plumber` container,
`obis_h3_export_parquet()` into `/share/data/obis-h3/<release>/`, validate (total records at least 90% of the
previous release's, else nothing is uploaded), `aws s3 sync` to `s3://oceanmetrics.io-public/obis-h3/<release>/`
without `--delete`, and **last** `obis-h3/latest.json`:

```json
{"release": "vYYYYMMDD", "base": "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/vYYYYMMDD/",
 "obis_snapshot": "YYYY-MM-DD", "built_at": "..."}
```

`latest.json` is served with `Cache-Control: max-age=300`. The release tag is the UTC date of the sync. Steps,
flags and env overrides are documented in obisindicators `data-raw/README.md`. The run takes hours (`timeout-minutes: 1440`)
and writes `/share/data/obis/log/refresh_YYYYMMDD.log`, also attached to the run as the `obis-h3-refresh-log`
artifact.

- **Disk prerequisite**: the job needs 110 GB free on `/share` (400 GB volume; the 93 GB OBIS snapshot, the
  store and old stores share it). It exits 2 before touching anything and lists the prunable old
  `obis_h3_*.duckdb` stores, old `/share/data/obis-h3/v*` folders and the spill dir. Prune, then re-run
  (`gh workflow run obis-h3 -R oceanmetrics/erddap-places`). Never prune the store `h3t` serves
  (`readlink -f /share/data/obis/obis_h3.duckdb`).
- **Rollback**: older releases stay on S3. Overwrite `obis-h3/latest.json` with the older release's `release`,
  `base`, `obis_snapshot` and `built_at` (the last two are in that release's `release.json`), with the same
  content type and cache-control as above. Clients pick it up within 5 minutes.
- **WoRMS `taxon.parquet`** (`/share/data/derived/taxon.parquet`) is a **manual input**, refreshed separately
  with `Rscript data-raw/build_taxon_parquet.R`; the monthly job reuses it and the build aborts if it is missing.
- **Manual follow-up**: the `h3t` tile service is not swapped by the job (it needs sudo). After a good run:
  `data-raw/deploy_obis_h3.sh --skip-sync --skip-build --store /share/data/obis/obis_h3_global_vYYYYMMDD.duckdb --yes`.
- The job never sets `OBIS_GLOBAL=true` (streaming from S3 OOM-wedged msens on 2026-06-23); the build runs
  from the local snapshot with memory 7GB, 2 threads, a 20GB spill cap.
- If msens is unavailable the job can run on any Linux host with docker, a `plumber`-like image, ~110 GB free
  and S3 credentials: register a second runner with the labels `self-hosted, linux, x64, msens` (see above), or
  run `data-raw/refresh_obis_h3.sh` by hand.

### CI credentials

None needed in the repository: the self-hosted runner uses the msens host profile (see above).

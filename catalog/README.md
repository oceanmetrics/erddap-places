# catalog/

- `build_places.R` — builds `places/places.parquet` and `places/places.pmtiles` (the 18 NOAA
  national marine sanctuaries, `NMS:<code>`; the Pitcairn EEZ and `PSGID:939` were removed in places 2.0.0). Sanctuary boundaries are the
  official NOAA ONMS shapefile downloads (urls in onmsR `sanctuaries.csv`, cached in `cache/imast/`,
  git-ignored; delete a zip to re-download). The PMTiles carry `name`, `description` and an HTML
  `attribution` (NOAA ONMS) in their metadata. Run with
  `Rscript catalog/build_places.R`, or do the whole release (build, copy to `gazetteer/places/`,
  `portolan add`, `portolan version bump`, `rashid check`, upload) with `publish_places.sh`.
- `publish_places.sh` — `catalog/publish_places.sh <new_version> -m "note" [--no-build] [--no-upload] [--upload-only]`
  (`--upload-only` after a committed `--no-upload` dry run: only `rashid check` and the upload).
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
- `antimeridian.py` (rule and tests in `erin_layers/bbox.py`; TypeScript twin `unionBbox()` /
  `placeBbox()` in `app/src/lib/gazetteer.ts`, shared cases `tests/union_bbox_cases.json`) — published
  bboxes cross ±180 with west > east (RFC 7946 §5) when the places do, never the band round the
  globe. `geo-bbox` sets the file-level GeoParquet bbox (`build_places.R`, and `publish_places.sh`
  after `portolan add`, which rewrites the file); `join-extent` turns portolan's two halves of a
  crossing extent into one bbox (`publish_places.sh` with `--data`). The
  per-row `bbox` column stays plain min/max. rashid 0.1.8 `PTL-DAT-005` assumes west <= east and
  warns on a crossing extent that matches; that warning is expected for `places`.
- `gazetteer/` — the published Portolan/STAC catalog (`places` + `erddap/*` + `stats` + Then vs Now collections).
  The bucket's other place collections (the five BOEM ones, `noaa_aoa_socal`, NOAA sanctuaries, MPAs, ...) are
  published by [oceanmetrics/places](https://github.com/oceanmetrics/places), never from here.
- Retired 2026-10-16: `build_erin_layers.py`, `erin_layers/` (except `bbox.py`, which `antimeridian.py` uses),
  `sources/`, `integrate_erin_layers.sh`, `staging/RUNBOOK.md` and `gazetteer-sync.yml` built and published the
  BOEM and NOAA AOA collections, which moved to oceanmetrics/places; they publish nothing now.
  Validate with `rashid check catalog/gazetteer` / `portolan check catalog/gazetteer`.

## Precomputed statistics (`gazetteer/stats/`)

One Parquet per (ERDDAP dataset, variable, place) for the dataset's full record (incremental per
chunk, see the stats README), built by `../precompute/`
with the browser app's own mask and SQL. See [`gazetteer/stats/README.md`](gazetteer/stats/README.md).

```bash
cd precompute && npm ci && npm run stats     # ~25 min; writes catalog/gazetteer/stats/
rashid check catalog/gazetteer
```

The `*.parquet` / `*.provenance.json` files are **not in git** (see
`gazetteer/stats/.gitignore`) — only `collection.json`, `items/` and the docs are. A fresh clone
therefore has Items whose data asset is missing until the precompute has run; run it before
`rashid check` if you want a clean asset verification.

## Requested places

The 18 places above are the daily run's. A place of ANY other published vector collection can be
precomputed on request, one catalogued target (a dataset and variable of `precompute/src/targets.ts`)
at a time. The request workflow of [oceanmetrics/indicators](https://github.com/oceanmetrics/indicators)
("Request an indicator", a public GitHub issue) calls, on the `macmini` runner:

```bash
cd precompute
PRECOMPUTE_PUBLISH=s3://oceanmetrics.io-public/gazetteer \
  npx tsx src/precompute.ts --gazetteer noaa_nerrs --place NERRS:WEL --dataset dhw_5km [--variable CRW_SST] [--days 30]
```

The places are read from `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/<slug>/places.parquet`
with the app's own loader (`placeGeometry()`), and the request names them, so a target's own `places`
rule (`all`, `nms`, a list) is not applied. Each `--place` is one id of that collection; `--dataset` is
required. Without `--gazetteer` nothing changes. The run is **refused** (exit code 2, a one-line reason,
no geometry fetched) when:

- the slug or a place id does not match `^[a-z0-9_]+$` / `^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.\-]+$`
  (the values come from public issues and end up in file names and URLs);
- no `--place` or no `--dataset` is given, the dataset is not in `TARGETS`, or a `--variable` is not one
  of that dataset's targets (`--variable` needs exactly one `--dataset`);
- the slug is not a `kind: "vector"` polygon layer in
  `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/index/layers.json`: reference
  collections (`mr_*`) publish no geometry and are never fetched as geometry, and point or line layers
  cannot mask a grid;
- a `--place` id is not in the collection;
- the id is also a place of the `places` collection, or already has a stats file from another
  collection: files are keyed `stats/<dataset>/<variable>/<place_id>.parquet`, so the second would
  overwrite the first.

The window is the target's own (the full record unless `--days`), incremental per chunk like the daily
run. A requested run writes the Parquet, the provenance JSON and the Item (`properties.gazetteer:collection`
names the collection), and **not** `collection.json`, the thumbnail or the catalog link: those describe
the daily run's places, and a collection rebuilt from a checkout would drop the Items already
published. Set `PRECOMPUTE_PUBLISH` to upload each finished file at once (`aws s3 cp`, the host's AWS
profile, never `--delete`); the Item is then at
`https://storage.oceanmetrics.io/gazetteer/stats/items/<dataset>_<variable>_<place-with-dashes>.json`.
The daily workflow's `aws s3 sync` of `stats/` has no `--delete`, so it leaves these files alone.

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
`~/data/noaa-onms/climate-dashboard-app/erddap_sst/`. The daily stats workflow excludes the three
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

`.github/workflows/stats.yml` refreshes the statistics daily (09:17 UTC; weekly until 2026-10-12) and syncs the whole
gazetteer to S3. Since 2026-10-12 it runs on a **self-hosted runner on the Mac mini** (`ssh macmini`),
because the first full-record run is hours of requests and the per-chunk rows that make later runs
incremental live on that host:

- runner name `macmini`, labels `self-hosted, macOS, ARM64, macmini`, installed in
  `~/actions-runner/erddap-places` (user `bbest`), working directory `_work`. The chunk store is
  `_work/erddap-places/precompute-chunks` (`PRECOMPUTE_CHUNKS`, beside the checkout, which
  `actions/checkout` cleans). Delete it only to force a full refetch.
- host tools from Homebrew: node, python3, `uv` (rashid is a uv tool), aws cli, duckdb. The precompute
  runs under `caffeinate -i`.
- S3 credentials: the host's AWS profile (`~/.aws`, `default`). The repository has **no** AWS secrets.
- `obis-h3.yml` (since 2026-10-12; see below) runs here too, so every self-hosted workflow is on the
  mini. (`gazetteer-sync.yml` ran here 2026-10-13 to 2026-10-16, then retired with the BOEM / AOA
  collections it published.)
- The runner takes one job at a time: stats and obis-h3 runs queue behind each other.
  A stats run can be cancelled to let obis-h3 through and re-dispatched later; it resumes from its
  chunks. A stats run starts no new work after 21 h. After the first full-record backfill, a daily run fetches only the new
  time steps.

The runner is registered to the **oceanmetrics org** (since 2026-10-16), in the Default group (public repos allowed;
both repos require approval for every fork PR from an outside contributor), so erddap-places and oceanmetrics/places
(its `sync.yml`, Mondays 07:43 UTC) share it, one job at a time. The folder is still `~/actions-runner/erddap-places`,
which keeps the chunk store. Status: `gh api orgs/oceanmetrics/actions/runners --jq '.runners[] | "\(.name) \(.status)"'`.

Register the Mac mini runner (by hand: Claude Code's auto mode will not install a runner service).
`PATH` must include Homebrew when `config.sh` runs, because the runner keeps the `PATH` it was
configured with:

```bash
# on the laptop (org admin; gh needs the admin:org scope): a registration token, valid one hour
gh api -X POST orgs/oceanmetrics/actions/runners/registration-token --jq .token
# on the mini
export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH
mkdir -p ~/actions-runner/erddap-places && cd ~/actions-runner/erddap-places
V=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | sed -n 's/.*"tag_name": "v\(.*\)".*/\1/p')
curl -sSLo runner.tgz https://github.com/actions/runner/releases/download/v$V/actions-runner-osx-arm64-$V.tar.gz
tar xzf runner.tgz && rm runner.tgz
./config.sh --unattended --url https://github.com/oceanmetrics --token <token> \
  --name macmini --labels macmini --work _work --runnergroup Default
./svc.sh install && ./svc.sh start      # a LaunchAgent: it runs in bbest's desktop session
```

Since 2026-10-13 the runner is that LaunchAgent, and the mini logs bbest in automatically, so the runner
comes back after a reboot (until then it ran in tmux). A LaunchDaemon would not do: Colima's vz VM
does not start outside a desktop session. Two macOS privacy (TCC) grants are needed, or Colima hangs at
start and obis-h3 fails with exit 5. Both were given on 2026-10-13, on the mini's screen:

- **Allow** the removable-volume prompt for the runner's `externals/node24/bin/node`, for
  `/Volumes/msens_big`. A runner upgrade that changes the node path may ask again.
- **Full Disk Access** for `limactl` (System Settings → Privacy & Security).

The old **msens** runner (`msens`, labels `self-hosted, linux, x64, msens`,
`/share/github/oceanmetrics/actions-runner`, systemd service
`actions.runner.oceanmetrics-erddap-places.msens`, user `ubuntu`) has no workflow since 2026-10-13.
msens still serves h3t, which obis-h3 swaps over ssh. To retire the runner (by hand):

```bash
# on the laptop (repo admin): a removal token
gh api -X POST repos/oceanmetrics/erddap-places/actions/runners/remove-token --jq .token
# on msens, in /share/github/oceanmetrics/actions-runner
sudo ./svc.sh stop && sudo ./svc.sh uninstall && ./config.sh remove --token <token>
```

Run by hand: prefer `gh workflow run stats -R oceanmetrics/erddap-places -f dataset=<id> -f publish=false`
(blank `dataset` = every target). The runner's checkout under `actions-runner/_work/` is **not** a
place to work in (it is wiped by the next run); for a manual precompute on the mini `git clone` the repo
elsewhere and follow "Precomputed statistics" above, then the `aws s3 sync` commands from the workflow.

#### Monthly obis-h3 refresh (`obis-h3.yml`)

`.github/workflows/obis-h3.yml` runs on the `macmini` runner (msens until 2026-10-12) on the 1st of each month
(03:17 UTC; also `workflow_dispatch` with a release override, skip flags and a dry run) and publishes the
release that the obis-hex app reads. The workflow only updates the `~/Github/marinebon/obisindicators`
checkout on the mini (branch `main`, `OBIS_BRANCH`) and runs `data-raw/run_refresh_docker.sh` there under `caffeinate -i`. The wrapper checks that the
external drive is mounted, starts the Colima VM `obis-h3` (stopped again afterwards), and runs
`data-raw/refresh_obis_h3.sh` in its Docker image with `DATA_ROOT=/Volumes/msens_big/_big/obis` mounted as
`/share/data`: sync OBIS open data, build the H3 store, `obis_h3_export_parquet()` into
`$DATA_ROOT/obis-h3/<release>/`, validate (total records at least 90% of the previous release's, else nothing
is uploaded), `aws s3 sync` to `s3://oceanmetrics.io-public/obis-h3/<release>/` without `--delete`, and
**last** `obis-h3/latest.json`:

```json
{"release": "vYYYYMMDD", "base": "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/vYYYYMMDD/",
 "obis_snapshot": "YYYY-MM-DD", "built_at": "..."}
```

`latest.json` is served with `Cache-Control: max-age=300`. The release tag is the UTC date of the sync. Steps,
flags and env overrides are documented in obisindicators `data-raw/README.md` and the wrapper's header. The
first run on the mini syncs the ~93 GB snapshot before it builds (~12 h; `timeout-minutes: 1440`). The log
is `$DATA_ROOT/obis/log/refresh_YYYYMMDD.log`, also attached to the run as the `obis-h3-refresh-log`
artifact, and a finished run writes `refresh_YYYYMMDD.done` beside it.

- **Exit codes**: 2 not enough disk (prune old `obis_h3_*.duckdb` stores and old `obis-h3/v*` folders under
  `$DATA_ROOT`, then re-run with `gh workflow run obis-h3 -R oceanmetrics/erddap-places`), 3 another refresh
  holds the container `obis-h3-refresh`, 4 validation failed, 5 the drive is not mounted or Colima/Docker is
  missing.
- **S3 credentials**: the mini's `~/.aws`, mounted read-only into the container. Credentials in the job's
  environment would not reach the container, so the repository has no AWS secrets for this job.
- **Rollback**: older releases stay on S3. Overwrite `obis-h3/latest.json` with the older release's `release`,
  `base`, `obis_snapshot` and `built_at` (the last two are in that release's `release.json`), with the same
  content type and cache-control as above. Clients pick it up within 5 minutes.
- **WoRMS `taxon.parquet`** (`$DATA_ROOT/derived/taxon.parquet`) is a **manual input**, refreshed separately
  with `Rscript data-raw/build_taxon_parquet.R`; the monthly job reuses it and the build aborts if it is missing.
- **h3t swap (automatic since 2026-10-12)**: after a published release the wrapper rsyncs the store to
  `msens:/share/data/obis/` (the mini's `Host msens` ssh key, user `ubuntu`), and the job's last step checks
  the copy's size and runs, over ssh, `data-raw/deploy_obis_h3.sh --skip-sync --skip-build --store
  /share/data/obis/obis_h3_global_vYYYYMMDD.duckdb --yes` in msens's obisindicators checkout. The deploy
  refuses a store missing a layer, restarts h3t, fails unless `/h3t/health` reports the new file's mtime,
  bans Varnish, and prints the rollback command. A failed copy fails the job before anything changes on msens; a deploy
  that fails after the swap fails the job with the rollback command in its log (nothing rolls back by itself). `skip_deploy` on a manual dispatch leaves h3t alone.
- The job never sets `OBIS_GLOBAL=true` (streaming from S3 OOM-wedged msens on 2026-06-23); the build runs
  from the local snapshot.
- If the mini is unavailable, `data-raw/refresh_obis_h3.sh` still runs by hand on msens (see its README).

### CI credentials

None needed in the repository: the self-hosted runners use their host's AWS profile (see above).

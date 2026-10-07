# catalog/

- `build_places.R` — builds `places/places.parquet` and `places/places.pmtiles` (20 marine place
  polygons: NOAA sanctuaries, MarineRegions MRGID, ProtectedSeas PSGID). Sanctuary boundaries are the
  official NOAA ONMS shapefile downloads (urls in onmsR `sanctuaries.csv`, cached in `cache/imast/`,
  git-ignored; delete a zip to re-download). Run with `Rscript catalog/build_places.R`, copy
  `places/places.{parquet,pmtiles}` into `gazetteer/places/`, then `portolan add places/` and
  `portolan version bump places <x.y.z>` from `gazetteer/`.
- `build_erddap_collections.ts` — (re)generates the `gazetteer/erddap/<id>/` collections (plus
  README/AGENTS and the `catalog.json` child links) for the datasets re-served from the USF IMaRS
  ERDDAP, from each server's `info/<id>/index.json`. Run with
  `cd precompute && npx tsx ../catalog/build_erddap_collections.ts [<id> ...]`.
- `places/` — build output directory. `gazetteer/places/` is the published copy tracked by
  Portolan (currently synced by hand after each rebuild; not auto-linked).
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

### CI credentials

None needed in the repository: the self-hosted runner uses the msens host profile (see above).

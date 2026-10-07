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
- `gazetteer/` — the published Portolan/STAC catalog (`places` + `erddap/*` + `stats` collections).
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

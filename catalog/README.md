# catalog/

- `build_places.R` — builds `places/places.parquet` and `places/places.pmtiles` (20 marine place
  polygons: NOAA sanctuaries, MarineRegions MRGID, ProtectedSeas PSGID). Run with
  `Rscript catalog/build_places.R`.
- `places/` — build output directory. `gazetteer/places/` is the published copy tracked by
  Portolan (currently synced by hand after each rebuild; not auto-linked).
- `gazetteer/` — the published Portolan/STAC catalog (`places` + `erddap/*` + `stats` collections).
  Validate with `rashid check catalog/gazetteer` / `portolan check catalog/gazetteer`.

## Precomputed statistics (`gazetteer/stats/`)

One Parquet per (ERDDAP dataset, variable, place) for the last 365 days, built by `../precompute/`
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

### CI credentials (Ben: these still need adding)

`.github/workflows/stats.yml` refreshes the statistics weekly and syncs the whole gazetteer to S3.
It needs two **repository secrets** (Settings → Secrets and variables → Actions → New repository
secret) — nothing in this repo creates them:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | access key of an IAM user with `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `arn:aws:s3:::oceanmetrics.io-public/*` |
| `AWS_SECRET_ACCESS_KEY` | its secret |

Until they exist the workflow still runs the precompute and `rashid check`, logs a warning, and
skips the sync (the statistics are also uploaded as a build artifact).

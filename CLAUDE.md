# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Place-based statistics from ERDDAP gridded and tabular datasets, computed **in the browser** with
DuckDB-WASM, for places from a gazetteer (NOAA sanctuaries `NMS:*`, MarineRegions `MRGID:*`,
ProtectedSeas `PSGID:*`). No server of ours sits in the request path: only ERDDAP and static files on
S3. Live at <https://oceanmetrics.io/erddap-places/>.

Read before editing: `app/AGENTS.md` (hard rules for the app, plus the Then vs Now data contract),
`app/README.md` (UI layout, URL grammar, size budget, and verified gotchas), `catalog/README.md`
(builders, publishing, the self-hosted runner). The `AGENTS.md` / `README.md` files under
`catalog/gazetteer/` are published with the STAC catalog for outside agents. Keep them accurate when
the catalog changes.

## Commands

The app (`app/`, Svelte 5 + Vite + TypeScript):

```sh
cd app && npm install
npm run dev                         # http://localhost:5179/ (strictPort)
npm run check                       # svelte-check + tsc; must be green before committing
npm run test                        # vitest; must be green before committing
ERDDAP_OFFLINE=1 npm run test       # skip live PacIOOS / gazetteer / S3 tests (what CI does)
npx vitest run src/lib/gridMask.test.ts        # one file
npx vitest run -t 'antimeridian'               # by test name
npm run build && npm run size-budget           # budgets in app/README.md "Size budget"
```

In a sandbox, set `TMPDIR` to a writable directory, or vitest cannot start.
To run Then vs Now offline, open `http://localhost:5179/#lens=then-now&place=NMS:TEST&data=/__then-now-fixture/`.
A dev-only middleware in `vite.config.ts` serves the committed fixture for that URL.

Precompute (`precompute/`, Node + native DuckDB; it also needs `app/` dependencies installed, because
its tests import the app's TypeScript):

```sh
cd precompute && npm ci && npm test
npx tsx src/precompute.ts --dataset dhw_5km --days 30   # quick smoke test
npm run stats                                            # every target (~25 min+, hits ERDDAP)
```

Catalog builders: `Rscript catalog/build_places.R` (places GeoParquet + PMTiles),
`cd precompute && npx tsx ../catalog/build_erddap_collections.ts [<id> ...]` (ERDDAP STAC collections),
`uv run catalog/build_then_now.py ...` (Then vs Now COGs; runs on the Mac mini, where the archive is).
Validate with `rashid check catalog/gazetteer`.

## Architecture

Three consumers share one pipeline: the browser app, the Node precompute, and agents that read the
published STAC catalog.

```
places.parquet (WKB) ─► gazetteer.ts placeLobes()  ─┐   one lobe per side of ±180
ERDDAP collection.json ─► catalog.ts                 ├─► gridMask() cells + partial-area weights
/info/<id>/index.json ─► extent.ts (live time range) ┘   (pointMask() for tabledap)
                          erddap.ts griddapUrl()/tabledapUrl() ─► .parquet slab per lobe
                          engine.ts: DuckDB slab ⋈ mask ─► ../sql/*.sql ─► rows, chart, map cells
```

- **`sql/` is at the repo root, not in `app/`.** The app loads templates with `import.meta.glob`
  (`src/lib/sql.ts`). `precompute/src/sql.ts` loads the same files with `fs`, and the native
  `duckdb` CLI runs them in tests. Choose the template by variable kind: `stats_daily.sql` (continuous),
  `stats_categorical.sql` (variables flagged `erddap-places:categorical`, such as Seascapes `CLASS`
  or CRW `CRW_BAA`), `stats_tabledap.sql` (monthly roll-up for point data), `last_step.sql` (map cells).
- **The precompute imports the app's modules directly** (`wkb.ts`, `gazetteer.ts`, `catalog.ts`,
  `extent.ts`, `erddap.ts`, `gridMask.ts`), so the precomputed stats match the browser bit for bit.
  A change to those modules or to `sql/` changes both. Only the engine differs.
- **The STAC catalog drives behaviour** (`catalog/gazetteer/`, published to
  `https://storage.oceanmetrics.io/gazetteer/`). Each `erddap/<id>/collection.json` supplies the
  base URL, `cube:variables`, `erddap:cors`/`formats` (format fallback rungs), `erddap:lat_descending`,
  `erddap:lon_range`, and `erddap-places:*` hints (`depth`, `status: "pending"`, `categorical`/`classes`,
  `long_format`). Its providers, license and DOI links feed Help → Data sources and Cite this data.
  To add a dataset, add or fix its collection. Never hardcode a server or a citation in the app.
- **Time extent comes from the server** (`extent.ts` reads `/info/<id>/index.json`), not the catalog.
  The STAC end date is null or stale.
- **Two lenses in one shell.** `src/Shell.svelte` holds the frame (header, Help, tour, feedback,
  footer) and swaps lenses in place. `src/App.svelte` is Statistics (the default).
  `src/lib/thenNow/ThenNow.svelte` is Then vs Now (a lazy chunk), which reads 366-band day-of-year
  COGs over HTTP range requests with geotiff.js, plus a series Parquet. A lens reaches the Shell only
  through the `LensApi` it registers (`src/lib/help/lensApi.ts`).
- **The URL hash is the state**, so every view is a permalink (grammar in `app/README.md`).
  `?tour=` / `?modal=` / `?theme=` are query switches, never hash keys.
  `migrateHash()` in `src/lib/view.ts` rewrites old `mode=then-now` links; never drop it.
- **Runs** start 250 ms after a change (there is no Run button). `src/lib/runToken.ts` aborts the
  run in flight, and every await checkpoint must return early on `stale()`. Results carry the run
  they belong to (`shownRun`, `shownVar`): file names, the permalink and Reproduce come from that,
  never from the live pickers.
- **Logic lives in plain, tested `.ts`**, and components only wire it. Examples: sentence words in
  `sentence.ts`, tour stops in `help/tour.ts`, shortcuts in `help/keys.ts`, and the issue URL in
  `feedback/issue.ts`. Fixtures assert exact numbers. The Then vs Now fixture is a closed form
  (`thenNow/fixtures/make_fixture.mjs`). Tests that need the network skip when it is unreachable.

## Rules that break things when ignored

These are verified regressions, each guarded by a test. Details are in `app/README.md` and
`app/AGENTS.md`.

- Never hold place geometry in deep `$state`. Use `$state.raw` and `plainPlace()`. The reactive proxy
  made the FKNMS mask take 67 s instead of 0.24 s (`maskPerf.test.ts`).
- Drive the map camera only through `bind:bounds` in `MapView.svelte`. Calling `fitBounds()` or
  passing a constant `center` loops effects until Svelte throws (`mapView.svelte.test.ts`).
- Pinned versions: `@duckdb/duckdb-wasm` 1.29.0, MapLibre GL major 5 (6 breaks the Vite worker),
  `html-to-image` 1.11.13. Keep `html-to-image` lazy: only `feedback/capture.ts` imports it, and only
  through `import()` from the Shell.
- ERDDAP constraints: percent-encode each `[`/`]` and nothing else. A descending latitude axis
  (`erddap:lat_descending`) must be requested hi → lo. Clamp longitude to `erddap:lon_range`.
- DuckDB-WASM has no ICU, so `TIMESTAMPTZ::DATE` fails. Use `make_timestamp(epoch_ms(time) * 1000)::DATE`.
- UI is `@marinebon/ui` v0.1.0 (follow `node_modules/@marinebon/ui/AGENTS.md`): semantic tokens
  only, check both themes and a 390 px width.
- When a control moves or is renamed, update its tour stop (`TOUR_STOPS`) and the keyboard list
  (`SHORTCUTS`). After a layout change, re-shoot screenshots with `docs/ui-assessment/shoot.mjs`;
  it opens pages with `?tour=off` and waits on `.lens[data-state]`.
- Feedback goes to the shared Ocean Metrics Apps Script when `VITE_FEEDBACK_URL` is set (a Google
  Sheet row, mail to the recipients, a GitHub issue; `scripts/feedback/Code.gs`, runbook
  `docs/feedback.md`). Without it, or when the POST fails, it builds a GitHub issue URL (under 7,500
  characters), copies to the clipboard, or downloads a PNG. The email field is optional: it goes to the
  Sheet and the mail only, never into the issue, the issue URL or the clipboard report. The view link
  is an opt-out checkbox; an unticked one is absent from the payload.
- Raise a size budget only with the reason recorded in `app/README.md`.

## CI and publishing

- `.github/workflows/pages.yml`: on push to `main` touching `app/` or `sql/`, it runs
  `ERDDAP_OFFLINE=1` tests, builds with `VITE_BASE=/erddap-places/`, checks the size budget, and
  deploys to GitHub Pages.
- `.github/workflows/stats.yml`: runs weekly on the **self-hosted `msens` runner**. It precomputes
  `catalog/gazetteer/stats/`, runs `rashid check`, and syncs the gazetteer to
  `s3://oceanmetrics.io-public/gazetteer/` using the host's AWS profile (the repo has no secrets).
  The sync excludes `rasters/`, `climatology/` and `series/`, which are uploaded from the Mac mini.
- Data files (stats Parquet and provenance, Then vs Now COGs and series) are git-ignored. Only the
  STAC JSON, READMEs and AGENTS files are committed.

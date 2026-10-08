# AGENTS.md — erddap-places app

Rules for agents working in `app/` (Svelte 5 + Vite + TypeScript; see `README.md` for the why).

- Run `npm run check` (svelte-check + tsc) and `npm run test` (vitest; `ERDDAP_OFFLINE=1` skips the
  live network tests) before committing; both must be green. In a sandbox, set `TMPDIR` to a
  writable directory or vitest cannot start.
- Never hold place geometry in deep `$state` (see README "Never put place geometry in deep
  `$state`"); use `$state.raw` and `plainPlace()`.
- Map camera: only through `bind:bounds` in `MapView.svelte` (README, `mapView.svelte.test.ts`).
- SQL for the statistics mode lives in `../sql/*.sql`; the then-now series SQL is generated in
  `src/lib/thenNow/series.ts` and tested against the native `duckdb` CLI.

## One page, two lenses (MBON UI kit)

- The UI is `@marinebon/ui` (pinned `github:marinebon/ui#v0.3.0`); follow its AGENTS.md
  (`node_modules/@marinebon/ui/AGENTS.md`): semantic tokens only, one coral button (Download CSV in
  Share), pipeline order dataset → place → method → delivery, check both themes and 390 px.
- `src/Shell.svelte`: header, footer, Help, and the lens, swapped in place (no reload).
- Statistics (`App.svelte`, default), hash `#place=…&dataset=…&variable=…&from=…&to=…` (+ `stat=`).
- Then vs Now (`src/lib/thenNow/ThenNow.svelte`, lazy chunk), hash
  `#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0`
  (+ `pal=viridis`, `data=<root>`). The old `mode=then-now` still opens it and is rewritten on load
  (`migrateHash()` in `src/lib/view.ts`, tested in `view.test.ts`): never drop that shim.
- Both: `show=` / `hide=` for panes that differ from the default (`controls`, `time`, `table` /
  `exceedance`). Every view stays a link. In Statistics `table` means the Time strip's Table tab (the
  table is a tab of the strip, not a pane); the active tab has no hash key of its own.
- Each lens marks its root `.lens[data-state=loading|done|error]`; screenshot scripts wait on it.
- The words of the title sentence live in `src/lib/sentence.ts` (tested); the shared footer line in
  `src/lib/chrome.svelte.ts`.
- `npm run size-budget` after a build (README "Size budget"); raise a budget only with a reason
  recorded there.
- **Help, the tour and feedback stay in step with the layout** (README "Help, the tour and
  feedback"). A control that moves or is renamed updates its tour stop (`TOUR_STOPS` in
  `src/lib/help/tour.ts`: order, selectors, words) and the Keyboard list (`SHORTCUTS` in `keys.ts`).
  A lens reaches the Shell only through the `LensApi` it registers (`src/lib/help/lensApi.ts`).
  `?tour=` / `?modal=` are query switches, never hash keys. Screenshots open with `?tour=off`
  (`docs/ui-assessment/shoot.mjs`). Feedback has one primary button, Send, always shown. It posts to
  the shared Apps Script endpoint when `VITE_FEEDBACK_URL` (or the `erddap-places.feedback_url`
  localStorage override) is set; otherwise it is disabled, and so after a failed POST a one-line notice
  under it carries the inline link "open a GitHub issue" (`issueUrl()`, under 7,500 characters; the
  screenshot goes to the clipboard). No Copy report or Download PNG button. The email is optional and
  goes to the Sheet and the mail only: never into the issue or the issue URL (`payload.ts` leaves the
  key out when empty). Mark colours live
  only in `feedback/colors.ts`. Runbook: `docs/feedback.md`.
- **html-to-image stays lazy** (pinned 1.11.13 exactly). Only `src/lib/feedback/capture.ts` imports
  it, and it and `FeedbackDialog.svelte` are reached only via `import()` in `Shell.svelte`
  (`help.test.ts` and the size budget's `fontEmbedCSS` check enforce it).
- A new ERDDAP collection in the catalog gets its Data sources row and citation from its STAC
  (`providers`, `license`, a `license` link, a `cite-as` / `sci:doi` / doi.org `about` link); fix the
  collection, not `sources.ts`.
  Mapping from the Shiny app and design notes: `docs/then-now.md`.

## Precomputed stats first

- `src/lib/precomputed.ts` shows the weekly `stats/<dataset_id>/<variable>/<place_id>.parquet`
  rows in the Time strip before the live run finishes (README "Precomputed stats first"). Existence
  comes only from the cached `stats/collection.json` item links (`hasPrecomputed()`): never HEAD or
  GET a stats file for a combination that is not listed.
- The shaped rows must keep the live run's columns (`stats_daily.sql` / `stats_categorical.sql`
  output: `fraction`, `percent_cells`, `date` as epoch ms). Change the template and the shaping
  together; `precomputed.test.ts` fails if they drift.
- Every await in `run()` still checks `stale()`; precomputed rows never set `shownRun` (file names and
  the permalink come from the live result only), and the live result clears `shownSource`.

## Then-now data contract

Under the gazetteer root (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/`,
the bucket URL rather than the `storage.oceanmetrics.io` redirect, to save a 302 per range request);
`catalog.json` has child links to `rasters/`, `climatology/` and `series/` collections.

- `rasters/<dataset>/<variable>/<place_id>/<year>.tif` — COG, EPSG:4326, float32, nodata NaN,
  **366 bands: band i = day-of-year i of a leap year** (band 60 = 29 Feb, NaN in non-leap years;
  1 Mar = 61 always), INTERLEAVE=BAND, DEFLATE, 256 px tiles. Covers the place bbox + 20 %, **not
  masked** to the polygon.
- `climatology/<dataset>/<variable>/<place_id>/<y0>-<y1>_{mean,sd,n}.tif` — same grid, same bands.
  Baselines `1985-2005`, `2003-2012`.
- `series/<dataset>/<variable>/<place_id>.parquet` — one row per day: `date`, `mean` (area-weighted,
  masked), `sd`, `min`, `max`, `n_cells`, …
- `rasters/collection.json` `summaries`: `erddap-places:dataset_id`, `erddap-places:variable`,
  `erddap-places:place_id` (lists), `erddap-places:baselines`, `year.minimum/maximum`
  (`parseRasterCollection()` in `src/lib/thenNow/data.ts`).
- Place ids keep their colon in the object key; the app requests it as `%3A`.
- `rasters/items/<ds>_<var>_<NMS-XXX>_<year>.json` carry `erddap-places:n_days_valid`; 0 = an all-NaN
  year (`placeItemLinks()` / `emptyYears()` in `data.ts`). TBNMS has no rasters (not in the summaries).
- `CogReader` reads are memoised and shared: never pass a per-view AbortSignal into them.
- `src/lib/thenNow/thenNow.live.test.ts` reads FKNMS from S3 (skipped offline) and asserts the cost:
  ≤ 4 requests and < 64 kB for a first band, ≤ 16 kB for the next.
- Band ↔ month-day: `src/lib/thenNow/doy.ts` (`mdToBand`, `bandToMd`, `bandDate`).

The test fixture (`src/lib/thenNow/fixtures/`, < 1 MB) has the same layout for one 20 × 20 px place
`NMS:TEST` and two years; its values are a closed form documented in `make_fixture.mjs`, so tests
assert exact numbers.

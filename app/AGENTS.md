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

- The UI is `@marinebon/ui` (pinned `github:marinebon/ui#v0.3.1`); follow its AGENTS.md
  (`node_modules/@marinebon/ui/AGENTS.md`): semantic tokens only, one coral button (Download CSV in
  Share), pipeline order dataset → place → method → delivery, check both themes and 390 px.
- `src/Shell.svelte`: header, footer, Help, and the lens, swapped in place (no reload).
- Statistics (`App.svelte`, default), hash `#place=…&dataset=…&variable=…&from=…&to=…` (+ `stat=`, and `coll=` for a
  place_id that exists in two gazetteer collections).
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

## Gazetteer data contract (index + manifest + per-collection geometry)

All under `https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/` (the bucket host: the
storage host's 302 costs a redirect per range request). Code: `src/lib/gazetteer.ts`, the vendored client in
`src/lib/places/` (its header lists the local patches: re-apply them when you re-copy it), the picker in
`src/lib/PlacePicker.svelte` + `placePicker.ts`.

- the manifest (`index/layers.json`; falls back to `layers.json`): 22 layers; slug == collection == PMTiles source-layer. `pmtiles` names the storage host:
  always go through `loadLayers()`, which rewrites it to `<bucket>/<slug>/places.pmtiles`. Titles, paint,
  `attribution_html`, `license`, `license_url` and `citation` come from here, never from the app.
- `index/places_index.parquet` (14,734 rows, 1.1 MB, one GET): `place_id`, `name`, `authority`, `place_type`,
  `geom_type`, `collection`, `bbox`, `centroid_*`, `area_km2` (only the 20 `places` rows have it). **`place_id` is
  not unique across collections** (three BOEM ids are in two): key by (collection, `place_id`), `placeKey()`, and
  resolve an id with `resolvePlace()` (the first collection in manifest order unless `coll` names one). Ids
  contain spaces and several colons; nothing may split or assume a shape. Places cut at ±180 are indexed UNWRAPPED (PMNM 177.8..199.0,
  `centroid_lon` may exceed 180): fit the bbox as it is. A few rows still read -180..180: `indexBounds()` waits for
  their geometry. Only `MultiPolygon`/`Polygon` rows can be masked.
- `<collection>/places.parquet`: WKB geometry split at ±180. `placeGeometry()` reads ONE place; its cost is the
  collection's row-group layout (the 1.0.1 collections have tiny row groups: an MPA is ~1 MB, a sanctuary ~0.1 MB;
  `places/places.parquet` is one 4.2 MB group, hence the whole-file fast path for the 20). Keep it out of `$state` (cache: a plain `Map`), `stale()` after the await, and never `unwrap` (the
  lobes expect the parts split at ±180). The 20 `places` ids use `loadPlaces()` instead.
- Statistics and Then vs Now rasters exist only for the 20 `places` ids: ask `hasPrecomputed()` only for the
  `places` collection. A new collection's rows need no code, only the manifest and the index.
- The URL: `place=<id>` (URL-encoded on write, decoded on read) and `coll=<collection>` only for an ambiguous id.
- The Place picker is not the kit's `Picker`: that one filters the items it is given and cannot sit on 14,734 rows.

## Precomputed stats first

- `src/lib/precomputed.ts` reads the weekly `stats/<dataset_id>/<variable>/<place_id>.parquet` and
  `planRun()` decides what a run loads (README "Precomputed stats first"). Existence comes only from
  the cached `stats/collection.json` item links (`hasPrecomputed()`): never HEAD or GET a stats file
  for a combination that is not listed.
- **Strip vs window** (the data contract of the Time strip): when `planRun()` says `precomputed`,
  `series` is the WHOLE file and is what the plot draws (`plotRows`, x-domain `seriesSpan`), while
  `rows` is only the window's share of it (`inWindow()`) and feeds the Table tab, `exportRows` (CSV /
  Parquet), the tab title and the counts. Never put the whole file into `rows`, and never restrict
  `series` to the window: that was the 0.2.0 bug (the strip looked like the live run). The brush is the
  window inside the series span.
- **Map slice**: on that path the only live request is one time step, `[(t):1:(t)]` with `t` the
  window's last day clamped to the dataset's last step (`griddapSliceUrl()`), through the same lobe
  loop (axis vectors, `erddap:lat_descending`, longitude clamp, `ds.format` rung) and `last_step.sql`
  only; the window statistics SQL is not run. Any other case (window starts before the file, no file,
  empty file, tabledap) is the full live path and must clear `series` / `shownSource`.
- The shaped rows must keep the live run's columns (`stats_daily.sql` / `stats_categorical.sql`
  output: `fraction`, `percent_cells`, `date` as epoch ms). Change the template and the shaping
  together; `precomputed.test.ts` fails if they drift.
- Every await in `run()` still checks `stale()`. The precomputed load DOES set `shownRun` (as soon as
  the file is read: permalink, file names, Reproduce, downloads), and `shownSource` (through date, as-of
  date, `mapDate`, `failed`) marks that the statistics are not recomputed; `urls` then lists the
  Parquet, its provenance JSON and the slice. The footer's rows / kB are the file's plus the slice
  (`fileRows`). The same target again (a brushed window) keeps `series` on screen and reuses the
  in-memory file (`preMem`).

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

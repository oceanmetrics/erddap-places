# app — erddap-places in the browser

Svelte 5 + Vite + TypeScript. The whole pipeline runs client-side: a place polygon and an ERDDAP
dataset in, daily statistics out, with no server of ours in the request path.

```
place GeoJSON ─┐
               ├─ gridMask()  → cells + area weights   (src/lib/gridMask.ts)
ERDDAP axes  ──┘
                 griddapUrl() → one .parquet per lobe  (src/lib/erddap.ts)
                 DuckDB-WASM  → slab ⋈ mask, per day   (src/lib/engine.ts + ../sql/stats_daily.sql)
```

`src/App.svelte` picks a place from the published gazetteer (`places.parquet`, read with hyparquet,
WKB decoded by `src/lib/wkb.ts`), splits it into lobes (one griddap request each, grouped by side of
the antimeridian so PMNM works), and computes daily `CRW_SST` from PacIOOS `dhw_5km`.

## The page (MBON re-layout, 2026-10-08)

One page, built with the MBON UI kit [`@marinebon/ui`](https://github.com/marinebon/ui) (v0.1.0,
installed from the git tag), laid out like calcofi.io/explore: the map is the page and everything
else floats over it. `src/Shell.svelte` holds the frame and swaps the **lens** in place;
`src/App.svelte` is the Statistics lens, `src/lib/thenNow/ThenNow.svelte` the Then vs Now lens (a lazy
chunk). Before/after screenshots: `../docs/ui-assessment.md` and `../docs/ui-assessment/after/`.

- **Header** (kit `Header`): MBON wordmark, *erddap-places*, "place statistics from ERDDAP, in your
  browser", the lens word (*Statistics* · *Then vs Now*), Help ▾ (below), Feedback, the theme toggle. The dark
  theme switches the basemap to Esri World Dark Gray in place (`setBasemap()` flips two raster layers;
  no `setStyle`, so the place and cell layers stay).
- **Title sentence** (kit `Sentence` + `Chip`), dataset → place → method → time. Statistics:
  "**Sea surface temperature** (NOAA Coral Reef Watch, 5 km, daily) in **Florida Keys NMS**,
  **area-weighted mean** of 462 cells, **7 Sep – 6 Oct 2026**"; Then vs Now: "**Sea surface
  temperature** in **Florida Keys NMS** on **5 Aug**: **Then** 1985–2005 climatology vs **Now**
  2026". Each bold part is a chip whose popover holds the same picker as the Controls tab. The second
  line is the colour scale of the map layer and the counts ("map: 6 Oct 2026 · 462 cells · 278 on the
  boundary"); with the anomaly on it carries the headline ("76 % of the sanctuary more than +1 °C
  warmer", shown once the sanctuary mask is in). The words come from `src/lib/sentence.ts`.
- **Controls** pane (kit `Controls`), top left: ① **Place** (gazetteer picker, sanctuaries first; or
  click the map) ② **Dataset & variable** (datasets grouped by cadence, then the variable in words)
  ③ **Method** (the lens: *Window statistics* | *Then vs Now*; for statistics the charted statistic,
  the area-weight note and the window; for Then vs Now, Then, Now, the anomaly, the day, and under
  *More options* the palette and smoothing) ④ **Share** (Download CSV, Parquet, PNG of the view, Copy
  link, Copy citation, *Cite this data*, and *Reproduce: requests, mask, SQL and timing*, closed).
- **No Run button**: a change runs after 250 ms; the run tokens still abort and supersede, so a
  chip change never stacks requests. A dataset change waits for its time extent before running.
- **Time strip** (kit `TimeStrip`), bottom: Statistics draws the daily series (the chosen statistic
  solid, the other mean dashed, the p10–p90 band; key in the strip bar) over a context of the window
  again on each side, with the **window as the brush**: drag a new one and it runs (capped at 90
  days). Only the window is fetched. Then vs Now draws the day-of-year chart (Then years blue, Now
  red, the previous year orange, the Then mean dashed), ◀ ▶ ▶| step and play the day, a brush picks a
  day, and *anomaly series* switches to the Now year's anomaly.
- **Right-edge pill**: *Table · 30 days* (the per-day, per-class or monthly table, with its own CSV
  / Parquet menu) for Statistics; *Exceedance · 76 % > +1 °C* (the pixel and km² breakdown) for
  Then vs Now. Folded by default.
- **Panes** remember their position per viewport class (the kit, `localStorage`); which are open is
  in the URL (below). On a phone (< 640 px) they are bottom sheets and start as bars, so the map
  shows; that folding is never written to the URL.
- **Footer** (kit `Footer`), one line: built by Ocean Metrics · the data release ("NOAA Coral Reef
  Watch — Daily Global 5km SST + DHW · ERDDAP 2.29 · data through 6 Oct 2026") · "updating… <step>"
  or the timings ("30 rows · 159 kB · 2.3 s (mask 0.19 s)") · source.
- **Help, the tour and feedback**: see the section below.
- **Errors** are a dismissable `Notice` over the map; the old status box, "N days requested" line
  and meta line are gone (their content is in the footer and under Share → Reproduce).

### URL grammar

| key | lens | what |
|---|---|---|
| `place`, `dataset`, `variable`, `from`, `to` | Statistics | the run, as before |
| `stat` | Statistics | the charted statistic (`mean_wt` default, omitted; `mean`, `min`, `max`, `p10`, `p90`, `sd`) |
| `lens` | both | `then-now`; absent = Statistics |
| `place`, `variable`, `md`, `then`, `now`, `swipe`, `anom`, `pal`, `data`, `dataset` | Then vs Now | as before |
| `show`, `hide` | both | comma lists of panes that differ from the default: `controls`, `time`, and `table` (Statistics) / `exceedance` (Then vs Now) |

Two **query** switches sit before the hash and are never part of a view (a copied link drops them):
`?tour=off` suppresses the welcome card and the tour (screenshots use it), `?tour=on` replays the tour,
and `?modal=about|sources|keys` opens a Help modal (`?modal=sources` is the data sources page).
`?theme=light|dark` is the kit's.

**Compatibility**: `mode=then-now` (every Then vs Now link before 2026-10-08) still opens Then vs
Now; `src/Shell.svelte` rewrites it to `lens=then-now` in place with `history.replaceState`
(`migrateHash()` in `src/lib/view.ts`), and `mode=stats` / `lens=stats` are dropped. Every other key
is kept, so an old link opens the same view. Switching lens carries the place over (a sanctuary into
Then vs Now; CRW SST for that place back into Statistics) and pushes a history entry, so Back returns.

### Help, the tour and feedback (U4, 2026-10-08)

After calcofi.io/explore's "Help, the tour and feedback" and obis-hex's U4, so the two MBON apps
behave alike. The logic is plain TypeScript under `src/lib/help/` and `src/lib/feedback/`, tested in
`src/lib/help/help.test.ts`; the components only wire it. Each lens registers a `LensApi`
(`src/lib/help/lensApi.ts`) with the Shell, so the tour and the keys can open its tabs and panes.

- **Welcome card** ("Start here", `src/lib/help/Welcome.svelte`, words in `start.ts`): on a first
  visit (localStorage `erddap-places-welcome`), and from Help ▾ → *Start here*. Two doors:
  *Sea surface temperature in a sanctuary this month* (FKNMS × `dhw_5km` CRW_SST, the dataset's last 30
  days) and *Then vs Now: this day against the 1985–2005 climatology* (FKNMS, today less a week, so
  the archive has it). Three worked questions: the Seascapes classes of Monterey Bay; CMEMS
  chlorophyll in Channel Islands over the whole record (Oct 2021 – Feb 2025, 41 months: a monthly grid
  may now run its whole record, where a daily grid stays capped at 90 days); the Florida Keys anomaly
  on 5 Aug 2023 with the exceedance open. Each is a real link; a click opens it in place.
- **Tour** (`Tour.svelte`, stops in `tour.ts`; Help ▾ → *Take the tour*, the `?` key, `?tour=on`, or
  the card's button): a ring and a card, no library; Back / Next / Done, ← → PageUp PageDown Home End
  Esc, focus returns where it was, the ring only animates without `prefers-reduced-motion`, and the
  tabs and panes go back as they were when it ends. Stops: the sentence → ① Place → ② Dataset &
  variable → ③ Method (and the lens switch) → the legend line → the Time strip (brush) → the edge pill
  → ④ Share → Help.
- **Help ▾**: *Take the tour*, *Guide* (marinebon.org/tools/erddap-places/), *Start here*, *About*
  (what the app is, how it computes, the gazetteer and the ERDDAP servers it reads, who built it, the
  licence and version, and the view's citation), *Data sources and attribution* (one row per ERDDAP
  collection in the catalog, built from the STAC: provider, server, citation, licence, DOI when the
  collection links one; then the gazetteer, NOAA ONMS, MarineRegions, ProtectedSeas, the Then vs Now
  rasters, the Esri basemaps and the software), *Keyboard*, *Register a product*, *Source code*.
  The modals are native `<dialog>`s (`Modal.svelte`).
- **Keys** (`keys.ts`): `?` tour, `t` theme, `1`–`4` the Controls tabs, `l` the other lens, `←` `→`
  the day in Then vs Now, `Esc` closes. Never while typing, with a modifier, or on something that
  owns its arrows (tabs, sliders, pane titles, the map, the Time strip).
- **Feedback** (the header button; `src/lib/feedback/`, a lazy chunk): a note, a picture of the view
  (html-to-image 1.11.13, pinned exactly as MarineSensitivity/atlas and obis-hex, with the MapLibre
  canvases composited in, the swipe's clip kept) with a rectangle, arrow and text mark-up, and three
  ways out, none through a server: *Open a GitHub issue* (title and body prefilled with the note, the
  view URL, the sentence, the lens, the data line, the app version, the viewport and the theme; the
  picture goes to the clipboard with a "paste it" hint; the URL stays under 7,500 characters by
  cutting the note, never the details), *Copy report*, *Download PNG*. No email is asked for.
  *Register a product* is the same dialog with "what did you build?".
- **Cite this data** (④ Share, and About): the dataset's citation (producer, title, ERDDAP page,
  access date, licence, DOI), the gazetteer's, and the app's with the view's link, with a copy
  button (`cite.ts`). Then vs Now cites the CoralTemp rasters instead of an ERDDAP dataset.

### Size budget

`npm run size-budget` (after `npm run build`; also run by the Pages workflow) gzips the entry JS,
the entry CSS and the lazy Then vs Now chunk, and sums the self-hosted fonts:

| part | before (2026-10-08, `26e61cd`) | after (kit 0.1.0) | budget |
|---|---|---|---|
| entry JS, gzip | 548.9 KB | 570.7 KB | 620 KB |
| entry CSS, gzip | 10.6 KB | 16.5 KB | 20 KB |
| Then vs Now chunk JS + CSS, gzip | 28.9 KB | 34.8 KB | 40 KB |
| fonts (woff2, raw; a page fetches only the faces it uses) | 0 | 514 KB | 560 KB |

Help, the tour and feedback (U4) added 8.2 KB to the entry JS (570.7 → 578.9 KB: the welcome card,
the tour, the modals, the sources and the citations), 1.0 KB to the entry CSS (17.5 KB) and 0.2 KB to
the Then vs Now chunk (35.0 KB); no budget was raised. The feedback dialog and html-to-image are their
own lazy chunks (`FeedbackDialog-*`, `capture-*`: 9.3 KB gzip), fetched on the first Feedback click,
with a line of their own (budget 15 KB); the script fails if html-to-image (its `fontEmbedCSS` option
name) shows up in the entry.

There was no budget before the re-layout; these are the first, set with ~8 % headroom over the
measured sizes. The DuckDB engine (wasm + worker, ~15 MB gzip, fetched on first query) is listed by
the script, not budgeted. The data bytes per view are unchanged (FKNMS 30 days: one 159 kB griddap
Parquet; Then vs Now first view: 6 range requests, 56 kB).

## The pipeline

- **Pickers**: place (gazetteer, grouped by NMS/MRGID/PSGID), ERDDAP dataset, variable, date window
  (clamped to the dataset's live time extent).
- **Map** (`src/lib/MapView.svelte`, the whole stage): the gazetteer
  places as vector tiles from `places.pmtiles`, outlined, with the selected one filled and a click
  anywhere in a place selecting it; after a run, the **last time step** of the slab as one square per
  masked grid cell, hover showing the value and the area weight. Fits the place bbox on selection,
  padded so the Controls pane and the Time strip do not cover it (`fitPadding()`).
- **Tabledap**: a dataset whose collection says `erddap:protocol: "tabledap"` takes a different
  path — bbox + window constraints instead of axis vectors, `pointMask()` instead of `gridMask()`,
  and a **monthly** roll-up with `n_casts`; the chart becomes a monthly mean with a min–max band and
  the map draws the sample stations as circles.
- **Export**: the result table as **CSV** or **Parquet** (DuckDB's own `COPY … TO` writer, read back
  with `copyFileToBuffer`), named after the place, dataset, variable and window, e.g.
  `erddap-places_NMS-HIHWNMS_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.parquet`; a **PNG of the
  view** (`src/lib/png.ts`: the map canvas read in its `render` event, the sentence above, the dataset
  and the link stamped below).
- **Reproduce** (Share tab, closed): the exact griddap URL(s) used, the mask summary (cells, lobes,
  total area weight, partial boundary cells) and the rendered SQL of both queries, with *Copy all*.
- **Permalink**: written on every successful run (the run on screen, plus `stat`, `show`, `hide`)
  and read on load, so a shared link reproduces the view.

## Then vs Now (`#lens=then-now`)

A second view: the *Sanctuaries Climate Change* Shiny app (shiny.marinebon.app/nms-cc) without a
server. Pick a sanctuary, a day of the year, **Then** (the `1985–2005` or `2003–2012` climatology, or
any custom year range averaged in the browser) and **Now** (the latest archived year or any year),
and swipe between the two maps on one shared colour scale; toggle the **anomaly** (Now − Then, with
the pixels and km² above +1 °C inside the sanctuary); read the day-of-year chart of every year (Then
years blue, Now red, the chosen day marked) and the Now year's anomaly series. Rasters are 366-band
COGs read one band at a time with geotiff.js over HTTP range requests (FKNMS on S3: 6 requests,
56 kB for a first view, 16 kB per further day); the chart is one DuckDB-WASM query over the place's series Parquet. Everything is in the hash,
so every view is a permalink. The code is a lazy chunk in `src/lib/thenNow/`; the mapping from the
Shiny controls, the design decisions and what is not done are in [`docs/then-now.md`](docs/then-now.md),
the data contract in [`AGENTS.md`](AGENTS.md).

## Run

```sh
npm install
npm run dev      # http://localhost:5179/
npm run test     # vitest: WKB decode, gazetteer/lobes, gridMask counts, ERDDAP URL shapes, SQL,
                 # then-now (URL state, band calendar, COG reads + averaging on the fixture, scales, series SQL),
                 # App/MapView mount (jsdom + a fake maplibre-gl: no effect loops),
                 # time-extent parse + window clamp, FKNMS mask budget, run tokens
                 # (live PacIOOS/gazetteer tests skip when offline)
npm run build    # → dist/ (base './', so it works from any GitHub Pages path)
npm run check    # svelte-check + tsc
npm run size-budget   # after build: entry JS / CSS / Then vs Now chunk / feedback chunks / fonts against the budget
```

`ERDDAP_OFFLINE=1 npm run test` forces the live-network tests to skip.

Offline then-now: `npm run dev`, then `http://localhost:5179/#lens=then-now&place=NMS:TEST&data=/__then-now-fixture/`
(the committed fixture, served by a dev-only middleware in `vite.config.ts`).

## Notes

- `sql/` lives at the **repo root**, not in `app/`: `engine.ts` pulls the templates in with
  `import.meta.glob('../../sql/*.sql', { query: '?raw' })`, so the same SQL is runnable with the
  native `duckdb` CLI.
- `@duckdb/duckdb-wasm` is pinned exactly (1.29.0) and excluded from the dep optimizer; its wasm and
  worker bundles are imported with `?url` and self-hosted (no jsDelivr in the critical path).
- `static/` is the Vite public dir (empty: the app has no static place files any more).
  `src/lib/__fixtures__/*.geojson` are the four test sanctuaries (public NOAA data, from
  `noaa-onms/onmsR`).
- **Categorical grids** (`CLASS` in AOML Seascapes, `CRW_BAA` in `dhw_5km`) are marked in the
  catalog with `erddap-places:categorical` and an `erddap-places:classes` label map. They run
  `sql/stats_categorical.sql` instead of `stats_daily.sql`: per date × class, the number of cells,
  the area weight, the area-weighted `fraction` (sums to 1 per date) and the percent of cells. The
  chart is a stacked area of the class proportions (`Plot.areaY` with `offset: 'normalize'`), the
  colours being seascapeR's reversed ColorBrewer Spectral ramp (`src/lib/palette.ts`).
- **One run at a time** (`src/lib/runToken.ts`): each `run()` takes a token and an `AbortController`
  from `Runs`, which aborts whatever was in flight; every await checkpoint (extent, axes, slab,
  DuckDB) returns early when `stale()`, and the signal goes into every `fetch`. The results also
  carry the variable they came from (`shownVar`), so a superseded SST run can no longer render
  through the newly-picked categorical template as "class NaN" rows. The pickers stay live while a
  run is in flight; since the re-layout there is no Run button: a change runs after 250 ms
  (`App.svelte`, the run-on-change effect keyed on place × dataset × variable × window).
- **Never put place geometry in deep `$state`** (verified 2026-09-15): Svelte 5's reactive proxy
  wraps every nested coordinate array, and `gridMask` reads each vertex many times — masking FKNMS
  (13 parts, 39,645 vertices) takes **0.24 s on plain arrays and 67 s through the proxy** (TBNMS:
  202 s), which is the main-thread freeze that was seen in the browser. `App.svelte` keeps
  `places`/`datasets`/`rows`/`urls` in `$state.raw` and calls `plainPlace()` (`src/lib/gazetteer.ts`)
  before `placeLobes`/`gridMask`; `structuredClone` cannot do that job (DataCloneError on a proxy).
  `maskPerf.test.ts` is the regression: the decode + lobes + weighted mask of FKNMS, plain and
  `proxy()`-wrapped, must finish in under 1 s. Selecting a place does no geometry work at all — the
  whole pipeline waits for Run — and the mask time is printed in the status line.
- **Time extent comes from the server, not the catalog** (`src/lib/extent.ts`): the STAC
  `cube:dimensions.time.extent` end is `null`/stale, so on dataset selection the app reads
  `<base>/info/<datasetID>/index.json` (the `time` `actual_range` row, seconds since epoch, with the
  `time_coverage_*` globals as the fallback) and caches it. The picker shows "data through
  2026-06-26"; the default window is the last 30 days ending at the **dataset's** last time step
  (widened to ~8 steps for a coarser product, so the 8-day Seascapes grid gets 65 days), and a
  user window is clamped to the extent — a start after the end snaps back and says so in the status
  line instead of 404ing on `"Start" is greater than the axis maximum=…`. `averageSpacing` from the
  same info table labels the chart x-axis and status ("8-day steps"), and the extent's own endpoints
  go into the griddap constraint verbatim so a non-noon axis (MUR is 09:00Z) cannot be overshot.
- **Map** (`src/lib/MapView.svelte`, `svelte-maplibre` + `pmtiles`): **MapLibre GL is pinned to
  major version 5** (`svelte-maplibre` 1.3.x, which peers on 4/5) — MapLibre 6 ships its worker as a
  module worker that Vite's dep optimizer breaks. The basemap is Esri's keyless *World Ocean Base*
  raster tiles, attributed in the map's own attribution control. The places come straight from the
  published `places/places.pmtiles` through the `pmtiles://` protocol, source layer **`places`**
  (`PLACES_SOURCE_LAYER` in `src/lib/gazetteer.ts`; its fields are `place_id`, `name`, `gazetteer`,
  `area_km2`), so selecting or drawing a place costs no geometry work in JS at all. The basemap is
  Esri's keyless *World Ocean Base* (`OCEAN_TILES`, an ArcGIS REST `/tile/{z}/{y}/{x}` template —
  row before column, unlike XYZ).
- **Drive the camera through `bind:bounds` only** (fixed 2026-09-15, regression test
  `src/lib/mapView.svelte.test.ts`): svelte-maplibre's camera `$effect` *reads* the bindable
  `center`/`zoom`/`bounds` props and eases the map when they differ from `map.getCenter()`, while
  its `moveend` handler *writes* them back. Calling `map.fitBounds()` from our own effect — or
  passing a constant `center={[lng, lat]}` array, which is never `compare`-equal to the `LngLat` the
  map returns — makes the two chase each other until Svelte throws
  `effect_update_depth_exceeded`; on the deployed build that froze the page with the status at
  "reading the dataset time extent…" and an empty map. `MapView.svelte` now keeps one `$state.raw`
  bounds value, writes it only when the `bounds` prop changes (it never reads it, so the map's
  write-back cannot restart the effect) and hands it to `<MapLibre bind:bounds fitBoundsOptions>`,
  which settles via `boundsEqual()` — longitude-wrapping, so an east-of-180 fit (PMNM) works. The
  place is already selected on first paint (hash or default), so the first fit is asked for before
  the map exists and lands on an unsized container, where it is dropped — the page then opened on
  the whole world. `onload` re-assigns a fresh `LngLatBounds` once (an event handler, not an effect)
  so the fit happens for real.
- **Cell squares** (`src/lib/cells.ts`): after a run, `sql/last_step.sql` returns the masked cells of
  the newest time step (mask coordinates, weight, value) and `cellSquares()` turns them into a
  GeoJSON square each, sized by the **median gap between the distinct cell coordinates** (so the
  holes the mask leaves cannot inflate the step) — `lon ± dx/2`, `lat ± dy/2`. Antimeridian-safe: a
  cell set spanning more than 180° is put in the `[0, 360)` frame, so a square at 179.975 runs
  179.95 → 180.05 instead of wrapping the globe; `placeMapBounds()` does the same for the map fit,
  and only walks geometry for such a place (every other place uses its stored bbox). Continuous
  variables are coloured with a viridis ramp (`rampStops()` in `src/lib/palette.ts`), categorical
  ones with the chart's own class colours.
- **Export and permalink** (`src/lib/download.ts`, `src/lib/permalink.ts`, both DuckDB-free so they
  test in plain Node): CSV is written from the rows on screen (`toCsv`, RFC 4180 quoting, ISO days);
  Parquet goes back through DuckDB (`engine.toParquet()` inserts the rows as Arrow, `COPY … TO
  'export.parquet' (FORMAT PARQUET)`, `copyFileToBuffer`, `dropFile`) rather than re-running the
  statistics, so the file is exactly the table that is shown. The hash is read **synchronously in
  the component script**, not in `onMount`, so the dataset-extent effect cannot default the window
  over a window that came from the link (`hashWindow`); it is rewritten with `history.replaceState`
  on every successful run. File names, the permalink and the reproduce panel all come from
  `shownRun` — the run the results belong to, never the live pickers.
- **Tabledap** (`tabledapUrl()` / `tabledapPlaceConstraints()` in `src/lib/erddap.ts`,
  `pointMask()` in `src/lib/gridMask.ts`, `sql/stats_tabledap.sql` + `sql/points_tabledap.sql`):
  the column list is joined with `%2C` and each constraint encodes **only** its comparison
  characters (`%3E=`, `%3C=`), `=` staying literal and a string value quoted with `%22` — the shape
  ERDDAP 2.30 accepts (verified against `erddap.calcofi.io`, which returns `.parquetWMeta` with
  CORS). There is no lattice: the distinct positions come back out of the slab
  (`SELECT DISTINCT longitude, latitude`), go through turf point-in-polygon and return as the same
  `mask` table the grid path uses, every kept station with weight 1. The roll-up is **monthly**
  (`date_trunc('month', …)`) with `n_casts` counting the distinct time × position events behind the
  measurements, because one cast contributes many depths. Long format: `erddap-places:long_format`
  names the `measurement_type` / `measurement_value` columns, the request filters
  `measurement_type="…"`, and `valueExpr(v, 's', longFormat)` reads the value column. The default
  window is **five years**, and when the server publishes no `time` `actual_range` or
  `time_coverage_*` (CalCOFI does not), the extent falls back to the collection's
  `cube:dimensions.time.extent`.
- Datasets and variables come from the STAC Collections under `erddap/` in the catalog
  (`src/lib/catalog.ts`): `cube:variables` fills the variable picker, `erddap:cors`/`erddap:formats`
  choose the format rung, `erddap:lat_descending` orients the latitude constraint, and a Kelvin unit
  becomes a `- 273.15` in the SQL (`valueExpr`).
- The gazetteer base URL is one constant in `src/lib/gazetteer.ts`
  (`https://storage.oceanmetrics.io/gazetteer/`), with the bucket URL
  (`https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/`) as the fallback on any
  fetch failure.
- SQL template loading/rendering lives in `src/lib/sql.ts`, separate from `engine.ts`, so the
  templates can be rendered and run in plain Node against the native `duckdb` CLI (`sql.test.ts`).
- ERDDAP wants each constraint's `[` `]` percent-encoded and nothing else, and it rejects an
  ascending constraint on a **descending** axis — `latitude` on the CRW grid must be `[(hi):1:(lo)]`.

## DuckDB-WASM gotchas (verified 2026-09-15)

- No ICU extension in the WASM build, so `TIMESTAMPTZ::DATE` is unimplemented; `sql/stats_daily.sql`
  goes through `make_timestamp(epoch_ms(time) * 1000)::DATE` instead (UTC day).
- `import.meta.glob` paths are relative to the importing file: `src/lib/engine.ts` reaches the repo-root
  `sql/` as `../../../sql/*.sql`.
- Arrow returns DATE values to JS as epoch milliseconds; format with `new Date(v)`.

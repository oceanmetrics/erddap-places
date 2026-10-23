# Parity checklist: erddap-places -> Ocean Metrics

This file is the week 2 gate of the Ocean Metrics restructure (build week 2 is 2026-11-06 to 11-12). It lists
every user-visible behaviour of the frozen app, read from the code at app 0.3.12, and says where each one lives
after the fold-in. The redirect from erddap-places to Indicators (`app/src/lib/redirect.ts`, `../docs/redirects.md`)
is activated only by Ben, after this checklist passes.

How to read it:

- One row is one behaviour. "erddap-places (file)" names the file and a function or line where it lives today
  (repo-relative paths). "target" says where it lives after the fold-in: the Indicators Map
  (`indicators/viewer/src/lib/map/…`), the Indicators Place view, the places record page (`/places/p/<id>`: the
  places site owns the Place page), or "not yet" with the week it is planned for.
- A row is ticked only on evidence the orchestrator can see: an Indicators test or a committed shot
  (`indicators/docs/shots/`). Name the test or the shot when ticking.
- Every row starts unticked, with its week: `[ ] week N`.

The weeks: week 2 (11-06 to 11-12): the layer under the map, Then vs Now as two slices. Week 3 (11-13 to 11-19):
the Place page and the Matrix, the live series and the period window on the Map. Week 4 (11-20 to 11-26): atlas
skins and the OBIS layer. Week 5 (11-27 to 12-03): alerts and the website. Week 6 (12-04 to 12-10): retire and
sustain.

In Indicators, `t` is the shared period (`map/TimeScrubber.svelte`, `map/timeWindow.ts`), `t2` the second period
of the compare mode (a "Compare" Toggle beside the scrubber, one swipe handle between the slice at `t` and the
slice at `t2`), and `anom=1` shows `t2 − t` per cell on a diverging ramp.

**Status 2026-10-23** (orchestrator's evidence: the indicators commits `127c60a` and `9dcd717`, their tests and the committed
`docs/shots/map_compare_sst_*`): **12 of 108 rows ticked** (16, 23, 28, 29, 31, 75, 78, 79, 80, 81, 96, 97): the slice, the compare mode
(swipe on one map in both projections, one colour scale, the anomaly) and its permalink keys (`layer`, `t`, `t2`, `swipe`,
`anom`), both themes at 390 px.

**Status 2026-10-23, later** (the indicators branch `wk2-rows` at `2090a71`, its tests and `docs/shots/map_wk2_*`, with `@oceanmetrics/map` 0.3.0 from
platform's `map-wk2`; erddap-places `fa4e9b5`): **23 of 108 rows ticked**, the 12 above and 17, 19, 20, 22, 30, 32, 37, 58, 82, 95, 106: the
cell readout (one slice and the compare mode), the cells sliced in the legend, the Retry, the globe and full screen (from their shots),
a palette, the year-range Then, `l`, and the redirect naming the Map's compare link. Still open in week 2 (25 rows): 18, 21, 24, 25, 26,
27, 33, 34, 38, 59, 60, 71, 72, 73, 74, 83, 86, 87, 100, 101, 102, 103, 105, 107, 108. Of those, 33 (Now: empty years greyed, `latest`
walking back) has no counterpart yet (`t` walks the indicator's own periods), and 34 and 83 (the day of year) are not needed: `t` and
`t2` are periods of the layer's grain; the others were not part of this pass and are not checked here. The ticks rest on the branch:
they hold once `wk2-rows` is merged and map 0.3.0 is published.

## Live series (Statistics, computed in the browser)

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 1 | No Run button: a change of place, dataset, variable or window runs 250 ms later; a newer pick aborts the run in flight and nothing stale is drawn | `app/src/App.svelte` run-on-change `$effect` (~L420), `app/src/lib/runToken.ts` `Runs` | indicators Place view | [ ] week 3 |
| 2 | The place is masked onto the grid in the browser: each cell weighted by the share of its area inside the polygon, the polygon split at ±180 into lobes, one griddap request per lobe | `app/src/lib/gridMask.ts` `gridMask()`, `app/src/lib/gazetteer.ts` `placeLobes()`, `App.svelte` `run()` lobe loop (~L596) | indicators Place view | [ ] week 3 |
| 3 | DuckDB-WASM computes the daily statistics of the window: n, area-weighted mean, mean, sd, min, max, p10, p90 | `sql/stats_daily.sql`, `app/src/lib/engine.ts` `runTemplate()`, `App.svelte` `run()` (~L684) | indicators Place view | [ ] week 3 |
| 4 | A categorical grid (Seascapes `CLASS`, CRW `CRW_BAA`) gives the area-weighted fraction of each class per day, drawn as a stacked area in the class colours | `sql/stats_categorical.sql`, `app/src/lib/palette.ts` `classColors()`, `App.svelte` `chart()` (~L793) | indicators Place view | [ ] week 3 |
| 5 | A tabledap dataset (CalCOFI) is asked for the place bbox and the window, its stations are masked by point-in-polygon, and the result is a monthly roll-up with `n_casts`; the map draws the stations as circles | `app/src/lib/erddap.ts` `tabledapUrl()`, `gridMask.ts` `pointMask()`, `sql/stats_tabledap.sql`, `sql/points_tabledap.sql` | indicators Place view | [ ] week 3 |
| 6 | The window: by default the last 30 days to the dataset's last step (at least 8 steps for a coarse grid, five years for tabledap); a live daily window is capped at 90 days, a monthly grid may run its whole record; a window outside the extent snaps back and says so | `App.svelte` `WIN` / `MONTHLY_WIN` / `TABLE_WIN` (L43-58), `app/src/lib/extent.ts` `defaultWindow()` / `clampWindow()`, `app/src/lib/precomputed.ts` `capStart()` | indicators Map: the period window (`viewer/src/lib/map/timeWindow.ts`, `map/TimeScrubber.svelte`) | [ ] week 3 |
| 7 | The time extent comes from ERDDAP's info table, not the catalog ("data through 6 Oct 2026" in the picker and the footer); runs may start 2.5 s after a dataset pick without it | `extent.ts` `fetchTimeExtent()`, `App.svelte` `loadExtent()`, `EXTENT_GATE_MS` | indicators Place view | [ ] week 3 |
| 8 | Every ERDDAP request has a per-attempt timeout and one retry, and a failure names the host ("pae-paha.pacioos.hawaii.edu did not answer …") | `app/src/lib/fetchRetry.ts` `fetchRetry()`, `mapFailMessage()` | indicators Place view | [ ] week 3 |
| 9 | A place outside the 18 sanctuaries reads its polygon when it runs, with the bytes in the status line; a Marine Regions place reads one feature from the VLIZ WFS | `gazetteer.ts` `placeGeometry()`, `polygonStatus()`, `App.svelte` `run()` (~L567) | indicators Place view | [ ] week 3 |
| 10 | The footer line: the data release ("… · ERDDAP 2.29 · data through …"), then "updating… <step>" while busy or "30 rows · 159 kB · 2.3 s (mask 0.19 s)" when done | `app/src/lib/chrome.svelte.ts`, `App.svelte` chrome effects (L428-440), `app/src/Shell.svelte` `Footer` | indicators Place view | [ ] week 3 |
| 11 | A link that names a dataset or variable the app cannot show raises a notice saying what it shows instead; a dataset is found by its collection id, its id without `erddap/`, or ERDDAP's dataset id, ignoring case | `app/src/lib/catalog.ts` `resolveDataset()`, `linkMismatch()`, `App.svelte` (L367-370) | indicators Place view | [ ] week 3 |

## Precomputed strip

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 12 | A (dataset, variable, sanctuary) listed in `stats/collection.json` reads its whole precomputed Parquet from S3 (no DuckDB); an unlisted one costs no request | `precomputed.ts` `precomputedIndex()`, `hasPrecomputed()`, `loadPrecomputed()`, `App.svelte` `run()` (L509-540) | indicators Place view | [ ] week 3 |
| 13 | Strip vs window: the strip draws the whole file (the full record) and the window is a brush inside it; the table, the downloads and the sentence use only the rows inside the window; a brushed window keeps its span (decades) and reuses the file in memory | `precomputed.ts` `inWindow()`, `App.svelte` `plotRows`, `ctx`, `preMem` | indicators Place view | [ ] week 3 |
| 14 | The strip note says what loaded: "precomputed to 6 Oct 2026 · map: live 8 Oct 2026" (compact below 1500 px), with the as-of date in its title | `precomputed.ts` `sourceLabel()`, `App.svelte` strip `actions` (~L1008) | indicators Place view | [ ] week 3 |
| 15 | A window before the file, an empty or missing file, a tabledap target or a slow host takes the full live path instead | `precomputed.ts` `planRun()`, `usePrecomputed()`, `App.svelte` `run()` (L541-548) | indicators Place view | [ ] week 3 |

## The slice (the last step under the places)

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 16 | After a run the map draws the last time step of the window as one square per masked cell (continuous: viridis on the cells' range; categorical: the class colours), below the selected place's outline | `app/src/lib/cells.ts` `cellSquares()`, `sql/last_step.sql`, `App.svelte` `fillColor`, `app/src/lib/MapView.svelte` `cells` layer | indicators Map: `layer=grid:<dataset>:<var>` (`viewer/src/lib/map/gridKind.ts`, `map/gridLayer.ts`) | [x] 2026-10-23: indicators shots `docs/shots/map_layer_sst_*`, `map_compare_sst_*`; `viewer/src/lib/map/gridLayer.test.ts` |
| 17 | Hovering a cell shows its value with the unit (or its class label), its area weight and its lat, lon | `MapView.svelte` `cellPopup` | indicators Map: `map/gridLayer.ts` | [x] 2026-10-23: the cell under the pointer (a tap at 390) in a box beside it and a "Cell:" legend line: value with its unit, the period, the centre, the share inside on a boundary cell; `viewer/src/lib/map/gridLayerWk2.test.ts` ("the cell readout"), `gridKind.test.ts` (`cellAt`), map 0.3.0 `grid.test.ts` (`cellLocator`); shots `map_wk2_hover_layer_cinms_oceanmetrics_light`, `map_wk2_hover_cinms_oceanmetrics_{light,dark}[_390]` (indicators branch `wk2-rows`). A categorical grid is still drawn on a ramp on the Map, so its readout gives the class value, not its label |
| 18 | On a precomputed place the map's one live request is the slice `[(t):1:(t)]`, `t` the window's last day clamped to the dataset's last step; the grid axes come from the provenance JSON | `erddap.ts` `griddapSliceUrl()`, `precomputed.ts` `lobeAxes()`, `App.svelte` `sliceAt` (~L563) | indicators Map: `map/gridSource.ts`, `map/gridLayer.ts` | [ ] week 2 |
| 19 | The second line of the sentence is the map's legend: the colour bar with its domain (or the class legend) and "map: 6 Oct 2026 · 462 cells · 278 on the boundary" | `App.svelte` `Sentence` `sub` snippet (L943-955) | indicators Map: `map/MapLegend.svelte` | [x] 2026-10-23: "Cells: 101,923 sliced in 14 places (9,163 on a boundary) · with data: 100,982 at 2024-07", "Cells per place" (a table per place), the places not sliced named; `gridLayerWk2.test.ts` ("the cells sliced"), `gridKind.test.ts` (`perPlace`, `counts`); shots `map_wk2_hover_*`, `map_wk2_retried_oceanmetrics_light` (indicators branch `wk2-rows`) |
| 20 | When the slice fails the series stays, the note reads "map: unavailable" beside a *retry map* button, and the toast names the host | `App.svelte` `shownSource.failed` (~L1012), `fetchRetry.ts` `mapFailMessage()` | indicators Map: `map/gridLayer.ts` | [x] 2026-10-23: every slice request patient (`patientFetch`, the places page's), the legend "no data: erddap.oceanmetrics.io answered HTTP 404 Not Found" with a Retry that asks for that slice again; the places keep their fill; `gridLayerWk2.test.ts` (patientFetch, problemText), `gridKind.test.ts` ("Retry asks again"), map 0.3.0 `grid.test.ts` (`retry`); shots `map_wk2_retry_oceanmetrics_{light,dark}[_390]` (every slab answered 404 by the harness; IMERG precipitation, the mirror had dropped MUR), `map_wk2_retried_oceanmetrics_light` (Retry, then the slice) (indicators branch `wk2-rows`) |
| 21 | Cells and the map fit are antimeridian-safe: a cell set over 180° wide is drawn in the 0..360 frame (PMNM) | `cells.ts` `cellSquares()`, `placeMapBounds()`, `indexBounds()` | indicators Map: `map/bounds.ts`, `map/gridLayer.ts` | [ ] week 2 |

## Globe (Statistics) and Mercator (Then vs Now)

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 22 | The Statistics map is a globe (MapLibre 5 `projection: globe`); there is no flat choice | `MapView.svelte` `style` (L103) | indicators Map: `proj=globe` (`map/frame.ts` `projectionSpec()`, `map/MapFrameControls.svelte`) | [x] 2026-10-23: `proj=globe` and the Flat / Globe buttons; shots `map_globe_political_oceanmetrics_{light,dark_390}`, `map_globe_political_mbon_dark`, `map_globe_nerrs_oceanmetrics_light`, `map_globe_sst_oceanmetrics_dark`, `map_compare_sst_cinms_globe_oceanmetrics_dark`; `map/frame.test.ts` (`projectionSpec`). Indicators offers the flat map too (the default) |
| 23 | Then vs Now is two Mercator maps in one box with their cameras kept in step | `app/src/lib/thenNow/SwipeMap.svelte`, `app/src/lib/thenNow/swipe.ts` `syncMaps()` | indicators Map: compare mode on one map, flat or globe (`map/frame.ts`) | [x] 2026-10-23: one map, two layer groups (a scissor pair around the second slot); shots `map_compare_sst_cinms_oceanmetrics_light`, `map_compare_sst_cinms_globe_oceanmetrics_dark`; `map/compare.test.ts` (scissor box) |
| 24 | Picking a place fits its bbox, padded so the Controls pane and the Time strip do not cover it; an east-of-180 box (PMNM) fits as it is | `app/src/lib/view.ts` `fitPadding()`, `MapView.svelte` `bind:bounds`, `onload()` refit | indicators Map: `map/bounds.ts` | [ ] week 2 |
| 25 | The 18 sanctuaries are drawn faint and outlined, and a click selects one; the selected place is filled with a 2.5 px outline; a place of another collection adds that collection's PMTiles, whose features are clickable too | `MapView.svelte` `places` source, `extra` source (L217-273) | indicators Map: `map/MapCanvas.svelte`, `map/selection.ts` | [ ] week 2 |
| 26 | The basemap is Esri World Ocean Base (light) or Esri Dark Gray (dark), flipped in place by the theme; zoom buttons top right, scale bottom left | `MapView.svelte` `basemapStyle()`, `setBasemap()`, `NavigationControl`, `ScaleControl` | indicators Map: `map/basemapTiles.ts` (CARTO) | [ ] week 2 |
| 27 | The map's credit names only the gazetteers of the places on screen, plus a short Esri line with the full list on hover | `MapView.svelte` `creditPlaces()`, `gazetteer.ts` `placesAttribution()` | indicators Map: `map/credit.ts` | [ ] week 2 |

## Then vs Now

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 28 | The swipe: Then on the left, Now on the right, a handle to drag (or ←/→ by 5 % when it has focus), a caption on each side; the position is `swipe=` | `SwipeMap.svelte` slider (L131-170), `swipe.ts` `clipFor()` | indicators Map: compare swipe between the slice at `t` and at `t2` | [x] 2026-10-23: shots `map_compare_sst_*` (handle, both captions; `swipe=0.35` in the globe shot); `map/compare.test.ts` (handle keys, geometry), `hash.test.ts` (`swipe=`) |
| 29 | Then and Now share one colour domain: the min and max of both rasters | `app/src/lib/thenNow/scale.ts` `sharedDomain()`, `ThenNow.svelte` `domain` | indicators Map: compare mode, one legend naming both periods (`map/MapLegend.svelte`) | [x] 2026-10-23: the union of both slices' ranges; `map/gridKind.test.ts` (one scale, back to its own when compare is off); legend "one colour scale over both periods" in `map_compare_sst_*` |
| 30 | Palettes: Spectral reversed (red = warm, the default) or viridis, under *More options* (`pal=`) | `scale.ts` `paletteStops()`, `ThenNow.svelte` `methodPanel` | indicators Map: the layer's ramp (`map/paint.ts`) | [x] 2026-10-23: a Palette select over the map package's ramps, each also reversed (Spectral reversed = red warm, viridis among them), the legend's ramp with it; the default is the layer's (thermal for SST), not Spectral; `gridLayerWk2.test.ts` ("the palette"), `gridKind.test.ts` (`setRamp`), map 0.3.0 `grid.test.ts` (`setRamp`); shots `map_wk2_palette_cinms_oceanmetrics_{light,dark}[_390]` (indicators branch `wk2-rows`) |
| 31 | The anomaly (`anom=1`): one map of Now − Then per pixel on a diverging RdBu scale symmetric about 0 (at least ±0.5), the swipe hidden, the legend "Now − Then (°C)" | `app/src/lib/thenNow/cog.ts` `diffBands()`, `scale.ts` `anomalyDomain()`, `RDBU_11`, `ThenNow.svelte` `leftImg` | indicators Map: `anom=1`, `t2 − t` per cell on a diverging ramp | [x] 2026-10-23: `t2 − t` in the engine's SQL, `balance` ramp symmetric about 0 (no ±0.5 floor: the unit is the layer's), swipe hidden; `map/gridAnomaly.test.ts`, `map/gridKind.test.ts`, shot `map_compare_sst_cinms_anom_oceanmetrics_dark` |
| 32 | Then is the 1985–2005 or 2003–2012 climatology, or any custom year range averaged in the browser (empty archive years skipped, and said) | `app/src/lib/thenNow/state.ts` `BASELINES`, `thenNow/data.ts` `thenSources()`, `cog.ts` `meanBands()`, `ThenNow.svelte` `pickThen()` | indicators Map: compare, the period `t` | [x] 2026-10-23: `t2=2003-2012` (any `y0-y1`, the two baselines offered): the mean per cell of the range's periods at the month of `t`, one slice each through `sliceCache`, averaged in DuckDB; years outside the record and failed periods left out and said, at most 12 periods (said); "Then: mean of 2003-07..2012-07 (10 periods)"; `compareRange.test.ts`, `gridAnomaly.test.ts` (`meanRows`), `gridKind.test.ts` ("the year range Then"), `hash.test.ts`; shots `map_wk2_range_cinms_oceanmetrics_{light,dark}[_390]`, `map_wk2_range_cinms_anom_oceanmetrics_dark` (IMERG precipitation in January, "Then: mean of 2003-01..2012-01 (10 periods)") (indicators branch `wk2-rows`) |
| 33 | Now is the latest archived year or any year; empty years are greyed "(no data)"; `latest` walks back past an empty year, and a day past the end of a partial year falls back to the year before | `ThenNow.svelte` `nowOptions`, `loadView()` (L241-260), `data.ts` `emptyYears()` | indicators Map: compare, the period `t2` | [ ] week 2 |
| 34 | The day of year (`md`): a slider, a sentence chip, ◀ / ▶ / ▶\| in the strip (▶ plays a day every 0.7 s), a brush on the chart, ← / → keys; 29 Feb falls back to 28 Feb in a non-leap year | `app/src/lib/thenNow/doy.ts` `mdToBand()`, `stepMd()`, `ThenNow.svelte` `dayPanel`, `onbrushend()`, `playing` | indicators Map: not needed (t and t2 are periods of the layer's grain) | [ ] week 2 |
| 35 | The exceedance: the share of the sanctuary more than +1 °C above Then, with pixel and km² counts, boundary pixels by their share; the headline "76 % of the sanctuary more than +1 °C warmer" waits for the sanctuary mask | `scale.ts` `exceedance()`, `ThenNow.svelte` `loadMask()`, `headline`, `app/src/lib/sentence.ts` `exceedanceLine()` | indicators Place view | [ ] week 3 |
| 36 | The exceedance pill on the right edge ("Exceedance · 76 % > +1 °C"), folded by default (`show=exceedance` opens it), with a "Show the anomaly map" toggle | `ThenNow.svelte` `Pane` `tn-exceedance` (L669-682) | indicators Place view | [ ] week 3 |
| 37 | The hover readout under the cursor: lat, lon · Then · Now · Now − Then | `cog.ts` `valueAt()`, `ThenNow.svelte` `readout` | indicators Map: compare mode | [x] 2026-10-23: in the compare mode the readout gives both periods and the difference `t2 − t` (Then − Now, the Map's anomaly sign) and the centre, the anomaly too; `gridLayerWk2.test.ts` ("compare: both periods and the difference"); shots `map_wk2_hover_cinms_oceanmetrics_{light,dark}[_390]`, `map_wk2_hover_cinms_anom_oceanmetrics_dark` (indicators branch `wk2-rows`) |
| 38 | Rasters are 366-band COGs read one band at a time over range requests (FKNMS first view 6 requests, 56 kB) and memoised; the footer gives the requests, kB and ms of the view ("from cache" when nothing was fetched) | `cog.ts` `CogReader`, `ThenNow.svelte` `footer` / `timing` | indicators Map: compare mode (`map/gridSource.ts`) | [ ] week 2 |
| 39 | The day-of-year chart in the Time strip: every year faint, Then years blue, Now red, the year before orange, the Then mean dashed, the day marked; *Smoothing (days, chart)* 1–31 | `app/src/lib/thenNow/series.ts` `seriesSql()`, `ThenNow.svelte` `doyChart()` | indicators Place view | [ ] week 3 |
| 40 | *anomaly series* switches the strip to the Now year's anomaly (red above 0, blue below) | `ThenNow.svelte` `anomChart()`, `stripMode` | indicators Place view | [ ] week 3 |
| 41 | Then vs Now Share: Download CSV of the series, PNG of the view (the swipe clip kept, or the anomaly), Copy link, Copy citation (CoralTemp rasters) | `ThenNow.svelte` `saveCsv()`, `savePng()`, `cite`, `sharePanel` | indicators Place view | [ ] week 3 |

## Reproduce

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 42 | Share → *Reproduce: requests, mask, SQL and timing* (closed): every request with its kB and seconds (griddap or tabledap, the polygon, the precomputed Parquet, its provenance, the slice) | `App.svelte` `reproduce` (L279-304), `sharePanel` (L902-922) | indicators Place view | [ ] week 3 |
| 43 | Reproduce gives the mask summary: cells, lobes, total area weight, partial (boundary) cells (or stations for tabledap) | `App.svelte` `maskInfo`, `sharePanel` | indicators Place view | [ ] week 3 |
| 44 | Reproduce shows the rendered SQL of the statistics and of the map layer, and *Copy all* copies the whole block with the permalink | `App.svelte` `sql`, `mapSql`, `copy(reproduce)` | indicators Place view | [ ] week 3 |
| 45 | Then vs Now Reproduce: the Now raster URL and band, the Then climatology (or the years averaged), the series URL, the series SQL, the request cost | `ThenNow.svelte` `reproduce` (L485-492) | indicators Place view | [ ] week 3 |
| 46 | *Cite this data*: the dataset's citation (producer, title, ERDDAP page, access date, licence, DOI), the place collection's, the gazetteer's and the app's with the view link, with Copy citation | `app/src/lib/help/cite.ts` `citeText()`, `App.svelte` `cite` | places record page (`/places/p/<id>`) for the place; indicators Place view for the data | [ ] week 3 |

## Time strip: Plot / Table / PNG / ⬇

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 47 | Plot tab: the chosen statistic solid, the other mean dashed, the p10–p90 band, a key in the strip bar; month ticks past 150 days | `App.svelte` `chart()` (L778-814), strip `actions` | indicators Place view | [ ] week 3 |
| 48 | *Statistic (the Time strip)*: area-weighted mean (default), mean, min, max, p10, p90, sd (`stat=`); the table and the CSV carry all of them | `sentence.ts` `STATS`, `App.svelte` `methodPanel` | indicators Place view | [ ] week 3 |
| 49 | The brush: drag a new window on the strip and it runs; Esc clears a brush; arrows move it, Shift+arrows resize it | `App.svelte` `onbrushend()`, `@marinebon/ui` `TimeStrip` | indicators Map: Period scrubber (`map/TimeScrubber.svelte`, `map/timeWindow.ts` `brushWindow()`, `keyWindow()`) | [ ] week 3 |
| 50 | Table tab: per day, per class or per month, scrolling inside the strip (the date column stays put on a phone); the strip title says "table · 30 days"; `show=table` opens it | `App.svelte` Table snippet (L1034-1078), `tableTitle` | indicators Place view | [ ] week 3 |
| 51 | The ⬇ menu: CSV and Parquet of the rows inside the window; *PNG of plot* (the chart at 900 × 340 px, 2×, under the sentence, over the data stamp, `…_plot.png`) | `App.svelte` `saveCsv()`, `saveParquet()`, `savePlotPng()`, `app/src/lib/png.ts` `svgCanvas()`, `viewPng()` | indicators Place view | [ ] week 3 |
| 52 | Expand fills the stage with the strip; Esc or the button restores it | `@marinebon/ui` `TimeStrip` `expandable`, `app/src/app.css` `.expanded` | indicators Place view | [ ] week 3 |
| 53 | The strip folds to a bar and resizes (90–360 px); `hide=time` starts it folded | `App.svelte` `TimeStrip` `bind:collapsed`, `bind:height` | indicators Place view | [ ] week 3 |
| 54 | Share tab: Download CSV (the one coral button), Parquet, PNG of the view (the map, the sentence above, the dataset and the link below), Copy link, Copy citation; file names `erddap-places_<place>[_<coll>]_<dataset>_<variable>_<from>_<to>.<ext>` | `App.svelte` `sharePanel`, `savePng()`, `app/src/lib/download.ts` `resultFileName()`, `toCsv()`, `png.ts` `grabMap()` | indicators Place view | [ ] week 3 |

## Keyboard

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 55 | `?` starts the tour | `app/src/lib/help/keys.ts` `shortcutFor()`, `Shell.svelte` `onKey()` → `startTour()` | not yet: week 5 (website) | [ ] week 5 |
| 56 | `t` toggles the light and dark theme | `keys.ts`, `Shell.svelte` `onKey()` → `toggleTheme()` | not yet: week 5 (website) | [ ] week 5 |
| 57 | `1`–`4` open the Controls tabs ① Place, ② Dataset & variable, ③ Method, ④ Share (and unfold Controls) | `keys.ts`, `Shell.svelte` `onKey()` → `api.setUi({ tab, controls: true })` | not yet: week 5 (website) | [ ] week 5 |
| 58 | `l` switches lens (Window statistics ↔ Then vs Now), carrying the place over | `keys.ts`, `LensApi.switchLens()` | indicators Map: the Compare Toggle | [x] 2026-10-23: `l` turns the Map's compare mode on and off, the place kept (with no layer it goes to the layer select); Help ▾ → Keyboard shortcuts lists it; `viewer/src/lib/keys.test.ts`, `viewer/scripts/keys.mjs` ("l: compare on", "l again: compare off", "l while typing", "Help ▾ has Keyboard shortcuts") (indicators branch `wk2-rows`) |
| 59 | `←` / `→` step the day of year back or forward, in Then vs Now only, and not when focus is on something that owns its arrows (tabs, sliders, lists, pane titles, the map, the strip, a menu) | `keys.ts` `OWNS_ARROWS`, `LensApi.day()` in `ThenNow.svelte` | indicators Map: the Period scrubber's arrows step `t` (`map/timeWindow.ts` `keyWindow()`) | [ ] week 2 |
| 60 | `Esc` closes the open menu, chip, dialog, welcome card or tour, restores an expanded Time strip, and clears a brush; it is the only key that works while a dialog or the tour is open | `keys.ts` (`escape`), `Shell.svelte` `onKey()` (closes the welcome card; the others close themselves), `TimeStrip` | indicators Map: `map/frame.ts` `escLeaves()` | [ ] week 2 |
| 61 | No shortcut fires while typing (input, textarea, select, contenteditable) or with Ctrl/Alt/Meta held; Help ▾ → *Keyboard* (`?modal=keys`) lists them | `keys.ts` `shortcutFor()`, `SHORTCUTS`, `Shell.svelte` keys modal | not yet: week 5 (website) | [ ] week 5 |

## The tour, the welcome card and Help

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 62 | The tour: a ring and a card over 9 stops (the sentence, ① Place, ② Dataset & variable, ③ Method, the legend line, the Time strip, the Table tab and ⬇ menu or the exceedance pill, ④ Share, Help); Back / Next / Done; ← → PageUp PageDown Home End Esc; it opens the tabs it needs and puts them back when it ends; focus returns; no animation under `prefers-reduced-motion` | `app/src/lib/help/tour.ts` `TOUR_STOPS`, `tourKey()`, `cardPosition()`, `help/Tour.svelte`, `Shell.svelte` `tourStepped()` / `tourClosed()` | not yet: week 5 (website) | [ ] week 5 |
| 63 | The tour starts from Help ▾ → *Take the tour*, the `?` key, `?tour=on`, or the welcome card; `?tour=off` suppresses the card and the tour (screenshots) | `help/start.ts` `parseHelpQuery()`, `onLoad()`, `Shell.svelte` | not yet: week 5 (website) | [ ] week 5 |
| 64 | The welcome card ("Start here") on a first visit (localStorage `erddap-places-welcome`) and from Help ▾: two doors (FKNMS SST this month; Then vs Now this day) and three worked questions, each opening in place | `help/Welcome.svelte`, `start.ts` `doors()`, `QUESTIONS`, `Shell.svelte` `openStart()` | not yet: week 5 (website) | [ ] week 5 |
| 65 | Help ▾: Guide ↗, About (with the freeze line and the view's citation), Data sources and attribution (one row per ERDDAP collection from the STAC, the place collection, the gazetteers, the rasters, Esri, the software), Keyboard, Register a product, Source code ↗; `?modal=about\|sources\|keys` opens one | `Shell.svelte` `help` snippet and `Modal`, `app/src/lib/help/sources.ts`, `help/Modal.svelte` | not yet: week 5 (website) | [ ] week 5 |

## Place picker

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 66 | The picker lists the whole gazetteer index, polygons only (10,585 of 14,734 places); the Place tab says "Polygon places only; lines and points are not maskable", and a link to a line or point says so | `app/src/lib/PlacePicker.svelte`, `app/src/lib/placePicker.ts`, `App.svelte` Place tab (L987-992) | indicators: `viewer/src/lib/pick/PlacePicker.svelte` | [ ] week 3 |
| 67 | With no query: a curated order of collections ("National Marine Sanctuaries (precomputed)" first, each row "✓ precomputed"), 50 rows a group then "… N more, type to search", and "show N more collections" for the rest | `placePicker.ts` `defaultView()`, `PlacePicker.svelte` | indicators: `pick/PlacePicker.svelte`, `pick/places.ts` | [ ] week 3 |
| 68 | With a query: the ranked search over every polygon place, one hit per place (copies share a `group_id`, the sanctuary copy wins, "also in N other layers"), grouped by collection with a fair share each and "showing N of M matches" | `placePicker.ts` `searchView()`, `alsoIn()`, `App.svelte` `searchPolygons()` | indicators: `pick/places.ts` | [ ] week 3 |
| 69 | *A–Z \| by group*, and the keys ↑ ↓ PageUp PageDown Enter, Esc clears the query | `PlacePicker.svelte` `onkeydown()`, `azRows()` | indicators: `pick/PlacePicker.svelte` | [ ] week 3 |
| 70 | A selection is (collection, `place_id`): `coll=` is written only for an id in two collections; the Place tab note gives name · id · collection · km² | `gazetteer.ts` `resolvePlace()`, `placeKey()`, `collForHash()`, `App.svelte` (L990) | places record page (`/places/p/<id>`) | [ ] week 3 |
| 71 | The Then vs Now sanctuary picker lists the sanctuaries, with those without rasters disabled (TBNMS) | `ThenNow.svelte` `placeItems`, `data.ts` `placesWith()` | indicators Map: compare mode | [ ] week 2 |
| 72 | Switching lens carries the place (a sanctuary into Then vs Now, except TBNMS; CRW SST for that place back into Statistics) and the pane layout, and pushes a history entry so Back returns | `view.ts` `lensHash()`, `Shell.svelte` `setLens()` | indicators Map: the Compare Toggle keeps the place | [ ] week 2 |

## Permalink grammar

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 73 | Every view is a link: the hash is rewritten with `replaceState` on every successful run, from the run on screen (`shownRun`), never the live pickers | `app/src/lib/permalink.ts` `encodeHash()` / `decodeHash()`, `App.svelte` `viewHash` (L266-277) | indicators: `viewer/src/lib/hash.ts` | [ ] week 2 |
| 74 | `place` (a `place_id`; a space as `+` or `%20`, several colons kept) and `coll` (only for an ambiguous id) | `permalink.ts` `RUN_KEYS` | indicators: `hash.ts` `place`, `coll` | [ ] week 2 |
| 75 | `dataset` (the STAC collection id, `erddap/dhw_5km`) and `variable` (`CRW_SST`) | `permalink.ts`, `catalog.ts` `resolveDataset()` | indicators Map: `layer=grid:<dataset>:<var>` (`map/layerSlot.ts`) | [x] 2026-10-23: `hash.test.ts` ("the layer under the map") |
| 76 | `from` and `to` (YYYY-MM-DD, the window) | `permalink.ts` | indicators Map: `t` and the period window (`map/timeWindow.ts`) | [ ] week 3 |
| 77 | `stat` (`mean_wt` default and left out; `mean`, `min`, `max`, `p10`, `p90`, `sd`) | `App.svelte` `statQ`, `sentence.ts` `isStat()` | indicators Place view: `ind=erddap:<dataset>:<variable>:<stat>` (`mean_wt` -> `mean`, `mean` -> `mean_unw`) | [ ] week 3 |
| 78 | `lens=then-now` (absent = Statistics); the Then vs Now `dataset` (the raster folder, `dhw_5km` left out) and `variable` | `view.ts` `lensOf()`, `thenNow/state.ts` `encodeThenNow()` | indicators Map: compare mode (`t2` present) on `layer=grid:dhw_5km:CRW_SST` | [x] 2026-10-23: `hash.test.ts` ("the compare mode": `layer=grid:jplMURSST41mday:sst&t=2024-07&t2=2016-07` round-trips) |
| 79 | `then` (a baseline or `y0-y1`) and `now` (`latest` or a year) | `state.ts` `decodeThenNow()` | indicators Map: `t` and `t2` | [x] 2026-10-23: one period each, `t` and `t2` (a baseline or a year range is row 32); `hash.test.ts` |
| 80 | `swipe` (0..1, three decimals) | `state.ts` | indicators Map: the compare swipe position | [x] 2026-10-23: `swipe=` on the Map, written on release; `hash.test.ts` |
| 81 | `anom` (`0` / `1`, also `true`) | `state.ts` | indicators Map: `anom=1` | [x] 2026-10-23: `anom=1`, read only with `t2`; `hash.test.ts` |
| 82 | `pal` (`spectral` default and left out, `viridis`) | `state.ts` | indicators Map: the layer's ramp (`map/paint.ts`) | [x] 2026-10-23: `pal=<ramp>[_r]` with a layer (`pal=spectral_r` is this app's Spectral, `pal=viridis`), absent = the layer's default; `hash.test.ts` ("pal is the layer's"), `gridLayerWk2.test.ts` (`palOf`); shots `map_wk2_palette_*` (indicators branch `wk2-rows`) |
| 83 | `md` (MM-DD; an impossible day falls back to the default) | `state.ts` `decodeThenNow()` | indicators Map: not needed (t and t2 are periods of the layer's grain) | [ ] week 2 |
| 84 | `data` (another data root, the dev fixture `/__then-now-fixture/`) | `state.ts`, `vite.config.ts` middleware | not yet: week 6 (retire: a dev key, not carried) | [ ] week 6 |
| 85 | `show` / `hide`: comma lists of the panes that differ from the default (`controls`, `time`, `table` in Statistics, `exceedance` in Then vs Now); the folding of phone sheets is never written | `view.ts` `decodePanes()`, `encodePanes()`, `paneUrlState()` | indicators Place view | [ ] week 3 |
| 86 | The old `mode=then-now` still opens Then vs Now and is rewritten to `lens=then-now` in place; `mode=stats` and `lens=stats` are dropped; every other key is kept | `view.ts` `migrateHash()`, `Shell.svelte` (L31-35, the `hashchange` handler) | redirect map: `redirectFor()` reads `mode=` as `lens=` (`app/src/lib/redirect.ts`) | [ ] week 2 |
| 87 | A pasted link or Back / Forward that changes the lens switches it in place | `Shell.svelte` `hashchange` / `popstate` `$effect` (L57-68) | indicators: `hash.ts` | [ ] week 2 |
| 88 | `?tour=`, `?modal=` and `?theme=` are query switches, never hash keys; `tour` and `modal` are dropped from the address bar once used | `start.ts` `withoutHelpQuery()`, `pageBase()`, `Shell.svelte` (L76-78) | not yet: week 5 (website) | [ ] week 5 |

## Feedback

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 89 | The header's Feedback button opens a dialog with a picture of the view (the map canvases composited in, the swipe clip kept); a capture that takes over 15 s opens the dialog without it | `Shell.svelte` `openFeedback()`, `app/src/lib/feedback/capture.ts` (html-to-image, lazy) | not yet: week 5 (website) | [ ] week 5 |
| 90 | Mark-up on the picture: rectangle, arrow and text, in pink (default), yellow or blue; "include the screenshot" | `feedback/FeedbackDialog.svelte`, `feedback/annotate.ts`, `feedback/colors.ts` | not yet: week 5 (website) | [ ] week 5 |
| 91 | A note, an optional email ("not published": the Sheet and the mail only, never the issue), and "include a link to this view" (on by default; unticked, no `url` key) | `FeedbackDialog.svelte`, `feedback/payload.ts` | not yet: week 5 (website) | [ ] week 5 |
| 92 | Send, the one primary button: it posts to the shared Apps Script when `VITE_FEEDBACK_URL` is set (a Sheet row, a mail, a GitHub issue); only the JSON receipt `{ok:true}` reads "Sent", a `skipped` receipt or an HTML page is a failure | `feedback/postFeedback.ts`, `feedback/endpoint.ts`, `scripts/feedback/Code.gs` | not yet: week 5 (website) | [ ] week 5 |
| 93 | Without an endpoint, or after a failed send, a one-line notice carries "open a GitHub issue": a prefilled issue under 7,500 characters, the picture copied to the clipboard | `feedback/issue.ts` `issueUrl()`, `FeedbackDialog.svelte` | not yet: week 5 (website) | [ ] week 5 |
| 94 | Help ▾ → *Register a product*: the same dialog asking "what did you build?" | `Shell.svelte` `openFeedback('product')`, `feedback/issue.ts` | not yet: week 5 (website) | [ ] week 5 |

## Full screen

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 95 | The map's full-screen button takes the whole lens (the sentence bar, the legend, the panes, the Time strip) on the page background, in both lenses; Esc leaves | `MapView.svelte` `onload()` `FullscreenControl({ container: .lens })`, `SwipeMap.svelte` (L77), `app.css` `.lens:fullscreen` | indicators Map: full screen (`map/frame.ts` `enterFull()`, `exitFull()`, native or expanded; `map/MapFrameControls.svelte`) | [x] 2026-10-23: the map, its credit and the side column (legend, selected place) full screen, native or expanded (no API), Esc leaves; shots `map_full_political_oceanmetrics_light`, `map_full_political_mbon_dark`, `map_full_globe_oceanmetrics_dark`, `map_full_expanded_{oceanmetrics_light,mbon_dark}_390`; `map/frame.test.ts`; `viewer/scripts/keys.mjs` (full screen, Esc) |

## Both themes at 390 px

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 96 | Light and dark themes (the header toggle, `t`, `?theme=`): semantic tokens only, the basemap swaps, the chart ink and line colours and the outline follow | `chrome.svelte.ts` `theme`, `App.svelte` `ink` / `main` / `alt`, `ThenNow.svelte` `ink`, `SwipeMap.svelte` theme `$effect` | indicators: both themes (`docs/shots/*_light*.png`, `*_dark*.png`) | [x] 2026-10-23: shots `map_compare_sst_oceanmetrics_{light,dark}` and the `_390` pair |
| 97 | At 390 px (below 640 px) the panes are bottom sheets that start as bars so the map shows, the fit keeps small margins, the Feedback word hides, and the freeze banner is a tight band | `view.ts` `initialPanes()`, `SHEET_BELOW`, `fitPadding()`, `Shell.svelte` styles | indicators: 390 px shots (`docs/shots/*_390.png`) | [x] 2026-10-23: shots `map_compare_sst_oceanmetrics_{light,dark}_390` (no page overflow) |
| 98 | The panes remember their position per viewport class (the kit, localStorage) | `@marinebon/ui` `Controls` / `Pane` | indicators Place view | [ ] week 3 |

## The page frame

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 99 | The title sentence, dataset → place → method → time ("Sea surface temperature (NOAA Coral Reef Watch, 5 km, daily) in Florida Keys NMS, area-weighted mean of 462 cells, 7 Sep – 6 Oct 2026"); each bold part is a chip with the same picker as the Controls tab | `sentence.ts`, `App.svelte` `Sentence` (L927-957), `ThenNow.svelte` `Sentence` (L592-632) | indicators Place view | [ ] week 3 |
| 100 | The Controls pane, full height, four tabs ① Place ② Dataset & variable (grouped by cadence, pending datasets disabled, the variable in words) ③ Method (the lens switch first) ④ Share | `App.svelte` `Controls` (L983-1002), `datasetItems`, `ThenNow.svelte` `Controls` | indicators Map: the layer choice (`map/gridLayer.ts` `layerChoices()`) | [ ] week 2 |
| 101 | Errors are a dismissible notice over the map | `App.svelte` toast (L977-981), `ThenNow.svelte` toast | indicators Map | [ ] week 2 |

## The freeze banner and the redirect map (written, not active)

| # | behaviour | erddap-places (file) | target | status |
|---|---|---|---|---|
| 102 | The freeze banner opens the page: "ERDDAP Places is frozen. Its statistics move to Ocean Metrics Indicators in build week 2 (2026-11-06 to 11-12), when this address redirects." with "Open this view in Indicators ↗"; dismissed for the session (sessionStorage `om-freeze-dismissed`) | `app/src/lib/freeze.ts`, `Shell.svelte` (L36-41, L198-202) | replaced by the redirect once Ben activates it | [ ] week 2 |
| 103 | The banner's link follows the view on screen: each lens mirrors its hash into `chrome.hash`, and the link is `redirectFor(chrome.hash).url` | `chrome.svelte.ts` `chrome.hash`, `Shell.svelte` `indicatorsHref` | replaced by the redirect once Ben activates it | [ ] week 2 |
| 104 | About carries the freeze line ("Frozen since 2026-10-22 … bug fixes only") | `freeze.ts` `FREEZE_ABOUT`, `Shell.svelte` About | not yet: week 6 (retire) | [ ] week 6 |
| 105 | Redirect rule, Statistics: `place`, `coll`, `dataset`, `variable`, `stat` -> the Indicators Place view `#view=place&place=…&coll=…&ind=erddap:<dataset>:<variable>:<stat>`; `from`/`to` dropped with a note; `show`/`hide` dropped | `app/src/lib/redirect.ts` `redirectFor()`, `STAT_MAP`, `docs/redirects.md` | indicators Place view (`viewer/src/lib/hash.ts` `view=place`) | [ ] week 2 |
| 106 | Redirect rule, Then vs Now: today the same Place view for `dhw_5km` and `mean`, `exact: false`, note "the slice arrives in build week 2"; once compare lands it can name the Map (`view=map&layer=grid:dhw_5km:CRW_SST&t=…&t2=…&anom=…`) | `redirect.ts` `NOTE_THEN_NOW`, `docs/redirects.md` | indicators Map: compare mode | [x] 2026-10-23: `redirectFor` names the Map's compare link `view=map&ind=…&place=…&grain=month&layer=grid:dhw_5km:<var>&pal=…&t=<now>-<MM>&t2=<then>&swipe=|anom=1`, `exact: false` with its notes (a month, not a day; the latest; 12 periods; the anomaly's sign); still not active; `app/src/lib/redirect.test.ts` ("Then vs Now -> the Map's compare link"), `docs/redirects.md` (erddap-places `fa4e9b5`) |
| 107 | Redirect rule, no place: the Indicators matrix (`/indicators/`) with the note "this link names no place" | `redirect.ts` `NOTE_NO_PLACE` | indicators Matrix | [ ] week 2 |
| 108 | Nothing is activated: no 404 page, no JavaScript redirect, no DNS change; Ben activates it after this checklist passes | `docs/redirects.md` "To activate" | the redirect, activated by Ben | [ ] week 2 |

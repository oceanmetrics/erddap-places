# Then vs Now (`#lens=then-now`)

A serverless rebuild of the *Sanctuaries Climate Change* Shiny app
([shiny.marinebon.app/nms-cc](https://shiny.marinebon.app/nms-cc), source
`noaa-onms/climate-dashboard-app/app/{ui,server,functions,global}.R`) as a second view of this app.
Open it with `#lens=then-now`, or *Then vs Now* in the Controls pane's ③ Method tab (the older
`#mode=then-now` links still work: the page rewrites them to `lens=`).

## From the Shiny controls to these

| Shiny (`ui.R` / `server.R`) | here | notes |
|---|---|---|
| `sel_nms` Sanctuary | **sanctuary** picker | names from `places/places.parquet` (4 columns read by range request); a sanctuary without rasters in the `rasters` collection is listed greyed out |
| `sel_var` Variable | **variable** | the variables the `rasters` collection lists for the dataset (CRW_SST today) |
| `sel_palette` (Spectral, viridis, …) | **palette** (Spectral reversed, viridis) | |
| `sld_md` month-day slider (animated) | **month-day** slider + ← → one day | 366 days, 29 Feb included; the slider loads on release |
| `sld_yrs_then` Then years (default first 20) | **Then**: `1985–2005` / `2003–2012` climatology, or **custom years** | a preset is one file read; a custom range averages the year files in the browser |
| `sld_yrs_now` Now years | **Now**: `latest` or a year | the Shiny range-of-Now is a single year here |
| Leaflet `addSidebyside` | **swipe** (two synced MapLibre maps, clip-path) | the slider position is in the URL |
| legends "Then / 05 Aug, 1985 to 2005", "Now / 05 Aug 2025" + one colour legend | same text, one shared colour bar | domain = min/max of both rasters, as `colorNumeric(c(values(now), values(then)))` |
| — | **anomaly** toggle: Now − Then per pixel, RdBu centred on 0 | plus pixels and km² above +1 °C inside the sanctuary |
| — | **hover readout**: Then, Now, Now − Then under the cursor | |
| Plotly day-of-year plot (`plot_doy`), `sld_days_smooth` | Observable Plot day-of-year chart + **smoothing** slider | every year grey, the Then years blue, the Then mean dashed, the Now year red, the chosen day a vertical rule |
| — | **anomaly series**: the Now year's daily mean minus the Then mean for that day | |
| dark mode switch | — | not carried over |

## What improved

- **No server.** The Shiny app needs R, `terra` and a share with every year's GeoTIFF on the
  server; here the browser reads one band per file from S3 by HTTP range requests, and the series
  from one Parquet file with DuckDB-WASM.
- **Any date.** 366 bands per year on a leap-year calendar, so 29 Feb is a real choice (it falls back
  to 28 Feb in a non-leap Now year, and says so).
- **Custom baselines.** Any year range, averaged per pixel in the browser (N range reads, memoised);
  the two published climatologies are a single read.
- **Anomaly map** with the area above +1 °C, masked to the sanctuary polygon with the statistics
  mode's own `gridMask()` (boundary pixels by their share).
- **Permalinks.** Every pick is in the hash:
  `#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=1985-2005&now=latest&swipe=0.5&anom=0`
  (`pal=viridis` and `data=<root>` only when not the default).
- **Costs are shown.** The footer prints the range requests, bytes and milliseconds of the view and
  of the series.

## How it works

- **Data** (built by `catalog/build_then_now.py`, published under the gazetteer; see the data
  contract in [`../AGENTS.md`](../AGENTS.md)): `rasters/<dataset>/<variable>/<place_id>/<year>.tif`,
  `climatology/<dataset>/<variable>/<place_id>/<y0>-<y1>_mean.tif`,
  `series/<dataset>/<variable>/<place_id>.parquet`. The place id's colon is sent as `%3A`
  (S3 maps it back to the key).
- **Band reads** (`src/lib/thenNow/cog.ts`): geotiff.js 3 on a counting `fetch` client with 8 kB
  blocks (consecutive blocks merge into one range request). A band is one tile (INTERLEAVE=BAND).
  The published files carry a ~147 kB header (IFD + band descriptions + STATISTICS_*), but geotiff
  only reads the tags it needs, so opening a file costs 2 requests / 24 kB, not 147 kB: measured
  against S3 from Node, 8 kB blocks give 3 requests / 32 kB for the first band of a file and
  1 request / 8 kB per further band; 64 kB blocks 192 kB, 192 kB blocks 384 kB for the same read.
  Headers and bands are memoised, so a revisited day costs nothing. Reads are shared between views
  and therefore take no per-view AbortSignal (an aborted shared read left geotiff's promise unsettled
  and hung the next view; fixed 2026-10-08).
- **Year validity**: `erddap-places:n_days_valid: 0` marks the all-NaN place-years of the archive
  (MBNMS 2015; MNMS 1991/1999/2015; NMSAS 1991; OCNMS 1999; SBNMS 2005/2010/2019). It is only in the
  per-year Items, so the place's ~42 Items (3 kB each) are read once per place; the Now picker greys
  those years (`latest` walks back past one, a picked one is refused with a message) and a custom
  Then skips them and says so.
## Measured against S3 (2026-10-08, headless Chrome on the dev server, bucket in us-east-1)

| view (FKNMS unless noted) | band reads | other | page load → map + chart |
|---|---|---|---|
| default: 05 Aug, Then 1985–2005 climatology, Now latest (2026) | 6 range requests, 56 kB, 0.9–1.1 s | 42 Items 1.1–1.3 s; series 662 kB parquet 0.9 s + DuckDB 0.4 s | 4.6–6.7 s |
| next day (→) | 2 requests, 16 kB, 0.3 s | — | 0.3 s |
| custom Then 1990–2000 (11 year files averaged) | 36 requests, 368 kB, 1.6 s wall (6.3 s summed) | as default | 5.1 s |
| anomaly on | 6 requests, 56 kB, 0.9 s | as default | 4.6 s |
| MBNMS, custom Then 2010–2020 (2015 empty, skipped) | 33 requests, 328 kB, 1.6 s | series 641 kB | 5.3 s |
| MBNMS, Now = 2015 (empty) | none: refused with "the archive has no CRW_SST … in 2015 (all NaN)" | 2015 greyed in the picker | 3.6 s |

The first-view time is dominated by things other than the rasters: DuckDB-WASM start-up and the
series (≈1.3 s), the Items (≈1.2 s, which the view waits for), the catalog and the sanctuary list.
The sanctuary mask for the > +1 °C count needs the 4 MB `places.parquet` geometry column and arrives
≈7.5 s after load (FKNMS 05 Aug 2026 vs 1985–2005: 334 of 458 pixels, 7,435 of 9,780 km², 76 %);
until then the count is over the raster box and says so. The data URLs go straight to the bucket
with the colon as `%3A`, so the `storage.oceanmetrics.io` 302 is never in the band-read path.

- **Why not `@geomatico/maplibre-cog-protocol`** (0.10): it only reads EPSG:3857 COGs (no
  reprojection; these are EPSG:4326) and colours whole tiles, so it can neither address band *d* of a
  366-band cube nor hand back the numbers the anomaly, the shared colour domain and the readout need.
  Instead each band is coloured into a canvas and drawn as a MapLibre `image` source with
  nearest-neighbour resampling, so the 0.05° pixels stay square.
- **Why not `@maplibre/maplibre-gl-compare`** (0.5): it is CommonJS, needs Node's `events` module and
  a `window.maplibregl` global, none of which survives a Vite ES build without polyfills. Its 60
  lines of behaviour are reimplemented in `swipe.ts` + `SwipeMap.svelte`: two stacked maps, the right
  one clipped with `clip-path: inset(0 0 0 Xpx)`, cameras synced on `move`, a draggable,
  keyboard-operable handle.
- **Series** (`series.ts`): one SQL statement over the series Parquet — the band of each date
  (`dayofyear(make_date(2000, month, day))`), an optional centred moving average per year, the
  Then-years mean per band and each day's anomaly against it.
- **Bundle**: the mode is a lazy chunk (`ThenNow-*.js`, 80 kB, 28 kB gzip) loaded only for
  `#lens=then-now` (formerly `#mode=then-now`); geotiff's DEFLATE decoder (`pako`, 15 kB gzip) loads on first band read. The
  statistics bundle grew by ~6 kB (the mode switch).

## Not done

- **Now live from ERDDAP** (the most recent day, through the existing griddap path, masked to the
  sanctuary): not implemented; Now is the latest year of the archive.
- Animation of the month-day slider (the Shiny `animate = T`), and the dark theme.

## Offline / development

`npm run dev`, then
`http://localhost:5179/#lens=then-now&place=NMS:TEST&data=/__then-now-fixture/` serves the
committed fixture (`src/lib/thenNow/fixtures/`, rebuilt by `node src/lib/thenNow/fixtures/make_fixture.mjs`)
through a dev-only middleware in `vite.config.ts`: Vite's own file serving answers 403 to the colon
in `NMS:TEST`.

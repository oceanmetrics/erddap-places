# Redirect map: erddap-places -> Ocean Metrics Indicators

Written 2026-10-22 (app 0.3.11, the freeze). **Not activated.** erddap-places is frozen (bug fixes only) and its
statistics move to Ocean Metrics Indicators in build week 2 (2026-11-06 to 11-12), when this address redirects.
Until then the only use of the map is the freeze banner's link, "Open this view in Indicators ↗", which shows
what the redirect will do. There is no 404 page, no JavaScript redirect and no DNS change.

The map is one pure function, `redirectFor(hash, origin = 'https://oceanmetrics.io')` in
`app/src/lib/redirect.ts`, tested in `redirect.test.ts` (one test per rule below). It returns
`{ url, exact, note? }`: `exact` is true when the target shows what the old link showed, and `note` says what it
does not carry. It never throws; an empty or unknown hash gives the Indicators matrix.

The target of Statistics is the Indicators **Place view**, `#view=place&place=<id>&coll=<collection>&ind=<indicator>`
(`indicators/viewer/src/lib/hash.ts`), where an erddap-places indicator id is
`erddap:<dataset id>:<variable>:<stat>` (`indicators/config/indicators.yml`). The dataset id is the STAC
collection id without its `erddap/` prefix.

## Statistics (no `lens`, or `lens=stats`)

Old: `#place=NMS:FKNMS&dataset=erddap/dhw_5km&variable=CRW_SST&stat=mean_wt&from=2026-09-21&to=2026-10-20`
New: `https://oceanmetrics.io/indicators/#view=place&place=NMS:FKNMS&ind=erddap:dhw_5km:CRW_SST:mean` (`exact: false`:
the window)

| old key | new | rule |
|---|---|---|
| `place` | `place=<id>` | carried; `:` kept, a space or slash percent-encoded. No place: `/indicators/` (the matrix), `exact: false`, note "this link names no place; Indicators opens on its matrix" |
| `coll` | `coll=<collection>` | carried when given (a place id that exists in two collections) |
| `dataset` | `ind=erddap:<id>:…` | `erddap/` prefix removed; absent -> `dhw_5km` (the app's opening dataset) |
| `variable` | `ind=erddap:<dataset>:<variable>:…` | carried; absent -> `CRW_SST` |
| `stat` | `ind=…:<stat>` | `mean_wt` and absent -> `mean` (the area-weighted mean is Ocean Metrics' record); `mean` -> `mean_unw` (the unweighted mean); `min`, `max`, `p10`, `p90`, `sd` unchanged. An unknown value -> `mean`, `exact: false`, a note naming it |
| `from`, `to` | dropped | `exact: false`, note "the window is not carried; the Place view shows the full record" |
| `show`, `hide` | dropped | pane layout, not data; `exact` unchanged |

## Then vs Now (`lens=then-now`, or the old `mode=then-now`)

Since 2026-10-23 (build week 2: Then vs Now is the Indicators Map's compare mode, two slices of one layer) the rule names
the Map's compare link instead of the Place view. Still written, not activated.

Old: `#lens=then-now&place=NMS:FKNMS&variable=CRW_SST&md=08-05&then=2003-2012&now=2024&swipe=0.35&anom=0`
New: `https://oceanmetrics.io/indicators/#view=map&ind=erddap:dhw_5km:CRW_SST:mean&place=NMS:FKNMS&grain=month&layer=grid:dhw_5km:CRW_SST&pal=spectral_r&t=2024-08&t2=2003-2012&swipe=0.35`,
`exact: false`, note "Then vs Now opens as the Map's compare mode, by month: the day of the year (md) is read as its month"

The keys are written in the order Indicators' `serializeHash` writes them (`indicators/viewer/src/lib/hash.ts`), so the
link is the Map's own permalink. A missing or malformed key takes Then vs Now's default (`decodeThenNow`: `md` 08-05,
`then` 1985-2005, `now` latest, `swipe` 0.5, `pal` spectral).

| old key | new | rule |
|---|---|---|
| `place` | `place=<id>` | carried (the Map selects it); no place: `/indicators/`, and the note also says "this link names no place; Indicators opens on its matrix" |
| `variable` | `ind=erddap:dhw_5km:<variable>:mean`, `layer=grid:dhw_5km:<variable>` | carried; absent -> `CRW_SST`. The dataset is always `dhw_5km` (the only dataset with rasters) |
| `now`, `md` | `t=<year>-<MM of md>`, `grain=month` | Now's month; `now=latest` leaves `t` out (the layer's latest month), note "Now is the layer's latest month, not the month of md" |
| `then` | `t2=<y0-y1>` | a baseline or a custom range: the Map's year-range Then, the mean per cell of that range's months at the month of `t`; more than 12 years adds the note "a Then of more than 12 years is the mean of its first 12 (the Map averages at most 12 periods)" |
| `swipe` | `swipe=` | carried (Then left of the handle in both), the middle left out, dropped with `anom` |
| `anom` | `anom=1` | `1` or `true`; note "the difference reads Then minus Now (the Map's t2 - t), the sign of Now minus Then reversed" |
| `pal` | `pal=spectral_r` / `pal=viridis` | Then vs Now's Spectral is the reversed one (red = warm), `spectral_r` in `@oceanmetrics/map`; always written, so the colours match |
| `data`, `show`, `hide` | dropped | a dev data root and the pane layout |

## The link in the banner

Shell.svelte computes the banner's href as `redirectFor(chrome.hash).url`. `chrome.hash` (`chrome.svelte.ts`) is the
hash on screen: each lens writes it when it writes the permalink with `replaceState` (which fires no event), and the
Shell's existing `hashchange` / `popstate` handler refreshes it for a pasted link or Back. There is no new listener.

## To activate (build week 2)

Not done here. The plan: the page keeps its address, and on load, before the app mounts, a frozen-app redirect calls
`redirectFor(location.hash)` and replaces the location; `exact: false` carries its `note` to the target as a banner.
The banner's `FREEZE_TEXT` ("when this address redirects") is then replaced by the redirect.

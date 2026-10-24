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

## The redirect page (written 2026-10-23, active since 2026-10-24)

GitHub Pages cannot answer a 301 and the hash never reaches a server, so the move is a small JavaScript page. One template
serves both frozen apps (erddap-places and obis-hex); it is **written, shipped at `redirect/redirect.html` and not linked
from anywhere**.

| file | where | what |
|---|---|---|
| `redirect.html`, `redirect.js` | `app/static/redirect/` (this repo is the source) | the template, identical in obis-hex's `public/redirect/` |
| `config.json` | `app/static/redirect/` | this app's `{ app, target, codec }`, plus optional `stay`, `delayMs`, `home` |
| `codec.js` | `app/dist/redirect/`, built by `vite.config.ts` (`redirectCodec`) from `src/lib/redirect.ts` | the app's `redirectFor` as an ES module |

The deployed page is `https://oceanmetrics.io/erddap-places/redirect/redirect.html`. `decide(location, config)` in
`redirect.js` is pure and tested (`src/lib/redirectPage.test.ts`): it strips the page's own `noredirect` switch, hands the
rest of `?query#hash` to `redirectFor`, and answers `{ redirect, reason, url, exact, note, stay, delayMs, message }`. The
page shows "This app moved to Ocean Metrics Indicators; taking you there…", the computed link, the note when `exact` is
false, and a "Stay here" link for 5 s, then `location.replace(url)`. A codec that throws or answers a non-http(s) address
leaves the page in place (or goes to `config.home` when set). `?noredirect=1` on the page shows the same address and does
not navigate. The "Stay here" link is the app with its own link and `?noredirect=1`, so it does not forward again.

**One template, two copies, one checksum.** A shared package (a `packages/status`-like one) is overkill for two files. The
template is written here; `obis-hex/scripts/sync-redirect.mjs` copies `redirect.html` and `redirect.js` into obis-hex's
`public/redirect/`. Both repos' page tests pin the SHA-256 of `redirect.html` + `redirect.js` (the same constant), and
compare the two copies byte for byte when the repos are checked out side by side. To change the template: edit it here,
run the sync script in obis-hex, update the pin in both `redirectPage.test.ts` files, commit both.

## Activation (Ben's go 2026-10-24: ACTIVE since that day; `?noredirect=1` keeps the app for comparing old and new)

Nothing in the build or the Pages workflow serves the template at `/`, and nothing forwards to it. Activation is one line in
`app/index.html`, first thing in `<head>`:

```html
<script>if(!/[?&]noredirect=1/.test(location.search))location.replace('./redirect/redirect.html'+location.search+location.hash)</script>
```

Every old link then lands on the template, which carries it to Ocean Metrics Indicators after the 5 s notice. To check
before the go, open `https://oceanmetrics.io/erddap-places/redirect/redirect.html?noredirect=1#<old hash>`: it shows the
address it would open and does not navigate. The freeze banner's `FREEZE_TEXT` ("when this address redirects") and
`FREEZE_ABOUT` are then dropped with the banner (the page replaces it). Preconditions are build week 2's: the parity
checklist passes and Indicators answers every example above. To undo: remove the line and redeploy.

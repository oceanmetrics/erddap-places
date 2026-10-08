<script lang="ts">
  // the Then vs Now lens (#lens=then-now) — the "Sanctuaries Climate Change" Shiny app (shiny.marinebon.app/nms-cc) without
  // a server: one day of the year, Then (a published climatology or any year range, averaged here)
  // against Now (a year of the archive), as a swipe map with one shared colour scale, an anomaly
  // map, and the day-of-year chart of every year. rasters are 366-band COGs read one band at a time
  // with HTTP range requests (cog.ts); the chart queries the series parquet in DuckDB-WASM.
  import { onMount, untrack } from 'svelte'
  import * as Plot from '@observablehq/plot'
  import { Button, Chip, Controls, Legend, Notice, Pane, Picker, Select, Sentence, Slider, Stat, TimeStrip, Toggle, type BrushRange, type PickerItem } from '@marinebon/ui'
  import PlotBox from '../PlotBox.svelte'
  import { chrome, theme } from '../chrome.svelte'
  import { copyText, download, toCsv } from '../download'
  import { decodePanes, encodePanes, fitPadding, initialPanes, paneUrlState, withExtras, type Lens, type Panes } from '../view'
  import { exceedanceLine, fmtMd, fmtYears, shortPlace, variableWords } from '../sentence'
  import { grabMap, viewPng } from '../png'
  import { GAZETTEER_FALLBACK, loadPlaces, placeLobes, plainPlace, type Place } from '../gazetteer'
  import { gridMask } from '../gridMask'
  import { engine } from '../engine'
  import { Runs, isAbort } from '../runToken'
  import { CogReader, diffBands, latticeAxes, latticeWeights, meanBands, sameLattice, valueAt, type Band } from './cog'
  import { emptyYears, parseRasterCollection, placeItemLinks, placesWith, rasterUrl, seriesUrl, thenSources, type RasterCatalog } from './data'
  import { bandDate, bandToMd, isLeap, mdLabel, mdToBand, stepMd } from './doy'
  import { loadSanctuaries, type LitePlace } from './places'
  import { anomalyDomain, colorize, exceedance, lut, paletteStops, sharedDomain, ticks } from './scale'
  import { seriesSql } from './series'
  import { BASELINES, decodeThenNow, encodeThenNow, isBaseline, parseRange, type ThenNowState } from './state'
  import SwipeMap, { type Img } from './SwipeMap.svelte'
  import { citeText, thenNowCitation } from '../help/cite'
  import { pageBase } from '../help/start'
  import type { LensApi } from '../help/lensApi'

  interface Props {
    setLens?: (to: Lens, carry?: { place?: string; variable?: string; panes?: Panes }) => void
    /** hands the Shell what Help, the tour and the shortcuts may ask of this lens */
    register?: (api: LensApi) => void
  }
  let { setLens, register }: Props = $props()

  const RAW = typeof location === 'undefined' ? '' : location.hash
  const s = $state<ThenNowState>(decodeThenNow(RAW))
  // which panes are open (`show=` / `hide=`); the Exceedance pane starts folded to its pill
  const PANES0 = decodePanes(RAW, 'then-now')
  const VW      = typeof innerWidth === 'number' ? innerWidth : 1280
  const START   = initialPanes(PANES0, VW)
  let controlsFolded = $state(!START.controls)
  let timeFolded     = $state(!START.time)
  let sideFolded     = $state(!START.side)
  const panes = $derived<Panes>({ controls: !controlsFolded, time: !timeFolded, side: !sideFolded })
  let tab = $state('method')
  // the permalink: every pick (and the pane layout) is written straight back into the hash
  const viewHash = $derived.by(() => { const { show, hide } = encodePanes(paneUrlState(panes, PANES0, VW), 'then-now'); return withExtras(encodeThenNow({ ...s }), { show, hide }) })
  $effect(() => { const h = viewHash; if (typeof history !== 'undefined' && h !== location.hash) history.replaceState(null, '', location.pathname + location.search + h) })

  // data root: the bucket URL itself, not the storage.oceanmetrics.io redirect, which would add a
  // 302 round trip to every range request
  const root = $derived(s.data || GAZETTEER_FALLBACK)
  const reader = new CogReader()
  const runs = new Runs()

  let catalog   = $state.raw<RasterCatalog | null>(null)
  let catNote   = $state('')
  let catDone   = $state(false)                  // the catalog attempt is over (found or not)
  let places    = $state.raw<LitePlace[]>([])
  let years     = $state.raw<[number, number] | null>(null)
  let status    = $state('loading the catalog…')
  let error     = $state('')
  let busy      = $state(false)

  // the view: both bands, the anomaly, the images and the numbers behind them (raw: big arrays)
  let thenB     = $state.raw<{ data: Float32Array; lattice: Band; years: number[]; n: number } | null>(null)
  let nowB      = $state.raw<{ data: Float32Array; lattice: Band; year: number; md: string } | null>(null)
  let anom      = $state.raw<Float32Array | null>(null)
  let note      = $state('')
  let footer    = $state('')                     // the full cost line (Share → Reproduce)
  let timing    = $state('')                     // the short one (the page footer)
  let hover     = $state.raw<{ lng: number; lat: number } | null>(null)
  let mdLive    = $state(s.md)                     // the slider's label while dragging
  let smooth    = $state(7)                        // days in the chart's moving average (Shiny default)
  let custom    = $state.raw<[number, number]>(parseRange(s.then) ?? [1985, 2005])

  const band    = $derived(mdToBand(s.md))
  const nowYear = $derived(s.now === 'latest' ? (years?.[1] ?? null) : s.now)
  const thenRange = $derived<[number, number]>(parseRange(s.then) ?? [1985, 2005])
  const available = $derived(placesWith(catalog, s.dataset, s.variable))
  const variables = $derived([...(catalog?.places.get(s.dataset)?.keys() ?? [])].length
    ? [...catalog!.places.get(s.dataset)!.keys()] : [s.variable])
  // the climatologies on offer: what the rasters collection lists, else the contract's two
  const baselines = $derived<readonly string[]>(catalog?.baselines?.length ? catalog.baselines : BASELINES)
  const place   = $derived(places.find((p) => p.place_id === s.place) ?? null)
  const unit    = $derived(catalog?.collection?.['cube:variables']?.[s.variable]?.unit
    ?? (/sst|temp/i.test(s.variable) ? '°C' : ''))
  const unitLbl = $derived(unit === 'Celsius' || unit === 'degree_C' ? '°C' : unit)

  // ── colour ──────────────────────────────────────────────────────────────────
  const domain  = $derived(thenB && nowB ? sharedDomain(thenB.data, nowB.data) : null)
  const aDomain = $derived(anom ? anomalyDomain(anom) : null)
  const table   = $derived(lut(paletteStops(s.pal)))
  const aTable  = lut(paletteStops('anomaly'))
  function toUrl(data: Float32Array, b: Band, dom: [number, number], t: Uint8Array): string {
    const c = document.createElement('canvas'); c.width = b.width; c.height = b.height
    c.getContext('2d')!.putImageData(new ImageData(colorize(data, dom, t) as any, b.width, b.height), 0, 0)
    return c.toDataURL('image/png')
  }
  const leftImg = $derived.by((): Img | null => {
    if (s.anom) return anom && nowB && aDomain ? { url: toUrl(anom, nowB.lattice, aDomain, aTable), bbox: nowB.lattice.bbox } : null
    return thenB && domain ? { url: toUrl(thenB.data, thenB.lattice, domain, table), bbox: thenB.lattice.bbox } : null
  })
  const rightImg = $derived(nowB && domain ? { url: toUrl(nowB.data, nowB.lattice, domain, table), bbox: nowB.lattice.bbox } : null)
  const bounds  = $derived<[number, number, number, number] | null>(nowB?.lattice.bbox ?? thenB?.lattice.bbox ?? place?.bbox ?? null)
  // ── the sanctuary mask ──────────────────────────────────────────────────────
  // the rasters cover the place bbox + 20 %, so the > +1 count is restricted to the polygon with the
  // statistics mode's own gridMask() (area weights for boundary pixels). places.parquet is one row
  // group, so one polygon costs the whole 4 MB geometry column: it is read once, after the first view
  // is on screen, and only the count waits for it
  let geoms: Promise<Place[]> | null = null
  let maskFor = $state('')
  let maskFailed = $state('')            // the place whose polygon could not be read (count over the box)
  let weights = $state.raw<Float32Array | null>(null)
  async function loadMask(id: string, b: Band) {
    const key = `${id}|${b.width}x${b.height}|${b.bbox.join(',')}`
    if (maskFor === key) return
    try {
      geoms ??= loadPlaces()
      const p = (await geoms).find((q) => q.place_id === id)
      if (!p) { maskFailed = id; return }    // a place outside the gazetteer (the dev fixture): count over the box
      if (s.place !== id) return
      const ax = latticeAxes(b), cells = []
      for (const lobe of placeLobes(plainPlace(p))) cells.push(...gridMask(lobe.geojson, ax.lon, ax.lat).cells)
      weights = latticeWeights(b, cells); maskFor = key
    } catch (e) { console.warn('then-now: no sanctuary mask', e); maskFailed = id }
  }
  $effect(() => { const b = nowB?.lattice, id = s.place; if (b) untrack(() => loadMask(id, b)) })
  const masked  = $derived(!!weights && !!nowB && maskFor === `${s.place}|${nowB.lattice.width}x${nowB.lattice.height}|${nowB.lattice.bbox.join(',')}`)
  const exceed  = $derived(anom && nowB ? exceedance(anom, nowB.lattice, 1, masked ? weights : null) : null)

  const thenLegend = $derived(thenB ? `Then: ${mdLabel(s.md)}, ${thenB.years[0]} to ${thenB.years[thenB.years.length - 1]}` +
    (isBaseline(s.then, baselines) ? ' (climatology)' : ` (${thenB.n} years averaged)`) : '')
  const nowLegend  = $derived(nowB ? `Now: ${mdLabel(nowB.md)} ${nowB.year}` : '')
  const css = (stops: string[]) => `linear-gradient(to right, ${stops.join(', ')})`

  // the readout under the cursor
  const readout = $derived.by(() => {
    const h = hover
    if (!h || !nowB || !thenB) return ''
    const t = valueAt(thenB.lattice, thenB.data, h.lng, h.lat), n = valueAt(nowB.lattice, nowB.data, h.lng, h.lat)
    if (Number.isNaN(t) && Number.isNaN(n)) return ''
    const f = (v: number) => (Number.isNaN(v) ? '—' : v.toFixed(2))
    const d = n - t
    return `${h.lat.toFixed(3)}, ${h.lng.toFixed(3)} · Then ${f(t)} · Now ${f(n)} · Now − Then ${Number.isNaN(d) ? '—' : (d > 0 ? '+' : '') + d.toFixed(2)} ${unitLbl}`
  })

  // ── catalog + places ────────────────────────────────────────────────────────
  onMount(async () => {
    const [cat, ps] = await Promise.allSettled([loadCatalog(root), loadSanctuaries(GAZETTEER_FALLBACK)])
    if (ps.status === 'fulfilled') places = ps.value
    if (cat.status === 'fulfilled' && cat.value) catalog = cat.value
    else catNote = 'no rasters collection in the catalog yet: every sanctuary is listed and the files are probed'
    catDone = true
    // a place that is only in the data root (the dev fixture) still needs an entry in the picker
    if (!places.some((p) => p.place_id === s.place))
      places = [...places, { place_id: s.place, name: s.place, bbox: [0, 0, 0, 0] }]
    years = catalog?.years ?? await probeYears()
    if (!years) { error = `no ${s.variable} rasters for ${s.place} under ${root}`; status = 'failed'; return }
    if (s.now !== 'latest' && (s.now < years[0] || s.now > years[1])) s.now = 'latest'
    // a Then that this archive cannot serve (no such climatology, no overlap) falls back to the
    // first climatology, or to the Shiny default: the first 20 years
    const r = parseRange(s.then)
    if (!isBaseline(s.then, baselines) && (!r || r[1] < years[0] || r[0] > years[1]))
      s.then = baselines[0] ?? `${years[0]}-${Math.min(years[0] + 20, years[1] - 1)}`
    status = `${s.dataset}/${s.variable}: ${years[0]}–${years[1]}`
  })

  async function loadCatalog(r: string): Promise<RasterCatalog | null> {
    const cat = await (await fetch(`${r}catalog.json`)).json()
    const link = (cat.links ?? []).find((l: any) => l.rel === 'child' && /(^|\/)rasters(\/|$)/.test(String(l.href).replace(/\/collection\.json$/, '')))
    if (!link) return null
    const href = new URL(String(link.href), new URL(`${r}catalog.json`, location.href)).href
    return parseRasterCollection(await (await fetch(href)).json())
  }

  /** without a catalog: the newest year file that answers, counting down from this year. */
  async function probeYears(): Promise<[number, number] | null> {
    const y1 = new Date().getUTCFullYear()
    for (let y = y1; y >= y1 - 4; y--) {
      try {
        const r = await fetch(rasterUrl(root, s.dataset, s.variable, s.place, y), { headers: { Range: 'bytes=0-0' } })
        if (r.ok) return [1985, y]
      } catch { /* try the year before */ }
    }
    return null
  }

  // ── empty archive years ─────────────────────────────────────────────────────
  // `erddap-places:n_days_valid: 0` marks a place-year whose raster is all NaN (archive gaps, e.g.
  // MBNMS 2015). it is only in the per-year Items, so the place's Items (~40 × 3 kB) are read once
  // per place, in parallel with the first band reads; the view waits for them, so a custom Then never
  // averages an empty year and the Now picker can grey them
  let empty     = $state.raw<Set<number>>(new Set())
  let emptyFor  = $state('')
  let emptyNote = $state('')
  const emptyCache = new Map<string, Promise<Set<number>>>()
  function loadEmpty(id: string): Promise<Set<number>> {
    let p = emptyCache.get(id)
    if (!p) {
      const col = catalog?.collection
      const links = placeItemLinks(col, s.dataset, s.variable, id)
      const base = new URL(`${root}rasters/collection.json`, location.href).href
      const t0 = performance.now()
      p = mapLimit(links, 8, async (l) => (await fetch(new URL(l.href, base).href)).json())
        .then((items) => { const e = emptyYears(items); emptyNote = `${links.length} Items in ${Math.round(performance.now() - t0)} ms`; return e })
        .catch((e) => { console.warn('then-now: Items unreadable', e); return new Set<number>() })
      emptyCache.set(id, p)
    }
    return p
  }
  $effect(() => {
    const id = s.place, c = catalog
    if (!catDone) return
    if (!c) { emptyFor = id; return }               // no catalog: nothing to grey (the files are probed)
    untrack(() => loadEmpty(id).then((e) => { if (s.place === id) { empty = e; emptyFor = id } }))
  })

  // ── the view ────────────────────────────────────────────────────────────────
  const thenCache = new Map<string, { data: Float32Array; lattice: Band; years: number[]; n: number }>()

  async function mapLimit<T, R>(xs: T[], k: number, f: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(xs.length); let i = 0
    await Promise.all(Array.from({ length: Math.min(k, xs.length) }, async () => { while (i < xs.length) { const j = i++; out[j] = await f(xs[j]) } }))
    return out
  }
  const allNaN = (a: Float32Array) => { for (let i = 0; i < a.length; i++) if (a[i] === a[i]) return false; return true }

  async function loadView() {
    if (!years || nowYear === null || emptyFor !== s.place) return
    const h = runs.start()
    busy = true; error = ''; note = ''
    const t0 = performance.now()
    reader.meter.reset()
    const notes: string[] = []
    try {
      // Now: a year of the archive. 29 Feb in a non-leap year falls back to 28 Feb, and a day past
      // the end of a partial latest year falls back to the year before, as the Shiny app does
      let y = nowYear, b = band
      // an empty archive year: `latest` walks back to the last year with data, a picked year is refused
      if (empty.has(y)) {
        if (s.now !== 'latest') throw new Error(`the archive has no ${s.variable} for ${place?.name ?? s.place} in ${y} (all NaN)`)
        while (empty.has(y) && y > years[0]) y--
        notes.push(`${nowYear} is empty in the archive: Now is ${y}`)
      }
      if (b === 60 && !isLeap(y)) { b = 59; notes.push(`${y} has no 29 Feb: Now shows 28 Feb`) }
      status = `reading ${s.place} ${y}, band ${b}…`
      let now = await reader.read(rasterUrl(root, s.dataset, s.variable, s.place, y), b)
      if (h.stale()) return
      if (allNaN(now.data) && s.now === 'latest' && y - 1 >= years[0] && !empty.has(y - 1)) {
        notes.push(`no ${mdLabel(bandToMd(b))} in ${y} yet: Now is ${y - 1}`)
        y -= 1
        if (b === 59 && isLeap(y) && band === 60) b = 60
        now = await reader.read(rasterUrl(root, s.dataset, s.variable, s.place, y), b)
        if (h.stale()) return
      }
      // Then: one climatology band, or the band from every year of a custom range, averaged
      const src = thenSources(root, s.dataset, s.variable, s.place, s.then, years, baselines, empty)
      const skipped = src.kind === 'custom' ? [...empty].filter((yy) => { const r = parseRange(s.then)!; return yy >= r[0] && yy <= r[1] }) : []
      if (skipped.length) notes.push(`Then skips ${skipped.sort().join(', ')} (no data in the archive)`)
      const key = `${root}|${s.dataset}|${s.variable}|${s.place}|${s.then}|${band}|${[...empty].join(',')}`
      let then = thenCache.get(key)
      if (!then) {
        if (src.kind === 'baseline') {
          status = `reading the ${s.then} climatology, band ${band}…`
          const c = await reader.read(src.urls[0], band)
          then = { data: c.data, lattice: c, years: src.years, n: src.years.length }
        } else {
          // 29 Feb exists only in leap years: skip the reads that would be all NaN
          if (!src.years.length) throw new Error(`the archive has no years in ${s.then} (it holds ${years[0]}–${years[1]})`)
          const ys = src.years.filter((yy) => bandDate(yy, band) !== null)
          if (!ys.length) throw new Error(`no leap year in ${s.then}, so no 29 Feb to average`)
          status = `averaging band ${band} over ${ys.length} year files (${ys[0]}–${ys[ys.length - 1]})…`
          const bs = await mapLimit(ys, 6, (yy) => reader.read(rasterUrl(root, s.dataset, s.variable, s.place, yy), band))
          if (h.stale()) return
          then = { data: meanBands(bs), lattice: bs[0], years: [src.years[0], src.years[src.years.length - 1]], n: ys.length }
        }
        thenCache.set(key, then)
      }
      if (h.stale()) return
      if (!sameLattice(now, then.lattice)) throw new Error('Then and Now rasters are not on the same grid')
      thenB = then
      nowB  = { data: now.data, lattice: now, year: y, md: bandToMd(b) }
      anom  = diffBands(now.data, then.data)
      const m = reader.meter, ms = performance.now() - t0
      footer = m.requests
        ? `this view: ${m.requests} range request${m.requests > 1 ? 's' : ''}, ${(m.bytes / 1024).toFixed(1)} kB in ` +
          `${Math.round(ms)} ms (request times summed: ${Math.round(m.ms)} ms)`
        : `this view: from cache, ${Math.round(ms)} ms`
      timing = m.requests ? `${m.requests} requests · ${(m.bytes / 1024).toFixed(1)} kB · ${Math.round(ms)} ms` : `from cache · ${Math.round(ms)} ms`
      note = notes.join('; ')
      status = `${place?.name ?? s.place}: ${mdLabel(s.md)}, Then ${s.then} vs Now ${y}`
    } catch (e) {
      if (!h.stale() && !isAbort(e)) { error = e instanceof Error ? e.message : String(e); status = 'failed' }
    } finally {
      runs.finish(h)
      if (!h.stale()) busy = false
    }
  }
  $effect(() => {
    // the inputs of a view; the load itself is untracked so what it writes cannot re-trigger it
    void [s.place, s.variable, s.md, s.then, s.now, root, years, nowYear, empty, emptyFor]
    untrack(() => loadView())
  })

  // ── the day-of-year series (DuckDB-WASM) ────────────────────────────────────
  let series   = $state.raw<any[]>([])
  let seriesFor = ''
  let seriesNote = $state('')
  const seriesRuns = new Runs()
  async function loadSeries() {
    const url = seriesUrl(root, s.dataset, s.variable, s.place)
    const h = seriesRuns.start()
    try {
      const t0 = performance.now()
      let name = `series_${s.place.replace(/\W/g, '_')}_${s.variable}.parquet`
      if (seriesFor !== url) {
        seriesNote = 'loading the daily series…'
        const res = await fetch(url, { signal: h.signal })
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        if (h.stale()) return
        const kb = buf.byteLength / 1024                    // before DuckDB-WASM takes (detaches) the buffer
        await engine.registerBuffer(name, buf)
        seriesFor = url
        seriesNote = `series: ${kb.toFixed(0)} kB parquet in ${Math.round(performance.now() - t0)} ms`
      }
      const t1 = performance.now()
      const rows = await engine.exec(seriesSql({ src: name, then: thenRange, smooth }), 'then-now series')
      if (h.stale()) return
      series = rows
      seriesNote = seriesNote.replace(/; DuckDB.*$/, '') + `; DuckDB ${Math.round(performance.now() - t1)} ms, ${rows.length} days`
    } catch (e) {
      if (!h.stale() && !isAbort(e)) { series = []; seriesNote = `no series: ${e instanceof Error ? e.message : String(e)}` }
    } finally { seriesRuns.finish(h) }
  }
  $effect(() => { void [s.place, s.variable, root, thenRange[0], thenRange[1], smooth]; untrack(() => loadSeries()) })

  // ── the Time strip: the day-of-year chart of every year, or the Now year's anomaly series ────────
  const x = (b: number) => new Date(Date.UTC(2000, 0, b))
  const PL = 48, PR = 12
  let stripMode = $state<'years' | 'anomaly'>('years')
  let stripH    = $state(170)
  const ink   = $derived(theme.dark ? '#c4d7e0' : '#44606e')
  const other = $derived(theme.dark ? '#2b5571' : '#c9d6dc')
  const COL   = { then: '#4a90d9', now: '#d62728', prev: '#f2a33a' }
  const base  = (width: number, height: number) => ({ width, height, marginLeft: PL, marginRight: PR, marginTop: 8, marginBottom: 22,
    style: { background: 'transparent', color: ink, fontSize: '10px' } })
  function doyChart(width: number, height: number): Element | null {
    if (!series.length) return null
    const ny = nowB?.year ?? nowYear
    const [y0, y1] = thenRange
    const prev = ny === null ? null : ny - 1
    const otherR = series.filter((r) => r.year !== ny && r.year !== prev && (r.year < y0 || r.year > y1))
    const thenR = series.filter((r) => r.year >= y0 && r.year <= y1 && r.year !== ny && r.year !== prev)
    const prevR = series.filter((r) => r.year === prev)
    const nowR  = series.filter((r) => r.year === ny)
    // the Then mean per band is the same on every year's rows: keep one row per band
    const clim  = [...new Map(series.filter((r) => r.clim !== null).map((r) => [r.band, r])).values()].sort((a, b) => a.band - b.band)
    return Plot.plot({
      ...base(width, height),
      x: { label: null, tickFormat: '%b', type: 'utc', domain: [x(1), x(367)] },
      y: { label: null, grid: true },
      marks: [
        Plot.line(otherR, { x: (r: any) => x(r.band), y: 'value', z: 'year', stroke: other, strokeWidth: 0.6 }),
        Plot.line(thenR, { x: (r: any) => x(r.band), y: 'value', z: 'year', stroke: COL.then, strokeWidth: 0.8, strokeOpacity: 0.6 }),
        Plot.line(clim, { x: (r: any) => x(r.band), y: 'clim', stroke: ink, strokeDasharray: '4,3', strokeWidth: 1.2 }),
        Plot.line(prevR, { x: (r: any) => x(r.band), y: 'value', stroke: COL.prev, strokeWidth: 1.4 }),
        Plot.line(nowR,  { x: (r: any) => x(r.band), y: 'value', stroke: COL.now, strokeWidth: 2.2 }),
        Plot.ruleX([x(band)], { stroke: ink, strokeWidth: 1 }),
        Plot.tip(series, Plot.pointerX({ x: (r: any) => x(r.band), y: 'value',
          title: (r: any) => `${new Date(r.date).toISOString().slice(0, 10)}\n${Number(r.value).toFixed(2)} ${unitLbl}` })),
      ],
    })
  }
  function anomChart(width: number, height: number): Element | null {
    if (!series.length) return null
    const ny = nowB?.year ?? nowYear
    const nowR = series.filter((r) => r.year === ny && r.anom !== null)
    return Plot.plot({
      ...base(width, height),
      x: { label: null, tickFormat: '%b', type: 'utc', domain: [x(1), x(367)] },
      y: { label: null, grid: true },
      marks: [
        Plot.areaY(nowR, { x: (r: any) => x(r.band), y: (r: any) => Math.max(0, r.anom), fill: '#d6604d', fillOpacity: 0.8 }),
        Plot.areaY(nowR, { x: (r: any) => x(r.band), y: (r: any) => Math.min(0, r.anom), fill: '#4393c3', fillOpacity: 0.8 }),
        Plot.ruleY([0], { stroke: ink }),
        Plot.ruleX([x(band)], { stroke: ink }),
        Plot.tip(nowR, Plot.pointerX({ x: (r: any) => x(r.band), y: 'anom',
          title: (r: any) => `${new Date(r.date).toISOString().slice(0, 10)}\n${r.anom > 0 ? '+' : ''}${Number(r.anom).toFixed(2)} ${unitLbl}` })),
      ],
    })
  }
  // a brush on the strip picks the day in its middle (a click-and-drag; the band is then the day)
  function onbrushend(r: BrushRange) {
    if (r.v0 === undefined || r.v1 === undefined) return
    const b = Math.max(1, Math.min(366, Math.round((r.v0 + r.v1) / 2)))
    s.md = bandToMd(b); mdLive = s.md
    brush = null
  }
  let brush = $state<[number, number] | null>(null)
  // ▶ steps through the year a day at a time (each further day is one band read, ≤ 16 kB)
  let playing = $state(false)
  $effect(() => {
    if (!playing) return
    const t = setInterval(() => { if (!busy) { s.md = stepMd(s.md, 1); mdLive = s.md } }, 700)
    return () => clearInterval(t)
  })

  // ── controls ────────────────────────────────────────────────────────────────
  const thenChoice = $derived(isBaseline(s.then, baselines) ? s.then : 'custom')
  function pickThen(v: string) {
    if (v !== 'custom') { s.then = v; return }
    // a custom range outside the archive starts from the Shiny default instead: the first 20 years
    if (years && (custom[1] < years[0] || custom[0] > years[1]))
      custom = [years[0], Math.max(years[0], Math.min(years[0] + 20, years[1] - 1))]
    s.then = `${custom[0]}-${custom[1]}`
  }
  function setCustom(i: 0 | 1, v: number) {
    const c: [number, number] = [...custom] as [number, number]; c[i] = v
    if (c[0] > c[1]) c[1 - i] = v
    custom = c; s.then = `${c[0]}-${c[1]}`
  }
  const yearList = $derived(years ? Array.from({ length: years[1] - years[0] + 1 }, (_, i) => years![1] - i) : [])

  // ── the sentence and the footer line ────────────────────────────────────────
  const varLabel   = $derived(variableWords(catalog?.collection?.['cube:variables']?.[s.variable]?.description
    ?? (s.variable === 'CRW_SST' ? 'sea surface temperature' : s.variable), s.variable))
  const placeLabel = $derived(shortPlace(place?.name ?? s.place))
  const thenText   = $derived(`${fmtYears(thenB ? `${thenB.years[0]}-${thenB.years[thenB.years.length - 1]}` : s.then)} ${isBaseline(s.then, baselines) ? 'climatology' : 'average'}`)
  const nowText    = $derived(String(nowB?.year ?? nowYear ?? (s.now === 'latest' ? 'latest' : s.now)))
  const km         = (v: number) => Math.round(v).toLocaleString('en-US')
  const pct        = $derived(exceed && exceed.validKm2 ? (100 * exceed.km2) / exceed.validKm2 : null)
  // the headline waits for the sanctuary mask: a count over the raster box would read as the answer
  const maskDone   = $derived(masked || maskFailed === s.place)
  const headline   = $derived(pct !== null && maskDone ? exceedanceLine(pct, 1, unitLbl, masked ? 'the sanctuary' : 'the raster box') : '')
  const titleText  = $derived(`${varLabel} in ${placeLabel} on ${fmtMd(s.md)}: Then ${thenText} vs Now ${nowText}`)
  const placeItems = $derived<PickerItem[]>(places.map((p) => ({
    id: p.place_id, label: shortPlace(p.name), keywords: `${p.place_id} ${p.name}`, color: 'var(--facet-place)',
    disabled: available.size > 0 && !available.has(p.place_id),
  })))
  const thenOptions = $derived([...baselines.map((b) => ({ value: b, label: `${fmtYears(b)} (climatology)` })), { value: 'custom', label: 'custom years…' }])
  const nowOptions  = $derived([{ value: 'latest', label: `latest${years ? ` (${years[1]})` : ''}` },
    ...yearList.map((y) => ({ value: String(y), label: `${y}${empty.has(y) ? ' (no data)' : ''}`, disabled: empty.has(y) }))])
  $effect(() => { chrome.busy = busy; chrome.step = busy ? status : '' })
  $effect(() => { chrome.timing = timing })
  $effect(() => { chrome.release = `NOAA CRW CoralTemp ${s.variable}${years ? ` ${years[0]}–${years[1]}` : ''} · COGs on S3` })

  // ── share ───────────────────────────────────────────────────────────────────
  let copied = $state('')
  let mapA: any = null, mapB: any = null
  const link = $derived(typeof location === 'undefined' ? '' : pageBase() + viewHash)
  async function copy(text: string, what: string) {
    copied = (await copyText(text)) ? `copied the ${what}` : `could not copy the ${what}`
    setTimeout(() => { copied = '' }, 2500)
  }
  const fileBase = $derived(`erddap-places_then-now_${s.place.replace(/[^\w-]+/g, '-')}_${s.variable}_${s.md}_then-${s.then}_now-${nowText}`)
  function saveCsv() {
    if (!series.length) return
    const rows = series.map((r: any) => ({ date: new Date(r.date).toISOString().slice(0, 10), year: r.year, band: r.band,
      value: r.value, then_mean: r.clim, anomaly: r.anom }))
    download(toCsv(rows), `${fileBase}_series.csv`, 'text/csv;charset=utf-8')
  }
  async function savePng() {
    if (!mapA || !mapB) return
    copied = 'drawing the PNG…'
    try {
      const a = await grabMap(mapA), layers = [{ canvas: a }]
      if (!s.anom) layers.push({ canvas: await grabMap(mapB), clip: [s.swipe, 1] } as any)
      const blob = await viewPng({ layers, title: titleText, dark: theme.dark,
        sub: s.anom ? `Now − Then${headline ? ` · ${headline}` : ''}` : `left: Then ${thenText} · right: Now ${nowText}`,
        stamp: [`NOAA Coral Reef Watch CoralTemp (${s.variable}) · Ocean Metrics gazetteer · built by Ocean Metrics for MBON`, link] })
      download(blob, `${fileBase}.png`, 'image/png'); copied = ''
    } catch (e) { copied = `PNG failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  // Cite this data: the CoralTemp rasters of this sanctuary, the gazetteer, this app with the view's link
  const cite = $derived.by(() => {
    const accessed = new Date().toISOString().slice(0, 10)
    return citeText({ datasets: [], extra: [thenNowCitation(s.variable, place?.name ?? s.place, root, accessed)], accessed, url: link, appVersion: __APP_VERSION__ })
  })
  const reproduce = $derived([
    `# erddap-places Then vs Now — ${place?.name ?? s.place} (${s.place}), ${s.variable}, ${s.md}: Then ${s.then} vs Now ${nowText}`,
    `# permalink: ${link}`,
    `# Now:  ${rasterUrl(root, s.dataset, s.variable, s.place, Number(nowB?.year ?? nowYear ?? 0))} band ${band}`,
    `# Then: ${isBaseline(s.then, baselines) ? `${root}climatology/${s.dataset}/${s.variable}/${s.place}/${s.then}_mean.tif band ${band}` : `the band ${band} of every year ${s.then}, averaged`}`,
    `# series: ${seriesUrl(root, s.dataset, s.variable, s.place)}`,
    '', seriesSql({ src: 'series.parquet', then: thenRange, smooth }),
  ].join('\n'))
  const switchLens = () => setLens?.('stats', { place: s.place, variable: s.variable, panes })

  // what Help, the tour and the shortcuts may ask of this lens (once: the Shell re-mounts a lens to change it)
  // svelte-ignore state_referenced_locally
  register?.({
    ui   : () => ({ tab, controls: !controlsFolded, time: !timeFolded, side: !sideFolded }),
    setUi: (u) => {
      if (u.tab) tab = u.tab
      if (u.controls !== undefined) controlsFolded = !u.controls
      if (u.time !== undefined) timeFolded = !u.time
      if (u.side !== undefined) sideFolded = !u.side
    },
    switchLens,
    day     : (by) => { s.md = stepMd(s.md, by); mdLive = s.md },
    sentence: () => titleText,
    maps    : () => [mapA, mapB].filter(Boolean),
    cite    : () => cite,
  })
</script>

{#snippet placePicker(close?: () => void)}
  <Picker items={placeItems} value={s.place} label="sanctuaries" placeholder="Search sanctuaries…" maxHeight={close ? '16rem' : '11rem'}
          onselect={(it) => { s.place = it.id; close?.() }} />
{/snippet}
{#snippet thenPanel()}
  <div class="pane-col">
    <Select label="Then" value={thenChoice} options={thenOptions} onchange={(v) => pickThen(v)} />
    {#if thenChoice === 'custom' && years}
      <div class="pane-row">
        <label class="pane-field">from <input type="number" min={years[0]} max={years[1]} value={custom[0]} onchange={(e) => setCustom(0, Number(e.currentTarget.value))} /></label>
        <label class="pane-field">to <input type="number" min={years[0]} max={years[1]} value={custom[1]} onchange={(e) => setCustom(1, Number(e.currentTarget.value))} /></label>
      </div>
    {/if}
  </div>
{/snippet}
{#snippet nowPanel()}
  <div class="pane-col">
    <Select label="Now" value={String(s.now)} options={nowOptions} onchange={(v) => { s.now = v === 'latest' ? 'latest' : Number(v) }} />
    <Toggle bind:checked={s.anom} label="Anomaly (Now − Then)" hint="one map on a diverging scale, and the share above +1" />
  </div>
{/snippet}
{#snippet dayPanel()}
  <div class="pane-col">
    <Slider label="Day of year" value={mdToBand(mdLive)} min={1} max={366} ticks={[{ value: 1, label: 'Jan' }, { value: 183, label: 'Jul' }, { value: 366, label: 'Dec' }]}
            format={(b) => fmtMd(bandToMd(b))} oninput={(b) => { mdLive = bandToMd(b); s.md = mdLive }} />
    <p class="pane-note">Or click the day-of-year chart in the Time strip; ▶ plays through the year.</p>
  </div>
{/snippet}
{#snippet methodPanel()}
  <div class="pane-col">
    <div class="lens-switch" role="group" aria-label="lens">
      <Button variant="quiet" size="sm" pressed={false} onclick={switchLens}>Window statistics</Button>
      <Button variant="quiet" size="sm" pressed={true}>Then vs Now</Button>
    </div>
    {@render thenPanel()}
    {@render nowPanel()}
    {@render dayPanel()}
    <details class="pane-details">
      <summary>More options</summary>
      <div class="pane-col">
        <Select label="Palette" value={s.pal} options={[{ value: 'spectral', label: 'Spectral' }, { value: 'viridis', label: 'viridis' }]}
                onchange={(v) => { s.pal = v as typeof s.pal }} />
        <Slider label="Smoothing (days, chart)" bind:value={smooth} min={1} max={31} step={2} />
      </div>
    </details>
  </div>
{/snippet}
{#snippet sharePanel()}
  <div class="pane-col">
    <div class="pane-row">
      <Button variant="action" size="sm" onclick={saveCsv} disabled={!series.length}>Download CSV</Button>
      <Button variant="quiet" size="sm" onclick={savePng} disabled={!nowB}>PNG of the view</Button>
    </div>
    <div class="pane-row">
      <Button variant="quiet" size="sm" onclick={() => copy(link, 'link')}>Copy link</Button>
      <Button variant="quiet" size="sm" onclick={() => copy(cite, 'citation')}>Copy citation</Button>
      {#if copied}<span class="pane-note" role="status">{copied}</span>{/if}
    </div>
    <details class="pane-details cite-this">
      <summary>Cite this data</summary>
      <div class="pane-col">
        <pre class="pane-pre cite">{cite}</pre>
        <Button variant="quiet" size="sm" onclick={() => copy(cite, 'citation')}>Copy citation</Button>
      </div>
    </details>
    <details class="pane-details">
      <summary>Reproduce: requests, SQL and timing</summary>
      <div class="pane-col">
        <Button variant="quiet" size="sm" onclick={() => copy(reproduce, 'reproduce block')}>Copy all</Button>
        <p class="pane-note">{footer}{seriesNote ? ` · ${seriesNote}` : ''}{emptyNote ? ` · year validity: ${emptyNote}` : ''}</p>
        {#if note || catNote}<p class="pane-note">{[note, catNote].filter(Boolean).join(' · ')}</p>{/if}
        <p class="pane-mono">data: {root}</p>
        <pre class="pane-pre">{reproduce}</pre>
      </div>
    </details>
  </div>
{/snippet}

<div class="lens" data-state={error ? 'error' : busy || !nowB || !maskDone ? 'loading' : 'done'}>
  <div class="sentence-bar">
    <Sentence>
      <Chip label={varLabel} facet="dataset" title="choose a variable" width="18rem">
        {#snippet children(close)}
          <Select label="Variable" value={s.variable} options={variables.map((v) => ({ value: v, label: v }))} onchange={(v) => { s.variable = v; close() }} />
          <p class="pane-note">NOAA Coral Reef Watch CoralTemp, 5 km, daily{years ? `, ${years[0]}–${years[1]}` : ''}</p>
        {/snippet}
      </Chip>
      in
      <Chip label={placeLabel} facet="place" title="choose a sanctuary" width="22rem">
        {#snippet children(close)}{@render placePicker(close)}{/snippet}
      </Chip>
      on
      <span class="nw"><Chip label={fmtMd(s.md)} facet="method" title="choose the day of year" width="20rem">
        {#snippet children()}{@render dayPanel()}{/snippet}
      </Chip>:</span>
      <Chip label="Then" facet="method" title="choose Then" width="18rem">
        {#snippet children()}{@render thenPanel()}{/snippet}
      </Chip>
      {thenText} vs
      <Chip label="Now" facet="method" title="choose Now" width="18rem">
        {#snippet children()}{@render nowPanel()}{/snippet}
      </Chip>
      {nowText}
      {#snippet sub()}
        {#if s.anom ? aDomain : domain}
          {@const dom = (s.anom ? aDomain : domain)!}
          <Legend title={s.anom ? `Now − Then (${unitLbl})` : `${s.variable} (${unitLbl})`} colors={paletteStops(s.anom ? 'anomaly' : s.pal)} domain={dom} />
        {/if}
        {#if s.anom && headline}
          <span class="headline">{headline}</span>
          <span class="counts">{km(exceed!.km2)} of {km(exceed!.validKm2)} km² · {exceed!.n} of {exceed!.valid} pixels</span>
        {:else if exceed && !maskDone}
          <span class="counts">masking the sanctuary…</span>
        {:else if exceed}
          <span class="counts">{exceed.valid} pixels {masked ? 'in the sanctuary' : 'in the raster box'}</span>
        {/if}
        {#if note}<span class="counts">{note}</span>{/if}
      {/snippet}
    </Sentence>
  </div>

  <div class="stage" style:--map-bottom={timeFolded ? '52px' : `${stripH + 58}px`}>
    <SwipeMap pmtilesUrl={`${GAZETTEER_FALLBACK}places/places.pmtiles`} placeId={s.place} {bounds} left={leftImg} right={rightImg}
              single={s.anom} swipe={s.swipe} onswipe={(f) => { s.swipe = f }} onhover={(ll) => { hover = ll }}
              dark={theme.dark} padding={fitPadding(VW, START, 170)} onmaps={(a, b) => { mapA = a; mapB = b }}
              leftLabel={s.anom ? (nowB ? `Now − Then: ${fmtMd(nowB.md)} ${nowB.year} − ${thenText}` : '') : (thenB ? `Then ${thenText}` : '')}
              rightLabel={nowB ? `Now ${fmtMd(nowB.md)} ${nowB.year}` : ''} />
    {#if readout}<div class="readout">{readout}</div>{/if}
    {#if error}
      <div class="toast"><Notice kind="error" ondismiss={() => { error = '' }}>{error}</Notice></div>
    {/if}

    <Controls id="tn-controls" title="controls" width={390} bind:active={tab} bind:collapsed={controlsFolded}
      tabs={[{ id: 'place', label: 'Place' }, { id: 'data', label: 'Dataset & variable' }, { id: 'method', label: 'Method' }, { id: 'share', label: 'Share' }]}>
      {#snippet tabLabel(t)}<span class="tab-label">{t.label}</span>{/snippet}
      {#snippet panel(id)}
        {#if id === 'place'}
          <div class="pane-col">
            {@render placePicker()}
            <p class="pane-note">The national marine sanctuaries with Then vs Now rasters{available.size ? ` (${available.size})` : ''}.</p>
          </div>
        {:else if id === 'data'}
          <div class="pane-col">
            <Select label="Variable" value={s.variable} options={variables.map((v) => ({ value: v, label: `${variableWords(catalog?.collection?.['cube:variables']?.[v]?.description ?? (v === 'CRW_SST' ? 'sea surface temperature' : v), v)} (${v})` }))}
                    onchange={(v) => { s.variable = v }} />
            <p class="pane-note">NOAA Coral Reef Watch CoralTemp (dhw_5km), 5 km, daily{years ? `, ${years[0]}–${years[1]}` : ''}: one 366-band COG per year, clipped to the sanctuary's box + 20 %, read one band at a time.</p>
          </div>
        {:else if id === 'method'}
          {@render methodPanel()}
        {:else}
          {@render sharePanel()}
        {/if}
      {/snippet}
      {#snippet footer()}{exceed ? `${exceed.valid} pixels · ` : ''}CoralTemp 5 km{busy ? ' · updating…' : ''}{/snippet}
    </Controls>

    <Pane title="exceedance" id="tn-exceedance" class="edge-pane" anchor="top-right" offset={{ x: 0, y: 130 }} width={300}
          bind:collapsed={sideFolded} pillLabel={s.anom && pct !== null && maskDone ? `Exceedance · ${Math.round(pct)} % > +1 ${unitLbl}` : 'Exceedance'}>
      <div class="pane-col">
        {#if exceed && pct !== null}
          <Stat value={`${Math.round(pct)} %`} label={`of ${masked ? 'the sanctuary' : 'the raster box'} > +1 ${unitLbl}`} note={`${fmtMd(s.md)} ${nowText} against ${thenText}`} />
          <p class="pane-note">Now − Then &gt; +1 {unitLbl}: <b>{exceed.n}</b> of {exceed.valid} pixels,
             {km(exceed.km2)} of {km(exceed.validKm2)} km²
             {masked ? 'inside the sanctuary (boundary pixels by their share)' : 'in the raster box (the sanctuary mask is loading or unavailable)'}.</p>
          {#if !s.anom}<Toggle bind:checked={s.anom} label="Show the anomaly map" />{/if}
        {:else}
          <p class="pane-note">{busy ? 'updating…' : 'no view yet'}</p>
        {/if}
      </div>
    </Pane>

    <TimeStrip title={stripMode === 'years' ? `day of year, every year · ${unitLbl}` : `${nowText} − Then mean · ${unitLbl}`}
               bind:collapsed={timeFolded} bind:height={stripH} minHeight={90} maxHeight={380}
               domain={[1, 367]} plotLeft={PL} plotRight={PR} bind:brush {onbrushend}>
      {#snippet actions()}
        {#if stripMode === 'years'}
          <span class="chart-key" aria-label="chart key">
            <span><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={COL.now} stroke-width="2.2" /></svg> {nowText}</span>
            <span><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={COL.prev} stroke-width="1.4" /></svg> {Number(nowText) - 1 || 'previous'}</span>
            <span><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={COL.then} stroke-width="1" /></svg> Then years</span>
            <span><svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke={ink} stroke-width="1.2" stroke-dasharray="4,3" /></svg> Then mean</span>
          </span>
        {/if}
        <Button variant="quiet" size="sm" aria-label="previous day" onclick={() => { s.md = stepMd(s.md, -1); mdLive = s.md }}>◀</Button>
        <Button variant="quiet" size="sm" aria-label={playing ? 'pause' : 'play through the year'} pressed={playing} onclick={() => { playing = !playing }}>{playing ? '❚❚' : '▶'}</Button>
        <Button variant="quiet" size="sm" aria-label="next day" onclick={() => { s.md = stepMd(s.md, 1); mdLive = s.md }}>▶|</Button>
        <Button variant="quiet" size="sm" pressed={stripMode === 'anomaly'} onclick={() => { stripMode = stripMode === 'years' ? 'anomaly' : 'years' }}>{stripMode === 'years' ? 'anomaly series' : 'every year'}</Button>
      {/snippet}
      {#snippet children({ width, height })}
        <PlotBox make={stripMode === 'years' ? doyChart : anomChart} {width} {height} />
      {/snippet}
    </TimeStrip>
  </div>
</div>

<style>
  .readout { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(var(--map-bottom, 0px) + 8px); z-index: 6;
             padding: 2px 8px; border-radius: 4px; pointer-events: none; font: 12px/1.4 var(--font-mono);
             color: var(--text-strong); background: color-mix(in srgb, var(--bg-surface) 90%, transparent); }
</style>

<script lang="ts">
  // #mode=then-now — the "Sanctuaries Climate Change" Shiny app (shiny.marinebon.app/nms-cc) without
  // a server: one day of the year, Then (a published climatology or any year range, averaged here)
  // against Now (a year of the archive), as a swipe map with one shared colour scale, an anomaly
  // map, and the day-of-year chart of every year. rasters are 366-band COGs read one band at a time
  // with HTTP range requests (cog.ts); the chart queries the series parquet in DuckDB-WASM.
  import { onMount, untrack } from 'svelte'
  import * as Plot from '@observablehq/plot'
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

  const s = $state<ThenNowState>(decodeThenNow(typeof location === 'undefined' ? '' : location.hash))
  // the permalink: every pick is written straight back into the hash
  $effect(() => { const h = encodeThenNow({ ...s }); if (typeof history !== 'undefined') history.replaceState(null, '', h) })

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
  let footer    = $state('')
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
  let weights = $state.raw<Float32Array | null>(null)
  async function loadMask(id: string, b: Band) {
    const key = `${id}|${b.width}x${b.height}|${b.bbox.join(',')}`
    if (maskFor === key) return
    try {
      geoms ??= loadPlaces()
      const p = (await geoms).find((q) => q.place_id === id)
      if (!p || s.place !== id) return
      const ax = latticeAxes(b), cells = []
      for (const lobe of placeLobes(plainPlace(p))) cells.push(...gridMask(lobe.geojson, ax.lon, ax.lat).cells)
      weights = latticeWeights(b, cells); maskFor = key
    } catch (e) { console.warn('then-now: no sanctuary mask', e) }
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

  let chartEl = $state<HTMLDivElement | null>(null)
  let anomEl  = $state<HTMLDivElement | null>(null)
  const x = (b: number) => new Date(Date.UTC(2000, 0, b))
  $effect(() => {
    if (!chartEl || !series.length) return
    const ny = nowB?.year ?? nowYear
    const [y0, y1] = thenRange
    const other = series.filter((r) => r.year !== ny && (r.year < y0 || r.year > y1))
    const thenR = series.filter((r) => r.year >= y0 && r.year <= y1 && r.year !== ny)
    const nowR  = series.filter((r) => r.year === ny)
    // the Then mean per band is the same on every year's rows: keep one row per band
    const clim  = [...new Map(series.filter((r) => r.clim !== null).map((r) => [r.band, r])).values()].sort((a, b) => a.band - b.band)
    const nowLbl = `Now ${ny}`, thenLbl = `Then ${y0}–${y1}`
    const chart = Plot.plot({
      width: 860, height: 340, marginLeft: 50,
      x: { label: 'day of year', tickFormat: '%b', type: 'utc' },
      y: { label: `${s.variable} area mean (${unitLbl})`, grid: true },
      color: { legend: true, domain: ['other years', thenLbl, 'Then mean', nowLbl], range: ['#bbbbbb', '#4a90d9', '#222222', '#d62728'] },
      marks: [
        Plot.line(other, { x: (r: any) => x(r.band), y: 'value', z: 'year', stroke: '#bbbbbb', strokeWidth: 0.6 }),
        Plot.line(thenR, { x: (r: any) => x(r.band), y: 'value', z: 'year', stroke: '#4a90d9', strokeWidth: 0.8, strokeOpacity: 0.7 }),
        Plot.line(clim, { x: (r: any) => x(r.band), y: 'clim', stroke: '#222', strokeDasharray: '4,3', strokeWidth: 1.2 }),
        Plot.line(nowR,  { x: (r: any) => x(r.band), y: 'value', stroke: '#d62728', strokeWidth: 2.2 }),
        Plot.ruleX([x(band)], { stroke: '#333', strokeWidth: 1 }),
        Plot.tip(series, Plot.pointerX({ x: (r: any) => x(r.band), y: 'value',
          title: (r: any) => `${new Date(r.date).toISOString().slice(0, 10)}\n${Number(r.value).toFixed(2)} ${unitLbl}` })),
      ],
    })
    chartEl.replaceChildren(chart)
    return () => chart.remove()
  })
  $effect(() => {
    if (!anomEl || !series.length) return
    const ny = nowB?.year ?? nowYear
    const nowR = series.filter((r) => r.year === ny && r.anom !== null)
    const chart = Plot.plot({
      width: 860, height: 150, marginLeft: 50,
      x: { label: null, tickFormat: '%b', type: 'utc', domain: [x(1), x(366)] },
      y: { label: `${ny} − Then mean (${unitLbl})`, grid: true },
      marks: [
        Plot.areaY(nowR, { x: (r: any) => x(r.band), y: (r: any) => Math.max(0, r.anom), fill: '#d6604d', fillOpacity: 0.8 }),
        Plot.areaY(nowR, { x: (r: any) => x(r.band), y: (r: any) => Math.min(0, r.anom), fill: '#4393c3', fillOpacity: 0.8 }),
        Plot.ruleY([0]),
        Plot.ruleX([x(band)], { stroke: '#333' }),
        Plot.tip(nowR, Plot.pointerX({ x: (r: any) => x(r.band), y: 'anom',
          title: (r: any) => `${new Date(r.date).toISOString().slice(0, 10)}\n${r.anom > 0 ? '+' : ''}${Number(r.anom).toFixed(2)} ${unitLbl}` })),
      ],
    })
    anomEl.replaceChildren(chart)
    return () => chart.remove()
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
</script>

<main>
  <p class="nav"><a href="#mode=stats">← place statistics</a></p>
  <h1>Then vs Now</h1>
  <p class="sub">One day of the year in a sanctuary: Then (a climatology or any range of years) against Now, from
     cloud-optimised GeoTIFFs read band by band in this browser. No server: the
     <a href="https://shiny.marinebon.app/nms-cc" target="_blank" rel="noreferrer">Shiny app</a>, rebuilt.</p>

  <div class="controls">
    <label>sanctuary
      <select bind:value={s.place}>
        {#each places as p}
          <option value={p.place_id} disabled={available.size > 0 && !available.has(p.place_id)}>{p.name}{available.size > 0 && !available.has(p.place_id) ? ' (no rasters)' : ''}</option>
        {/each}
      </select>
    </label>
    <label>variable
      <select bind:value={s.variable}>{#each variables as v}<option value={v}>{v}</option>{/each}</select>
    </label>
    <label>Then
      <select value={thenChoice} onchange={(e) => pickThen(e.currentTarget.value)}>
        {#each baselines as b}<option value={b}>{b.replace('-', '–')} (climatology)</option>{/each}
        <option value="custom">custom years…</option>
      </select>
    </label>
    {#if thenChoice === 'custom' && years}
      <label>from <input type="number" min={years[0]} max={years[1]} value={custom[0]} onchange={(e) => setCustom(0, Number(e.currentTarget.value))} /></label>
      <label>to <input type="number" min={years[0]} max={years[1]} value={custom[1]} onchange={(e) => setCustom(1, Number(e.currentTarget.value))} /></label>
    {/if}
    <label>Now
      <select value={String(s.now)} onchange={(e) => { const v = e.currentTarget.value; s.now = v === 'latest' ? 'latest' : Number(v) }}>
        <option value="latest">latest{years ? ` (${years[1]})` : ''}</option>
        {#each yearList as y}<option value={String(y)} disabled={empty.has(y)}>{y}{empty.has(y) ? ' (no data)' : ''}</option>{/each}
      </select>
    </label>
    <label>palette
      <select bind:value={s.pal}><option value="spectral">Spectral</option><option value="viridis">viridis</option></select>
    </label>
    <label class="chk"><input type="checkbox" bind:checked={s.anom} /> anomaly (Now − Then)</label>
  </div>

  <div class="md">
    <button onclick={() => { s.md = stepMd(s.md, -1); mdLive = s.md }} aria-label="previous day">←</button>
    <input type="range" min="1" max="366" value={mdToBand(mdLive)}
           oninput={(e) => { mdLive = bandToMd(Number(e.currentTarget.value)) }}
           onchange={(e) => { s.md = bandToMd(Number(e.currentTarget.value)) }} aria-label="month and day" />
    <button onclick={() => { s.md = stepMd(s.md, 1); mdLive = s.md }} aria-label="next day">→</button>
    <span class="mdl">{mdLabel(mdLive)}</span>
  </div>

  <p class="status" class:err={!!error}>{error || status}{busy ? ' …' : ''}</p>
  {#if note || catNote}<p class="meta">{[note, catNote].filter(Boolean).join(' · ')}</p>{/if}

  <div class="mapwrap">
    <SwipeMap pmtilesUrl={`${GAZETTEER_FALLBACK}places/places.pmtiles`} placeId={s.place} {bounds} left={leftImg} right={rightImg}
              single={s.anom} swipe={s.swipe} onswipe={(f) => { s.swipe = f }} onhover={(ll) => { hover = ll }} />
    {#if s.anom}
      {#if nowB}<div class="lg tl"><b>Now − Then</b><br />{mdLabel(nowB.md)} {nowB.year} − {thenB?.years[0]}–{thenB?.years[thenB.years.length - 1]}</div>{/if}
    {:else}
      {#if thenLegend}<div class="lg tl"><b>{thenLegend.split(':')[0]}</b><br />{thenLegend.split(': ')[1]}</div>{/if}
      {#if nowLegend}<div class="lg tr"><b>Now</b><br />{nowLegend.split(': ')[1]}</div>{/if}
    {/if}
    {#if s.anom ? aDomain : domain}
      {@const dom = (s.anom ? aDomain : domain)!}
      <div class="bar">
        <div class="ramp" style:background={css(paletteStops(s.anom ? 'anomaly' : s.pal))}></div>
        <div class="ticks">{#each ticks(dom) as t}<span>{t.toFixed(1)}</span>{/each}</div>
        <div class="unit">{s.anom ? `Now − Then (${unitLbl})` : `${s.variable} (${unitLbl})`}</div>
      </div>
    {/if}
    {#if readout}<div class="readout">{readout}</div>{/if}
  </div>

  {#if exceed}
    <p class="meta">Now − Then &gt; +1 {unitLbl}: <b>{exceed.n}</b> of {exceed.valid} pixels,
       {exceed.km2.toFixed(0)} of {exceed.validKm2.toFixed(0)} km² ({exceed.validKm2 ? ((100 * exceed.km2) / exceed.validKm2).toFixed(0) : 0}% of the area)
       {masked ? 'inside the sanctuary (boundary pixels by their share)' : 'in the raster box (the sanctuary mask is loading or unavailable)'}</p>
  {/if}

  <h2>Day of year, every year</h2>
  <label class="meta">smoothing <input type="range" min="1" max="31" step="2" bind:value={smooth} /> {smooth} day{smooth > 1 ? 's' : ''}</label>
  <div bind:this={chartEl} class="chart"></div>
  <div bind:this={anomEl} class="chart"></div>

  <footer class="meta">{footer}{footer && seriesNote ? ' · ' : ''}{seriesNote}{emptyNote ? ` · year validity: ${emptyNote}` : ''} · data: {root}</footer>
</main>

<style>
  main    { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font: 15px/1.5 system-ui, sans-serif; color: #222; }
  h1      { font-size: 1.4rem; margin: 0 0 .25rem; }
  h2      { font-size: 1.05rem; margin: 1.25rem 0 .25rem; }
  .nav    { margin: 0 0 .25rem; font-size: 13px; }
  .sub    { color: #555; margin: 0 0 1rem; }
  .controls { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; margin-bottom: .5rem; }
  .controls label { display: flex; flex-direction: column; font-size: 12px; color: #444; gap: 2px; }
  .controls label.chk { flex-direction: row; align-items: center; gap: 4px; font-size: 13px; }
  .controls select, .controls input[type=number] { font-size: 14px; padding: 2px 4px; max-width: 320px; }
  .controls input[type=number] { width: 5.5em; }
  .md     { display: flex; align-items: center; gap: .5rem; margin: .25rem 0 .5rem; }
  .md input { flex: 1; }
  .mdl    { font-weight: 600; min-width: 4.5em; }
  .status { background: #eef4fb; border-left: 3px solid #1f77b4; padding: .5rem .75rem; }
  .status.err { background: #fdeeee; border-left-color: #d62728; }
  .meta   { color: #444; font-size: 13px; }
  .mapwrap { position: relative; margin: .75rem 0; }
  .lg     { position: absolute; top: 8px; background: rgba(255,255,255,.9); padding: 3px 8px; border-radius: 3px;
            font: 12px/1.35 system-ui, sans-serif; pointer-events: none; z-index: 6; }
  .tl     { left: 8px; } .tr { right: 48px; }
  .bar    { position: absolute; left: 8px; bottom: 8px; width: 240px; background: rgba(255,255,255,.9); padding: 4px 8px;
            border-radius: 3px; font: 11px system-ui, sans-serif; pointer-events: none; z-index: 6; }
  .ramp   { height: 10px; border: 1px solid #999; }
  .ticks  { display: flex; justify-content: space-between; }
  .unit   { text-align: center; color: #444; }
  .readout { position: absolute; right: 8px; bottom: 28px; background: rgba(255,255,255,.92); padding: 2px 8px; border-radius: 3px;
             font: 12px system-ui, sans-serif; pointer-events: none; z-index: 6; }
  .chart  { margin: .5rem 0; }
  footer  { margin: 1rem 0 2rem; word-break: break-all; }
</style>

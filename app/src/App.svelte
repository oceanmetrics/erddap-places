<script lang="ts">
  // the Statistics lens: pick a place from the published gazetteer and a variable from a
  // STAC-described ERDDAP dataset, mask the grid, fetch one griddap slab per lobe, aggregate with
  // DuckDB-WASM. Nothing but ERDDAP itself is in the request path. The map is the page; the title
  // sentence, the Controls pane (① Place ② Dataset & variable ③ Method ④ Share), the Time strip and
  // the Table pill float around it. Any change runs (no Run button); a newer pick supersedes.
  import { untrack } from 'svelte'
  import * as Plot from '@observablehq/plot'
  import { Button, Chip, Controls, Legend, Menu, Notice, Pane, Picker, Select, Sentence, TimeStrip, type BrushRange, type PickerItem } from '@marinebon/ui'
  import { gridMask, pointMask, type MaskCell } from './lib/gridMask'
  import { fetchAxis, fetchSlab, griddapUrl, isParquet, noonZ, tabledapPlaceConstraints, tabledapUrl } from './lib/erddap'
  import { engine } from './lib/engine'
  import { loadPlaces, placeLobes, placesPmtilesUrl, plainPlace, type Place } from './lib/gazetteer'
  import { loadDatasets, lobeLonSpan, statsTemplate, toDatasetLon, valueExpr, valueLabel, type CubeVariable, type Dataset } from './lib/catalog'
  import { addDays, clampWindow, daysBetween, defaultWindow, fetchTimeExtent, timeInstant, type TimeExtent } from './lib/extent'
  import { classColors, rampStops, VIRIDIS_9 } from './lib/palette'
  import MapView from './lib/MapView.svelte'
  import PlotBox from './lib/PlotBox.svelte'
  import { cellPoints, cellSquares, placeMapBounds, type ValueCell } from './lib/cells'
  import { isAbort, Runs, type RunHandle } from './lib/runToken'
  import { decodeHash, encodeHash, type RunState } from './lib/permalink'
  import { copyText, download, resultFileName, toCsv } from './lib/download'
  import { chrome, theme } from './lib/chrome.svelte'
  import { decodePanes, encodePanes, fitPadding, initialPanes, paneUrlState, hashParam, withExtras, type Lens, type Panes } from './lib/view'
  import { datasetBlurb, fmtDay, fmtMonths, fmtRange, isStat, plural, shortPlace, STATS, statLabel, variableWords, type StatId } from './lib/sentence'
  import { grabMap, viewPng } from './lib/png'
  import { citeText } from './lib/help/cite'
  import { pageBase } from './lib/help/start'
  import type { LensApi } from './lib/help/lensApi'

  interface Props {
    setLens?: (to: Lens, carry?: { place?: string; variable?: string; panes?: Panes }) => void
    /** hands the Shell what Help, the tour and the shortcuts may ask of this lens */
    register?: (api: LensApi) => void
  }
  let { setLens, register }: Props = $props()

  const MAX_DAYS     = 90
  const DEFAULT_DAYS = 30
  const LAG_DAYS     = 2      // most near-real-time grids are a couple of days behind
  const MIN_STEPS    = 8      // a coarse product (8-day Seascapes) still gets this many time steps
  const WIN          = { days: DEFAULT_DAYS, minSteps: MIN_STEPS, maxDays: MAX_DAYS }
  // point data is sparse: a CalCOFI cruise is quarterly, so a tabledap run defaults to five years
  const TABLE_DAYS   = 5 * 365
  const TABLE_WIN    = { days: TABLE_DAYS, minSteps: 1, maxDays: TABLE_DAYS + 2 }
  // a monthly grid is small per step: its window may run the whole record (a CMEMS product is a few
  // hundred steps), where a daily 5 km grid stays capped at 90 days
  const MONTHLY_WIN  = { days: DEFAULT_DAYS, minSteps: MIN_STEPS, maxDays: 40 * 366 }
  const winOpts      = (ds: Dataset | null) => (ds?.protocol === 'tabledap' ? TABLE_WIN : ds?.timeStep === 'P1M' ? MONTHLY_WIN : WIN)
  const iso          = (d: Date) => d.toISOString().slice(0, 10)

  // ── state ───────────────────────────────────────────────────────────────────
  // $state.raw, not $state: deep reactive proxies make every vertex read go through a proxy trap,
  // which turned the FKNMS mask (39,645 vertices) into 67 s of blocked main thread. these are only
  // ever replaced wholesale, so raw state loses nothing.
  let places    = $state.raw<Place[]>([])
  let datasets  = $state.raw<Dataset[]>([])
  // a shared link reproduces the run: #place=…&dataset=…&variable=…&from=…&to=… (+ stat, show, hide),
  // read once, here, before any effect can default the window from the dataset extent
  const HASH    = typeof location === 'undefined' ? {} : decodeHash(location.hash)
  const RAW     = typeof location === 'undefined' ? '' : location.hash
  let hashWindow = Boolean(HASH.from && HASH.to)
  let placeId   = $state(HASH.place ?? 'NMS:HIHWNMS')
  let dsId      = $state(HASH.dataset ?? 'erddap/dhw_5km')
  let varName   = $state(HASH.variable ?? 'CRW_SST')
  let endDate   = $state(HASH.to ?? iso(new Date(Date.now() - LAG_DAYS * 864e5)))
  let startDate = $state(HASH.from ?? iso(new Date(Date.now() - (LAG_DAYS + DEFAULT_DAYS - 1) * 864e5)))
  // the statistic the Time strip draws (`stat=`; the table and the CSV always carry all of them)
  const statQ   = hashParam(RAW, 'stat')
  let stat      = $state<StatId>(isStat(statQ) ? statQ : 'mean_wt')
  // which panes are open (`show=` / `hide=`); a closed pane is folded to its pill
  const PANES0  = decodePanes(RAW, 'stats')
  const VW      = typeof innerWidth === 'number' ? innerWidth : 1280
  const START   = initialPanes(PANES0, VW)
  let controlsFolded = $state(!START.controls)
  let timeFolded     = $state(!START.time)
  let tableFolded    = $state(!START.side)
  const panes   = $derived<Panes>({ controls: !controlsFolded, time: !timeFolded, side: !tableFolded })
  let tab       = $state('place')
  let status    = $state('loading the gazetteer…')
  let error     = $state('')
  let busy      = $state(true)
  let note      = $state('')
  let urls      = $state.raw<{ url: string; kb: number; ms: number }[]>([])
  let rows      = $state.raw<Record<string, any>[]>([])
  let sql       = $state('')
  let mapSql    = $state('')   // the last-time-step query behind the map layer
  let totalMs   = $state(0)
  // the dataset's live time extent, from ERDDAP's info table (the STAC extent end is null/stale)
  let extent    = $state<TimeExtent | null>(null)
  let extentFor = $state('')   // the dataset id `extent` belongs to
  let maskMs    = $state(0)    // time spent masking the grid, reported under Share
  // only the newest run may touch the UI: a run started while another is in flight supersedes it
  const runs    = new Runs()
  let shownVar  = $state.raw<CubeVariable | null>(null)   // the variable `rows` came from
  // the map layer: the last time step of the slab, one square per masked cell (raw, never deep state)
  let squares   = $state.raw<ReturnType<typeof cellSquares> | null>(null)
  let points    = $state.raw<ReturnType<typeof cellPoints> | null>(null)
  let shownProtocol = $state<'griddap' | 'tabledap'>('griddap')
  let stepDate  = $state('')
  let pmtiles   = $state(placesPmtilesUrl())
  // what the results on screen are of: file names, the permalink, the sentence counts and the
  // reproduce panel use this, never the live pickers (which stay editable while a run is in flight)
  let shownRun  = $state.raw<RunState | null>(null)
  let maskInfo  = $state.raw<{ cells: number; weight: number; partial: number; lobes: number } | null>(null)
  let copied    = $state('')
  let exporting = $state('')
  let map: any  = null

  const place   = $derived(places.find((p) => p.place_id === placeId) ?? null)
  const dataset = $derived(datasets.find((d) => d.id === dsId) ?? null)
  const variable = $derived(dataset?.variables.find((v) => v.name === varName) ?? dataset?.variables[0] ?? null)
  // the results on screen belong to the variable that produced them, never to the current picker:
  // a superseded run used to render SST rows through a categorical template ("class NaN")
  const categorical = $derived(shownVar?.categorical === true)
  const nDays   = $derived(Math.round((Date.parse(endDate) - Date.parse(startDate)) / 864e5) + 1)
  const pickedTabular = $derived(dataset?.protocol === 'tabledap')
  const step    = $derived(extent?.stepLabel ?? (dataset?.timeStep === 'P1D' ? 'daily' : undefined))
  const through = $derived(extentFor === dsId && extent ? extent.end.slice(0, 10) : '')
  // categorical rows, labelled and coloured (seascapeR's class table when the collection carries one)
  const classList = $derived(categorical
    ? [...new Set(rows.map((r) => Number(r.class)))].sort((a, b) => a - b)
    : [])
  const classLabel = (c: number) => shownVar?.classes?.[String(c)] ?? `class ${c}`
  const colours = $derived(classColors(classList))
  const catRows = $derived(rows.map((r) => ({
    date    : new Date(r.date),
    class   : Number(r.class),
    label   : classLabel(Number(r.class)),
    fraction: Number(r.fraction),
    n       : Number(r.n),
    percent : Number(r.percent_cells),
  })))
  const fmt     = (v: unknown, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '')

  // ── pickers (the Controls tabs and the sentence chips show the same ones) ───
  const GAZ_GROUP: Record<string, string> = { NMS: 'Sanctuaries', MRGID: 'Marine regions', PSGID: 'Protected areas' }
  const GAZ_ORDER = ['NMS', 'MRGID', 'PSGID']
  const gazRank = (g: string) => { const i = GAZ_ORDER.indexOf(g); return i < 0 ? GAZ_ORDER.length : i }
  const placeItems = $derived<PickerItem[]>([...places].sort((a, b) => gazRank(a.gazetteer) - gazRank(b.gazetteer) || a.name.localeCompare(b.name)).map((p) => ({
    id: p.place_id, label: shortPlace(p.name), group: GAZ_GROUP[p.gazetteer] ?? p.gazetteer,
    keywords: `${p.place_id} ${p.name}`, color: 'var(--facet-place)',
  })))
  const cadenceGroup = (d: Dataset) => d.protocol === 'tabledap' ? 'Samples (tabledap)'
    : d.timeStep === 'P1D' ? 'Daily grids' : d.timeStep === 'P1M' ? 'Monthly grids' : 'Other grids'
  const datasetItems = $derived<PickerItem[]>(datasets.map((d) => ({
    id: d.id, label: d.title, group: cadenceGroup(d), disabled: d.status === 'pending',
    keywords: `${d.id} ${d.variables.map((v) => `${v.name} ${v.description}`).join(' ')}`,
  })))
  const variableOptions = $derived((dataset?.variables ?? []).map((v) => ({
    value: v.name, label: `${variableWords(v.description, v.name)}${v.categorical ? ' (classes)' : ''}`,
  })))
  const statOptions = STATS.map((s) => ({ value: s.id, label: s.label }))

  // ── the sentence ────────────────────────────────────────────────────────────
  const shownDs   = $derived(shownRun ? datasets.find((d) => d.id === shownRun!.dataset) ?? null : null)
  const varLabel  = $derived(variable ? variableWords(variable.description, variable.name) : 'Variable')
  const blurb     = $derived(dataset ? datasetBlurb(dataset.collection, dataset.timeStep, extent?.stepLabel, dataset.protocol) : '')
  const placeLabel = $derived(place ? shortPlace(place.name) : placeId)
  const methodLabel = $derived(pickedTabular ? 'monthly mean' : variable?.categorical ? 'area-weighted class fractions' : statLabel(stat))
  const windowLabel = $derived(pickedTabular ? fmtMonths(startDate, endDate) : fmtRange(startDate, endDate))
  const countWord = $derived(shownProtocol === 'tabledap' ? 'station' : 'cell')
  const unit      = $derived(shownVar ? valueLabel(shownVar) : '')
  const titleText = $derived(`${varLabel}${blurb ? ` (${blurb})` : ''} in ${placeLabel}, ${methodLabel}` +
    (maskInfo ? ` of ${plural(maskInfo.cells, countWord)}` : '') + `, ${windowLabel}`)

  // ── map ─────────────────────────────────────────────────────────────────────
  // the place's bounds; only an antimeridian place (PMNM) costs a geometry walk (see cells.ts)
  const mapBounds = $derived(place ? placeMapBounds(place) : null)
  // a sequential ramp for a measurement, the chart's own class colours for a categorical grid
  const layer     = $derived(squares ?? points)
  const pointRun  = $derived(shownProtocol === 'tabledap')   // the results on screen are tabledap
  const fillColor = $derived.by(() => {
    const l = layer
    if (!l) return '#1f77b4'
    if (categorical)
      return ['match', ['to-string', ['get', 'value']],
              ...classList.flatMap((c) => [String(c), colours.get(String(c)) ?? '#cccccc']),
              '#cccccc'] as any
    return ['case', ['==', ['get', 'value'], null], 'rgba(0,0,0,0)',
            ['interpolate', ['linear'], ['get', 'value'], ...rampStops(l.range[0], l.range[1])]] as any
  })
  const legendItems = $derived(categorical ? classList.map((c) => ({ label: classLabel(c), color: colours.get(String(c))! })) : [])
  const cellText  = $derived(categorical
    ? (v: number) => `${classLabel(v)} (class ${v})`
    : (v: number) => `${v.toFixed(2)} ${unit}`.trim())

  // ── export / reproduce ──────────────────────────────────────────────────────
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  /** the table on screen, as plain rows: ISO dates, class labels, nothing Arrow-shaped. */
  const exportRows = $derived.by(() => rows.map((r: any) => {
    const date = new Date(r.date).toISOString().slice(0, 10)
    if (pointRun)
      return { month: date, n: num(r.n), n_casts: num(r.n_casts), mean: num(r.mean), sd: num(r.sd),
               min: num(r.min), max: num(r.max), p10: num(r.p10), p90: num(r.p90) }
    return categorical
      ? { date, class: num(r.class), label: classLabel(Number(r.class)), n: num(r.n),
          weight: num(r.weight), fraction: num(r.fraction), percent_cells: num(r.percent_cells) }
      : { date, n: num(r.n), mean: num(r.mean), mean_wt: num(r.mean_wt), sd: num(r.sd),
          min: num(r.min), max: num(r.max), p10: num(r.p10), p90: num(r.p90), weight_sum: num(r.weight_sum) }
  }))
  // the view in the URL: the run on screen, the statistic and the panes that differ from the default
  const viewHash = $derived.by(() => {
    if (!shownRun) return ''
    const { show, hide } = encodePanes(paneUrlState(panes, PANES0, VW), 'stats')
    return withExtras(encodeHash(shownRun), { stat: stat !== 'mean_wt' ? stat : null, show, hide })
  })
  const link = $derived(viewHash && typeof location !== 'undefined' ? pageBase() + viewHash : '')
  $effect(() => {
    const h = viewHash
    if (h && typeof history !== 'undefined' && h !== location.hash)
      history.replaceState(null, '', location.pathname + location.search + h)
  })
  /** everything needed to repeat this run outside the browser, as one copyable block. */
  const reproduce = $derived.by(() => {
    if (!shownRun) return ''
    const ds = shownDs
    return [
      `# erddap-places — ${place?.name ?? shownRun.place} (${shownRun.place})`,
      `# dataset ${shownRun.dataset} (${ds?.baseUrl ?? '?'}, ERDDAP ${ds?.version ?? '?'}), ` +
        `variable ${shownRun.variable}, ${shownRun.from} to ${shownRun.to}`,
      `# permalink: ${link}`,
      '',
      `# ${shownProtocol} request(s):`,
      ...urls.map((u) => u.url),
      '',
      maskInfo
        ? (pointRun
            ? `# mask: ${maskInfo.cells} sample positions inside the place, in ${maskInfo.lobes} lobe(s)`
            : `# mask: ${maskInfo.cells} cells in ${maskInfo.lobes} lobe(s), total area weight ` +
              `${maskInfo.weight.toFixed(3)}, ${maskInfo.partial} partial (boundary) cells`)
        : '# mask: —',
      '',
      '-- statistics (sql/' + statsTemplate(shownVar, shownProtocol) + '.sql, run in DuckDB):',
      sql,
      '',
      '-- the map layer (sql/last_step.sql):',
      mapSql,
    ].join('\n')
  })
  // Cite this data: the dataset on screen, the gazetteer, this app with the view's link
  const cite = $derived(shownDs ? citeText({ datasets: [shownDs], accessed: iso(new Date()), url: link, appVersion: __APP_VERSION__ }) : '')

  async function copy(text: string, what: string) {
    copied = (await copyText(text)) ? `copied the ${what}` : `could not copy the ${what}`
    setTimeout(() => { copied = '' }, 2500)
  }
  function saveCsv() {
    if (!exportRows.length || !shownRun) return
    download(toCsv(exportRows as any), resultFileName(shownRun, 'csv'), 'text/csv;charset=utf-8')
  }
  async function saveParquet() {
    if (!exportRows.length || !shownRun) return
    exporting = 'writing Parquet…'
    try {
      const buf = await engine.toParquet(exportRows as any)
      download(buf, resultFileName(shownRun, 'parquet'), 'application/vnd.apache.parquet')
      exporting = ''
    } catch (e) { exporting = `Parquet export failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  async function savePng() {
    if (!map || !shownRun) return
    exporting = 'drawing the PNG…'
    try {
      const canvas = await grabMap(map)
      const blob = await viewPng({ layers: [{ canvas }], title: titleText, dark: theme.dark,
        sub: (stepDate ? `map: ${fmtDay(stepDate)}` : '') + (layer && !categorical ? ` · colour ${layer.range[0].toFixed(2)} to ${layer.range[1].toFixed(2)} ${unit}` : ''),
        stamp: [`${shownDs?.title ?? shownRun.dataset} · ERDDAP ${shownDs?.version ?? ''} · built by Ocean Metrics for MBON`, link] })
      download(blob, resultFileName(shownRun, 'png'), 'image/png')
      exporting = ''
    } catch (e) { exporting = `PNG failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  // ── loading, and running on every change ───────────────────────────────────
  $effect(() => {
    untrack(async () => {
      try {
        const [ps, ds] = await Promise.all([loadPlaces(), loadDatasets()])
        places = ps; datasets = ds
        if (!datasets.some((d) => d.id === dsId && d.status !== 'pending')) dsId = datasets.find((d) => d.status !== 'pending')?.id ?? ''
        pmtiles = placesPmtilesUrl()      // whichever gazetteer base answered
        status = `gazetteer: ${places.length} places, ${datasets.length} ERDDAP datasets`
        if (!places.some((p) => p.place_id === placeId)) { busy = false; error = `no place ${placeId} in the gazetteer` }
      } catch (e) { fail(e); busy = false }
    })
  })

  function fail(e: unknown) {
    error  = e instanceof Error ? e.message : String(e)
    status = 'failed'
  }
  // keep the variable valid when the dataset changes
  $effect(() => { if (dataset && !dataset.variables.some((v) => v.name === varName)) varName = dataset.variables[0]?.name ?? '' })
  // ask the server for the dataset's last time step, and default the window to it
  // (a window that came from the permalink is kept: it is only clamped, never reset)
  $effect(() => {
    const d = dataset
    if (!d || extentFor === d.id) return
    const reset = !hashWindow; hashWindow = false
    loadExtent(d, reset)
  })
  // run on change: once the pickers are valid and the dataset's extent is in, any new
  // place × dataset × variable × window runs after a short pause (typing a date does not stack runs;
  // a run in flight is superseded and aborted, as before)
  let lastKey = ''
  const keyOf = (p: string, d: string, v: string, a: string, b: string) => [p, d, v, a, b].join('|')
  $effect(() => {
    const key = keyOf(placeId, dsId, varName, startDate, endDate)
    const ready = !!place && !!dataset && !!variable && variable.name === varName && extentFor === dsId
    if (!ready || key === lastKey) return
    const t = setTimeout(() => { lastKey = key; untrack(() => run()) }, 250)
    return () => clearTimeout(t)
  })
  // the footer line: "updating… <step>" while busy, the timings once done
  $effect(() => { chrome.busy = busy; chrome.step = busy ? status : '' })
  $effect(() => {
    const d = shownDs
    chrome.release = d ? `${d.title} · ERDDAP ${d.version ?? '?'}${through && extentFor === d.id ? ` · data through ${fmtDay(through)}` : ''}` : ''
  })
  $effect(() => {
    const kb = urls.reduce((a, u) => a + u.kb, 0)
    chrome.timing = shownRun ? `${plural(rows.length, 'row')} · ${kb.toLocaleString('en-US')} kB · ${(totalMs / 1000).toFixed(1)} s (mask ${(maskMs / 1000).toFixed(2)} s)` : ''
  })

  /** the live extent for a dataset (memoised in extent.ts); resets the window when asked. */
  async function loadExtent(ds: Dataset, reset = false, signal?: AbortSignal): Promise<TimeExtent | null> {
    let ext = await fetchTimeExtent(ds.baseUrl, ds.datasetId, 'time', signal)
    // some tabledap datasets publish neither `time` actual_range nor time_coverage_* (CalCOFI does
    // not): fall back to the extent the STAC collection records
    if (!ext && ds.timeExtent?.[0] && ds.timeExtent?.[1])
      ext = { start: String(ds.timeExtent[0]), end: String(ds.timeExtent[1]) }
    if (dataset?.id !== ds.id) return ext        // the user moved on while we were fetching
    extent = ext; extentFor = ds.id
    if (reset && ext) { const w = defaultWindow(ext, winOpts(ds)); startDate = w.start; endDate = w.end }
    return ext
  }

  // ── pipeline ────────────────────────────────────────────────────────────────
  async function run() {
    if (!place || !dataset || !variable) return
    const ds = dataset, v = variable, p = place
    const superseding = runs.active
    const h: RunHandle = runs.start()      // aborts whatever was in flight
    busy = true; error = ''; rows = []; urls = []; note = ''; shownVar = null
    squares = null; points = null; stepDate = ''; shownRun = null; maskInfo = null; copied = ''; exporting = ''
    if (superseding) status = 'superseding the run in flight…'
    const t0 = performance.now()
    try {
      if (!(nDays > 0)) throw new Error('the end date must be on or after the start date')
      // the window must sit inside what the server actually holds: an out-of-range start snaps back
      // to the last steps of the dataset instead of 404ing on `"Start" is greater than the axis maximum`
      status = 'reading the dataset time extent…'
      const ext = extentFor === ds.id ? extent : await loadExtent(ds, false, h.signal)
      if (h.stale()) return
      const opts = winOpts(ds), cap = opts.maxDays
      const win = clampWindow({ start: startDate, end: endDate }, ext, opts)
      if (win.snapped) note = `window ${win.reason}`
      let end = win.end, start = win.start
      if (daysBetween(start, end) + 1 > cap) start = iso(new Date(Date.parse(end) - (cap - 1) * 864e5))
      // the clamped window is what ran: the run-on-change effect must not see it as a new pick
      lastKey = keyOf(p.place_id, ds.id, v.name, start, end)
      startDate = start; endDate = end
      const days = daysBetween(start, end) + 1
      const steps = Math.max(1, Math.round(days / (ext?.stepDays ?? 1)))

      // the mask works on a plain copy: nothing reactive, and no geometry work happens before a run
      const lobes   = placeLobes(plainPlace(p))
      maskMs = 0
      const cells: MaskCell[] = []
      const files: string[] = []
      const shifted = ds.lonRange[1] > 180      // dataset longitudes run 0..360
      const toPoly  = (x: number) => (shifted && x > 180 ? x - 360 : x)

      const tabular = ds.protocol === 'tabledap'
      const long    = ds.longFormat

      for (const [i, lobe] of lobes.entries()) {
        if (tabular) {
          // tabledap: no axis vectors and no lattice — ask for the place bbox and the window, then
          // mask the positions that come back by point-in-polygon (below, once the slab is in)
          const cols = ['longitude', 'latitude', 'time',
                        ...(ds.collection?.['cube:dimensions']?.depth ? ['depth'] : []),
                        ...(long ? [long.typeColumn, long.valueColumn] : [v.name])]
          const url = tabledapUrl({
            base: ds.baseUrl, datasetId: ds.datasetId, columns: cols, format: ds.format,
            callback: `erddapCb${i}`,
            constraints: tabledapPlaceConstraints({
              bbox: lobe.bbox, from: start, to: end,
              typeColumn: long?.typeColumn, typeValue: long ? v.name : undefined,
            }),
          })
          status = `lobe ${i + 1}/${lobes.length}: fetching ${v.name} samples, ${start} to ${end}, as .${ds.format}…`
          const slab = await fetchSlab(url, ds.format, `erddapCb${i}`, h.signal)
          if (h.stale()) return
          const file = isParquet(ds.format) ? `slab_${i}.parquet` : `slab_${i}`
          if (isParquet(ds.format)) await engine.registerBuffer(file, slab.buffer!)
          else                      await engine.insertRows(slab.rows ?? [], file)
          if (h.stale()) return
          files.push(file)
          urls = [...urls, { url, kb: Math.round((slab.bytes ?? 0) / 1024), ms: Math.round(slab.ms) }]
          continue
        }
        const [lo, hi] = lobeLonSpan(lobe.bbox, ds.lonRange)
        status = `lobe ${i + 1}/${lobes.length}: ERDDAP axis vectors…`
        const [lonSrv, lat] = await Promise.all([
          fetchAxis(ds.baseUrl, ds.datasetId, 'longitude', lo, hi, false, h.signal),
          fetchAxis(ds.baseUrl, ds.datasetId, 'latitude',  lobe.bbox[1], lobe.bbox[3], ds.latDescending, h.signal),
        ])
        if (h.stale()) return
        status = `lobe ${i + 1}/${lobes.length}: masking the grid…`
        const m = gridMask(lobe.geojson, lonSrv.map(toPoly), lat)
        maskMs += m.ms
        status = `lobe ${i + 1}/${lobes.length}: masked ${m.nInside} cells (${m.method}) in ${(m.ms / 1000).toFixed(2)} s`
        // mask cells go back into the server's own longitude frame, so they join the slab directly
        for (const c of m.cells) cells.push(shifted ? { ...c, lon: toDatasetLon(c.lon, ds.lonRange) } : c)

        const url = griddapUrl({
          base: ds.baseUrl, datasetId: ds.datasetId, variable: v.name,
          time: [timeInstant(start, ext, noonZ), timeInstant(end, ext, noonZ)],
          lat : [lat[lat.length - 1], lat[0]], lon: [lonSrv[0], lonSrv[lonSrv.length - 1]],
          latDescending: ds.latDescending, depth: ds.depth, format: ds.format,
        })
        status = `lobe ${i + 1}/${lobes.length}: fetching ${days} days (${steps} ${ext?.stepLabel ?? 'daily'} step${steps > 1 ? 's' : ''}) of ${v.name} as .${ds.format} (this can take 15–30 s)…`
        const slab = await fetchSlab(url, ds.format, `erddapCb${i}`, h.signal)
        if (h.stale()) return
        const file = isParquet(ds.format) ? `slab_${i}.parquet` : `slab_${i}`
        if (isParquet(ds.format)) await engine.registerBuffer(file, slab.buffer!)
        else                      await engine.insertRows(slab.rows ?? [], file)
        if (h.stale()) return
        files.push(file)
        urls = [...urls, { url, kb: Math.round((slab.bytes ?? 0) / 1024), ms: Math.round(slab.ms) }]
      }

      const slab = isParquet(ds.format)
        ? `read_parquet([${files.map((f) => `'${f}'`).join(', ')}])`   // the lobes, unioned
        : `(${files.map((f) => `SELECT * FROM ${f}`).join(' UNION ALL ')})`
      const expr = valueExpr(v, 's', long)

      // tabledap has no lattice: the stations come back out of the slab and are masked by
      // point-in-polygon, then go into the same `mask` table the grid path uses (weight 1)
      if (tabular) {
        status = 'masking the sample positions…'
        const stations = await engine.exec(`SELECT DISTINCT longitude, latitude FROM ${slab}`, 'stations')
        if (h.stale()) return
        const pts = stations.map((r: any) => ({ lon: Number(r.longitude), lat: Number(r.latitude) }))
        for (const lobe of lobes) {
          const m = pointMask(lobe.geojson, pts)
          maskMs += m.ms
          for (const c of m.cells) cells.push(c)
        }
        status = `${cells.length} of ${pts.length} sample positions are inside ${p.name}`
      }

      status = 'computing the statistics…'
      await engine.insertMask(cells)
      if (h.stale()) return
      const out = await engine.runTemplate(statsTemplate(v, ds.protocol), { expr, slab, mask: 'mask' })
      if (h.stale()) return                 // a newer pick is on screen: do not render this result
      rows = out; shownVar = v; shownProtocol = ds.protocol
      sql  = engine.lastSql
      // the map layer: a square per grid cell, or a point per tabledap station
      const last = await engine.runTemplate(tabular ? 'points_tabledap' : 'last_step',
                                            { expr, slab, mask: 'mask' })
      if (h.stale()) return
      mapSql  = engine.lastSql
      // for a station the "weight" slot carries the number of measurements averaged into the dot
      const vcells: ValueCell[] = last.map((r: any) => ({
        lon: Number(r.longitude), lat: Number(r.latitude),
        weight: Number(tabular ? r.n : r.weight), value: r.value === null ? null : Number(r.value) }))
      // a grid draws its cells as squares; tabledap stations are points
      squares = tabular ? null : cellSquares(vcells)
      points  = tabular ? cellPoints(vcells) : null
      stepDate = last.length
        ? new Date(Math.max(...last.map((r: any) => +new Date(r.date)))).toISOString().slice(0, 10)
        : ''
      totalMs = performance.now() - t0
      // what the exports, the reproduce panel and the permalink describe
      shownRun = { place: p.place_id, dataset: ds.id, variable: v.name, from: start, to: end }
      maskInfo = { cells: cells.length, lobes: lobes.length,
                   weight: cells.reduce((a, c) => a + c.weight, 0),
                   partial: cells.filter((c) => c.weight < 0.999).length }
      // tabledap counts stations and rolls up by month; a grid counts cells and time steps
      note = (win.snapped ? `window ${win.reason}. ` : '') +
             `${lobes.length} lobe${lobes.length > 1 ? 's' : ''}, ` +
             (tabular
               ? `${cells.length} station${cells.length === 1 ? '' : 's'} inside the place, ` +
                 `${start} to ${end}, monthly roll-up, `
               : `${cells.length} masked cells, ` +
                 `${start} to ${end} = ${steps} ${ext?.stepLabel ?? 'daily'} step${steps > 1 ? 's' : ''}, `) +
             `mask ${(maskMs / 1000).toFixed(2)} s, ` +
             `ERDDAP ${ds.version ?? '?'} (.${ds.format})`
      status = `done: ${rows.length} rows for ${p.name} in ${(totalMs / 1000).toFixed(1)} s ` +
               `(mask ${(maskMs / 1000).toFixed(2)} s)`
    } catch (e) {
      if (!h.stale() && !isAbort(e)) fail(e)
    } finally {
      runs.finish(h)
      if (!h.stale()) busy = false          // a superseded run leaves `busy` to the run that took over
    }
  }

  // ── the Time strip ──────────────────────────────────────────────────────────
  // the window sits inside a context span (the window again on each side, within the dataset's
  // extent) and is drawn as the brush; dragging a new brush sets the window and runs it. no extra
  // data is fetched for the context: only the window is ever requested.
  const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
  const ctx = $derived.by((): [number, number] => {
    const len = Math.max(1, nDays)
    let a = ms(addDays(startDate, -len)), b = ms(addDays(endDate, len))
    if (extent?.start) a = Math.max(a, Math.min(ms(startDate), ms(extent.start.slice(0, 10))))
    if (extent?.end)   b = Math.min(b, Math.max(ms(endDate), ms(extent.end.slice(0, 10))))
    if (!(b > a)) b = a + 864e5
    return [a, b + 864e5]
  })
  const winBrush = $derived<[number, number] | null>(Number.isFinite(ctx[0]) && nDays > 0
    ? [(ms(startDate) - ctx[0]) / (ctx[1] - ctx[0]), (ms(endDate) + 864e5 - ctx[0]) / (ctx[1] - ctx[0])] : null)
  let brush = $state<[number, number] | null>(null)
  $effect(() => { brush = winBrush })
  let stripH = $state(150)
  const PL = 52, PR = 14
  function onbrushend(r: BrushRange) {
    if (r.v0 === undefined || r.v1 === undefined) return
    let a = iso(new Date(Math.round(r.v0 / 864e5) * 864e5)), b = iso(new Date(Math.round(r.v1 / 864e5) * 864e5 - 864e5))
    if (b < a) b = a
    const cap = winOpts(dataset).maxDays
    if (daysBetween(a, b) + 1 > cap) a = addDays(b, -(cap - 1))
    startDate = a; endDate = b
    brush = winBrush
  }
  const ink  = $derived(theme.dark ? '#c4d7e0' : '#44606e')
  const main = $derived(theme.dark ? '#6fc3d3' : '#2456b8')
  const alt  = $derived(theme.dark ? '#f5b53f' : '#b5651d')
  // the comparison line: the unweighted mean beside the area-weighted one (and vice versa)
  const altStat = $derived<StatId>(stat === 'mean_wt' ? 'mean' : 'mean_wt')
  const stripTitle = $derived(pointRun ? 'monthly mean · min–max' : categorical ? 'class fractions of the place area'
    : `${statLabel(stat)} · ${step ?? 'daily'}${unit ? ` · ${unit}` : ''}`)

  function chart(width: number, height: number): Element | null {
    if (!rows.length || !shownVar) return null
    const x = { domain: [new Date(ctx[0]), new Date(ctx[1])], type: 'utc' as const, label: null,
                ticks: Math.max(2, Math.floor(width / 90)), tickFormat: pointRun ? '%b %Y' : '%-d %b' }
    const base = { width, height, marginLeft: PL, marginRight: PR, marginTop: 8, marginBottom: 22,
                   style: { background: 'transparent', color: ink, fontSize: '10px' } }
    if (pointRun)
      return Plot.plot({ ...base, x, y: { label: null, grid: true },
        marks: [
          Plot.areaY(rows, { x: (r: any) => new Date(r.date), y1: 'min', y2: 'max', fill: main, fillOpacity: 0.15, curve: 'step' }),
          Plot.line(rows, { x: (r: any) => new Date(r.date), y: 'mean', stroke: main, strokeWidth: 1.8 }),
          Plot.dot(rows,  { x: (r: any) => new Date(r.date), y: 'mean', fill: main, r: 2.5,
            title: (r: any) => `${new Date(r.date).toISOString().slice(0, 7)}\n${Number(r.mean).toFixed(2)}\n${r.n} measurements, ${r.n_casts} casts` }),
        ] })
    if (categorical) {
      const domain = classList.map(classLabel)
      return Plot.plot({ ...base, x, y: { label: null, grid: true, percent: true },
        color: { domain, range: classList.map((c) => colours.get(String(c))!) },
        marks: [
          Plot.areaY(catRows, { x: 'date', y: 'fraction', fill: 'label', offset: 'normalize', order: domain, curve: 'step',
            title: (d: any) => `${d.date.toISOString().slice(0, 10)}\n${d.label}\n${(d.fraction * 100).toFixed(1)}% of area, ${d.n} cells` }),
          Plot.ruleY([0]),
        ] })
    }
    const pts = (k: string) => rows.map((r) => ({ date: new Date(r.date), value: r[k] }))
    return Plot.plot({ ...base, x, y: { label: null, grid: true },
      marks: [
        Plot.areaY(rows, { x: (r: any) => new Date(r.date), y1: 'p10', y2: 'p90', fill: main, fillOpacity: 0.13 }),
        // the comparison: thin and dashed, so two lines 0.04 °C apart stay two lines
        ...(stat === 'mean_wt' || stat === 'mean'
          ? [Plot.line(pts(altStat), { x: 'date', y: 'value', stroke: alt, strokeWidth: 1.2, strokeDasharray: '4,3' })] : []),
        Plot.line(pts(stat), { x: 'date', y: 'value', stroke: main, strokeWidth: 2 }),
        Plot.dot(pts(stat), { x: 'date', y: 'value', fill: main, r: 2,
          title: (d: any) => `${d.date.toISOString().slice(0, 10)}\n${statLabel(stat)} ${fmt(d.value)} ${unit}` }),
      ] })
  }

  const tableLabel = $derived(pointRun ? `Table · ${plural(rows.length, 'month')}`
    : categorical ? `Table · ${plural(new Set(rows.map((r) => r.date)).size, 'day')}` : `Table · ${plural(rows.length, 'day')}`)
  const switchLens = () => setLens?.('then-now', { place: placeId, panes })

  // what Help, the tour and the shortcuts may ask of this lens (once: the Shell re-mounts a lens to change it)
  // svelte-ignore state_referenced_locally
  register?.({
    ui   : () => ({ tab, controls: !controlsFolded, time: !timeFolded, side: !tableFolded }),
    setUi: (u) => {
      if (u.tab) tab = u.tab
      if (u.controls !== undefined) controlsFolded = !u.controls
      if (u.time !== undefined) timeFolded = !u.time
      if (u.side !== undefined) tableFolded = !u.side
    },
    switchLens,
    sentence: () => titleText,
    maps    : () => (map ? [map] : []),
    cite    : () => cite,
  })
</script>

{#snippet placePicker(close?: () => void)}
  <Picker items={placeItems} value={placeId} label="places" placeholder="Search places…" maxHeight={close ? '16rem' : '11rem'}
          onselect={(it) => { placeId = it.id; close?.() }} />
{/snippet}
{#snippet datasetPicker(close?: () => void)}
  <div class="pane-col">
    <Picker items={datasetItems} value={dsId} label="datasets" placeholder="Search datasets…" maxHeight={close ? '13rem' : '11rem'}
            onselect={(it) => { dsId = it.id }} />
    {#if dataset}
      <Select label="Variable" value={varName} options={variableOptions} onchange={(v) => { varName = v; close?.() }} />
      <p class="pane-note">{blurb}{through ? ` · ${fmtDay(extent?.start ?? '')} – ${fmtDay(through)}` : ''}</p>
    {/if}
  </div>
{/snippet}
{#snippet lensSwitch()}
  <div class="lens-switch" role="group" aria-label="lens">
    <Button variant="quiet" size="sm" pressed={true}>Window statistics</Button>
    <Button variant="quiet" size="sm" pressed={false} onclick={switchLens}>Then vs Now</Button>
  </div>
{/snippet}
{#snippet methodPanel()}
  <div class="pane-col">
    {@render lensSwitch()}
    {#if pickedTabular}
      <p class="pane-note">Sample data: every measurement at a station inside the place, rolled up by month (mean, sd, min, max, p10, p90).</p>
    {:else if variable?.categorical}
      <p class="pane-note">Classes: the share of the place's area in each class per time step, each cell weighted by the share of its area inside the place.</p>
    {:else}
      <Select label="Statistic (the Time strip)" value={stat} options={statOptions} onchange={(v) => { stat = v as StatId }} />
      <p class="pane-note">Mask: each grid cell weighted by the share of its area inside the place{maskInfo && !pointRun ? ` (${plural(maskInfo.cells, 'cell')}, ${maskInfo.partial} on the boundary)` : ''}. The table and the CSV carry every statistic.</p>
    {/if}
    {@render windowPanel()}
  </div>
{/snippet}
{#snippet windowPanel()}
  <div class="pane-row">
    <label class="pane-field">from <input type="date" bind:value={startDate} min={extent?.start?.slice(0, 10)} max={through || undefined} /></label>
    <label class="pane-field">to <input type="date" bind:value={endDate} min={extent?.start?.slice(0, 10)} max={through || undefined} /></label>
  </div>
  <p class="pane-note">{pickedTabular ? 'Up to five years, monthly roll-up.' : dataset?.timeStep === 'P1M' ? 'Monthly steps, the whole record if you like' : `Up to ${MAX_DAYS} days`}{through ? `; data through ${fmtDay(through)}` : ''}{step && step !== 'daily' ? ` (${step} steps)` : ''}. Or drag on the Time strip.</p>
{/snippet}
{#snippet sharePanel()}
  <div class="pane-col">
    <div class="pane-row">
      <Button variant="action" size="sm" onclick={saveCsv} disabled={!rows.length}>Download CSV</Button>
      <Button variant="quiet" size="sm" onclick={saveParquet} disabled={!rows.length}>Parquet</Button>
      <Button variant="quiet" size="sm" onclick={savePng} disabled={!shownRun}>PNG of the view</Button>
    </div>
    <div class="pane-row">
      <Button variant="quiet" size="sm" onclick={() => copy(link, 'link')} disabled={!link}>Copy link</Button>
      <Button variant="quiet" size="sm" onclick={() => copy(cite, 'citation')} disabled={!cite}>Copy citation</Button>
      {#if copied || exporting}<span class="pane-note" role="status">{copied || exporting}</span>{/if}
    </div>
    {#if cite}
      <details class="pane-details cite-this">
        <summary>Cite this data</summary>
        <div class="pane-col">
          <pre class="pane-pre cite">{cite}</pre>
          <Button variant="quiet" size="sm" onclick={() => copy(cite, 'citation')}>Copy citation</Button>
        </div>
      </details>
    {/if}
    {#if shownRun}
      <details class="pane-details">
        <summary>Reproduce: requests, mask, SQL and timing</summary>
        <div class="pane-col">
          <Button variant="quiet" size="sm" onclick={() => copy(reproduce, 'reproduce block')}>Copy all</Button>
          {#each urls as u}
            <p class="pane-mono"><a href={u.url} target="_blank" rel="noreferrer">{u.url}</a> — {u.kb} kB in {(u.ms / 1000).toFixed(1)} s</p>
          {/each}
          {#if maskInfo && pointRun}
            <p class="pane-note">{plural(maskInfo.cells, 'sample position')} inside the place, in {plural(maskInfo.lobes, 'lobe')}</p>
          {:else if maskInfo}
            <p class="pane-note">{plural(maskInfo.cells, 'cell')} in {plural(maskInfo.lobes, 'lobe')}, total area weight {maskInfo.weight.toFixed(3)}, {plural(maskInfo.partial, 'partial (boundary) cell')}</p>
          {/if}
          {#if note}<p class="pane-note">{note}</p>{/if}
          <span class="mbon-label">sql/{statsTemplate(shownVar, shownProtocol)}.sql</span>
          <pre class="pane-pre">{sql}</pre>
          <span class="mbon-label">sql/{pointRun ? 'points_tabledap' : 'last_step'}.sql (the map layer)</span>
          <pre class="pane-pre">{mapSql}</pre>
        </div>
      </details>
    {/if}
  </div>
{/snippet}

<div class="lens" data-state={error ? 'error' : busy ? 'loading' : shownRun ? 'done' : 'idle'}>
  <div class="sentence-bar">
    <Sentence>
      <Chip label={varLabel} facet="dataset" title="choose a dataset and variable" width="24rem">
        {#snippet children(close)}{@render datasetPicker(close)}{/snippet}
      </Chip>
      {#if blurb}<span class="paren">({blurb})</span>{/if}
      in
      <span class="nw"><Chip label={placeLabel} facet="place" title="choose a place" width="22rem">
        {#snippet children(close)}{@render placePicker(close)}{/snippet}
      </Chip>,</span>
      <span class="nw"><Chip label={methodLabel} facet="method" title="choose the method" width="22rem">
        {#snippet children()}{@render methodPanel()}{/snippet}
      </Chip>{#if maskInfo}&nbsp;of <span class="num">{plural(maskInfo.cells, countWord)}</span>,{:else},{/if}</span>
      <Chip label={windowLabel} facet="method" title="choose the window" width="20rem">
        {#snippet children()}<div class="pane-col">{@render windowPanel()}</div>{/snippet}
      </Chip>
      {#snippet sub()}
        {#if layer && categorical}
          <Legend type="categorical" items={legendItems} />
        {:else if layer}
          <Legend title={`${shownVar?.name ?? ''} ${unit ? `(${unit})` : ''}`} colors={VIRIDIS_9} domain={layer.range} />
        {/if}
        <span class="counts">
          {#if stepDate}map: {fmtDay(stepDate)}{/if}
          {#if maskInfo && !pointRun} · {plural(maskInfo.cells, 'cell')} · {maskInfo.partial} on the boundary{/if}
          {#if maskInfo && pointRun} · {plural(maskInfo.cells, 'station')}{/if}
          {#if note && /snapped|capped|clamp/i.test(note)} · {note.split('. ')[0]}{/if}
        </span>
      {/snippet}
    </Sentence>
  </div>

  <div class="stage" style:--map-bottom={timeFolded ? '52px' : `${stripH + 58}px`}>
    <MapView
      pmtilesUrl={pmtiles}
      {placeId}
      onselect={(id) => { placeId = id }}
      bounds={mapBounds}
      squares={squares?.geojson ?? null}
      points={points?.geojson ?? null}
      {fillColor}
      dark={theme.dark}
      padding={fitPadding(VW, START, 150)}
      onmap={(m) => { map = m }}
      valueLabel={shownVar ? (categorical ? shownVar.name : `${shownVar.name}${unit && unit !== shownVar.name ? ` (${unit})` : ''}`) : 'place'}
      valueText={cellText}
      weightLabel={pointRun ? 'measurements' : 'area weight'}
      weightText={pointRun ? (v) => String(Math.round(v)) : undefined} />

    {#if error}
      <div class="toast"><Notice kind="error" ondismiss={() => { error = '' }}>{error}</Notice></div>
    {/if}

    <Controls id="ep-controls" title="controls" width={390} bind:active={tab} bind:collapsed={controlsFolded}
      tabs={[{ id: 'place', label: 'Place' }, { id: 'data', label: 'Dataset & variable' }, { id: 'method', label: 'Method' }, { id: 'share', label: 'Share' }]}>
      {#snippet tabLabel(t)}<span class="tab-label">{t.label}</span>{/snippet}
      {#snippet panel(id)}
        {#if id === 'place'}
          <div class="pane-col">
            {@render placePicker()}
            {#if place}<p class="pane-note">{place.name} · {place.place_id}{place.area_km2 ? ` · ${Math.round(place.area_km2).toLocaleString('en-US')} km²` : ''}. Or click a place on the map.</p>{/if}
          </div>
        {:else if id === 'data'}
          {@render datasetPicker()}
        {:else if id === 'method'}
          {@render methodPanel()}
        {:else}
          {@render sharePanel()}
        {/if}
      {/snippet}
      {#snippet footer()}{maskInfo ? `${plural(maskInfo.cells, countWord)} · ` : ''}{dataset?.title ?? ''}{busy ? ' · updating…' : ''}{/snippet}
    </Controls>

    <Pane title="table" id="ep-table" class="edge-pane" anchor="top-right" offset={{ x: 0, y: 130 }} width={380} height={300}
          bind:collapsed={tableFolded} pillLabel={rows.length ? tableLabel : 'Table'}>
      {#snippet actions()}
        <Menu label="⬇" ariaLabel="Export the table" align="end">
          {#snippet children(close)}
            <button type="button" onclick={() => { saveCsv(); close() }}>CSV</button>
            <button type="button" onclick={() => { saveParquet(); close() }}>Parquet</button>
          {/snippet}
        </Menu>
      {/snippet}
      <div class="table-wrap">
        {#if rows.length && pointRun}
          <table class="data-table">
            <thead><tr><th>month</th><th>n</th><th>casts</th><th>mean</th><th>sd</th><th>min</th><th>max</th><th>p10</th><th>p90</th></tr></thead>
            <tbody>
              {#each rows as r}
                <tr>
                  <td>{new Date(r.date).toISOString().slice(0, 7)}</td><td>{r.n}</td><td>{r.n_casts}</td>
                  <td>{fmt(r.mean)}</td><td>{fmt(r.sd)}</td><td>{fmt(r.min)}</td><td>{fmt(r.max)}</td>
                  <td>{fmt(r.p10)}</td><td>{fmt(r.p90)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if rows.length && categorical}
          <table class="data-table">
            <thead><tr><th>date</th><th>class</th><th>label</th><th>cells</th><th>area weight</th><th>fraction of area</th><th>% of cells</th></tr></thead>
            <tbody>
              {#each catRows as r}
                <tr>
                  <td>{r.date.toISOString().slice(0, 10)}</td>
                  <td><span class="swatch" style:background={colours.get(String(r.class))}></span>{r.class}</td>
                  <td>{r.label}</td><td>{r.n}</td><td>{fmt(rows.find((x) => x.date === +r.date && Number(x.class) === r.class)?.weight)}</td>
                  <td>{(r.fraction * 100).toFixed(1)}%</td><td>{r.percent.toFixed(1)}%</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if rows.length}
          <table class="data-table">
            <thead><tr><th>date</th><th>n</th><th>area-wtd mean</th><th>mean</th><th>sd</th><th>min</th><th>max</th><th>p10</th><th>p90</th></tr></thead>
            <tbody>
              {#each rows as r}
                <tr>
                  <td>{new Date(r.date).toISOString().slice(0, 10)}</td><td>{r.n}</td><td>{fmt(r.mean_wt)}</td><td>{fmt(r.mean)}</td>
                  <td>{fmt(r.sd)}</td><td>{fmt(r.min)}</td><td>{fmt(r.max)}</td><td>{fmt(r.p10)}</td><td>{fmt(r.p90)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="pane-note">{busy ? 'updating…' : 'no rows yet'}</p>
        {/if}
      </div>
    </Pane>

    <TimeStrip title={stripTitle} bind:collapsed={timeFolded} bind:height={stripH} minHeight={90} maxHeight={360}
               domain={ctx} plotLeft={PL} plotRight={PR} bind:brush {onbrushend} onclear={() => { brush = winBrush }}>
      {#snippet actions()}
        {#if rows.length && !categorical && !pointRun}
          <span class="chart-key" aria-label="chart key">
            <span><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={main} stroke-width="2" /></svg> {statLabel(stat)}</span>
            {#if stat === 'mean_wt' || stat === 'mean'}
              <span><svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={alt} stroke-width="1.4" stroke-dasharray="4,3" /></svg> {statLabel(altStat)}</span>
            {/if}
            <span><svg width="14" height="8" aria-hidden="true"><rect width="14" height="8" fill={main} fill-opacity="0.18" /></svg> p10–p90</span>
          </span>
        {/if}
      {/snippet}
      {#snippet children({ width, height })}
        <PlotBox make={chart} {width} {height} />
      {/snippet}
    </TimeStrip>
  </div>
</div>

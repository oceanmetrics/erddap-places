<script lang="ts">
  // place-based statistics in the browser: pick a place from the published gazetteer and a variable
  // from a STAC-described ERDDAP dataset, mask the grid, fetch one griddap slab per lobe, aggregate
  // with DuckDB-WASM. Nothing but ERDDAP itself is in the request path.
  import { onMount } from 'svelte'
  import * as Plot from '@observablehq/plot'
  import { gridMask, type MaskCell } from './lib/gridMask'
  import { fetchAxis, fetchSlab, griddapUrl, noonZ } from './lib/erddap'
  import { engine } from './lib/engine'
  import { gazetteerBase, loadPlaces, placeLobes, type Place } from './lib/gazetteer'
  import { loadDatasets, statsTemplate, toDatasetLon, valueExpr, valueLabel, type Dataset } from './lib/catalog'
  import { clampWindow, daysBetween, defaultWindow, fetchTimeExtent, timeInstant, type TimeExtent } from './lib/extent'
  import { classColors } from './lib/palette'

  const MAX_DAYS     = 90
  const DEFAULT_DAYS = 30
  const LAG_DAYS     = 2      // most near-real-time grids are a couple of days behind
  const MIN_STEPS    = 8      // a coarse product (8-day Seascapes) still gets this many time steps
  const WIN          = { days: DEFAULT_DAYS, minSteps: MIN_STEPS, maxDays: MAX_DAYS }
  const iso          = (d: Date) => d.toISOString().slice(0, 10)

  // ── state ───────────────────────────────────────────────────────────────────
  let places    = $state<Place[]>([])
  let datasets  = $state<Dataset[]>([])
  let placeId   = $state('NMS:HIHWNMS')
  let dsId      = $state('erddap/dhw_5km')
  let varName   = $state('CRW_SST')
  let endDate   = $state(iso(new Date(Date.now() - LAG_DAYS * 864e5)))
  let startDate = $state(iso(new Date(Date.now() - (LAG_DAYS + DEFAULT_DAYS - 1) * 864e5)))
  let status    = $state('loading the gazetteer…')
  let error     = $state('')
  let busy      = $state(false)
  let note      = $state('')
  let urls      = $state<{ url: string; kb: number; ms: number }[]>([])
  let rows      = $state<Record<string, any>[]>([])
  let sql       = $state('')
  let totalMs   = $state(0)
  let chartEl   = $state<HTMLDivElement | null>(null)
  // the dataset's live time extent, from ERDDAP's info table (the STAC extent end is null/stale)
  let extent    = $state<TimeExtent | null>(null)
  let extentFor = $state('')   // the dataset id `extent` belongs to

  const place   = $derived(places.find((p) => p.place_id === placeId) ?? null)
  const dataset = $derived(datasets.find((d) => d.id === dsId) ?? null)
  const variable = $derived(dataset?.variables.find((v) => v.name === varName) ?? dataset?.variables[0] ?? null)
  const groups  = $derived([...new Set(places.map((p) => p.gazetteer))].map((g) => ({ g, ps: places.filter((p) => p.gazetteer === g) })))
  const categorical = $derived(variable?.categorical === true)
  const nDays   = $derived(Math.round((Date.parse(endDate) - Date.parse(startDate)) / 864e5) + 1)
  const step    = $derived(extent?.stepLabel ?? (dataset?.timeStep === 'P1D' ? 'daily' : undefined))
  const nSteps  = $derived(Math.max(1, Math.round(nDays / (extent?.stepDays ?? 1))))
  const through = $derived(extentFor === dsId && extent ? `data through ${extent.end.slice(0, 10)}` +
                           (step && step !== 'daily' ? ` (${step} steps)` : '') : '')
  // categorical rows, labelled and coloured (seascapeR's class table when the collection carries one)
  const classList = $derived(categorical
    ? [...new Set(rows.map((r) => Number(r.class)))].sort((a, b) => a - b)
    : [])
  const classLabel = (c: number) => variable?.classes?.[String(c)] ?? `class ${c}`
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

  onMount(async () => {
    try {
      const [ps, ds] = await Promise.all([loadPlaces(), loadDatasets()])
      places = ps; datasets = ds
      if (!datasets.some((d) => d.id === dsId)) dsId = datasets[0]?.id ?? ''
      status = `gazetteer: ${places.length} places, ${datasets.length} ERDDAP datasets (${gazetteerBase()})`
      await run()
    } catch (e) { fail(e) }
  })

  function fail(e: unknown) {
    error  = e instanceof Error ? e.message : String(e)
    status = 'failed'
  }
  // keep the variable valid when the dataset changes
  $effect(() => { if (dataset && !dataset.variables.some((v) => v.name === varName)) varName = dataset.variables[0]?.name ?? '' })
  // ask the server for the dataset's last time step, and default the window to it
  $effect(() => { const d = dataset; if (d && extentFor !== d.id) loadExtent(d, true) })

  /** the live extent for a dataset (memoised in extent.ts); resets the window when asked. */
  async function loadExtent(ds: Dataset, reset = false): Promise<TimeExtent | null> {
    const ext = await fetchTimeExtent(ds.baseUrl, ds.datasetId)
    if (dataset?.id !== ds.id) return ext        // the user moved on while we were fetching
    extent = ext; extentFor = ds.id
    if (reset && ext) { const w = defaultWindow(ext, WIN); startDate = w.start; endDate = w.end }
    return ext
  }

  // ── pipeline ────────────────────────────────────────────────────────────────
  async function run() {
    if (!place || !dataset || !variable || busy) return
    const ds = dataset, v = variable
    busy = true; error = ''; rows = []; urls = []; note = ''
    const t0 = performance.now()
    try {
      if (!(nDays > 0)) throw new Error('the end date must be on or after the start date')
      // the window must sit inside what the server actually holds: an out-of-range start snaps back
      // to the last steps of the dataset instead of 404ing on `"Start" is greater than the axis maximum`
      status = 'reading the dataset time extent…'
      const ext = extentFor === ds.id ? extent : await loadExtent(ds)
      const win = clampWindow({ start: startDate, end: endDate }, ext, WIN)
      if (win.snapped) note = `window ${win.reason}`
      let end = win.end, start = win.start
      if (daysBetween(start, end) + 1 > MAX_DAYS) start = iso(new Date(Date.parse(end) - (MAX_DAYS - 1) * 864e5))
      startDate = start; endDate = end
      const days = daysBetween(start, end) + 1
      const steps = Math.max(1, Math.round(days / (ext?.stepDays ?? 1)))

      const lobes   = placeLobes(place)
      const cells: MaskCell[] = []
      const files: string[] = []
      const shifted = ds.lonRange[1] > 180      // dataset longitudes run 0..360
      const toPoly  = (x: number) => (shifted && x > 180 ? x - 360 : x)

      for (const [i, lobe] of lobes.entries()) {
        const lo = toDatasetLon(lobe.bbox[0], ds.lonRange), hi = toDatasetLon(lobe.bbox[2], ds.lonRange)
        status = `lobe ${i + 1}/${lobes.length}: ERDDAP axis vectors…`
        const [lonSrv, lat] = await Promise.all([
          fetchAxis(ds.baseUrl, ds.datasetId, 'longitude', Math.min(lo, hi), Math.max(lo, hi)),
          fetchAxis(ds.baseUrl, ds.datasetId, 'latitude',  lobe.bbox[1], lobe.bbox[3], ds.latDescending),
        ])
        status = `lobe ${i + 1}/${lobes.length}: masking the grid…`
        const m = gridMask(lobe.geojson, lonSrv.map(toPoly), lat)
        // mask cells go back into the server's own longitude frame, so they join the slab directly
        for (const c of m.cells) cells.push(shifted ? { ...c, lon: toDatasetLon(c.lon, ds.lonRange) } : c)

        const url = griddapUrl({
          base: ds.baseUrl, datasetId: ds.datasetId, variable: v.name,
          time: [timeInstant(start, ext, noonZ), timeInstant(end, ext, noonZ)],
          lat : [lat[lat.length - 1], lat[0]], lon: [lonSrv[0], lonSrv[lonSrv.length - 1]],
          latDescending: ds.latDescending, format: ds.format,
        })
        status = `lobe ${i + 1}/${lobes.length}: fetching ${days} days (${steps} ${ext?.stepLabel ?? 'daily'} step${steps > 1 ? 's' : ''}) of ${v.name} as .${ds.format} (this can take 15–30 s)…`
        const slab = await fetchSlab(url, ds.format, `erddapCb${i}`)
        const file = ds.format === 'parquet' ? `slab_${i}.parquet` : `slab_${i}`
        if (ds.format === 'parquet') await engine.registerBuffer(file, slab.buffer!)
        else                          await engine.insertRows(slab.rows ?? [], file)
        files.push(file)
        urls = [...urls, { url, kb: Math.round((slab.bytes ?? 0) / 1024), ms: Math.round(slab.ms) }]
      }

      status = 'computing the statistics…'
      await engine.insertMask(cells)
      const slab = ds.format === 'parquet'
        ? `read_parquet([${files.map((f) => `'${f}'`).join(', ')}])`   // the lobes, unioned
        : `(${files.map((f) => `SELECT * FROM ${f}`).join(' UNION ALL ')})`
      rows = await engine.runTemplate(statsTemplate(v), { expr: valueExpr(v), slab, mask: 'mask' })
      sql  = engine.lastSql
      totalMs = performance.now() - t0
      note = (win.snapped ? `window ${win.reason}. ` : '') +
             `${lobes.length} lobe${lobes.length > 1 ? 's' : ''}, ${cells.length} masked cells, ` +
             `${start} to ${end} = ${steps} ${ext?.stepLabel ?? 'daily'} step${steps > 1 ? 's' : ''}, ` +
             `ERDDAP ${ds.version ?? '?'} (.${ds.format})`
      status = `done: ${rows.length} rows for ${place.name} in ${(totalMs / 1000).toFixed(1)} s`
    } catch (e) { fail(e) } finally { busy = false }
  }

  // ── charts ──────────────────────────────────────────────────────────────────
  // continuous: mean / area-weighted mean with a p10-p90 band.
  // categorical: stacked area of the area-weighted class proportions (seascapeR's plot_ss_ts()).
  $effect(() => {
    if (!chartEl || !rows.length || !variable) return
    const chart = categorical ? categoricalChart() : continuousChart()
    chartEl.replaceChildren(chart)
    return () => chart.remove()
  })

  function continuousChart() {
    const long = rows.flatMap((r) => [
      { date: new Date(r.date), stat: 'mean',          value: r.mean    },
      { date: new Date(r.date), stat: 'area-wtd mean', value: r.mean_wt },
    ])
    return Plot.plot({
      width: 820, height: 320, marginLeft: 55,
      y: { label: valueLabel(variable!), grid: true },
      x: { label: step && step !== 'daily' ? `date (${step} steps)` : null },
      color: { legend: true, domain: ['mean', 'area-wtd mean'], range: ['#1f77b4', '#d62728'] },
      marks: [
        Plot.areaY(rows, { x: (r: any) => new Date(r.date), y1: 'p10', y2: 'p90', fill: '#1f77b4', fillOpacity: 0.12 }),
        Plot.line(long, { x: 'date', y: 'value', stroke: 'stat', strokeWidth: 1.8 }),
        Plot.dot(long,  { x: 'date', y: 'value', stroke: 'stat', r: 2 }),
      ],
    })
  }

  function categoricalChart() {
    const domain = classList.map(classLabel)
    return Plot.plot({
      width: 820, height: 360, marginLeft: 55, marginRight: 10,
      y: { label: 'fraction of place area', grid: true, percent: true },
      x: { label: step && step !== 'daily' ? `date (${step} steps)` : null },
      color: { legend: true, domain, range: classList.map((c) => colours.get(String(c))!) },
      marks: [
        Plot.areaY(catRows, {
          x: 'date', y: 'fraction', fill: 'label', offset: 'normalize',
          order: domain, curve: 'step',
          title: (d: any) => `${d.date.toISOString().slice(0, 10)}\n${d.label}\n${(d.fraction * 100).toFixed(1)}% of area, ${d.n} cells`,
        }),
        Plot.ruleY([0]),
      ],
    })
  }
</script>

<main>
  <h1>erddap-places</h1>
  <p class="sub">Key statistics for a gazetteer place from an ERDDAP™ griddap dataset — masked, fetched
     and aggregated entirely in this browser with DuckDB-WASM.</p>

  <div class="controls">
    <label>place
      <select bind:value={placeId} disabled={busy || !places.length}>
        {#each groups as { g, ps }}
          <optgroup label={g}>
            {#each ps as p}<option value={p.place_id}>{p.name} ({p.place_id})</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label>dataset
      <select bind:value={dsId} disabled={busy || !datasets.length}>
        {#each datasets as d}<option value={d.id}>{d.title}</option>{/each}
      </select>
    </label>
    {#if through}<span class="through">{through}</span>{/if}
    <label>variable
      <select bind:value={varName} disabled={busy || !dataset}>
        {#each dataset?.variables ?? [] as v}<option value={v.name}>{v.name}{v.categorical ? ' (categorical)' : ''} — {v.description}</option>{/each}
      </select>
    </label>
    <label>from <input type="date" bind:value={startDate} disabled={busy} /></label>
    <label>to <input type="date" bind:value={endDate} disabled={busy} /></label>
    <button onclick={run} disabled={busy || !place || !variable}>Run</button>
  </div>
  <p class="meta">{nDays > 0 ? nDays : 0} days requested (capped at {MAX_DAYS}){#if step && step !== 'daily'} ≈ {nSteps} {step} steps{/if}</p>

  <p class="status" class:err={!!error}>{error || status}</p>
  {#if note}<p class="meta">{note}</p>{/if}

  {#each urls as u}
    <p class="url">griddap: <a href={u.url} target="_blank" rel="noreferrer">{u.url}</a> — {u.kb} kB in {(u.ms / 1000).toFixed(1)} s</p>
  {/each}

  <div bind:this={chartEl} class="chart"></div>

  {#if rows.length && categorical}
    <table>
      <thead><tr><th>date</th><th>class</th><th>label</th><th>cells</th><th>area weight</th><th>fraction of area</th><th>% of cells</th></tr></thead>
      <tbody>
        {#each catRows as r}
          <tr>
            <td>{r.date.toISOString().slice(0, 10)}</td>
            <td><span class="swatch" style="background:{colours.get(String(r.class))}"></span>{r.class}</td>
            <td>{r.label}</td><td>{r.n}</td><td>{fmt(rows.find((x) => x.date === +r.date && Number(x.class) === r.class)?.weight)}</td>
            <td>{(r.fraction * 100).toFixed(1)}%</td><td>{r.percent.toFixed(1)}%</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else if rows.length}
    <table>
      <thead><tr><th>date</th><th>n</th><th>mean</th><th>area-wtd mean</th><th>sd</th><th>min</th><th>max</th><th>p10</th><th>p90</th></tr></thead>
      <tbody>
        {#each rows as r}
          <tr>
            <td>{new Date(r.date).toISOString().slice(0, 10)}</td><td>{r.n}</td><td>{fmt(r.mean)}</td><td>{fmt(r.mean_wt)}</td>
            <td>{fmt(r.sd)}</td><td>{fmt(r.min)}</td><td>{fmt(r.max)}</td><td>{fmt(r.p10)}</td><td>{fmt(r.p90)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if sql}
    <details><summary>SQL</summary><pre>{sql}</pre></details>
  {/if}
</main>

<style>
  main    { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font: 15px/1.5 system-ui, sans-serif; color: #222; }
  h1      { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub    { color: #555; margin: 0 0 1rem; }
  .controls { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; margin-bottom: .25rem; }
  .controls label { display: flex; flex-direction: column; font-size: 12px; color: #444; gap: 2px; }
  .controls select, .controls input { font-size: 14px; padding: 2px 4px; max-width: 420px; }
  .status { background: #eef4fb; border-left: 3px solid #1f77b4; padding: .5rem .75rem; }
  .status.err { background: #fdeeee; border-left-color: #d62728; }
  .meta   { color: #444; font-size: 13px; }
  .through { font-size: 12px; color: #555; padding-bottom: 4px; }
  .url    { font-size: 12px; word-break: break-all; color: #666; }
  .chart  { margin: 1rem 0; }
  table   { border-collapse: collapse; font-size: 13px; width: 100%; }
  th, td  { border-bottom: 1px solid #e3e3e3; padding: 3px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  .swatch { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border: 1px solid #999; }
  pre     { background: #f7f7f7; padding: .5rem; overflow-x: auto; font-size: 12px; }
</style>

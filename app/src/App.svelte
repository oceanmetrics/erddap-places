<script lang="ts">
  // place-based statistics in the browser: pick a place from the published gazetteer, mask the
  // ERDDAP grid to it, fetch one griddap .parquet per lobe, aggregate with DuckDB-WASM.
  import { onMount } from 'svelte'
  import * as Plot from '@observablehq/plot'
  import { gridMask, type MaskCell } from './lib/gridMask'
  import { fetchAxis, fetchSlab, griddapUrl, noonZ } from './lib/erddap'
  import { engine } from './lib/engine'
  import { gazetteerBase, loadPlaces, placeLobes, type Place } from './lib/gazetteer'

  // ── configuration (the dataset picker arrives in step 2) ────────────────────
  const BASE     = 'https://pae-paha.pacioos.hawaii.edu/erddap'
  const DATASET  = 'dhw_5km'
  const VAR      = 'CRW_SST'
  const N_DAYS   = 30
  const LAG_DAYS = 2 // the CRW daily grid's latest time step is ~2 days back

  // ── state ───────────────────────────────────────────────────────────────────
  let places   = $state<Place[]>([])
  let placeId  = $state('NMS:HIHWNMS')
  let status   = $state('loading the gazetteer…')
  let error    = $state('')
  let busy     = $state(false)
  let note     = $state('')
  let urls     = $state<{ url: string; kb: number; ms: number }[]>([])
  let rows     = $state<Record<string, any>[]>([])
  let chartEl  = $state<HTMLDivElement | null>(null)

  const place  = $derived(places.find((p) => p.place_id === placeId) ?? null)
  const groups = $derived([...new Set(places.map((p) => p.gazetteer))].map((g) => ({ g, ps: places.filter((p) => p.gazetteer === g) })))
  const fmt    = (v: unknown, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '')

  onMount(async () => {
    try {
      places = await loadPlaces()
      status = `gazetteer: ${places.length} places from ${gazetteerBase()}`
      await run()
    } catch (e) {
      error  = e instanceof Error ? e.message : String(e)
      status = 'failed'
    }
  })

  // ── pipeline ────────────────────────────────────────────────────────────────
  async function run() {
    if (!place || busy) return
    busy = true; error = ''; rows = []; urls = []
    try {
      const lobes = placeLobes(place)
      const end   = new Date(Date.now() - LAG_DAYS * 864e5)
      const start = new Date(end.getTime() - (N_DAYS - 1) * 864e5)
      const cells: MaskCell[] = []
      const files: string[] = []

      for (const [i, lobe] of lobes.entries()) {
        status = `lobe ${i + 1}/${lobes.length}: ERDDAP axis vectors…`
        const [lon, lat] = await Promise.all([
          fetchAxis(BASE, DATASET, 'longitude', lobe.bbox[0], lobe.bbox[2]),
          fetchAxis(BASE, DATASET, 'latitude',  lobe.bbox[1], lobe.bbox[3], true), // descending on the CRW grid
        ])
        status = `lobe ${i + 1}/${lobes.length}: masking the grid…`
        const m = gridMask(lobe.geojson, lon, lat)
        cells.push(...m.cells)

        const url = griddapUrl({
          base: BASE, datasetId: DATASET, variable: VAR,
          time: [noonZ(start), noonZ(end)],
          lat : [lat[lat.length - 1], lat[0]], lon: [lon[0], lon[lon.length - 1]],
          latDescending: true, format: 'parquet',
        })
        status = `lobe ${i + 1}/${lobes.length}: fetching ${N_DAYS} days of ${VAR} (the server takes ~15–20 s)…`
        const slab = await fetchSlab(url, 'parquet')
        const file = `slab_${i}.parquet`
        await engine.registerBuffer(file, slab.buffer!)
        files.push(file)
        urls = [...urls, { url, kb: Math.round((slab.bytes ?? 0) / 1024), ms: Math.round(slab.ms) }]
      }

      status = 'computing the daily statistics…'
      await engine.insertMask(cells)
      const slab = `read_parquet([${files.map((f) => `'${f}'`).join(', ')}])` // the lobes, unioned
      rows = await engine.runTemplate('stats_daily', { var: VAR, slab, mask: 'mask' })
      note = `${lobes.length} lobe${lobes.length > 1 ? 's' : ''}, ${cells.length} masked cells`
      status = `done: ${rows.length} days for ${place.name}`
    } catch (e) {
      error  = e instanceof Error ? e.message : String(e)
      status = 'failed'
    } finally { busy = false }
  }

  // ── chart ───────────────────────────────────────────────────────────────────
  $effect(() => {
    if (!chartEl || !rows.length) return
    const long = rows.flatMap((r) => [
      { date: new Date(r.date), stat: 'mean',          value: r.mean    },
      { date: new Date(r.date), stat: 'area-wtd mean', value: r.mean_wt },
    ])
    const chart = Plot.plot({
      width: 820, height: 320, marginLeft: 55,
      y: { label: '°C', grid: true },
      x: { label: null },
      color: { legend: true, domain: ['mean', 'area-wtd mean'], range: ['#1f77b4', '#d62728'] },
      marks: [
        Plot.areaY(rows, { x: (r: any) => new Date(r.date), y1: 'p10', y2: 'p90', fill: '#1f77b4', fillOpacity: 0.12 }),
        Plot.line(long, { x: 'date', y: 'value', stroke: 'stat', strokeWidth: 1.8 }),
        Plot.dot(long,  { x: 'date', y: 'value', stroke: 'stat', r: 2 }),
      ],
    })
    chartEl.replaceChildren(chart)
    return () => chart.remove()
  })
</script>

<main>
  <h1>erddap-places</h1>
  <p class="sub">Daily <code>{VAR}</code> statistics from PacIOOS ERDDAP <code>{DATASET}</code> for a place
     from the Ocean Metrics gazetteer — masked, fetched and aggregated entirely in this browser.</p>

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
    <button onclick={run} disabled={busy || !place}>Run</button>
  </div>

  <p class="status" class:err={!!error}>{error || status}</p>
  {#if note}<p class="meta">{note}</p>{/if}

  {#each urls as u}
    <p class="url">griddap: <a href={u.url} target="_blank" rel="noreferrer">{u.url}</a> — {u.kb} kB in {(u.ms / 1000).toFixed(1)} s</p>
  {/each}

  <div bind:this={chartEl} class="chart"></div>

  {#if rows.length}
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
</main>

<style>
  main    { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font: 15px/1.5 system-ui, sans-serif; color: #222; }
  h1      { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub    { color: #555; margin: 0 0 1rem; }
  .controls { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap; margin-bottom: .75rem; }
  .controls label { display: flex; flex-direction: column; font-size: 12px; color: #444; gap: 2px; }
  .controls select { font-size: 14px; padding: 2px 4px; max-width: 460px; }
  .status { background: #eef4fb; border-left: 3px solid #1f77b4; padding: .5rem .75rem; }
  .status.err { background: #fdeeee; border-left-color: #d62728; }
  .meta   { color: #444; }
  .url    { font-size: 12px; word-break: break-all; color: #666; }
  .chart  { margin: 1rem 0; }
  table   { border-collapse: collapse; font-size: 13px; width: 100%; }
  th, td  { border-bottom: 1px solid #e3e3e3; padding: 3px 8px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  code    { background: #f3f3f3; padding: 0 3px; }
</style>

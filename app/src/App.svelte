<script lang="ts">
  // first slice: daily SST statistics for one place (HIHWNMS), computed entirely in the browser.
  // place polygon -> ERDDAP axis vectors -> gridMask -> one griddap .parquet -> DuckDB-WASM -> chart.
  import { onMount } from 'svelte'
  import * as Plot from '@observablehq/plot'
  import { gridMask, polygonParts, type MaskResult } from './lib/gridMask'
  import { fetchAxis, fetchSlab, griddapUrl, noonZ } from './lib/erddap'
  import { engine } from './lib/engine'
  import type { FeatureCollection } from 'geojson'

  // ── configuration ───────────────────────────────────────────────────────────
  const PLACE    = { id: 'HIHWNMS', name: 'Hawaiian Islands Humpback Whale NMS', url: `${import.meta.env.BASE_URL}places/HIHWNMS.geojson` }
  const BASE     = 'https://pae-paha.pacioos.hawaii.edu/erddap'
  const DATASET  = 'dhw_5km'
  const VAR      = 'CRW_SST'
  const N_DAYS   = 30
  const LAG_DAYS = 2 // the CRW daily grid's latest time step is ~2 days back

  // ── state ───────────────────────────────────────────────────────────────────
  let status  = $state('starting…')
  let error   = $state('')
  let mask    = $state<MaskResult | null>(null)
  let slabUrl = $state('')
  let slabMs  = $state(0)
  let slabKb  = $state(0)
  let rows    = $state<Record<string, any>[]>([])
  let chartEl = $state<HTMLDivElement | null>(null)

  const fmt = (v: unknown, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '')

  // ── pipeline ────────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      status = `fetching the ${PLACE.id} polygon…`
      const gj: FeatureCollection = await (await fetch(PLACE.url)).json()

      // place bbox (one lobe here; lobes split at ±180 would get one request each)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const p of polygonParts(gj)) {
        x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1])
        x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3])
      }

      status = 'fetching the ERDDAP axis vectors…'
      const [lon, lat] = await Promise.all([
        fetchAxis(BASE, DATASET, 'longitude', x0, x1),
        fetchAxis(BASE, DATASET, 'latitude',  y0, y1, true), // descending, as on the CRW grid
      ])

      status = 'masking the grid…'
      mask = gridMask(gj, lon, lat)

      const end   = new Date(Date.now() - LAG_DAYS * 864e5)
      const start = new Date(end.getTime() - (N_DAYS - 1) * 864e5)
      slabUrl = griddapUrl({
        base: BASE, datasetId: DATASET, variable: VAR,
        time: [noonZ(start), noonZ(end)],
        lat : [lat[lat.length - 1], lat[0]], lon: [lon[0], lon[lon.length - 1]],
        latDescending: true, format: 'parquet',
      })

      status = `fetching ${N_DAYS} days of ${VAR} from PacIOOS (the server takes ~15–20 s)…`
      const slab = await fetchSlab(slabUrl, 'parquet')
      slabMs = Math.round(slab.ms); slabKb = Math.round((slab.bytes ?? 0) / 1024)

      status = 'loading DuckDB-WASM…'
      await engine.registerBuffer('slab.parquet', slab.buffer!)
      await engine.insertMask(mask.cells)

      status = 'computing the daily statistics…'
      rows = await engine.runTemplate('stats_daily', { var: VAR, slab: "'slab.parquet'", mask: 'mask' })
      status = `done: ${rows.length} days × ${mask.nInside} cells`
    } catch (e) {
      error  = e instanceof Error ? e.message : String(e)
      status = 'failed'
    }
  })

  // redraw the chart whenever the rows (or the container) change
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
  <p class="sub">Daily <code>{VAR}</code> statistics for <strong>{PLACE.name}</strong> ({PLACE.id}) from
     PacIOOS ERDDAP <code>{DATASET}</code> — masked, fetched and aggregated entirely in this browser.</p>

  <p class="status" class:err={!!error}>{error || status}</p>

  {#if mask}
    <p class="meta">
      mask: <strong>{mask.nInside}</strong> cells inside of {mask.nCandidates} candidates
      ({mask.cells.length} with area weights), method <code>{mask.method}</code>, {mask.ms.toFixed(0)} ms
      {#if slabKb}· slab: {slabKb} kB in {(slabMs / 1000).toFixed(1)} s{/if}
    </p>
  {/if}

  {#if slabUrl}
    <p class="url">griddap URL: <a href={slabUrl} target="_blank" rel="noreferrer">{slabUrl}</a></p>
  {/if}

  <div bind:this={chartEl} class="chart"></div>

  {#if rows.length}
    <table>
      <thead><tr><th>date</th><th>n</th><th>mean</th><th>area-wtd mean</th><th>sd</th><th>min</th><th>max</th><th>p10</th><th>p90</th></tr></thead>
      <tbody>
        {#each rows as r}
          <tr>
            <td>{String(r.date).slice(0, 10)}</td><td>{r.n}</td><td>{fmt(r.mean)}</td><td>{fmt(r.mean_wt)}</td>
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

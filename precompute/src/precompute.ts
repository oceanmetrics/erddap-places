#!/usr/bin/env tsx
// precompute the stats/ collection: for every (dataset, variable) in targets.ts and every place,
// fetch the last 365 days of griddap, mask it with the place polygon, aggregate with the app's SQL,
// and write catalog/gazetteer/stats/{dataset}/{variable}/{place_id}.parquet + a STAC Item.
//
//   npx tsx src/precompute.ts                     # everything in TARGETS
//   npx tsx src/precompute.ts --dataset dhw_5km   # one dataset
//   npx tsx src/precompute.ts --place NMS:PMNM    # one place (repeatable)
//   npx tsx src/precompute.ts --days 30           # a shorter window (a quick smoke test)
//   npx tsx src/precompute.ts --items-only        # rebuild the STAC from the existing provenance
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DAYS, TARGETS } from './targets'
import { STATS } from './paths'
import {
  computeOne, fileSafe, liveExtent, loadDataset, loadLocalPlaces, statsPath, variableOf,
  type Provenance,
} from './stats'
import { writeStac } from './stac'

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const o = { datasets: [] as string[], places: [] as string[], days: DAYS, itemsOnly: false, resume: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if      (a === '--dataset')    o.datasets.push(argv[++i])
    else if (a === '--place')      o.places.push(argv[++i])
    else if (a === '--days')       o.days = Number(argv[++i])
    else if (a === '--items-only') o.itemsOnly = true
    else if (a === '--resume')     o.resume = true
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

const hhmmss = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const t0   = Date.now()
  const opts = parseArgs(process.argv.slice(2))
  const places = await loadLocalPlaces()
  const byId   = new Map(places.map((p) => [p.place_id, p]))
  const titles = new Map<string, string>()
  const provs: Provenance[] = []
  const failed: string[] = []

  const targets = TARGETS.filter((t) => !opts.datasets.length || opts.datasets.includes(t.dataset))

  for (const t of targets) {
    const ds = loadDataset(t.dataset)
    titles.set(ds.datasetId, ds.title)
    const v  = variableOf(ds, t.variable)
    const want = (t.places === 'all' ? places.map((p) => p.place_id) : t.places)
      .filter((id) => !opts.places.length || opts.places.includes(id))
    if (!want.length) continue

    console.log(`\n== ${ds.datasetId} / ${v.name} (${v.categorical ? 'categorical' : 'continuous'}), ${want.length} place(s)`)
    const ext = opts.itemsOnly ? null : await liveExtent(ds)
    if (ext) console.log(`   live extent ${ext.start} .. ${ext.end} (${ext.stepLabel ?? 'daily'})`)

    // sequential per dataset: one place at a time, so we never hammer a single ERDDAP host
    for (const id of want) {
      const place = byId.get(id)
      if (!place) { console.warn(`   !! no place ${id} in places.parquet; skipped`); failed.push(`${ds.datasetId}/${v.name}/${id}`); continue }
      // --items-only / --resume reuse the provenance JSON written beside an existing parquet
      const provFile = statsPath(ds.datasetId, v.name, id).replace(/\.parquet$/, '.provenance.json')
      if ((opts.itemsOnly || opts.resume) && existsSync(provFile)) {
        provs.push(JSON.parse(readFileSync(provFile, 'utf8')))
        continue
      }
      if (opts.itemsOnly) { console.warn(`   !! no provenance for ${id}; run the precompute first`); continue }
      console.log(`  -- ${id} ${place.name}`)
      try {
        provs.push(await computeOne(ds, v, place, ext!, opts.days))
      } catch (e) {
        console.error(`   !! ${id}: ${e instanceof Error ? e.message : String(e)}`)
        failed.push(`${ds.datasetId}/${v.name}/${id}`)
      }
    }
  }

  if (!provs.length) throw new Error('nothing computed')
  writeStac(provs, byId, titles)
  console.log(`\n${provs.length} item(s) written to ${join(STATS, 'items')} + collection.json`)
  console.log(`parquet files: ${provs.map((p) => fileSafe(p.place_id)).length}, ` +
              `${(provs.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(1)} MB, ` +
              `${provs.reduce((s, p) => s + p.rows, 0)} rows`)
  if (failed.length) console.log(`failed: ${failed.length}\n  ${failed.join('\n  ')}`)
  console.log(`total ${hhmmss(Date.now() - t0)}`)
  if (failed.length) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1) })

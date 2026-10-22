#!/usr/bin/env tsx
// precompute the stats/ collection: for every (dataset, variable) in targets.ts and every place,
// fetch the target's window of griddap (the dataset's full record by default, incremental per chunk:
// stats.ts computeOne), mask it with the place polygon, aggregate with the app's SQL,
// and write catalog/gazetteer/stats/{dataset}/{variable}/{place_id}.parquet + a STAC Item.
//
// each (dataset, variable, place) is a unit, scheduled per ERDDAP server (schedule.ts): one lane per
// server, side by side; a failing server rests and its failed place goes to the back of its queue while
// the other servers keep working. With PRECOMPUTE_PUBLISH set, each finished unit is uploaded at once
// (publish.ts), so a run that is cut off, or takes days over several runs, loses nothing it finished.
//
//   npx tsx src/precompute.ts                     # everything in TARGETS
//   npx tsx src/precompute.ts --dataset dhw_5km   # one dataset
//   npx tsx src/precompute.ts --place NMS:PMNM    # one place (repeatable)
//   npx tsx src/precompute.ts --days 30           # override every target's window (a quick smoke test)
//   npx tsx src/precompute.ts --hours 6           # start no new work after 6 h (default RUN_HOURS, or PRECOMPUTE_HOURS)
//   npx tsx src/precompute.ts --items-only        # rebuild the STAC from the existing provenance
//
// a REQUESTED run (oceanmetrics/indicators "Request an indicator"): one catalogued target for places of
// ANY published vector collection. The request names the places; a target's own `places` rule is not
// applied, and the checks of request.ts refuse anything else before geometry is fetched (exit code 2).
//   npx tsx src/precompute.ts --gazetteer noaa_nerrs --place NERRS:WEL --dataset dhw_5km [--variable CRW_SST] [--days 30]
// it writes the parquet, the provenance and the Item only (never collection.json, the thumbnail or the
// catalog link, which describe the daily run's places); PRECOMPUTE_PUBLISH uploads exactly those.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TARGETS, placesFor } from './targets'
import { STATS, internalParquet } from './paths'
import { asyncBufferFromFile } from 'hyparquet'
import {
  computeOne, liveExtent, loadDataset, loadLocalPlaces, statsPath, variableOf, StopRequested,
  type Provenance,
} from './stats'
import { RequestRefusal, LAYERS_URL, daysOf, parseArgs, resolveRequest, selectTargets, validateArgs } from './request'
import type { TimeExtent } from '../../app/src/lib/extent'
import type { Dataset, CubeVariable } from '../../app/src/lib/catalog'
import { configureGazetteer, placeGeometry, readParquetPlace, PLACES_COLLECTION, type Place } from '../../app/src/lib/gazetteer'
import { itemCollections, writeItems, writeStac } from './stac'
import { schedule, hostOf, type Unit } from './schedule'
import { publisher } from './publish'
import { Agent, setGlobalDispatcher } from 'undici'

// undici's default 10 s connect timeout is what every PacIOOS "fetch failed" in CI and on msens was
// (2026-10-07/08); give a slow handshake 30 s before the retry logic in stats.ts takes over
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))

const hhmmss = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// ── main ──────────────────────────────────────────────────────────────────────
interface Job extends Unit { ds: Dataset; v: CubeVariable; place: Place; days: number | 'all' }

/** a requested run's places: the manifest check, then each place's geometry through the app's loader. */
async function requestedPlaces(opts: ReturnType<typeof parseArgs>, localPlaces: Place[]): Promise<Place[]> {
  configureGazetteer()                         // the bucket, as the app does at start-up
  const local = new Map(localPlaces.map((p) => [p.place_id, p]))
  return resolveRequest(opts, {
    fetchLayers: async () => {
      const res = await fetch(LAYERS_URL, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`${LAYERS_URL}: ${res.status} ${res.statusText}`)
      return (await res.json()).layers
    },
    loadPlace: async (slug, id) => {
      if (slug === PLACES_COLLECTION) {
        const p = local.get(id)
        if (!p) throw new Error(`no place ${id} in the ${slug} collection`)
        return { ...p, collection: PLACES_COLLECTION }
      }
      // a reference collection (Marine Regions): the build machine's private full-resolution parquet, the same
      // geometry the gazetteer's derived products are built from, never the publisher's WFS
      const own = internalParquet(slug)
      if (own) return readParquetPlace(await asyncBufferFromFile(own), slug, id)
      return placeGeometry({ collection: slug, place_id: id })
    },
    localIds: localPlaces.map((p) => p.place_id),
    internal: (slug) => internalParquet(slug) !== undefined,
    existing: (id) => itemCollections(id),
  })
}

async function main() {
  const t0   = Date.now()
  const opts = parseArgs(process.argv.slice(2))
  validateArgs(opts)                           // before anything is read or fetched
  const requested = opts.gazetteer !== undefined
  const localPlaces = await loadLocalPlaces()
  const places = requested ? await requestedPlaces(opts, localPlaces) : localPlaces
  const byId   = new Map(places.map((p) => [p.place_id, p]))
  const titles = new Map<string, string>()
  const provs: Provenance[] = []
  const failed: string[] = []
  const inTargets = new Set(TARGETS.map((t) => `${t.dataset}/${t.variable}`))
  const keep = (d: string, v: string) => inTargets.has(`${d}/${v}`)

  // every (dataset, variable, place) the targets ask for, whatever --dataset / --place pick: the
  // collection lists those without an Item yet as pending (the daily run only)
  const planned = TARGETS.flatMap((t) => {
    const ds = loadDataset(t.dataset), v = variableOf(ds, t.variable)
    return placesFor(t, places.map((p) => p.place_id)).map((place_id) => ({ dataset_id: ds.datasetId, variable: v.name, place_id }))
  })

  // every (dataset, variable, place) of the targets, in target order
  const jobs: Job[] = []
  for (const { target: t, placeIds } of selectTargets(opts, places.map((p) => p.place_id))) {
    const ds = loadDataset(t.dataset)
    titles.set(ds.datasetId, ds.title)
    const v  = variableOf(ds, t.variable)
    const days = daysOf(opts, t)
    for (const id of placeIds) {
      const key = `${ds.datasetId}/${v.name}/${id}`
      const place = byId.get(id)
      if (!place) { console.warn(`   !! no place ${id} in places.parquet; skipped`); failed.push(key); continue }
      jobs.push({ key, host: hostOf(ds.baseUrl), ds, v, place, days })
    }
  }

  // --items-only / --resume reuse the provenance JSON written beside an existing parquet
  const provFile = (j: Job) => statsPath(j.ds.datasetId, j.v.name, j.place.place_id).replace(/\.parquet$/, '.provenance.json')
  const todo = jobs.filter((j) => {
    if ((opts.itemsOnly || opts.resume) && existsSync(provFile(j))) { provs.push(JSON.parse(readFileSync(provFile(j), 'utf8'))); return false }
    if (opts.itemsOnly) { console.warn(`   !! no provenance for ${j.key}; run the precompute first`); return false }
    return true
  })

  // the live time extent, once per dataset per run (a failed probe is asked again on the unit's next try)
  const extents = new Map<string, Promise<TimeExtent>>()
  const extentOf = (ds: Dataset) => {
    if (!extents.has(ds.datasetId)) {
      const p = liveExtent(ds, { attempts: 2 })
      extents.set(ds.datasetId, p)
      p.catch(() => extents.delete(ds.datasetId))
    }
    return extents.get(ds.datasetId)!
  }

  const deadline = t0 + opts.hours * 3_600_000
  const pub = publisher()
  console.log(`full record unless --days; no new work after ${opts.hours} h; ` +
              `${pub.enabled ? `publishing each item to ${process.env.PRECOMPUTE_PUBLISH}` : 'not publishing (PRECOMPUTE_PUBLISH unset)'}`)

  const res = await schedule(todo, {
    deadline,
    run: async (j, attempt, progress) => {
      const tag = `[${j.host.split('.')[0]}] ${j.key}`
      const log = (s: string) => console.log(`${tag}${s.startsWith(' ') ? '' : ' '}${s}`)
      const ext = await extentOf(j.ds)
      log(` -- ${j.place.name}${attempt > 1 ? ` (try ${attempt})` : ''}; extent ${ext.start} .. ${ext.end}`)
      let prov: Provenance
      try { prov = await computeOne(j.ds, j.v, j.place, ext, j.days, log, { shouldStop: () => Date.now() >= deadline, onChunk: progress }) }
      catch (e) { if (e instanceof StopRequested) { log(' stopped at the deadline; resumes next run'); return 'deferred' } throw e }
      provs.push(prov)
      const parquet = statsPath(prov.dataset_id, prov.variable, prov.place_id)
      // a requested run writes its Item only: the collection describes the daily run's places
      const stac = requested ? writeItems([prov], byId, titles) : writeStac(provs, byId, titles, keep, [prov], planned)
      void pub.publish([parquet, parquet.replace(/\.parquet$/, '.provenance.json'), ...stac])
      return 'done'
    },
  })
  failed.push(...res.failed.map((f) => f.unit.key))
  await pub.done()

  if (!provs.length && !failed.length && !res.deferred.length) throw new Error('nothing computed')
  // the whole collection once more (also the --items-only path)
  if (provs.length && !requested) writeStac(provs, byId, titles, keep, provs, planned)
  console.log(`\n${res.done.length} item(s) computed, ${provs.length} in ${join(STATS, 'items')}${requested ? '' : ' + collection.json'}` +
              (pub.enabled ? `; ${pub.stats.files} file(s) uploaded, ${pub.stats.failures} upload failure(s)` : ''))
  console.log(`parquet: ${(provs.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(1)} MB, ${provs.reduce((s, p) => s + p.rows, 0)} rows`)
  if (res.deferred.length) console.log(`deferred to the next run (deadline): ${res.deferred.length}\n  ${res.deferred.map((u) => u.key).join('\n  ')}`)
  if (failed.length) console.log(`failed: ${failed.length}\n  ${failed.join('\n  ')}`)
  console.log(`total ${hhmmss(Date.now() - t0)}`)
  if (failed.length || pub.stats.failures) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => {
  if (e instanceof RequestRefusal) { console.error(`refused: ${e.message}`); process.exit(2) }
  console.error(e); process.exit(1)
})

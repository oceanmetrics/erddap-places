// the argument rules of precompute.ts, kept out of the script so they run offline in a test.
//
// two modes:
//   default       every target in ALL_TARGETS (the daily run passes TARGETS), for the places the target's own rule names (all | nms | a list),
//                 out of the local places collection. what the daily workflow runs; unchanged.
//   --gazetteer   a REQUESTED run: one catalogued target (--dataset, optionally --variable) for the
//                 --place ids of ANY published vector collection. the request names the places, so a
//                 target's own `places` rule is not applied. the values come from public issues
//                 (oceanmetrics/indicators "Request an indicator"), hence the strict patterns and the
//                 checks before any geometry is fetched.
import { ALL_TARGETS, DAYS, RUN_HOURS, placesFor, type Target } from './targets'
import { GAZETTEER_FALLBACK, isPolygonal, PLACES_COLLECTION } from '../../app/src/lib/gazetteer'

/** a collection slug, as the bucket names its directories. */
export const SLUG_RE     = /^[a-z0-9_]+$/
/** a place id: authority, colon, source id (no spaces, slashes or anything a path or URL would read). */
export const PLACE_ID_RE = /^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.\-]+$/

/** the manifest that says which collections carry geometry. */
export const LAYERS_URL = `${GAZETTEER_FALLBACK}index/layers.json`

export interface Args {
  datasets : string[]
  variables: string[]
  places   : string[]
  gazetteer: string | undefined
  days     : number | undefined
  itemsOnly: boolean
  resume   : boolean
  hours    : number
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Args {
  const o: Args = { datasets: [], variables: [], places: [], gazetteer: undefined, days: undefined, itemsOnly: false, resume: false,
                    hours: Number(env.PRECOMPUTE_HOURS || RUN_HOURS) }
  const value = (i: number, flag: string) => {
    const v = argv[i]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if      (a === '--dataset')    o.datasets.push(value(++i, a))
    else if (a === '--variable')   o.variables.push(value(++i, a))
    else if (a === '--place')      o.places.push(value(++i, a))
    else if (a === '--gazetteer')  o.gazetteer = value(++i, a)
    else if (a === '--days')       o.days = Number(value(++i, a))
    else if (a === '--items-only') o.itemsOnly = true
    else if (a === '--resume')     o.resume = true
    else if (a === '--hours')      o.hours = Number(value(++i, a))
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

/** a request the run refuses (exit code 2): the message says why, in the words of the issue. */
export class RequestRefusal extends Error {
  constructor(message: string) { super(message); this.name = 'RequestRefusal' }
}

const refuse = (m: string): never => { throw new RequestRefusal(m) }

/**
 * the checks that need no network. Without --gazetteer only --variable is checked (an unknown one would
 * select nothing); with it, everything a request must name.
 */
export function validateArgs(o: Args, targets: Target[] = ALL_TARGETS): void {
  const ofDataset = (d: string) => targets.filter((t) => t.dataset === d)
  for (const d of o.datasets) if (!ofDataset(d).length) refuse(`dataset ${JSON.stringify(d)} is not a catalogued target (have ${[...new Set(targets.map((t) => t.dataset))].join(', ')})`)
  if (o.variables.length) {
    if (o.datasets.length !== 1) refuse('--variable needs exactly one --dataset')
    const have = ofDataset(o.datasets[0]).map((t) => t.variable)
    for (const v of o.variables) if (!have.includes(v)) refuse(`variable ${JSON.stringify(v)} is not a target of ${o.datasets[0]} (have ${have.join(', ')})`)
  }
  if (o.gazetteer === undefined) return

  if (!SLUG_RE.test(o.gazetteer)) refuse(`--gazetteer ${JSON.stringify(o.gazetteer)} is not a collection slug (${SLUG_RE})`)
  if (!o.places.length) refuse('--gazetteer needs at least one --place')
  for (const p of o.places) if (!PLACE_ID_RE.test(p)) refuse(`--place ${JSON.stringify(p)} is not a place id (${PLACE_ID_RE})`)
  if (!o.datasets.length) refuse('--gazetteer needs a --dataset (one catalogued target)')
}

/**
 * the layer row of layers.json that `slug` names, or a refusal: it must carry geometry we may fetch. A reference
 * (`raster`) collection qualifies when `internal(slug)`: this machine holds its private full-resolution parquet.
 */
export function checkLayer(layers: Array<{ slug: string; kind?: string; geom_type?: string }>, slug: string,
                           internal: (slug: string) => boolean = () => false) {
  const l = layers.find((x) => x.slug === slug)
  if (!l) return refuse(`no collection ${JSON.stringify(slug)} in ${LAYERS_URL}`)
  if (l.kind === 'raster' && !internal(slug)) return refuse(`collection ${slug} is a reference ("raster") layer and this runner holds no private copy of its geometry to mask a grid with`)
  if (l.kind !== 'vector' && l.kind !== 'raster') return refuse(`collection ${slug} is ${JSON.stringify(l.kind ?? 'not vector')}, not a vector layer: it publishes no geometry to mask a grid with`)
  if (!isPolygonal(l.geom_type)) return refuse(`collection ${slug} holds ${l.geom_type ?? 'unknown'} geometry: only polygon places can be masked`)
  return l
}

/** every (dataset, variable) the run asks for, and the place ids for each, in target order. */
export interface Selected { target: Target; placeIds: string[] }
export function selectTargets(o: Pick<Args, 'datasets' | 'variables' | 'places' | 'gazetteer'>, localIds: string[], targets: Target[] = ALL_TARGETS): Selected[] {
  return targets
    .filter((t) => !o.datasets.length || o.datasets.includes(t.dataset))
    .filter((t) => !o.variables.length || o.variables.includes(t.variable))
    .map((target) => ({
      target,
      // a request names its places: the target's own `places` rule does not apply
      placeIds: o.gazetteer !== undefined
        ? [...new Set(o.places)]
        : placesFor(target, localIds).filter((id) => !o.places.length || o.places.includes(id)),
    }))
}

/** the window of a target in this run: --days, else the target's own, else the default. */
export const daysOf = (o: Pick<Args, 'days'>, t: Pick<Target, 'days'>): number | 'all' => o.days ?? t.days ?? DAYS

/**
 * Stats files are keyed by dataset/variable/place_id, not by collection, so a requested id that is
 * already someone else's file would overwrite it. `existing` is the collection of an Item already
 * there (every collection some Item for that place id names); the local `places` ids are the other source
 * of a clash.
 */
export function collisionOf(slug: string, id: string, localIds: string[], existing: string[]): string | null {
  if (slug !== PLACES_COLLECTION && localIds.includes(id))
    return `${id} is also a place of the ${PLACES_COLLECTION} collection; stats files are keyed by place id, so it would overwrite those`
  const other = existing.find((c) => c !== slug)
  if (other !== undefined)
    return `${id} already has a stats file from the ${other} collection; stats files are keyed by place id`
  return null
}

export interface RequestDeps {
  fetchLayers: () => Promise<Array<{ slug: string; kind?: string; geom_type?: string }>>
  /** one place's geometry from the collection (the app's placeGeometry); rejects when the id is not in it */
  loadPlace  : (slug: string, id: string) => Promise<import('../../app/src/lib/gazetteer').Place>
  localIds   : string[]
  /** true when this machine holds the private parquet of a reference collection (paths.ts internalParquet) */
  internal?  : (slug: string) => boolean
  /** the `gazetteer:collection` of every Item already written for this place id */
  existing   : (id: string) => string[]
}

/**
 * a requested run's places, after every check. The order is the contract: patterns and targets first
 * (validateArgs), then the one manifest, then each place; nothing is fetched as geometry for a
 * collection that is not a polygon vector layer.
 */
export async function resolveRequest(o: Args, d: RequestDeps, targets: Target[] = ALL_TARGETS) {
  validateArgs(o, targets)
  const slug = o.gazetteer!
  checkLayer(await d.fetchLayers(), slug, d.internal)
  const ids = [...new Set(o.places)]
  for (const id of ids) {
    const clash = collisionOf(slug, id, d.localIds, d.existing(id))
    if (clash) refuse(clash)
  }
  const places = []
  for (const id of ids) {
    try { places.push(await d.loadPlace(slug, id)) }
    catch (e) {
      // only "no such place" is a refusal; a network failure is a failure of the run, not of the request
      if (e instanceof Error && /^no place /.test(e.message)) refuse(`${id} is not a place of the ${slug} collection`)
      throw e
    }
  }
  return places
}

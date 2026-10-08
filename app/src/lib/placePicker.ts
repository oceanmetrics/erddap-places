// what the Place tab lists: plain, tested logic that PlacePicker.svelte only draws.
//
// The gazetteer index has 14,734 places in 22 collections, so the list is never "everything":
//   - no query: a curated set of collections, each capped at GROUP_CAP rows with a "… N more, type to
//     search" row, the two noisiest collections (3,325 rescinded wind blocks, 2,816 cable areas) and the
//     collections nobody asked for behind one "show N more collections" row;
//   - a query: the client's ranked search over EVERY polygon place, the first SEARCH_LIMIT hits, grouped
//     by collection.
// Only polygons are listed: a grid mask needs an area, so lines and points are not selectable.
import { PLACES_COLLECTION, placeKey } from './gazetteer'
import type { IndexPlace, Layer } from './places'

export const GROUP_CAP    = 50
export const SEARCH_LIMIT = 200
/** the heading of the 20 places whose statistics are precomputed (the manifest calls the collection "Places") */
export const PLACES_TITLE = 'Sanctuaries & places (precomputed)'

/** the collections listed without a query, in this order; `places` first */
export const CURATED = [
  'places', 'noaa_marine_monuments', 'noaa_nerrs', 'mpa_inventory', 'noaa_hapc', 'fws_critical_habitat_proposed',
  'boem_wind_leases', 'boem_pacific_og_leases', 'boem_ocs_planning', 'boem_program_11_draft', 'noaa_aoa_socal',
  'usace_danger_zones', 'noaa_vessel_routing_measures', 'noaa_state_submerged_lands', 'noaa_submarine_cables',
  'boem_wind_planning_rescinded',
] as const
/** curated, but so many rows that they hide behind "show more" (and are always searchable) */
export const NOISY = ['noaa_submarine_cables', 'boem_wind_planning_rescinded'] as const

/** one selectable row */
export interface PickRow {
  key        : string
  row        : IndexPlace
  /** a place with a precomputed statistics file (the `places` collection) */
  precomputed: boolean
}
/** a group of rows; `more` counts the rows of the group that are not shown */
export interface PickSection { slug: string; title: string; rows: PickRow[]; more: number }

/**
 * collection slugs in the order groups are shown: the curated ones, then the rest in manifest order.
 * The list names collections that may be absent (callers keep the ones they have rows for), so the order
 * holds before the manifest has loaded too.
 */
export function groupOrder(manifest: string[]): string[] {
  return [...CURATED, ...manifest.filter((c) => !(CURATED as readonly string[]).includes(c))]
}

export const sectionTitle = (slug: string, layers: Pick<Layer, 'slug' | 'title'>[]) =>
  slug === PLACES_COLLECTION ? PLACES_TITLE : layers.find((l) => l.slug === slug)?.title ?? slug

const pickRow = (row: IndexPlace): PickRow => ({ key: placeKey(row), row, precomputed: row.collection === PLACES_COLLECTION })

// sanctuaries, then marine regions, then protected areas, as the picker always listed the 20 places
const AUTH = ['NMS', 'MRGID', 'PSGID']
const authRank = (a: string) => { const i = AUTH.indexOf(a); return i < 0 ? AUTH.length : i }
const byName = (a: IndexPlace, b: IndexPlace) => a.name.localeCompare(b.name) || a.place_id.localeCompare(b.place_id)
const byPlaces = (a: IndexPlace, b: IndexPlace) => authRank(a.authority) - authRank(b.authority) || byName(a, b)

export interface DefaultView {
  sections      : PickSection[]
  /** collections folded behind "show N more collections" (0 once expanded) */
  hiddenGroups  : number
  /** the places in those collections */
  hiddenPlaces  : number
}

/**
 * The list with no query. `polygons` are the selectable index rows; `expanded` adds the noisy and the
 * non-curated collections after the curated ones. Each group shows at most `cap` rows.
 */
export function defaultView(polygons: IndexPlace[], layers: Pick<Layer, 'slug' | 'title'>[], expanded = false, cap = GROUP_CAP): DefaultView {
  const by = new Map<string, IndexPlace[]>()
  for (const r of polygons) (by.get(r.collection) ?? by.set(r.collection, []).get(r.collection)!).push(r)
  const order = groupOrder(layers.map((l) => l.slug)).filter((s) => by.has(s))
  for (const s of by.keys()) if (!order.includes(s)) order.push(s)      // not in the manifest: still listed, last
  const folded = (s: string) => (NOISY as readonly string[]).includes(s) || !(CURATED as readonly string[]).includes(s)
  const shown = order.filter((s) => expanded || !folded(s))
  const hidden = order.filter((s) => !shown.includes(s))
  const sections = shown.map((slug): PickSection => {
    const rows = [...by.get(slug)!].sort(slug === PLACES_COLLECTION ? byPlaces : byName)
    return { slug, title: sectionTitle(slug, layers), rows: rows.slice(0, cap).map(pickRow), more: Math.max(0, rows.length - cap) }
  })
  return { sections, hiddenGroups: hidden.length, hiddenPlaces: hidden.reduce((n, s) => n + by.get(s)!.length, 0) }
}

/**
 * Ranked search hits grouped by collection (groups in `groupOrder`, hits in rank order inside a group).
 * `hits` is the client's full ranked list for the query. At most `limit` are shown, and no collection takes
 * more than its share of them (`limit` / the number of collections with hits, between 10 and GROUP_CAP rows),
 * so a word that matches thousands of cable areas still shows the wind leases. `more` counts a group's
 * matches that are not shown.
 */
export function searchView(hits: IndexPlace[], layers: Pick<Layer, 'slug' | 'title'>[], limit = SEARCH_LIMIT): { sections: PickSection[]; total: number; shown: number } {
  const by = new Map<string, IndexPlace[]>()
  for (const r of hits) (by.get(r.collection) ?? by.set(r.collection, []).get(r.collection)!).push(r)
  const share = Math.min(GROUP_CAP, Math.max(10, Math.floor(limit / Math.max(1, by.size))))
  const order = groupOrder(layers.map((l) => l.slug)).filter((s) => by.has(s))
  // a collection missing from the manifest still lists its hits, last
  for (const s of by.keys()) if (!order.includes(s)) order.push(s)
  const sections = order.map((slug): PickSection => {
    const all = by.get(slug)!
    return { slug, title: sectionTitle(slug, layers), rows: all.slice(0, share).map(pickRow), more: Math.max(0, all.length - share) }
  })
  return { sections, total: hits.length, shown: sections.reduce((n, s) => n + s.rows.length, 0) }
}

/** the A–Z view: one list sorted by name (stable for equal names by id) */
export function azRows(sections: PickSection[]): PickRow[] {
  return sections.flatMap((s) => s.rows).sort((a, b) => byName(a.row, b.row))
}

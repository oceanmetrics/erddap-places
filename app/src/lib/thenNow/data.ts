// where the then-now data live, under the gazetteer catalog (Portolan STAC):
//
//   rasters/<dataset>/<variable>/<place_id>/<year>.tif           366 bands, band i = day-of-year i
//   climatology/<dataset>/<variable>/<place_id>/<baseline>_mean.tif   (+ _sd.tif, _n.tif)
//   series/<dataset>/<variable>/<place_id>.parquet                daily area means
//
// `catalog.json` links the three collections as children; the rasters collection says which places,
// variables and years exist. the parser below is deliberately tolerant about *where* in the
// collection that is said (summaries, item links or child links), since all three are valid STAC.
import { BASELINES, isBaseline, parseRange } from './state'

export interface RasterCatalog {
  /** dataset -> variable -> place ids */
  places : Map<string, Map<string, Set<string>>>
  years  : [number, number] | null
  baselines: string[]
  collection?: any
}

// the place id's colon is percent-encoded: S3 decodes `NMS%3AFKNMS` back to the `NMS:FKNMS` key,
// and Vite's dev server (which serves the fixture) answers 403 to a literal colon in a path
const seg = (place: string) => encodeURIComponent(place)
export const rasterUrl = (root: string, ds: string, v: string, place: string, year: number) =>
  `${root}rasters/${ds}/${v}/${seg(place)}/${year}.tif`
export const climUrl = (root: string, ds: string, v: string, place: string, baseline: string, stat: 'mean' | 'sd' | 'n' = 'mean') =>
  `${root}climatology/${ds}/${v}/${seg(place)}/${baseline}_${stat}.tif`
export const seriesUrl = (root: string, ds: string, v: string, place: string) =>
  `${root}series/${ds}/${v}/${seg(place)}.parquet`

/** the files a Then selection reads: one climatology, or one year file per year of the range. */
export function thenSources(root: string, ds: string, v: string, place: string, then: string,
                            years: [number, number] | null, baselines: readonly string[] = BASELINES): { kind: 'baseline' | 'custom'; urls: string[]; years: number[] } {
  const r = parseRange(then)
  if (!r) throw new Error(`not a Then selection: ${then}`)
  if (isBaseline(then, baselines)) return { kind: 'baseline', urls: [climUrl(root, ds, v, place, then)], years: range(r[0], r[1]) }
  const lo = years ? Math.max(r[0], years[0]) : r[0], hi = years ? Math.min(r[1], years[1]) : r[1]
  const ys = range(lo, hi)
  return { kind: 'custom', urls: ys.map((y) => rasterUrl(root, ds, v, place, y)), years: ys }
}
const range = (a: number, b: number) => (b >= a ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [])

const PATH = /(?:^|\/)rasters\/([^/]+)\/([^/]+)\/([^/]+?)(?:\/|\.json|$)/
function add(c: RasterCatalog, ds: string, v: string, p: string) {
  const dv = c.places.get(ds) ?? c.places.set(ds, new Map()).get(ds)!
  ;(dv.get(v) ?? dv.set(v, new Set()).get(v)!).add(decodeURIComponent(p))
}

/** the rasters collection -> which dataset/variable/place cubes exist, the years and the baselines. */
export function parseRasterCollection(col: any): RasterCatalog {
  const out: RasterCatalog = { places: new Map(), years: null, baselines: [], collection: col }
  const sm = col?.summaries ?? {}
  // catalog/build_then_now.py writes `erddap-places:dataset_id`, `erddap-places:variable` and
  // `erddap-places:place_id` as lists; the plural spellings are accepted too
  const arr = (v: any): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(String) : [String(v)])
  const dsName = arr(sm['erddap-places:dataset_id'] ?? sm['erddap-places:dataset'] ?? sm.dataset)[0]
  let vars = arr(sm['erddap-places:variable'] ?? sm['erddap-places:variables'] ?? sm.variables ?? sm.variable)
  if (!vars.length) vars = Object.keys(col?.['cube:variables'] ?? {})
  const pids = arr(sm['erddap-places:place_id'] ?? sm['erddap-places:place_ids'] ?? sm.place_ids)
  if (dsName && pids.length) for (const v of vars) for (const p of pids) add(out, dsName, v, p)
  for (const l of col?.links ?? []) {
    if (!['item', 'child'].includes(l.rel)) continue
    const m = PATH.exec(String(l.href))
    if (m) add(out, m[1], m[2], m[3])
  }
  for (const it of col?.features ?? []) {
    for (const a of Object.values<any>(it.assets ?? {})) {
      const m = PATH.exec(String(a.href)); if (m) add(out, m[1], m[2], m[3])
    }
  }
  const iv = col?.extent?.temporal?.interval?.[0]
  const yr = (x: any) => (x ? new Date(x).getUTCFullYear() : NaN)
  const y0 = sm.year?.minimum ?? yr(iv?.[0]), y1 = sm.year?.maximum ?? yr(iv?.[1])
  if (Number.isFinite(y0) && Number.isFinite(y1)) out.years = [Number(y0), Number(y1)]
  out.baselines = sm['erddap-places:baselines'] ?? sm.baselines ?? []
  return out
}

/** the place ids with cubes for a dataset/variable. */
export function placesWith(c: RasterCatalog | null, ds: string, v: string): Set<string> {
  return c?.places.get(ds)?.get(v) ?? new Set()
}

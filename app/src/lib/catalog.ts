// the STAC side of the gazetteer: catalog.json -> the erddap/* child Collections. each Collection
// carries the datacube extension (cube:dimensions, cube:variables) and our erddap:* fields, which is
// everything the app needs to build a griddap URL and read the slab back.
import { gazetteerFetch } from './gazetteer'
import type { Format } from './erddap'
import { pickFormat } from './erddap'

export interface CubeVariable {
  name       : string
  unit       : string | null
  description: string
  categorical: boolean
  /** class value -> label, for categorical variables (from `erddap-places:classes`). */
  classes   ?: Record<string, string>
}

export interface Dataset {
  id           : string           // erddap/dhw_5km
  title        : string
  baseUrl      : string
  datasetId    : string
  version     ?: string
  cors         : boolean
  formats      : string[]
  lonRange     : [number, number]
  latDescending: boolean
  variables    : CubeVariable[]
  timeStep    ?: string           // e.g. P1D, P8D
  timeExtent  ?: [string | null, string | null]
  format       : Format           // best format this server can serve us
  collection   : any              // the raw STAC Collection
}

const KELVIN = /^(k|kelvin|degree_?k(elvin)?)$/i

/** the SQL expression for a variable's value, converting Kelvin to °C. */
export function valueExpr(v: CubeVariable, alias = 's'): string {
  const col = `${alias}."${v.name}"`
  return KELVIN.test(v.unit ?? '') ? `(${col} - 273.15)` : col
}
/** the axis label for a variable, after any unit conversion. */
export function valueLabel(v: CubeVariable): string {
  if (KELVIN.test(v.unit ?? '')) return '°C'
  const u = (v.unit ?? '').trim()
  if (!u || u === '1' || u.toLowerCase() === 'none') return v.name
  if (/^(celsius|degree_?c(elsius)?)$/i.test(u)) return '°C'
  return u
}

function toVariable(name: string, v: any): CubeVariable {
  return {
    name,
    unit       : v?.unit ?? null,
    description: v?.description ?? name,
    categorical: v?.['erddap-places:categorical'] === true,
    classes    : v?.['erddap-places:classes'] ?? undefined,
  }
}

/** one STAC Collection -> the fields the app uses. */
export function toDataset(c: any): Dataset {
  const vars = Object.entries(c['cube:variables'] ?? {})
    .filter(([, v]: [string, any]) => (v?.type ?? 'data') === 'data')
    .map(([k, v]) => toVariable(k, v))
  const time = c['cube:dimensions']?.time ?? {}
  return {
    id           : c.id,
    title        : c.title ?? c.id,
    baseUrl      : c['erddap:base_url'],
    datasetId    : c['erddap:dataset_id'],
    version      : c['erddap:version'],
    cors         : c['erddap:cors'] !== false,
    formats      : c['erddap:formats'] ?? [],
    lonRange     : c['erddap:lon_range'] ?? [-180, 180],
    latDescending: c['erddap:lat_descending'] === true,
    variables    : vars,
    timeStep     : time.step,
    timeExtent   : time.extent,
    format       : pickFormat({ erddap: { cors: c['erddap:cors'], formats: c['erddap:formats'] } }),
    collection   : c,
  }
}

/** every `erddap/*` child Collection of the published catalog. */
export async function loadDatasets(): Promise<Dataset[]> {
  const cat: any = await (await gazetteerFetch('catalog.json')).json()
  const hrefs: string[] = (cat.links ?? [])
    .filter((l: any) => l.rel === 'child' && /erddap\//.test(l.href))
    .map((l: any) => String(l.href).replace(/^\.\//, ''))
  const out: Dataset[] = []
  for (const href of hrefs) {
    try { out.push(toDataset(await (await gazetteerFetch(href)).json())) }
    catch (e) { console.warn(`catalog: skipping ${href}`, e) }
  }
  return out
}

/** ERDDAP wants a lon in the dataset's own range: [-180, 180] or [0, 360]. */
export function toDatasetLon(lon: number, range: [number, number]): number {
  if (range[1] > 180 && lon < 0)  return lon + 360
  if (range[0] < 0   && lon > 180) return lon - 360
  return lon
}

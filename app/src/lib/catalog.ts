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

/** the long-format columns of a tabledap table: `measurement_type` / `measurement_value`. */
export interface LongFormat { typeColumn: string; valueColumn: string }

export interface Dataset {
  id           : string           // erddap/dhw_5km
  title        : string
  baseUrl      : string
  datasetId    : string
  protocol     : 'griddap' | 'tabledap'
  /** set when the table keeps its variables in a column (tabledap, long format) */
  longFormat  ?: LongFormat
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

/**
 * The SQL expression for a variable's value, converting Kelvin to °C.
 *
 * For a long-format table the variable is not a column: the rows were already filtered to
 * `measurement_type = '<name>'` by the request, so the expression is the value column.
 */
export function valueExpr(v: CubeVariable, alias = 's', long?: LongFormat): string {
  const col = long ? `${alias}."${long.valueColumn}"` : `${alias}."${v.name}"`
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

/** the `erddap-places:categorical` flag as published in the catalog (boolean, or the string). */
export function isCategorical(v: any): boolean {
  const f = v?.['erddap-places:categorical']
  return f === true || f === 'true'
}

/** `erddap-places:long_format` -> the two column names, or undefined. */
export function toLongFormat(f: any): LongFormat | undefined {
  const t = f?.type_column, v = f?.value_column
  return t && v ? { typeColumn: String(t), valueColumn: String(v) } : undefined
}

/**
 * The SQL template a run is summarised with: point (tabledap) data rolls up by month, a flagged
 * categorical grid gets per-class fractions, everything else is the daily grid statistics.
 */
export function statsTemplate(
  v: Pick<CubeVariable, 'categorical'> | null | undefined,
  protocol: 'griddap' | 'tabledap' = 'griddap',
): 'stats_daily' | 'stats_categorical' | 'stats_tabledap' {
  if (protocol === 'tabledap') return 'stats_tabledap'
  return v?.categorical === true ? 'stats_categorical' : 'stats_daily'
}

function toVariable(name: string, v: any): CubeVariable {
  return {
    name,
    unit       : v?.unit ?? null,
    description: v?.description ?? name,
    categorical: isCategorical(v),
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
    protocol     : c['erddap:protocol'] === 'tabledap' ? 'tabledap' : 'griddap',
    longFormat   : toLongFormat(c['erddap-places:long_format']),
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

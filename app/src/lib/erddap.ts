// ERDDAP griddap client. no proxy of ours in the path: the browser talks to the ERDDAP server.
//
// URL shape (griddap): {base}/griddap/{dataset}.{fmt}?{var}[(t0):1:(t1)][(lat0):1:(lat1)][(lon0):1:(lon1)]
// each constraint's square brackets are percent-encoded (%5B / %5D); the rest of the query is left
// literal, because ERDDAP will not accept a fully encoded query string. constraint values go in the
// axis's own direction (latitude descends on the CRW grid, so [(22.4):1:(18.8)]).

export type Format = 'parquet' | 'csvp' | 'jsonp'

export interface ErddapMeta { version?: string; cors?: boolean; formats?: string[] }
export interface Collection { erddap: ErddapMeta }

export interface GriddapSpec {
  base          : string
  datasetId     : string
  variable      : string
  time          : [string, string]
  lat           : [number, number]  // [min, max], any order; reordered per latDescending
  lon           : [number, number]
  latDescending?: boolean
  format        ?: Format
  callback      ?: string           // jsonp only
}

const enc = (s: string) => s.replace(/\[/g, '%5B').replace(/\]/g, '%5D')
const stripSlash = (s: string) => s.replace(/\/+$/, '')
/** one axis constraint, `[(lo):1:(hi)]` with the brackets encoded. */
export function constraint(lo: string | number, hi: string | number, stride = 1): string {
  return enc(`[(${lo}):${stride}:(${hi})]`)
}
/** an ISO instant at 12:00Z for a Date or a yyyy-mm-dd string (ERDDAP daily grids sit at noon). */
export function noonZ(d: Date | string): string {
  const iso = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  return `${iso}T12:00:00Z`
}

const EXT: Record<Format, string> = { parquet: '.parquet', csvp: '.csvp', jsonp: '.json' }

/** the griddap request URL for one lobe. */
export function griddapUrl(s: GriddapSpec): string {
  const fmt  = s.format ?? 'parquet'
  const desc = s.latDescending ?? true
  const [y0, y1] = [Math.min(...s.lat), Math.max(...s.lat)]
  const [x0, x1] = [Math.min(...s.lon), Math.max(...s.lon)]
  const q =
    s.variable +
    constraint(s.time[0], s.time[1]) +
    (desc ? constraint(y1, y0) : constraint(y0, y1)) +
    constraint(x0, x1)
  const tail = fmt === 'jsonp' ? `&.jsonp=${s.callback ?? 'erddapCb'}` : ''
  return `${stripSlash(s.base)}/griddap/${s.datasetId}${EXT[fmt]}?${q}${tail}`
}

/** one URL per polygon lobe (bbox = [lonMin, latMin, lonMax, latMax]). */
export function griddapUrls(s: Omit<GriddapSpec, 'lat' | 'lon'>, bboxes: Array<[number, number, number, number]>): string[] {
  return bboxes.map((b) => griddapUrl({ ...s, lon: [b[0], b[2]], lat: [b[1], b[3]] }))
}

// ── axis vectors ──────────────────────────────────────────────────────────────
/** `dataset.json?latitude[(min):1:(max)]` -> the axis values, in the server's own order. */
export async function fetchAxis(base: string, datasetId: string, axis: string, min: number, max: number, descending = false, signal?: AbortSignal): Promise<number[]> {
  const c   = descending ? constraint(max, min) : constraint(min, max)
  const url = `${stripSlash(base)}/griddap/${datasetId}.json?${axis}${c}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  const j: { table: { columnNames: string[]; rows: number[][] } } = await res.json()
  return j.table.rows.map((r) => Number(r[0]))
}

// ── format rung ───────────────────────────────────────────────────────────────
/**
 * Best format this server can serve us: Parquet -> CSV (`.csvp`) -> JSONP.
 * CORS off means only JSONP (a `<script>` tag is not subject to CORS).
 */
export function pickFormat(collection: Collection): Format {
  const e    = collection?.erddap ?? {}
  const fmts = (e.formats ?? []).map((f) => f.replace(/^\./, '').toLowerCase())
  if (e.cors === false) return 'jsonp'
  if (fmts.length === 0) return 'parquet'
  if (fmts.includes('parquet')) return 'parquet'
  if (fmts.includes('csvp') || fmts.includes('csv')) return 'csvp'
  return 'jsonp'
}

// ── fetch ─────────────────────────────────────────────────────────────────────
export interface Slab {
  url    : string
  format : Format
  ms     : number
  bytes ?: number
  buffer?: Uint8Array                    // parquet
  rows  ?: Record<string, unknown>[]     // csvp / jsonp
  text  ?: string                        // csvp, raw
}

/** load a `.json?...&.jsonp=cb` URL through a <script> tag (browser only; no CORS needed). */
export function fetchJsonp(url: string, cbName: string, timeoutMs = 120_000, signal?: AbortSignal): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('jsonp needs a browser document'))
    const done = (fn: () => void) => { clearTimeout(timer); delete (window as any)[cbName]; script.remove(); fn() }
    const timer = setTimeout(() => done(() => reject(new Error(`jsonp timeout: ${url}`))), timeoutMs)
    ;(window as any)[cbName] = (data: any) => done(() => resolve(data))
    // a <script> tag cannot be cancelled, but a superseded run must stop waiting on it
    signal?.addEventListener('abort', () => done(() => reject(new DOMException('aborted', 'AbortError'))), { once: true })
    const script  = document.createElement('script')
    script.src    = url
    script.onerror = () => done(() => reject(new Error(`jsonp failed: ${url}`)))
    document.head.appendChild(script)
  })
}

/** `{table:{columnNames, rows}}` -> array of objects. */
export function tableToRows(t: { table: { columnNames: string[]; rows: unknown[][] } }): Record<string, unknown>[] {
  const { columnNames, rows } = t.table
  return rows.map((r) => Object.fromEntries(columnNames.map((c, i) => [c, r[i]])))
}

/** minimal CSV parse for `.csvp` (ERDDAP quotes with " and doubles inner quotes). */
export function parseCsvp(text: string): Record<string, unknown>[] {
  const lines = text.split('\n').filter((l) => l.length)
  if (!lines.length) return []
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
      else if (ch === '"') q = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else if (ch !== '\r') cur += ch
    }
    out.push(cur); return out
  }
  const head = split(lines[0]).map((h) => h.replace(/\s*\(.*\)$/, '')) // strip the " (degree_C)" units suffix
  return lines.slice(1).map((l) => {
    const f = split(l)
    return Object.fromEntries(head.map((h, i) => {
      const v = f[i]
      const n = v === '' || v === 'NaN' ? null : Number(v)
      return [h, n === null || Number.isNaN(n) ? v : n]
    }))
  })
}

/** fetch one slab in the given format. Parquet comes back as bytes for `registerFileBuffer`. */
export async function fetchSlab(url: string, format: Format = 'parquet', callback = 'erddapCb', signal?: AbortSignal): Promise<Slab> {
  const t0 = (globalThis.performance ?? Date).now()
  if (format === 'jsonp') {
    const data = await fetchJsonp(url, callback, 120_000, signal)
    return { url, format, ms: (globalThis.performance ?? Date).now() - t0, rows: tableToRows(data) }
  }
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const msg = (await res.text().catch(() => '')).slice(0, 400)
    throw new Error(`${res.status} ${res.statusText} from ERDDAP: ${msg}`)
  }
  if (format === 'csvp') {
    const text = await res.text()
    return { url, format, ms: (globalThis.performance ?? Date).now() - t0, bytes: text.length, text, rows: parseCsvp(text) }
  }
  const buffer = new Uint8Array(await res.arrayBuffer())
  return { url, format, ms: (globalThis.performance ?? Date).now() - t0, bytes: buffer.byteLength, buffer }
}

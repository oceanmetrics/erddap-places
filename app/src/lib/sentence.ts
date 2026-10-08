// the words of the title sentence: dataset -> place -> method -> time, in plain language, with the
// codes kept for hovers and the URL. pure functions, so the sentence is testable without a DOM.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Florida Keys National Marine Sanctuary" -> "Florida Keys NMS" (and the monument the same way). */
export function shortPlace(name: string): string {
  return String(name ?? '')
    .replace(/\bNational Marine Sanctuary\b/i, 'NMS')
    .replace(/\bMarine National Monument\b/i, 'MNM')
    .trim()
}

/** "sea surface temperature" -> "Sea surface temperature"; a trailing note in parentheses is dropped. */
export function variableWords(description: string | undefined, name: string): string {
  const d = String(description ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  const s = d && d !== name ? d : name
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The producer, short: "NOAA Coral Reef Watch (CRW)" -> "NOAA Coral Reef Watch"; a long name with a
 * one-word acronym becomes the acronym ("California Cooperative … Investigations (CalCOFI)" ->
 * "CalCOFI"); "A (X) / B" keeps A.
 */
export function producer(collection: any): string {
  const ps: any[] = collection?.providers ?? []
  const p = ps.find((x) => (x?.roles ?? []).includes('producer')) ?? ps[0]
  const name = String(p?.name ?? '').split(' / ')[0].trim()
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(name)
  if (!m) return name
  return m[1].length > 32 && /^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(m[2]) ? m[2] : m[1].trim()
}

/** grid spacing in words: 0.05° -> "5 km", 0.01° -> "1 km", 0.0833° -> "9 km", 0.25° -> "0.25°". */
export function resolution(collection: any): string {
  const d = collection?.['cube:dimensions'] ?? {}
  const step = Number((d.longitude ?? d.x ?? d.lon)?.step)
  if (!Number.isFinite(step) || step <= 0) return ''
  if (step < 0.2) return `${Math.max(1, Math.floor(step * 111))} km`
  return `${+step.toPrecision(3)}°`
}

/** an ISO 8601 step in words: P1D daily, P8D 8-day, P1M monthly; otherwise the step label given. */
export function cadence(step: string | undefined, label?: string): string {
  if (step === 'P1D') return 'daily'
  if (step === 'P1M') return 'monthly'
  const m = /^P(\d+)D$/.exec(step ?? '')
  if (m) return `${m[1]}-day`
  return label ?? ''
}

/** "(NOAA Coral Reef Watch, 5 km, daily)": the parenthetical after the variable. */
export function datasetBlurb(collection: any, step?: string, stepLabel?: string, protocol?: string): string {
  const parts = [producer(collection), protocol === 'tabledap' ? 'samples' : resolution(collection),
                 protocol === 'tabledap' ? 'monthly roll-up' : cadence(step, stepLabel)].filter(Boolean)
  return parts.join(', ')
}

const ymd = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}
/** "2026-10-06" -> "6 Oct 2026". */
export function fmtDay(iso: string): string {
  const t = ymd(iso)
  return t ? `${t.d} ${MONTHS[t.m - 1]} ${t.y}` : String(iso ?? '')
}
/** "7 Sep – 6 Oct 2026", "28 Dec 2025 – 6 Jan 2026", "6 Oct 2026" for a single day. */
export function fmtRange(from: string, to: string): string {
  const a = ymd(from), b = ymd(to)
  if (!a || !b) return `${from ?? ''} – ${to ?? ''}`
  if (from.slice(0, 10) === to.slice(0, 10)) return fmtDay(to)
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${fmtDay(to)}`
  return `${fmtDay(from)} – ${fmtDay(to)}`
}
/** "2021-01" … "2026-10" month span, for a tabledap monthly roll-up: "Jan 2021 – Oct 2026". */
export function fmtMonths(from: string, to: string): string {
  const a = ymd(from), b = ymd(to)
  if (!a || !b) return fmtRange(from, to)
  return `${MONTHS[a.m - 1]} ${a.y} – ${MONTHS[b.m - 1]} ${b.y}`
}
/** "08-05" -> "5 Aug". */
export function fmtMd(md: string): string {
  const m = /^(\d{2})-(\d{2})$/.exec(md ?? '')
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : String(md ?? '')
}
/** a year range "1985-2005" -> "1985–2005". */
export const fmtYears = (r: string) => String(r ?? '').replace(/^(\d{4})-(\d{4})$/, '$1–$2')

/** the statistics a daily run can chart, in the order the Method tab lists them. */
export const STATS = [
  { id: 'mean_wt', label: 'area-weighted mean' },
  { id: 'mean',    label: 'mean (unweighted)' },
  { id: 'min',     label: 'minimum' },
  { id: 'max',     label: 'maximum' },
  { id: 'p10',     label: '10th percentile' },
  { id: 'p90',     label: '90th percentile' },
  { id: 'sd',      label: 'standard deviation' },
] as const
export type StatId = (typeof STATS)[number]['id']
export const isStat = (s: unknown): s is StatId => STATS.some((x) => x.id === s)
export const statLabel = (s: string) => STATS.find((x) => x.id === s)?.label ?? s

/** "462 cells", "1 cell", "12 stations". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "76 % of the sanctuary more than +1 °C warmer" (or "cooler" for a negative threshold). */
export function exceedanceLine(pct: number, threshold: number, unit: string, what = 'the sanctuary'): string {
  const sign = threshold > 0 ? '+' : threshold < 0 ? '−' : ''
  const temp = /°C|celsius/i.test(unit)
  const word = temp ? (threshold < 0 ? 'cooler' : 'warmer') : (threshold < 0 ? 'lower' : 'higher')
  return `${Math.round(pct)} % of ${what} more than ${sign}${Math.abs(threshold)} ${unit} ${word}`.replace(/\s+/g, ' ').trim()
}

/** a collection's DOI as a URL: `cite-as`, then `sci:doi`, then an `about` link that is a doi.org URL. */
export function datasetDoi(c: any): string {
  const links: any[] = c?.links ?? []
  const citeAs = links.find((l) => l?.rel === 'cite-as')?.href
  if (citeAs) return String(citeAs)
  if (c?.['sci:doi']) return `https://doi.org/${c['sci:doi']}`
  const about = links.find((l) => l?.rel === 'about' && /^https?:\/\/(dx\.)?doi\.org\//.test(String(l?.href)))?.href
  return about ? String(about) : ''
}

/** a collection's licence in words: the SPDX id, or for `other`/none the licence page when there is one. */
export function datasetLicence(c: any): { text: string; href: string } {
  const href = String((c?.links ?? []).find((l: any) => l?.rel === 'license')?.href ?? '')
  const id = String(c?.license ?? '').trim()
  if (id && id !== 'other' && id !== 'proprietary') return { text: id, href: href || `https://spdx.org/licenses/${id}.html` }
  return { text: href ? `the producer's terms (${href})` : '', href }
}

/**
 * A citation for a dataset as the app used it: producer, title, the ERDDAP dataset page, the access
 * date, the licence, and the DOI when the collection has one (cite-as, sci:doi or a doi.org `about`).
 */
export function citation(o: { collection: any; title: string; baseUrl: string; datasetId: string; protocol?: string }, accessed: string): string {
  const c = o.collection ?? {}
  const who = producer(c) || 'Unknown producer'
  const doi = datasetDoi(c)
  const lic = datasetLicence(c).text
  const page = `${String(o.baseUrl ?? '').replace(/\/$/, '')}/${o.protocol === 'tabledap' ? 'tabledap' : 'griddap'}/${o.datasetId}.html`
  return [`${who}. ${o.title} (ERDDAP dataset ${o.datasetId}).`, `${page}, accessed ${accessed}.`,
          lic ? `Licence: ${lic}.` : '', doi ? `${doi}` : ''].filter(Boolean).join(' ')
}

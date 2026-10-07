// day of year <-> band index. the then-now rasters keep one band per calendar day of a **leap** year:
// band i is day-of-year i of 2000, so band 60 is 29 Feb and 1 Mar is always band 61 (in a non-leap
// year band 60 is all NaN). a month-day therefore names the same band in every year, and the
// climatology bands line up with the year bands without any shifting.

export const N_BANDS = 366
const REF = 2000                                   // a leap year: the calendar the bands follow
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** `MM-DD` -> band (1..366); throws on a month-day that does not exist in a leap year. */
export function mdToBand(md: string): number {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(md.trim())
  if (!m) throw new Error(`not a month-day: ${md}`)
  const mo = Number(m[1]), d = Number(m[2])
  const t = Date.UTC(REF, mo - 1, d)
  const back = new Date(t)
  if (mo < 1 || mo > 12 || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
    throw new Error(`no such day: ${md}`)
  return Math.round((t - Date.UTC(REF, 0, 1)) / 864e5) + 1
}

/** band (1..366) -> `MM-DD`. */
export function bandToMd(band: number): string {
  if (!(band >= 1 && band <= N_BANDS)) throw new Error(`band out of range: ${band}`)
  const d = new Date(Date.UTC(REF, 0, band))
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** a date (`YYYY-MM-DD` or Date) -> its band: 1 Mar is 61 whether or not the year is leap. */
export function dateToBand(date: string | Date): number {
  const s = typeof date === 'string' ? date : date.toISOString().slice(0, 10)
  return mdToBand(s.slice(5, 10))
}

/** the date a band stands for in a given year, or null for band 60 (29 Feb) in a non-leap year. */
export function bandDate(year: number, band: number): string | null {
  const md = bandToMd(band)
  if (md === '02-29' && !isLeap(year)) return null
  return `${year}-${md}`
}

/** `08-05` -> `05 Aug`, as the Shiny app's legends print it. */
export function mdLabel(md: string): string {
  const [m, d] = md.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`
}

/** step a month-day by `delta` days around the 366-day calendar (wraps 31 Dec <-> 01 Jan). */
export function stepMd(md: string, delta: number): string {
  const b = mdToBand(md) + delta
  return bandToMd(((b - 1) % N_BANDS + N_BANDS) % N_BANDS + 1)
}

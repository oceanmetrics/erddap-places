// the day-of-year chart's query: every year of the place's daily area means on the 366-band
// calendar (so 1 Mar lines up across leap and non-leap years), an optional centred moving average,
// the Then-years climatology per day and the anomaly of each day against it. runs in DuckDB-WASM on
// the series parquet, and in the native duckdb CLI in the tests.

export interface SeriesParams {
  src     : string          // a read_parquet() argument: a registered file name or a path
  then    : [number, number]
  /** centred moving-average window in days (0 or 1 = none), as the Shiny app's smoothing slider */
  smooth ?: number
  dateCol?: string
  valueCol?: string
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
const str   = (s: string) => `'${s.replace(/'/g, "''")}'`

export function seriesSql({ src, then, smooth = 0, dateCol = 'date', valueCol = 'mean' }: SeriesParams): string {
  const k = Math.max(1, Math.round(smooth))
  const before = Math.ceil((k - 1) / 2), after = Math.floor((k - 1) / 2)
  const y0 = Math.trunc(then[0]), y1 = Math.trunc(then[1])
  // the band of a date: its day of year in 2000, a leap year (no ICU in DuckDB-WASM: plain DATE math)
  return `WITH raw AS (
  SELECT CAST(${ident(dateCol)} AS DATE) AS date, CAST(${ident(valueCol)} AS DOUBLE) AS value
  FROM read_parquet(${str(src)})
), s AS (
  SELECT date, year(date) AS year,
         dayofyear(make_date(2000, month(date), day(date))) AS band,
         ${k > 1
           ? `avg(value) OVER (PARTITION BY year(date) ORDER BY date ROWS BETWEEN ${before} PRECEDING AND ${after} FOLLOWING)`
           : 'value'} AS value
  FROM raw
), clim AS (
  SELECT band, avg(value) AS clim FROM s WHERE year BETWEEN ${y0} AND ${y1} GROUP BY band
)
SELECT s.year, s.band, s.date, s.value, clim.clim, s.value - clim.clim AS anom
FROM s LEFT JOIN clim USING (band)
ORDER BY s.year, s.band`
}

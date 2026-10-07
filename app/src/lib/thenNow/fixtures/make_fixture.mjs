// builds the then-now test fixture with the same shapes as the published data contract:
//
//   rasters/dhw_5km/CRW_SST/NMS:TEST/<year>.tif               366-band COG, band i = day-of-year i
//   climatology/dhw_5km/CRW_SST/NMS:TEST/2024-2025_mean.tif   366-band mean of the two years
//   series/dhw_5km/CRW_SST/NMS:TEST.parquet                    daily area means, 2020-2025
//
// 20 x 20 px at 0.05° over [-81, 24.5, -80, 25.5] (EPSG:4326, float32, nodata NaN, INTERLEAVE=BAND,
// DEFLATE, 256 px tiles). values are a closed form, so tests can assert them exactly:
//
//   v(year, band, row, col) = 20 + 0.01 * band + 0.5 * (year - 2024) + 0.1 * col - 0.05 * row
//
// NaN where row + col < 3 (pixels outside the "sanctuary") and in band 60 (29 Feb) of a non-leap
// year. needs node >= 22, gdal_translate (GDAL >= 3.11 for the COG INTERLEAVE option) and duckdb.
//
//   node src/lib/thenNow/fixtures/make_fixture.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE  = dirname(fileURLToPath(import.meta.url))
const PLACE = 'NMS:TEST'
const W = 20, H = 20, NB = 366
const BBOX = [-81, 24.5, -80, 25.5]
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export const value = (year, band, row, col) =>
  row + col < 3 || (band === 60 && !leap(year)) ? NaN
    : 20 + 0.01 * band + 0.5 * (year - 2024) + 0.1 * col - 0.05 * row

function cube(f) {
  const a = new Float32Array(W * H * NB)
  for (let b = 1; b <= NB; b++)
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) a[(b - 1) * W * H + r * W + c] = f(b, r, c)
  return a
}

function writeCog(arr, out) {
  const tmp = mkdtempSync(join(tmpdir(), 'thennow-'))
  const raw = join(tmp, 'cube.bin')
  writeFileSync(raw, Buffer.from(arr.buffer))
  writeFileSync(join(tmp, 'cube.hdr'),
    `ENVI\nsamples = ${W}\nlines = ${H}\nbands = ${NB}\nheader offset = 0\nfile type = ENVI Standard\n` +
    `data type = 4\ninterleave = bsq\nbyte order = 0\n`)
  mkdirSync(dirname(out), { recursive: true })
  execFileSync('gdal_translate', ['-q', '-of', 'COG', '-a_srs', 'EPSG:4326',
    '-a_ullr', String(BBOX[0]), String(BBOX[3]), String(BBOX[2]), String(BBOX[1]), '-a_nodata', 'nan',
    '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=YES', '-co', 'BLOCKSIZE=256', '-co', 'INTERLEAVE=BAND',
    '-co', 'OVERVIEWS=NONE', raw, out])
  rmSync(tmp, { recursive: true, force: true })
}

const ras = (y) => join(HERE, 'rasters/dhw_5km/CRW_SST', PLACE, `${y}.tif`)
for (const y of [2024, 2025]) writeCog(cube((b, r, c) => value(y, b, r, c)), ras(y))
// the climatology: NaN-aware mean of 2024 and 2025 (band 60 is 2024 alone)
writeCog(cube((b, r, c) => {
  const vs = [2024, 2025].map((y) => value(y, b, r, c)).filter(Number.isFinite)
  return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : NaN
}), join(HERE, 'climatology/dhw_5km/CRW_SST', PLACE, '2024-2025_mean.tif'))

// the series: daily area means, 2020-2025, a seasonal cycle on the band calendar plus 0.1 °C a year
const rows = ['date,mean,sd,min,max,n_cells']
for (let t = Date.UTC(2020, 0, 1); t <= Date.UTC(2025, 11, 31); t += 864e5) {
  const d = new Date(t), y = d.getUTCFullYear()
  // on the band calendar (day of year in 2000), so a day has the same seasonal term in every year
  const band = Math.round((Date.UTC(2000, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(2000, 0, 1)) / 864e5) + 1
  const m = 27 + 3 * Math.sin((2 * Math.PI * (band - 120)) / 366) + 0.1 * (y - 2020)
  rows.push(`${d.toISOString().slice(0, 10)},${m.toFixed(4)},0.5,${(m - 1).toFixed(4)},${(m + 1).toFixed(4)},397`)
}
const tmp = mkdtempSync(join(tmpdir(), 'thennow-'))
writeFileSync(join(tmp, 's.csv'), rows.join('\n') + '\n')
const pq = join(HERE, 'series/dhw_5km/CRW_SST', `${PLACE}.parquet`)
mkdirSync(dirname(pq), { recursive: true })
execFileSync('duckdb', ['-c',
  `COPY (SELECT CAST(date AS DATE) AS date, mean, sd, min, max, CAST(n_cells AS INTEGER) AS n_cells ` +
  `FROM read_csv('${join(tmp, 's.csv')}') ORDER BY date) TO '${pq}' (FORMAT PARQUET, COMPRESSION ZSTD)`])
rmSync(tmp, { recursive: true, force: true })
console.log('fixture written under', HERE)

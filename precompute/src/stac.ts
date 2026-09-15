// the STAC side: catalog/gazetteer/stats/ — one Collection, one Item per (dataset, variable, place).
import { createHash }                     from 'node:crypto'
import { deflateSync }                    from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname }                  from 'node:path'
import type { Place }                     from '../../app/src/lib/gazetteer'
import { placeLobes, plainPlace }         from '../../app/src/lib/gazetteer'
import type { Provenance }                from './stats'
import { itemId, statsHref, statsPath }   from './stats'
import { GAZETTEER, STATS }               from './paths'

const STAC_VERSION = '1.1.0'
const EXT = {
  table : 'https://stac-extensions.github.io/table/v1.2.0/schema.json',
  file  : 'https://stac-extensions.github.io/file/v2.1.0/schema.json',
  portolan: 'https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json',
}

/** the collection thumbnail file name. */
export const THUMB = 'stats.thumb.png'

/** `file:size` + `file:checksum` when the file is on disk (the parquet is not in git). */
export function fileStats(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  return { 'file:size': statSync(path).size, 'file:checksum': multihash(path) }
}

/** multihash (sha2-256) of a file, the way portolan writes file:checksum. */
export function multihash(path: string): string {
  return '1220' + createHash('sha256').update(readFileSync(path)).digest('hex')
}

// ── columns ───────────────────────────────────────────────────────────────────
export const DAILY_COLUMNS = [
  { name: 'date',       type: 'date',   description: 'UTC day of the time step' },
  { name: 'n',          type: 'int64',  description: 'grid cells with a non-null value on that day' },
  { name: 'mean',       type: 'double', description: 'unweighted mean over the masked cells' },
  { name: 'mean_wt',    type: 'double', description: 'area-weighted mean (partial boundary cells count for their overlap)' },
  { name: 'sd',         type: 'double', description: 'sample standard deviation' },
  { name: 'min',        type: 'double', description: 'minimum' },
  { name: 'max',        type: 'double', description: 'maximum' },
  { name: 'p10',        type: 'double', description: '10th percentile (continuous)' },
  { name: 'p90',        type: 'double', description: '90th percentile (continuous)' },
  { name: 'weight_sum', type: 'double', description: 'sum of the cell area weights contributing to the day' },
  { name: 'place_id',   type: 'string', description: 'gazetteer place id, e.g. NMS:HIHWNMS' },
  { name: 'dataset_id', type: 'string', description: 'ERDDAP datasetID, e.g. dhw_5km' },
  { name: 'variable',   type: 'string', description: 'ERDDAP variable, e.g. CRW_SST' },
]
export const CATEGORICAL_COLUMNS = [
  { name: 'date',       type: 'date',   description: 'UTC day of the time step' },
  { name: 'class',      type: 'int64',  description: 'the class value (see the dataset collection\'s erddap-places:classes)' },
  { name: 'n',          type: 'int64',  description: 'grid cells in that class on that day' },
  { name: 'weight',     type: 'double', description: 'sum of the class cells\' area weights' },
  { name: 'frac_area',  type: 'double', description: 'area-weighted share of the place in that class; sums to 1 over a date (the SQL template calls this `fraction`)' },
  { name: 'pct_cells',  type: 'double', description: 'unweighted percent of masked cells in that class (the SQL template calls this `percent_cells`)' },
  { name: 'place_id',   type: 'string', description: 'gazetteer place id, e.g. NMS:HIHWNMS' },
  { name: 'dataset_id', type: 'string', description: 'ERDDAP datasetID, e.g. dhw_5km' },
  { name: 'variable',   type: 'string', description: 'ERDDAP variable, e.g. CLASS' },
]

// ── geometry ──────────────────────────────────────────────────────────────────
/**
 * The item geometry: a MultiPolygon of the place's LOBE bounding boxes, not the place outline.
 * The outlines run to 39,645 vertices (FKNMS) and would make the items far larger than the data
 * they describe; the lobe boxes keep an antimeridian place (PMNM) as two honest boxes instead of one
 * box spanning the globe.
 */
export function lobeBoxGeometry(place: Place) {
  const boxes = placeLobes(plainPlace(place)).map((l) => l.bbox)
  return {
    type: 'MultiPolygon' as const,
    coordinates: boxes.map(([x0, y0, x1, y1]) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]),
  }
}

/** the upstream `rel: "via"` (text/html) of a dataset's own collection, so items point at the source. */
export function datasetVia(datasetId: string): { href: string; title: string } | null {
  const p = join(GAZETTEER, 'erddap', datasetId, 'collection.json')
  if (!existsSync(p)) return null
  const c = JSON.parse(readFileSync(p, 'utf8'))
  const v = (c.links ?? []).find((l: any) => l.rel === 'via' && l.type === 'text/html')
  return v ? { href: v.href, title: v.title ?? datasetId } : null
}

// ── thumbnail ─────────────────────────────────────────────────────────────────
/**
 * A 480x240 equirectangular PNG of the covered places: the collection's "default styling" is the
 * place boxes on a world graticule, which is all a 2 kB thumbnail can honestly say. Written by hand
 * (node:zlib + the PNG container) rather than pulling a raster library in for one image.
 */
export function writeThumbnail(path: string, places: Place[]) {
  const W = 480, H = 240
  const px = Buffer.alloc(W * H * 3)
  const set = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 3
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]
  }
  const toX = (lon: number) => Math.round(((lon + 180) / 360) * (W - 1))
  const toY = (lat: number) => Math.round(((90 - lat) / 180) * (H - 1))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, [10, 26, 47])          // ocean
  for (let x = 0; x < W; x += 1) { set(x, toY(0), [24, 48, 80]) }                           // equator
  for (const lon of [-120, -60, 0, 60, 120]) for (let y = 0; y < H; y++) set(toX(lon), y, [24, 48, 80])
  for (const p of places) {
    for (const [x0, y0, x1, y1] of placeLobes(plainPlace(p)).map((l) => l.bbox)) {
      const [a, b, c, d] = [toX(x0), toY(y1), toX(x1), toY(y0)]
      // a filled, then outlined, box: tiny places still show as at least one pixel
      for (let y = b; y <= d; y++) for (let x = a; x <= c; x++) set(x, y, [56, 142, 168])
      for (let x = a - 1; x <= c + 1; x++) { set(x, b - 1, [240, 196, 92]); set(x, d + 1, [240, 196, 92]) }
      for (let y = b - 1; y <= d + 1; y++) { set(a - 1, y, [240, 196, 92]); set(c + 1, y, [240, 196, 92]) }
    }
  }
  // PNG: filter byte 0 per scanline, deflate, then IHDR/IDAT/IEND with CRC32
  const raw = Buffer.alloc(H * (W * 3 + 1))
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3)
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (b: Buffer) => {
    let c = 0xffffffff
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0     // 8-bit RGB, no interlace
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, png)
  return png.length
}

// ── item ──────────────────────────────────────────────────────────────────────
export function buildItem(p: Provenance, place: Place, datasetTitle: string) {
  const id      = itemId(p.dataset_id, p.variable, p.place_id)
  const href    = statsHref(p.dataset_id, p.variable, p.place_id)
  const parquet = statsPath(p.dataset_id, p.variable, p.place_id)
  const rel     = (h: string) => h.replace(/^\.\//, '../../')      // items/ is two levels under stats/
  const assets: Record<string, any> = {
    data: {
      href : rel(href),
      type : 'application/vnd.apache.parquet',
      title: `${p.variable} statistics for ${place.name}`,
      roles: ['data'],
      'table:columns': p.categorical ? CATEGORICAL_COLUMNS : DAILY_COLUMNS,
      ...fileStats(parquet),
    },
    provenance: {
      href : rel(href).replace(/\.parquet$/, '.provenance.json'),
      type : 'application/json',
      title: 'the griddap URLs, mask size and SQL this file was built from',
      roles: ['metadata'],
      ...fileStats(parquet.replace(/\.parquet$/, '.provenance.json')),
    },
  }
  return {
    type        : 'Feature',
    stac_version: STAC_VERSION,
    stac_extensions: [EXT.table, EXT.file],
    id,
    collection  : 'stats',
    geometry    : lobeBoxGeometry(place),
    bbox        : place.bbox,
    properties  : {
      title      : `${place.name} — ${p.variable} (${p.dataset_id})`,
      description: `Precomputed ${p.categorical ? 'per-class composition' : 'daily statistics'} of ` +
                   `${p.variable} from ${datasetTitle} over ${place.name} (${p.place_id}), ` +
                   `${p.start_date} to ${p.end_date}.`,
      datetime      : null,
      start_datetime: p.start_datetime,
      end_datetime  : p.end_datetime,
      created       : p.generated,
      'table:row_count': p.rows,
      'erddap-places:place_id'    : p.place_id,
      'erddap-places:dataset_id'  : p.dataset_id,
      'erddap-places:variable'    : p.variable,
      'erddap-places:categorical' : p.categorical,
      'erddap-places:mask_cells'  : p.mask_cells,
      'erddap-places:lobes'       : p.lobes,
      'erddap-places:griddap_urls': p.griddap_urls,
    },
    assets,
    links: [
      { rel: 'root',       href: '../../catalog.json',    type: 'application/json' },
      { rel: 'parent',     href: '../collection.json',    type: 'application/json' },
      { rel: 'collection', href: '../collection.json',    type: 'application/json' },
      { rel: 'related',    href: `../../erddap/${p.dataset_id}/collection.json`, type: 'application/json',
        title: datasetTitle },
      { rel: 'related',    href: '../../places/collection.json', type: 'application/json', title: 'Places' },
      ...(datasetVia(p.dataset_id) ? [{ ...datasetVia(p.dataset_id)!, rel: 'via', type: 'text/html' }] : []),
    ],
  }
}

// ── collection ────────────────────────────────────────────────────────────────
export function buildCollection(provs: Provenance[], places: Map<string, Place>) {
  const boxes = provs.map((p) => places.get(p.place_id)!.bbox)
  const bbox  = [
    Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3])),
  ]
  const start = provs.map((p) => p.start_datetime).sort()[0]
  const end   = provs.map((p) => p.end_datetime).sort().slice(-1)[0]
  const datasets = [...new Set(provs.map((p) => p.dataset_id))]
  return {
    type        : 'Collection',
    id          : 'stats',
    stac_version: STAC_VERSION,
    stac_extensions: [EXT.table, EXT.file, EXT.portolan],
    title       : 'Precomputed place statistics',
    description :
      'Precomputed statistics of ERDDAP grid variables over the gazetteer places: one Parquet file ' +
      'per (dataset, variable, place), covering the last 365 days (or the dataset\'s full extent if ' +
      'shorter). Each file is produced by exactly the code the browser app runs live — the place ' +
      'polygon masks the dataset\'s own grid (cell centre inside, partial-area weight on the ' +
      'boundary) and sql/stats_daily.sql or sql/stats_categorical.sql aggregates per day — so a ' +
      'precomputed row and a live in-browser row agree. Use these when you want the answer now; run ' +
      'the live query when you want today.',
    license     : 'CC-BY-4.0',
    keywords    : ['statistics', 'time series', 'marine protected areas', 'ERDDAP', 'griddap', 'zonal statistics'],
    extent: {
      spatial : { bbox: [bbox] },
      temporal: { interval: [[start, end]] },
    },
    // the host provider must be last (PTL-PRV-002)
    providers: [
      { name: 'NOAA Coral Reef Watch (CRW)', roles: ['producer', 'licensor'], url: 'https://coralreefwatch.noaa.gov' },
      { name: 'NOAA Atlantic Oceanographic and Meteorological Laboratory (AOML)', roles: ['producer', 'licensor'], url: 'https://www.aoml.noaa.gov' },
      { name: 'Ocean Metrics LLC', roles: ['processor', 'host'], url: 'https://oceanmetrics.io' },
    ],
    summaries: {
      'erddap-places:dataset_id': datasets,
      'erddap-places:variable'  : [...new Set(provs.map((p) => p.variable))],
      'erddap-places:place_id'  : [...new Set(provs.map((p) => p.place_id))].sort(),
    },
    // the continuous (stats_daily) schema; categorical items carry their own table:columns
    'table:columns': DAILY_COLUMNS,
    assets: {
      thumbnail: {
        href : `./${THUMB}`,
        type : 'image/png',
        title: 'the precomputed places, equirectangular',
        roles: ['thumbnail'],
        ...fileStats(join(STATS, THUMB)),
      },
    },
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    links: [
      { rel: 'root',   href: '../catalog.json', type: 'application/json', title: 'Ocean Metrics gazetteer' },
      { rel: 'parent', href: '../catalog.json', type: 'application/json' },
      { rel: 'agents',      href: './AGENTS.md', type: 'text/markdown', title: 'Agent/LLM usage guide' },
      { rel: 'describedby', href: './README.md', type: 'text/markdown', title: 'Human-readable documentation' },
      ...datasets.map((d) => ({
        rel: 'related', href: `../erddap/${d}/collection.json`, type: 'application/json',
        title: `source dataset: ${d}`,
      })),
      { rel: 'related', href: '../places/collection.json', type: 'application/json', title: 'Places' },
      // rel:'via' must point at a human-readable source page (PTL-PRO-001)
      ...datasets.flatMap((d) => { const v = datasetVia(d); return v ? [{ ...v, rel: 'via', type: 'text/html' }] : [] }),
      ...provs.map((p) => ({
        rel  : 'item',
        href : `./items/${itemId(p.dataset_id, p.variable, p.place_id)}.json`,
        type : 'application/geo+json',
        title: `${p.place_id} — ${p.variable}`,
      })),
    ],
  }
}

// ── write ─────────────────────────────────────────────────────────────────────
const writeJson = (path: string, o: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(o, null, 2) + '\n')
}

export function writeStac(provs: Provenance[], places: Map<string, Place>, titles: Map<string, string>) {
  // the thumbnail first: the collection records its size and checksum
  writeThumbnail(join(STATS, THUMB), [...new Set(provs.map((p) => p.place_id))].map((id) => places.get(id)!))
  for (const p of provs) {
    const item = buildItem(p, places.get(p.place_id)!, titles.get(p.dataset_id) ?? p.dataset_id)
    writeJson(join(STATS, 'items', `${item.id}.json`), item)
  }
  writeJson(join(STATS, 'collection.json'), buildCollection(provs, places))
  linkFromCatalog()
}

/** add (once) the stats child link to the catalog root. */
export function linkFromCatalog() {
  const path = join(GAZETTEER, 'catalog.json')
  const cat  = JSON.parse(readFileSync(path, 'utf8'))
  const has  = (cat.links ?? []).some((l: any) => l.rel === 'child' && /stats\/collection\.json/.test(l.href))
  if (has) return
  cat.links.push({
    rel: 'child', href: './stats/collection.json', type: 'application/json',
    title: 'Precomputed place statistics',
  })
  writeJson(path, cat)
}

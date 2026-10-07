// one band of a 366-band, band-interleaved COG, read with geotiff.js over HTTP range requests.
//
// @geomatico/maplibre-cog-protocol was the first choice, but it only reads EPSG:3857 COGs (it does
// not reproject) and colours whole tiles, so it cannot address band d of an EPSG:4326 cube nor give
// us the numbers for an anomaly or a hover readout. geotiff.js reads the IFD once, then only the
// tile(s) of the one band asked for (INTERLEAVE=BAND puts each band in its own tiles); a sanctuary
// is a few dozen pixels on a side, so a band is one 256 px tile: a few kB per view.
import { BaseClient, BaseResponse, fromCustomClient, type GeoTIFF } from 'geotiff'

export interface Band {
  url   : string
  band  : number                         // 1-based
  width : number
  height: number
  /** [west, south, east, north] of the pixel edges */
  bbox  : [number, number, number, number]
  data  : Float32Array                   // row-major, north row first; NaN = no data
}

/** bytes and time spent on the network, for the footer. */
export class Meter {
  bytes = 0; requests = 0; ms = 0
  reset() { this.bytes = 0; this.requests = 0; this.ms = 0 }
}

/** a geotiff client on `fetch` that counts what comes back (ranges included). */
class CountingClient extends BaseClient {
  constructor(url: string, private meter: Meter, private fetcher: typeof fetch) { super(url) }
  async request(init: RequestInit = {}): Promise<BaseResponse> {
    const t = performance.now()
    const res = await this.fetcher(this.url, { headers: init.headers, signal: init.signal })
    const buf = await res.arrayBuffer()
    this.meter.bytes += buf.byteLength; this.meter.requests += 1; this.meter.ms += performance.now() - t
    const out = new BaseResponse()
    Object.defineProperty(out, 'ok',     { get: () => res.ok })
    Object.defineProperty(out, 'status', { get: () => res.status })
    ;(out as any).getHeader = (h: string) => res.headers.get(h) ?? undefined
    ;(out as any).getData   = async () => buf
    return out
  }
}

/**
 * Opens COGs once and reads bands from them, memoising both: switching the month-day re-reads one
 * tile per file, switching back costs nothing.
 */
export class CogReader {
  meter = new Meter()
  private tiffs = new Map<string, Promise<GeoTIFF>>()
  private bands = new Map<string, Promise<Band>>()
  constructor(private fetcher: typeof fetch = (...a) => fetch(...a)) {}

  open(url: string): Promise<GeoTIFF> {
    let t = this.tiffs.get(url)
    if (!t) {
      // 8 kB blocks: geotiff merges consecutive missing blocks into one range request, so the
      // header (~35 kB on the published files: 366 tile offsets per IFD) is one request, and a
      // band's tile (~6 kB) costs one or two blocks instead of a 16 kB one on every day change. a server that ignores Range (Vite's dev
      // server, for the fixture) answers with the whole file, which geotiff then slices itself
      t = fromCustomClient(new CountingClient(url, this.meter, this.fetcher) as any, { blockSize: 8192, maxRanges: 0, allowFullFile: true } as any)
      t.catch(() => this.tiffs.delete(url))
      this.tiffs.set(url, t)
    }
    return t
  }

  /** band `band` (1-based) of the full-resolution image. */
  read(url: string, band: number, signal?: AbortSignal): Promise<Band> {
    const k = `${url}#${band}`
    let b = this.bands.get(k)
    if (!b) {
      b = (async () => {
        const tiff  = await this.open(url)
        const img   = await tiff.getImage(0)
        const n     = img.getSamplesPerPixel()
        if (band < 1 || band > n) throw new Error(`${url}: band ${band} of ${n}`)
        const [w, s, e, nn] = img.getBoundingBox() as [number, number, number, number]
        const r: any = await img.readRasters({ samples: [band - 1], interleave: true, signal })
        const data  = r instanceof Float32Array ? r : Float32Array.from(r)
        const nodata = img.getGDALNoData()
        if (nodata !== null && Number.isFinite(nodata))
          for (let i = 0; i < data.length; i++) if (data[i] === nodata) data[i] = NaN
        return { url, band, width: img.getWidth(), height: img.getHeight(), bbox: [w, s, e, nn], data }
      })()
      b.catch(() => this.bands.delete(k))
      this.bands.set(k, b)
    }
    return b
  }
}

/** do two bands sit on the same lattice (size and pixel edges)? */
export function sameLattice(a: Pick<Band, 'width' | 'height' | 'bbox'>, b: Pick<Band, 'width' | 'height' | 'bbox'>): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  const tol = Math.abs(a.bbox[2] - a.bbox[0]) / a.width / 100
  return a.bbox.every((v, i) => Math.abs(v - b.bbox[i]) <= tol)
}

/** the NaN-aware per-pixel mean of same-lattice bands (a pixel NaN in every input stays NaN). */
export function meanBands(bands: Pick<Band, 'width' | 'height' | 'bbox' | 'data'>[]): Float32Array {
  if (!bands.length) throw new Error('nothing to average')
  for (const b of bands.slice(1))
    if (!sameLattice(bands[0], b)) throw new Error('bands are not on the same lattice')
  const n = bands[0].data.length
  const sum = new Float64Array(n), cnt = new Uint16Array(n)
  for (const b of bands)
    for (let i = 0; i < n; i++) { const v = b.data[i]; if (v === v) { sum[i] += v; cnt[i]++ } }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = cnt[i] ? sum[i] / cnt[i] : NaN
  return out
}

/** Now - Then per pixel (NaN where either is NaN). */
export function diffBands(now: Float32Array, then: Float32Array): Float32Array {
  if (now.length !== then.length) throw new Error('bands differ in size')
  const out = new Float32Array(now.length)
  for (let i = 0; i < now.length; i++) out[i] = now[i] - then[i]
  return out
}

/** the value under a lon/lat, or NaN outside the raster. */
export function valueAt(b: Pick<Band, 'width' | 'height' | 'bbox'>, data: Float32Array, lon: number, lat: number): number {
  const [w, s, e, n] = b.bbox
  const c = Math.floor(((lon - w) / (e - w)) * b.width)
  const r = Math.floor(((n - lat) / (n - s)) * b.height)
  if (c < 0 || r < 0 || c >= b.width || r >= b.height) return NaN
  return data[r * b.width + c]
}

/** the pixel-centre axes of a band's lattice (longitudes west->east, latitudes north->south). */
export function latticeAxes(b: Pick<Band, 'width' | 'height' | 'bbox'>): { lon: number[]; lat: number[] } {
  const [w, s, e, n] = b.bbox
  const dx = (e - w) / b.width, dy = (n - s) / b.height
  return { lon: Array.from({ length: b.width },  (_, c) => w + (c + 0.5) * dx),
           lat: Array.from({ length: b.height }, (_, r) => n - (r + 0.5) * dy) }
}

/** gridMask() cells (pixel centres + area weights) -> one weight per pixel of the lattice (0 outside). */
export function latticeWeights(b: Pick<Band, 'width' | 'height' | 'bbox'>, cells: { lon: number; lat: number; weight: number }[]): Float32Array {
  const [w, s, e, n] = b.bbox
  const out = new Float32Array(b.width * b.height)
  for (const c of cells) {
    const col = Math.floor(((c.lon - w) / (e - w)) * b.width), row = Math.floor(((n - c.lat) / (n - s)) * b.height)
    if (col >= 0 && row >= 0 && col < b.width && row < b.height) out[row * b.width + col] = c.weight
  }
  return out
}

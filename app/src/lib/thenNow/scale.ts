// colour scales for the then-now map. Then and Now share one domain (the min and max of the finite
// values of both rasters, as the Shiny app's colorNumeric(palette, c(values(now), values(then))));
// the anomaly is diverging and symmetric around 0.
import { ramp, SPECTRAL_11, VIRIDIS_9 } from '../palette'

/** ColorBrewer RdBu-11, blue (low) -> red (high), for Now - Then. */
export const RDBU_11 = [
  '#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7',
  '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f',
]

/** the stops of a named palette, low -> high (Spectral reversed so red = warm, as in the Shiny app). */
export function paletteStops(name: 'spectral' | 'viridis' | 'anomaly'): string[] {
  if (name === 'viridis') return VIRIDIS_9
  if (name === 'anomaly') return RDBU_11
  return [...SPECTRAL_11].reverse()
}

/** [min, max] over the finite values of every array; null when there are none. */
export function sharedDomain(...arrays: ArrayLike<number>[]): [number, number] | null {
  let lo = Infinity, hi = -Infinity
  for (const a of arrays)
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v && v !== Infinity && v !== -Infinity) { if (v < lo) lo = v; if (v > hi) hi = v } }
  if (lo > hi) return null
  return lo === hi ? [lo - 0.5, hi + 0.5] : [lo, hi]
}

/** a domain symmetric about 0 that holds every finite value (at least ±`min`). */
export function anomalyDomain(a: ArrayLike<number>, min = 0.5): [number, number] {
  let m = 0
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v === v && v !== Infinity && v > m) m = v }
  m = Math.max(m, min)
  return [-m, m]
}

const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

/** a 256-entry RGB lookup table along `stops`. */
export function lut(stops: string[]): Uint8Array {
  const cols = ramp(256, stops, false).map(rgb)
  const out = new Uint8Array(256 * 3)
  cols.forEach((c, i) => out.set(c, i * 3))
  return out
}

/** values -> RGBA pixels on `domain` (NaN transparent; out-of-domain values clamp). */
export function colorize(data: ArrayLike<number>, domain: [number, number], table: Uint8Array, alpha = 230): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length * 4)
  const [lo, hi] = domain, span = hi - lo || 1
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v !== v) continue
    const k = Math.max(0, Math.min(255, Math.round(((v - lo) / span) * 255))) * 3
    out[i * 4] = table[k]; out[i * 4 + 1] = table[k + 1]; out[i * 4 + 2] = table[k + 2]; out[i * 4 + 3] = alpha
  }
  return out
}

/** `n` evenly spaced legend ticks across a domain. */
export function ticks(domain: [number, number], n = 5): number[] {
  return Array.from({ length: n }, (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / (n - 1))
}

/**
 * Pixels whose anomaly exceeds `threshold`, and their area (optionally only the pixels of a mask,
 * each counted by its area weight, the share of the pixel inside the place): a pixel of `dx` by `dy` degrees at
 * latitude φ covers (dx·111.32·cos φ)·(dy·110.57) km², close enough for a 0.05° grid.
 */
export function exceedance(anom: Float32Array, b: { width: number; height: number; bbox: [number, number, number, number] },
                           threshold = 1, weights?: Float32Array | null): { n: number; valid: number; km2: number; validKm2: number } {
  const [w, s, e, nn] = b.bbox
  const dx = (e - w) / b.width, dy = (nn - s) / b.height
  let n = 0, valid = 0, km2 = 0, validKm2 = 0
  for (let r = 0; r < b.height; r++) {
    const lat = nn - (r + 0.5) * dy
    const a = dx * 111.32 * Math.cos((lat * Math.PI) / 180) * dy * 110.57
    for (let c = 0; c < b.width; c++) {
      const i = r * b.width + c, v = anom[i]
      // with a mask, only the pixels that touch the place count, by the share of them inside it
      const f = weights ? weights[i] : 1
      if (v !== v || !(f > 0)) continue
      valid++; validKm2 += a * f
      if (v > threshold) { n++; km2 += a * f }
    }
  }
  return { n, valid, km2, validKm2 }
}

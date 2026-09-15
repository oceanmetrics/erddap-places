// discrete colours for categorical grids. seascapeR draws its seascape time series with
// rev(colorRampPalette(RColorBrewer::brewer.pal(11, "Spectral"))(n)), so the same ramp is
// reproduced here: ColorBrewer Spectral-11, reversed, interpolated in RGB.

/** ColorBrewer Spectral, 11 classes (low -> high). */
export const SPECTRAL_11 = [
  '#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf',
  '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2',
]

/** viridis, 9 stops (low -> high): the sequential ramp the map uses for continuous variables. */
export const VIRIDIS_9 = [
  '#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c',
  '#27ad81', '#5ec962', '#aadc32', '#fde725',
]

const rgb = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** `n` colours interpolated along `stops` (reversed by default, as seascapeR does). */
export function ramp(n: number, stops: string[] = SPECTRAL_11, reverse = true): string[] {
  const s = reverse ? [...stops].reverse() : stops
  if (n <= 0) return []
  if (n === 1) return [s[0]]
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (s.length - 1)
    const k = Math.min(Math.floor(t), s.length - 2)
    const f = t - k
    const a = rgb(s[k]), b = rgb(s[k + 1])
    out.push(hex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]))
  }
  return out
}

/** one colour per class value, in the given (sorted) order. */
export function classColors(values: Array<string | number>, stops?: string[]): Map<string, string> {
  const cols = ramp(values.length, stops)
  return new Map(values.map((v, i) => [String(v), cols[i]]))
}

/**
 * `[value, colour, value, colour, ...]` stops spanning `[min, max]`, for a MapLibre
 * `['interpolate', ['linear'], ['get', 'value'], ...stops]` paint expression. A flat range (every
 * cell the same value) still gets two stops, so the expression stays valid.
 */
export function rampStops(min: number, max: number, n = 7, stops = VIRIDIS_9): Array<number | string> {
  const cols = ramp(Math.max(2, n), stops, false)
  const lo = min, hi = max > min ? max : min + 1e-9
  return cols.flatMap((c, i) => [lo + ((hi - lo) * i) / (cols.length - 1), c])
}

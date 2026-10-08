// a PNG of the view: the map as drawn, with the title sentence above it and the selection, the data
// release and the view URL stamped below, so the picture never leaves the app anonymous.

/** copy a MapLibre map's WebGL canvas while its frame is still in the buffer (no preserveDrawingBuffer). */
export function grabMap(map: { getCanvas(): HTMLCanvasElement; once(t: string, f: () => void): unknown; triggerRepaint(): void }): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const src = map.getCanvas()
      const c = document.createElement('canvas')
      c.width = src.width; c.height = src.height
      c.getContext('2d')!.drawImage(src, 0, 0)
      resolve(c)
    })
    map.triggerRepaint()
  })
}

/**
 * An SVG element (an Observable Plot figure) drawn onto a transparent canvas of `width × height` CSS px
 * at `scale`. The SVG is serialised and loaded through an <img>, which cannot see the page's CSS: the
 * text colour and font are set on the clone, and the page's fonts are not available (a system font is
 * used). No dependency; the same canvas then goes under `viewPng()`'s title and stamp.
 */
export async function svgCanvas(svg: Element, width: number, height: number, scale = 2, o: { color?: string; fontFamily?: string } = {}): Promise<HTMLCanvasElement> {
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height))
  if (o.color) clone.style.color = o.color
  if (o.fontFamily) clone.style.fontFamily = o.fontFamily
  const xml = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('the plot could not be drawn')) })
  const c = document.createElement('canvas')
  c.width = Math.round(width * scale); c.height = Math.round(height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** wrap `text` to lines no wider than `max` px in the context's current font. */
export function wrapLines(ctx: { measureText(s: string): { width: number } }, text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${w}` : w
    if (line && ctx.measureText(t).width > max) { out.push(line); line = w } else line = t
  }
  if (line) out.push(line)
  return out
}

export interface PngLayer { canvas: HTMLCanvasElement; /** fraction [x0, x1] of the width to draw (a swipe side) */ clip?: [number, number] }

/** the map layers composed under a title and over a stamp; resolves to a PNG blob. */
export async function viewPng(o: { layers: PngLayer[]; title: string; sub?: string; stamp: string[]; dark?: boolean }): Promise<Blob> {
  const base = o.layers[0].canvas
  const W = base.width, H = base.height
  const s = Math.max(1, W / 1200)                         // type scale for a 2x / large canvas
  const pad = Math.round(16 * s)
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  const titleFont = `600 ${Math.round(20 * s)}px "Space Grotesk", system-ui, sans-serif`
  const subFont = `${Math.round(13 * s)}px "IBM Plex Sans", system-ui, sans-serif`
  const stampFont = `${Math.round(11 * s)}px "IBM Plex Mono", ui-monospace, monospace`
  ctx.font = titleFont
  const tLines = wrapLines(ctx, o.title, W - 2 * pad)
  ctx.font = subFont
  const sLines = o.sub ? wrapLines(ctx, o.sub, W - 2 * pad) : []
  ctx.font = stampFont
  const fLines = o.stamp.flatMap((l) => wrapLines(ctx, l, W - 2 * pad))
  const top = pad + tLines.length * 26 * s + sLines.length * 18 * s + pad / 2
  const foot = pad / 2 + fLines.length * 15 * s + pad / 2
  c.width = W; c.height = Math.round(top + H + foot)
  ctx.fillStyle = o.dark ? '#04131f' : '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = o.dark ? '#eaf3f7' : '#0f2230'
  ctx.textBaseline = 'top'
  let y = pad
  ctx.font = titleFont
  for (const l of tLines) { ctx.fillText(l, pad, y); y += 26 * s }
  ctx.font = subFont
  ctx.fillStyle = o.dark ? '#c4d7e0' : '#44606e'
  for (const l of sLines) { ctx.fillText(l, pad, y); y += 18 * s }
  for (const L of o.layers) {
    const [f0, f1] = L.clip ?? [0, 1]
    const sx = Math.round(f0 * W), sw = Math.max(1, Math.round((f1 - f0) * W))
    ctx.drawImage(L.canvas, sx, 0, sw, H, sx, top, sw, H)
  }
  y = top + H + pad / 2
  ctx.font = stampFont
  ctx.fillStyle = o.dark ? '#9db9c7' : '#44606e'
  for (const l of fLines) { ctx.fillText(l, pad, y); y += 15 * s }
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'))
}

// the feedback picture: html-to-image (pinned 1.11.13, as MarineSensitivity/atlas, CalCOFI explore
// and obis-hex; html2canvas rejects color-mix()) over the page body (the sentence, the map stage and
// its panes; the header and footer are left out), with the map composited from MapLibre's own canvas
// (grabMap(), a synchronous redraw then a copy, since the maps keep no drawing buffer and a WebGL
// canvas does not survive html-to-image's clone). The Then vs Now swipe clips its right-hand map with
// `clip-path: inset(…)`, which the composite honours.
// Reached ONLY through the dynamic import() in Shell.svelte (help.test.ts checks the wiring);
// html-to-image must never enter index.html's static graph.
import { toCanvas } from 'html-to-image'
import { grabMap } from '../png'
import { insetFractions } from './annotate'

/** never in the picture: dialogs, the welcome card, the tour, and the maps' WebGL canvases */
export const CAPTURE_SKIP = ['dialog', '.welcome', '.tour-ring', '.tour-card', 'canvas.maplibregl-canvas']

type MlMap = Parameters<typeof grabMap>[0] & { getContainer(): HTMLElement }

export async function captureView(root: HTMLElement, maps: MlMap[]): Promise<HTMLCanvasElement> {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const scale = Math.min(2, window.devicePixelRatio || 1)
  const bg = getComputedStyle(document.body).backgroundColor || '#fff'
  const box = root.getBoundingClientRect()
  const page = await toCanvas(root, {
    pixelRatio: scale,
    cacheBust : false,
    filter    : (node) => !(node instanceof Element && CAPTURE_SKIP.some((s) => node.matches(s))),
  })
  const out = document.createElement('canvas')
  out.width = Math.round(box.width * scale)
  out.height = Math.round(box.height * scale)
  const ctx = out.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, out.width, out.height)
  for (const m of maps) {
    const el = m.getContainer()
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    // the swipe's clip sits on the map container or its parent
    const clip = getComputedStyle(el).clipPath !== 'none' ? getComputedStyle(el).clipPath : getComputedStyle(el.parentElement ?? el).clipPath
    const f = insetFractions(clip, r.width, r.height)
    if (f.x1 <= f.x0 || f.y1 <= f.y0) continue
    const c = await grabMap(m)
    ctx.drawImage(c, f.x0 * c.width, f.y0 * c.height, (f.x1 - f.x0) * c.width, (f.y1 - f.y0) * c.height,
      (r.left - box.left + f.x0 * r.width) * scale, (r.top - box.top + f.y0 * r.height) * scale,
      (f.x1 - f.x0) * r.width * scale, (f.y1 - f.y0) * r.height * scale)
  }
  // the page over the maps (their area is transparent: the canvases were skipped)
  ctx.drawImage(page, 0, 0, out.width, out.height)
  return out
}

export function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'))
}

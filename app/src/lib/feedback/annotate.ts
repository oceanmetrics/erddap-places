// the feedback dialog's mark-up: rectangle, arrow and text over the captured view (obis-hex's, after
// MarineSensitivity/atlas src/lib/feedback/annotate.ts, itself from CalCOFI explore). Pure canvas
// drawing; FeedbackDialog.svelte owns the pointer events.
import { DEFAULT_MARK_COLOR } from './colors'

export type MarkTool = 'rect' | 'arrow' | 'text'

export interface Mark {
  tool: MarkTool
  x0: number
  y0: number
  x1: number
  y1: number
  text?: string
  /** the mark's own colour, chosen when it was drawn (see colors.ts); the default when absent */
  color?: string
}

export const MARK_TOOLS: { id: MarkTool; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'text', label: 'Text' },
]

/** the arrow head's two corner points for a shaft from (x0,y0) to (x1,y1) */
export function arrowHead(m: Pick<Mark, 'x0' | 'y0' | 'x1' | 'y1'>, len: number): [[number, number], [number, number]] {
  const a = Math.atan2(m.y1 - m.y0, m.x1 - m.x0)
  return [
    [m.x1 - len * Math.cos(a - 0.45), m.y1 - len * Math.sin(a - 0.45)],
    [m.x1 - len * Math.cos(a + 0.45), m.y1 - len * Math.sin(a + 0.45)],
  ]
}

/** a rectangle's box from any two corners */
export function rectBox(m: Pick<Mark, 'x0' | 'y0' | 'x1' | 'y1'>): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) }
}

/** line width scale for an image of this pixel width (a 2× capture needs thicker strokes) */
export function strokeScale(w: number): number {
  return Math.max(1, w / 1400)
}

/** draws one mark in its colour (`color` overrides the mark's own, which falls back to the default) */
export function drawMark(ctx: CanvasRenderingContext2D, m: Mark, k = 1, color: string = m.color ?? DEFAULT_MARK_COLOR): void {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3 * k
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (m.tool === 'rect') {
    const b = rectBox(m)
    ctx.strokeRect(b.x, b.y, b.w, b.h)
  } else if (m.tool === 'arrow') {
    ctx.beginPath()
    ctx.moveTo(m.x0, m.y0)
    ctx.lineTo(m.x1, m.y1)
    ctx.stroke()
    const [p, q] = arrowHead(m, 14 * k)
    ctx.beginPath()
    ctx.moveTo(m.x1, m.y1)
    ctx.lineTo(p[0], p[1])
    ctx.lineTo(q[0], q[1])
    ctx.closePath()
    ctx.fill()
  } else if (m.text) {
    ctx.font = `600 ${16 * k}px "IBM Plex Sans", system-ui, sans-serif`
    ctx.textBaseline = 'top'
    const w = ctx.measureText(m.text).width + 10 * k
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(m.x0 - 5 * k, m.y0 - 3 * k, w, 22 * k)
    ctx.fillStyle = color
    ctx.fillText(m.text, m.x0, m.y0)
  }
}

/** pointer position (client px) → image px, for a canvas drawn at image size and scaled by CSS */
export function toImage(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, w: number, h: number): { x: number; y: number } {
  return { x: ((clientX - rect.left) / (rect.width || 1)) * w, y: ((clientY - rect.top) / (rect.height || 1)) * h }
}

/**
 * The visible part of an element clipped with `clip-path: inset(t r b l)` (the Then vs Now swipe
 * clips the right-hand map that way), as fractions of its width and height; the whole box for
 * anything else. Lengths in px or %; `inset(0 0 0 100%)` hides it all.
 */
export function insetFractions(clip: string, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const m = /inset\(([^)]*)\)/.exec(String(clip ?? ''))
  if (!m) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  const parts = m[1].trim().split(/\s+/).slice(0, 4)
  const v = parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]]
    : parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]]
    : parts.length === 3 ? [parts[0], parts[1], parts[2], parts[1]] : parts
  const len = (s: string, of: number) => (s.endsWith('%') ? (parseFloat(s) / 100) : (parseFloat(s) || 0) / (of || 1))
  const [t, r, b, l] = [len(v[0], h), len(v[1], w), len(v[2], h), len(v[3], w)]
  const c = (x: number) => Math.max(0, Math.min(1, x))
  return { x0: c(l), y0: c(t), x1: c(1 - r), y1: c(1 - b) }
}

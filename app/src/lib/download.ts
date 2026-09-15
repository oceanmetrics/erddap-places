// exporting a result: CSV text, file names that say what the numbers are, and a browser download.
// the Parquet side lives in engine.ts (DuckDB's own COPY … TO writer); this module stays free of
// DuckDB so it is testable in plain Node.
import type { RunState } from './permalink'

/** RFC 4180 field: quote when it contains a comma, a quote or a newline. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** rows -> CSV text with a header row (columns from the first row unless given). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Object.keys(rows[0] ?? {})
  const head = cols.map(csvField).join(',')
  return [head, ...rows.map((r) => cols.map((c) => csvField(r[c])).join(','))].join('\n') + '\n'
}

const safe = (s: string) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

/** `erddap-places_NMS-HIHWNMS_erddap-dhw_5km_CRW_SST_2026-05-28_2026-06-26.csv` */
export function resultFileName(s: Partial<RunState>, ext: string): string {
  const parts = ['erddap-places', s.place, s.dataset, s.variable, s.from, s.to].filter(Boolean).map((x) => safe(String(x)))
  return `${parts.join('_')}.${ext.replace(/^\./, '')}`
}

/** hand a blob to the browser as a download (no-op outside a DOM). */
export function download(data: BlobPart | Uint8Array, name: string, type = 'application/octet-stream'): void {
  if (typeof document === 'undefined') return
  // a Uint8Array over a possibly-shared buffer is not a BlobPart to TypeScript: copy it into a plain one
  const part: BlobPart = data instanceof Uint8Array ? new Uint8Array(data).slice().buffer as ArrayBuffer : data
  const url = URL.createObjectURL(new Blob([part], { type }))
  const a   = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** copy text to the clipboard, falling back to a hidden textarea where the API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
  document.body.appendChild(ta); ta.select()
  const ok = document.execCommand?.('copy') ?? false
  ta.remove()
  return ok
}

// the fallback when no endpoint is configured or the POST fails: the prefilled GitHub "new issue" URL
// behind the dialog's inline "open a GitHub issue" link (obis-hex's, after MarineSensitivity/atlas
// src/lib/feedback/issueUrl.ts). The optional email never enters it (payload.ts sends it to the Sheet
// and the mail only); the image never goes into the URL (GitHub cannot take one there): the dialog
// copies it to the clipboard and asks the visitor to paste it into the issue.
export const ISSUE_BASE = 'https://github.com/oceanmetrics/erddap-places/issues/new'
/** GitHub truncates a new-issue URL around 8 KB; stay well under it */
export const MAX_ISSUE_URL_LENGTH = 7500

export type FeedbackKind = 'feedback' | 'product'

export interface FeedbackReport {
  kind      : FeedbackKind
  note      : string
  /** the view's link (the URL hash is the view) */
  url       : string
  /** "Statistics" or "Then vs Now" */
  lens      : string
  appVersion: string
  /** the bare version and short commit, for the endpoint payload (appVersion is their display form) */
  version  ?: string
  sha      ?: string
  /** the data release line of the footer, e.g. "NOAA Coral Reef Watch — … · ERDDAP 2.29 · data through 6 Oct 2026" */
  release   : string | null
  /** "1280×800" CSS pixels */
  viewport  : string
  theme     : string
  /** the title sentence, so the issue says what was on screen */
  sentence ?: string
}

export const KIND_TITLE: Record<FeedbackKind, string> = {
  feedback: 'Feedback',
  product : 'I built something with this',
}

export function issueTitle(r: FeedbackReport): string {
  const first = r.note.trim().split(/\n/)[0].slice(0, 80)
  return `${KIND_TITLE[r.kind]}${first ? `: ${first}` : r.sentence ? `: ${r.sentence.slice(0, 80)}` : ''}`
}

function details(r: FeedbackReport): string {
  return [
    ...(r.url ? [`- View: ${r.url}`] : []),
    ...(r.sentence ? [`- Showing: ${r.sentence}`] : []),
    `- Lens: ${r.lens}`,
    `- Data: ${r.release || 'not loaded yet'}`,
    `- App: erddap-places v${r.appVersion}`,
    `- Viewport: ${r.viewport}`,
    `- Theme: ${r.theme}`,
  ].join('\n')
}

const NOTE_HEAD: Record<FeedbackKind, string> = { feedback: '**Note**', product: '**What I built** (a link helps)' }
const PASTE = '_Screenshot: paste it here (it is on your clipboard)._'

/** the issue body: the note, the screenshot line, the view's details */
export function reportBody(r: FeedbackReport, opts: { note?: string } = {}): string {
  const note = (opts.note ?? r.note).trim()
  return [NOTE_HEAD[r.kind], '', note || '_(no note)_', '', PASTE, '', '---', details(r)].join('\n')
}

function buildUrl(r: FeedbackReport, note: string): string {
  const q = new URLSearchParams()
  q.set('title', issueTitle(r))
  q.set('body', reportBody(r, { note }))
  q.set('labels', r.kind === 'product' ? 'product' : 'feedback')
  return `${ISSUE_BASE}?${q.toString()}`
}

/** the prefilled new-issue URL, at most MAX_ISSUE_URL_LENGTH characters: a long note is cut (ending
 * "… (cut: the full note is on the clipboard)"); the view's details are never cut */
export function issueUrl(r: FeedbackReport, max = MAX_ISSUE_URL_LENGTH): string {
  let url = buildUrl(r, r.note)
  if (url.length <= max) return url
  const cutTail = '… (cut: the full note is on the clipboard)'
  let lo = 0
  let hi = r.note.length
  // the longest prefix of the note that fits (binary search over the encoded length)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (buildUrl(r, r.note.slice(0, mid) + cutTail).length <= max) lo = mid
    else hi = mid - 1
  }
  url = buildUrl(r, r.note.slice(0, lo) + cutTail)
  return url.length <= max ? url : url.slice(0, max)
}

/**
 * The words before the dialog's inline "open a GitHub issue" link: why Send is not the way. With no
 * endpoint (`error` empty) sending is not set up; after a failed POST the reason leads. The caller
 * appends the link and " instead.".
 */
export function fallbackLead(error = ''): string {
  const why = error.trim().replace(/[.;:\s]+$/, '')
  return why ? `${why[0].toUpperCase()}${why.slice(1)}; ` : 'Sending is not set up yet; '
}

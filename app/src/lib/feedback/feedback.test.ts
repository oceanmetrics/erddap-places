// the feedback endpoint client: the payload's shape and privacy rules, where the endpoint comes from,
// how it is POSTed, and the mark colours. Each rule on a small fixture with the exact expected output.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFeedbackPayload, fitImage, isEmail, MAX_IMAGE_DATA_URL_LENGTH, MAX_TEXT_LENGTH, type FeedbackPayloadInput } from './payload'
import { feedbackEndpoint, FEEDBACK_URL_KEY } from './endpoint'
import { postFeedback } from './postFeedback'
import { drawMark } from './annotate'
import { DEFAULT_MARK_COLOR, MARK_COLORS } from './colors'

const INPUT: FeedbackPayloadInput = {
  kind: 'feedback', text: '  The mean looks too warm.  ', email: '', includeUrl: true,
  url: 'https://oceanmetrics.io/erddap-places/#place=NMS:FKNMS', release: 'CRW · data through 6 Oct 2026',
  version: '0.4.0', sha: 'abc1234', lens: 'Statistics', viewport: '1280×800', theme: 'dark', userAgent: 'UA/1',
}

describe('buildFeedbackPayload', () => {
  it('has exactly the keys the script reads, trimmed, and none of the optional ones', () => {
    expect(buildFeedbackPayload(INPUT)).toEqual({
      app: 'erddap-places', kind: 'feedback', text: 'The mean looks too warm.', release: 'CRW · data through 6 Oct 2026',
      version: '0.4.0', sha: 'abc1234', lens: 'Statistics', viewport: '1280×800', theme: 'dark', user_agent: 'UA/1',
      website: '', url: 'https://oceanmetrics.io/erddap-places/#place=NMS:FKNMS',
    })
  })
  it('email is present only when given (a blank or whitespace one leaves the key out)', () => {
    expect('email' in buildFeedbackPayload(INPUT)).toBe(false)
    expect('email' in buildFeedbackPayload({ ...INPUT, email: '   ' })).toBe(false)
    expect(buildFeedbackPayload({ ...INPUT, email: ' me@example.org ' }).email).toBe('me@example.org')
  })
  it('url is absent (the key, not just the value) when the box is unticked', () => {
    expect('url' in buildFeedbackPayload({ ...INPUT, includeUrl: false })).toBe(false)
  })
  it('an unresolved release is the empty string; title only when given; text is capped', () => {
    const p = buildFeedbackPayload({ ...INPUT, release: null, text: 'x'.repeat(MAX_TEXT_LENGTH + 50) })
    expect(p.release).toBe('')
    expect(p.text).toHaveLength(MAX_TEXT_LENGTH)
    expect('title' in p).toBe(false)
    expect(buildFeedbackPayload({ ...INPUT, title: ' T ' }).title).toBe('T')
  })
  it('an image over the cap is dropped, one under it is kept', () => {
    expect('image' in buildFeedbackPayload({ ...INPUT, image: 'x'.repeat(MAX_IMAGE_DATA_URL_LENGTH + 1) })).toBe(false)
    expect(buildFeedbackPayload({ ...INPUT, image: 'data:image/png;base64,AA' }).image).toBe('data:image/png;base64,AA')
  })
  it('the honeypot value is carried through', () => {
    expect(buildFeedbackPayload({ ...INPUT, website: 'spam' }).website).toBe('spam')
  })
})

describe('isEmail', () => {
  it('accepts an address and rejects the rest', () => {
    expect(isEmail('a@b.org')).toBe(true)
    expect(isEmail(' a@b.org ')).toBe(true)
    for (const bad of ['', 'a', 'a@b', '@b.org', 'a b@c.org']) expect(isEmail(bad)).toBe(false)
  })
})

describe('fitImage', () => {
  const canvas = (png: string, jpg: Record<string, string> = {}) => ({
    toDataURL: (t?: string, q?: number) => (t === 'image/jpeg' ? jpg[String(q)] ?? 'J'.repeat(1e6) : png),
  })
  it('keeps the PNG when it fits', () => expect(fitImage(canvas('PNG'), 10)).toBe('PNG'))
  it('falls back to a JPEG that fits', () => expect(fitImage(canvas('P'.repeat(50), { '0.85': 'JPG' }), 10)).toBe('JPG'))
  it('gives up (no picture) when nothing fits', () => expect(fitImage(canvas('P'.repeat(50)), 10)).toBeUndefined())
})

describe('feedbackEndpoint resolution order', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  const stubStorage = (v: string | null, throws = false) =>
    vi.stubGlobal('localStorage', { getItem: (k: string) => { if (throws) throw new Error('blocked'); return k === FEEDBACK_URL_KEY ? v : null } })

  it('nothing set is null', () => { vi.stubEnv('VITE_FEEDBACK_URL', ''); stubStorage(null); expect(feedbackEndpoint()).toBeNull() })
  it('the localStorage override key is erddap-places.feedback_url', () => expect(FEEDBACK_URL_KEY).toBe('erddap-places.feedback_url'))
  it('the build-time variable wins over the override', () => {
    vi.stubEnv('VITE_FEEDBACK_URL', ' https://script.google.com/macros/s/ENV/exec ')
    stubStorage('https://example.org/override')
    expect(feedbackEndpoint()).toBe('https://script.google.com/macros/s/ENV/exec')
  })
  it('the override is used when the variable is empty (an unset GitHub variable)', () => {
    vi.stubEnv('VITE_FEEDBACK_URL', '')
    stubStorage('https://example.org/override')
    expect(feedbackEndpoint()).toBe('https://example.org/override')
  })
  it('a junk value in either place is ignored', () => {
    vi.stubEnv('VITE_FEEDBACK_URL', 'not-a-url')
    stubStorage('javascript:alert(1)')
    expect(feedbackEndpoint()).toBeNull()
  })
  it('blocked storage is not an error', () => {
    vi.stubEnv('VITE_FEEDBACK_URL', '')
    stubStorage(null, true)
    expect(feedbackEndpoint()).toBeNull()
  })
})

describe('postFeedback', () => {
  const reply = (ok: boolean, body?: unknown) => vi.fn().mockResolvedValue({ ok, json: async () => body })
  it('POSTs the JSON as text/plain (a CORS simple request) and never sets keepalive', async () => {
    const f = reply(true, { ok: true, issue_url: 'https://github.com/o/r/issues/1' })
    const r = await postFeedback('https://x/exec', { a: 1 }, f)
    expect(r).toEqual({ ok: true, issueUrl: 'https://github.com/o/r/issues/1' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://x/exec')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=UTF-8')
    expect(init.keepalive).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ a: 1 })
  })
  it('a non-OK response is a failure', async () => expect((await postFeedback('https://x', {}, reply(false))).ok).toBe(false))
  it('a 200 whose body says ok:false is a failure carrying the script\'s reason', async () =>
    expect(await postFeedback('https://x', {}, reply(true, { ok: false, error: 'rate limited' }))).toEqual({ ok: false, error: 'rate limited' }))
  it('a 200 whose body is not the script\'s JSON receipt (Google\'s HTML error or sign-in page) is a failure', async () => {
    const html = await postFeedback('https://x', {}, vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('not JSON') } }))
    expect(html).toEqual({ ok: false, error: 'the feedback server answered with a page instead of a receipt' })
    expect((await postFeedback('https://x', {}, reply(true, { endpoint: 'something else' }))).ok).toBe(false)
    expect((await postFeedback('https://x', {}, reply(true, null))).ok).toBe(false)
  })
  it('the honeypot receipt (ok:true, skipped) is a failure for the person in the dialog: browser autofill fills the trap', async () =>
    expect(await postFeedback('https://x', {}, reply(true, { ok: true, skipped: 'honeypot' }))).toEqual({ ok: false, error: 'the feedback server dropped it as spam (a hidden field was filled, usually by browser autofill)' }))
  it('a rejected fetch resolves false, never throws', async () =>
    expect((await postFeedback('https://x', {}, vi.fn().mockRejectedValue(new Error('down')))).ok).toBe(false))
})

describe('drawMark colour', () => {
  // a recording context: the colour in force at each drawing call
  function ctx() {
    const seen: { op: string; stroke: unknown; fill: unknown }[] = []
    const c: Record<string, unknown> = { strokeStyle: '', fillStyle: '', measureText: () => ({ width: 40 }) }
    for (const op of ['strokeRect', 'stroke', 'fill', 'fillText', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath'])
      c[op] = () => { seen.push({ op, stroke: c.strokeStyle, fill: c.fillStyle }) }
    return { c: c as unknown as CanvasRenderingContext2D, seen }
  }
  const box = { x0: 10, y0: 10, x1: 90, y1: 60 }
  const [pink, yellow, blue] = MARK_COLORS.map((m) => m.hex)

  it('there are three colours and the default is the first', () => {
    expect(MARK_COLORS.map((m) => m.hex)).toEqual(['#ff2d95', '#ffd60a', '#4dabf7'])
    expect(DEFAULT_MARK_COLOR).toBe(pink)
  })
  it('a rectangle strokes in the mark\'s colour', () => {
    const { c, seen } = ctx()
    drawMark(c, { tool: 'rect', ...box, color: blue })
    expect(seen.find((s) => s.op === 'strokeRect')!.stroke).toBe(blue)
  })
  it('an arrow strokes its shaft and fills its head in the colour', () => {
    const { c, seen } = ctx()
    drawMark(c, { tool: 'arrow', ...box, color: yellow })
    expect(seen.find((s) => s.op === 'stroke')!.stroke).toBe(yellow)
    expect(seen.find((s) => s.op === 'fill')!.fill).toBe(yellow)
  })
  it('text is filled in the colour on its dark plate', () => {
    const { c, seen } = ctx()
    drawMark(c, { tool: 'text', ...box, text: 'here', color: blue })
    expect(seen.find((s) => s.op === 'fillRect')!.fill).toBe('rgba(0,0,0,0.6)')
    expect(seen.find((s) => s.op === 'fillText')!.fill).toBe(blue)
  })
  it('with no colour the default is used, and the argument overrides the mark', () => {
    const a = ctx(); drawMark(a.c, { tool: 'rect', ...box })
    expect(a.seen.find((s) => s.op === 'strokeRect')!.stroke).toBe(DEFAULT_MARK_COLOR)
    const b = ctx(); drawMark(b.c, { tool: 'rect', ...box, color: blue }, 1, yellow)
    expect(b.seen.find((s) => s.op === 'strokeRect')!.stroke).toBe(yellow)
  })
})

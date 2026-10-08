// @vitest-environment jsdom
//
// The dialog's one primary action: Send is always there; without an endpoint it is disabled and a
// one-line notice carries an inline "open a GitHub issue" link; Copy report and Download PNG are gone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import FeedbackDialog from './FeedbackDialog.svelte'
import { FEEDBACK_URL_KEY } from './endpoint'
import { fallbackLead, ISSUE_BASE, MAX_ISSUE_URL_LENGTH } from './issue'

const REPORT = () => ({
  url: 'https://oceanmetrics.io/erddap-places/#place=NMS:FKNMS', lens: 'Statistics', appVersion: '0.2.0 (abc1234)',
  release: 'CRW · data through 6 Oct 2026', viewport: '1280×800', theme: 'light', sentence: 'Mean SST in FKNMS',
})

const settle = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); flushSync() } }

describe('FeedbackDialog', () => {
  let target: HTMLElement
  let app: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    // jsdom has no <dialog>.showModal(); the Modal only needs it not to throw
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubEnv('VITE_FEEDBACK_URL', '')
    target = document.body.appendChild(document.createElement('div'))
  })
  afterEach(() => {
    if (app) unmount(app)
    app = null
    target.remove()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function show(endpoint: string | null) {
    vi.stubGlobal('localStorage', { getItem: (k: string) => (k === FEEDBACK_URL_KEY ? endpoint : null) })
    app = mount(FeedbackDialog, { target, props: { open: true, kind: 'feedback', image: null, report: REPORT } })
    await settle()
  }
  const buttons = () => [...target.querySelectorAll('button')].map((b) => b.textContent!.trim())
  const send = () => [...target.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Send')!
  const type = (el: HTMLTextAreaElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync() }

  it('without an endpoint: Send is shown but disabled, and the notice links to a prefilled issue', async () => {
    await show(null)
    expect(send()).toBeTruthy()
    expect(send().disabled).toBe(true)
    const notice = target.querySelector('p[data-fallback="true"]')!
    expect(notice.textContent!.replace(/\s+/g, ' ').trim()).toBe('Sending is not set up yet; open a GitHub issue instead.')
    const a = notice.querySelector('a')!
    expect(a.textContent).toBe('open a GitHub issue')
    expect(a.href.startsWith(ISSUE_BASE)).toBe(true)
    expect(a.href.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH)
    expect(a.target).toBe('_blank')
  })

  it('has no Copy report, Download PNG or Open a GitHub issue button', async () => {
    await show(null)
    for (const b of buttons()) expect(b).not.toMatch(/copy report|download png|open a github issue/i)
    await show('https://script.google.com/macros/s/X/exec')
    for (const b of buttons()) expect(b).not.toMatch(/copy report|download png|open a github issue/i)
  })

  it('with an endpoint: Send is enabled once there is a note, and no fallback notice shows', async () => {
    await show('https://script.google.com/macros/s/X/exec')
    expect(send().disabled).toBe(true) // no note yet
    type(target.querySelector('textarea')!, 'The mean looks too warm.')
    expect(send().disabled).toBe(false)
    expect(target.querySelector('a.issue-link')).toBeNull()
    expect(target.querySelector('p[data-fallback="false"]')).toBeTruthy()
  })

  it('a failed POST puts the reason and the same link under Send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    await show('https://script.google.com/macros/s/X/exec')
    type(target.querySelector('textarea')!, 'x')
    send().click()
    await settle()
    const notice = target.querySelector('p[data-fallback="true"]')!
    expect(notice.textContent!.replace(/\s+/g, ' ').trim()).toBe('The feedback server could not be reached; open a GitHub issue instead.')
    expect(notice.querySelector('a')).toBeTruthy()
  })
})

describe('fallbackLead', () => {
  it('no endpoint reads "Sending is not set up yet; "', () => expect(fallbackLead()).toBe('Sending is not set up yet; '))
  it('a failure leads with its reason, capitalised, one separator', () => {
    expect(fallbackLead('the feedback server could not be reached')).toBe('The feedback server could not be reached; ')
    expect(fallbackLead('rate limited.')).toBe('Rate limited; ')
  })
})

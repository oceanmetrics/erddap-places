import { describe, expect, it } from 'vitest'
import { isAbort, Runs } from './runToken'

describe('Runs: the newest run wins', () => {
  it('hands out increasing tokens and makes the previous one stale', () => {
    const runs = new Runs()
    const a = runs.start()
    expect(a.stale()).toBe(false)
    expect(runs.active).toBe(true)
    const b = runs.start()
    expect(a.stale()).toBe(true)      // the page-load auto-run must not render over the new pick
    expect(b.stale()).toBe(false)
    expect(b.token).toBe(a.token + 1)
  })

  it('aborts the superseded run\'s signal, not the new one\'s', () => {
    const runs = new Runs()
    const a = runs.start()
    const b = runs.start()
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(false)
    expect(isAbort(a.signal.reason)).toBe(true)
  })

  it('a superseded run finishing does not clear the run in flight', () => {
    const runs = new Runs()
    const a = runs.start(), b = runs.start()
    runs.finish(a)
    expect(runs.active).toBe(true)
    runs.finish(b)
    expect(runs.active).toBe(false)
    expect(b.stale()).toBe(false)     // finishing is not going stale
  })

  it('abort() stops everything and makes every handle stale', () => {
    const runs = new Runs()
    const a = runs.start()
    runs.abort()
    expect(a.signal.aborted).toBe(true)
    expect(a.stale()).toBe(true)
    expect(runs.active).toBe(false)
  })

  it('isAbort recognises an AbortError', () => {
    expect(isAbort(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbort(new Error('The user aborted a request.'))).toBe(true)
    expect(isAbort(new Error('404 Not Found from ERDDAP'))).toBe(false)
    expect(isAbort('nope')).toBe(false)
  })
})

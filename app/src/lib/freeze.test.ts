import { describe, expect, it } from 'vitest'
import { dismissFreeze, FREEZE_ABOUT, FREEZE_KEY, FREEZE_LINK, FREEZE_TEXT, freezeDismissed } from './freeze'

const fake = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }

describe('the freeze banner', () => {
  it('shows until it is dismissed, then stays closed for the session', () => {
    const s = fake()
    expect(freezeDismissed(s)).toBe(false)
    dismissFreeze(s)
    expect(s.m.get('om-freeze-dismissed')).toBe('1')
    expect(freezeDismissed(s)).toBe(true)
  })
  it('uses the key om-freeze-dismissed', () => { expect(FREEZE_KEY).toBe('om-freeze-dismissed') })
  it('shows and never throws when storage is missing or blocked', () => {
    expect(freezeDismissed(null)).toBe(false)
    expect(() => dismissFreeze(null)).not.toThrow()
    expect(freezeDismissed(broken)).toBe(false)
    expect(() => dismissFreeze(broken)).not.toThrow()
  })
  it('says when, in the words of the plan', () => {
    expect(FREEZE_TEXT).toBe('ERDDAP Places is frozen. Its statistics move to Ocean Metrics Indicators in build week 2 (2026-11-06 to 11-12), when this address redirects.')
    expect(FREEZE_LINK).toBe('Open this view in Indicators ↗')
    expect(FREEZE_ABOUT).toContain('Frozen since 2026-10-22')
  })
})

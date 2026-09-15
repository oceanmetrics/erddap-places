import { describe, expect, it } from 'vitest'
import { SPECTRAL_11, classColors, ramp } from './palette'

describe('ramp', () => {
  it('reverses Spectral, as seascapeR does', () => {
    expect(ramp(11)).toEqual([...SPECTRAL_11].reverse())
    expect(ramp(1)[0]).toBe('#5e4fa2')
  })
  it('interpolates to any n, keeping the endpoints', () => {
    const c = ramp(33)
    expect(c).toHaveLength(33)
    expect(c[0]).toBe('#5e4fa2')
    expect(c[32]).toBe('#9e0142')
    for (const x of c) expect(x).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('is empty for n <= 0', () => { expect(ramp(0)).toEqual([]) })
})

describe('classColors', () => {
  it('maps each class value to its own colour', () => {
    const m = classColors([1, 2, 3])
    expect([...m.keys()]).toEqual(['1', '2', '3'])
    expect(new Set(m.values()).size).toBe(3)
  })
})

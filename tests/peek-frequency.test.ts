import { describe, expect, it } from 'vitest'
import { nextPeekIntervalForFrequency } from '../src/main/peek-frequency'

describe('fullscreen peek frequency', () => {
  it('uses the documented cadence for each setting', () => {
    expect(nextPeekIntervalForFrequency('low', () => 0)).toBe(45_000)
    expect(nextPeekIntervalForFrequency('low', () => 1)).toBe(90_000)
    expect(nextPeekIntervalForFrequency('standard', () => 0)).toBe(20_000)
    expect(nextPeekIntervalForFrequency('standard', () => 1)).toBe(45_000)
    expect(nextPeekIntervalForFrequency('high', () => 0)).toBe(10_000)
    expect(nextPeekIntervalForFrequency('high', () => 1)).toBe(25_000)
  })
})

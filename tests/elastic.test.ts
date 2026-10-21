import { describe, expect, it } from 'vitest'
import { ElasticValue } from '../src/shared/elastic'

describe('elastic visual motion', () => {
  it('carries an impulse briefly, then settles without drift', () => {
    const spring = new ElasticValue(150, 16, 1)
    spring.kick(6)
    const samples = Array.from({ length: 180 }, () => spring.step(0, 1 / 60))
    expect(Math.max(...samples)).toBeGreaterThan(0.2)
    expect(samples.some(value => value < -0.01)).toBe(true)
    expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.001)
  })

  it('follows a moving target and remains bounded through a delayed frame', () => {
    const spring = new ElasticValue(140, 15, 0.13)
    for (let frame = 0; frame < 40; frame += 1) spring.step(0.08, 1 / 60)
    expect(spring.value).toBeCloseTo(0.08, 2)
    spring.kick(100)
    const value = spring.step(0, 0.5)
    expect(Number.isFinite(value)).toBe(true)
    expect(Math.abs(value)).toBeLessThanOrEqual(0.13)
    spring.reset()
    expect(spring.value).toBe(0)
  })
})

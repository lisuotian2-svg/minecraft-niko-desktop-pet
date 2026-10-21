import { describe, expect, it } from 'vitest'
import { petHeartOffsets, PET_HEART_COUNT } from '../src/shared/pet-hearts'

describe('pet feedback distribution', () => {
  it('surrounds the whole character instead of clumping at its head', () => {
    const points = petHeartOffsets({ x: 0, y: 0, width: 200, height: 400 }, () => 0.5)
    expect(points).toHaveLength(PET_HEART_COUNT)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      expect(points.filter(p => p.x * sx > 0 && p.y * sy > 0).length).toBeGreaterThanOrEqual(3)
    }
    for (const point of points) {
      const radius = Math.hypot(point.x / 96, point.y / 172)
      expect(radius).toBeGreaterThanOrEqual(0.78)
      expect(radius).toBeLessThanOrEqual(1.02)
      expect(Math.abs(point.x)).toBeLessThanOrEqual(100)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(180)
    }
  })
  it('scales its spread with the rendered character', () => {
    const small = petHeartOffsets({ x: 0, y: 0, width: 100, height: 200 }, () => 0.3)
    const large = petHeartOffsets({ x: 0, y: 0, width: 200, height: 400 }, () => 0.3)
    large.forEach((point, i) => {
      expect(point.x).toBeCloseTo(small[i]!.x * 2)
      expect(point.y).toBeCloseTo(small[i]!.y * 2)
    })
  })
})

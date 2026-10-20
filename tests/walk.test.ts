import { describe, expect, it } from 'vitest'
import {
  bottomWindowY,
  clampWindowX,
  nextWalkDelayMs,
  stepWalk,
  walkDurationMs,
  walkSpeed,
  type WalkArea
} from '../src/shared/walk'

const area: WalkArea = { x: 100, y: 20, width: 1000, height: 700 }
const windowWidth = 420

describe('bottom walking', () => {
  it('keeps the window within work-area bounds and at the bottom', () => {
    expect(clampWindowX(-200, area, windowWidth)).toBe(100)
    expect(clampWindowX(2000, area, windowWidth)).toBe(680)
    expect(bottomWindowY(area, 420)).toBe(300)
    expect(clampWindowX(200, { ...area, width: 300 }, windowWidth)).toBe(100)
  })

  it('uses elapsed seconds and direction at approximately 40 pixels per second', () => {
    expect(stepWalk({ x: 300, direction: 1 }, 0.5, 40, area, windowWidth)).toEqual({ x: 320, direction: 1 })
    expect(stepWalk({ x: 300, direction: -1 }, 0.5, 40, area, windowWidth)).toEqual({ x: 280, direction: -1 })
    expect(stepWalk({ x: 300, direction: -1 }, 0, 40, area, windowWidth)).toEqual({ x: 300, direction: -1 })
    expect(walkSpeed(420)).toBe(40)
  })

  it('reflects at both edges, including an exact edge and a long frame', () => {
    expect(stepWalk({ x: 110, direction: -1 }, 1, 40, area, windowWidth)).toEqual({ x: 130, direction: 1 })
    expect(stepWalk({ x: 670, direction: 1 }, 1, 40, area, windowWidth)).toEqual({ x: 650, direction: -1 })
    expect(stepWalk({ x: 680, direction: 1 }, 0, 40, area, windowWidth)).toEqual({ x: 680, direction: -1 })
    expect(stepWalk({ x: 100, direction: -1 }, 0, 40, area, windowWidth)).toEqual({ x: 100, direction: 1 })
    expect(stepWalk({ x: 300, direction: 1 }, 30, 40, area, windowWidth)).toEqual({ x: 340, direction: 1 })
  })

  it('schedules lazy walks every 3–8 minutes for 10–40 seconds', () => {
    expect(nextWalkDelayMs(() => 0)).toBe(180_000)
    expect(nextWalkDelayMs(() => 1)).toBe(480_000)
    expect(walkDurationMs(() => 0)).toBe(10_000)
    expect(walkDurationMs(() => 1)).toBe(40_000)
    expect(nextWalkDelayMs(() => 0.5)).toBe(330_000)
  })
})

import { describe, expect, it } from 'vitest'
import {
  bottomWindowY,
  clampDragPosition,
  clampWindowX,
  dragPadding,
  nextWalkDelayMs,
  roundWindowCoordinate,
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
    expect(nextWalkDelayMs(() => 0, 'low')).toBe(360_000)
    expect(nextWalkDelayMs(() => 1, 'low')).toBe(720_000)
    expect(nextWalkDelayMs(() => 0, 'high')).toBe(60_000)
    expect(nextWalkDelayMs(() => 1, 'high')).toBe(180_000)
    expect(walkSpeed(420, 1.5)).toBe(60)
  })
})

describe('free desktop dragging', () => {
  it('uses the visible pet rather than the empty canvas for all four edges', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(dragPadding(912, 500)).toBe(206)
    expect(clampDragPosition(-1000, -1000, display, 912, 500)).toEqual({ x: -206, y: -206 })
    expect(clampDragPosition(9000, 9000, display, 912, 500)).toEqual({ x: 1214, y: 374 })
    expect(clampDragPosition(450, 250, display, 912, 500)).toEqual({ x: 450, y: 250 })
  })

  it('respects a secondary monitor with negative desktop coordinates', () => {
    const display = { x: -1280, y: -200, width: 1280, height: 1024 }
    expect(clampDragPosition(-5000, -5000, display, 700, 400)).toEqual({ x: -1430, y: -350 })
    expect(clampDragPosition(5000, 5000, display, 700, 400)).toEqual({ x: -550, y: 274 })
  })

  it('never passes negative zero to the native window APIs', () => {
    // Math.round() returns -0 for values in (-0.5, 0]; Electron's Windows
    // bindings throw a conversion error for -0, which used to surface as a
    // main-process error dialog while walking or dragging along the edge.
    expect(Object.is(roundWindowCoordinate(-0.4), -0)).toBe(false)
    expect(roundWindowCoordinate(-0.4)).toBe(0)
    expect(roundWindowCoordinate(-0.6)).toBe(-1)
    expect(roundWindowCoordinate(0.4)).toBe(0)
    expect(Object.is(clampDragPosition(-0.4, -0.4, { x: 0, y: 0, width: 1536, height: 960 }, 912, 500).x, -0)).toBe(false)
    expect(Object.is(bottomWindowY({ x: 0, y: 0, width: 1536, height: 960 }, 960), -0)).toBe(false)
  })

  it('lets asymmetric transparent margins leave the screen while the model remains visible', () => {
    const display = { x: 0, y: 0, width: 1536, height: 960 }
    const model = { x: 350, y: 300, width: 230, height: 520 }
    expect(clampDragPosition(-1000, -1000, display, 912, model)).toEqual({ x: -350, y: -300 })
    expect(clampDragPosition(9000, 9000, display, 912, model)).toEqual({ x: 956, y: 140 })
  })
})

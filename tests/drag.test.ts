import { describe, expect, it } from 'vitest'
import { DragEdgePush, dragPosition, isPetOnAnyDisplay, isUsableDragCoordinate } from '../src/shared/drag'

const displays = [{ x: 0, y: 0, width: 1536, height: 960 }]
const footprint = { x: 306, y: 214, width: 267, height: 598 }

describe('free drag geometry', () => {
  it('preserves the original grab point and the movement before drag start', () => {
    // The pointer pressed a window at (312,0), then travelled (80,45).
    expect(dragPosition({ x: 812, y: 345 }, { x: 420, y: 300 }, { x: 0, y: 0 }))
      .toEqual({ x: 392, y: 45 })
  })

  it.each([
    [{ x: -572, y: 0 }, true], [{ x: -573, y: 0 }, false],
    [{ x: 1229, y: 0 }, true], [{ x: 1230, y: 0 }, false],
    [{ x: 0, y: -811 }, true], [{ x: 0, y: -812 }, false],
    [{ x: 0, y: 745 }, true], [{ x: 0, y: 746 }, false]
  ])('checks the visible model at each edge: %o', (position, visible) => {
    expect(isPetOnAnyDisplay(position, footprint, displays)).toBe(visible)
  })

  it('keeps a pet on a second negative-coordinate monitor alive', () => {
    const screens = [...displays, { x: -1920, y: -200, width: 1920, height: 1080 }]
    expect(isPetOnAnyDisplay({ x: -1200, y: -300 }, footprint, screens)).toBe(true)
    expect(isPetOnAnyDisplay({ x: -2500, y: -300 }, footprint, screens)).toBe(false)
  })
})

describe('held drag at screen edges', () => {
  it.each([
    [{ x: 0, y: 500 }, { x: -18, y: 0 }],
    [{ x: 1535, y: 500 }, { x: 18, y: 0 }],
    [{ x: 500, y: 0 }, { x: 0, y: -18 }],
    [{ x: 500, y: 959 }, { x: 0, y: 18 }]
  ])('continues outward after a short dwell at %o', (cursor, expected) => {
    const edge = new DragEdgePush()
    expect(edge.step(cursor, displays, 0)).toEqual({ x: 0, y: 0 })
    expect(edge.step(cursor, displays, 250)).toEqual({ x: 0, y: 0 })
    expect(edge.step(cursor, displays, 300)).toEqual(expected)
    // Leaving the edge retains the offset, so reversing does not jump back.
    expect(edge.step({ x: 500, y: 500 }, displays, 350)).toEqual(expected)
    expect(edge.step({ x: 500, y: 500 }, displays, 900)).toEqual(expected)
  })

  it('does not push at an adjoining monitor seam', () => {
    const screens = [...displays, { x: 1536, y: 0, width: 1920, height: 1080 }]
    const edge = new DragEdgePush()
    for (const time of [0, 300, 500, 1000]) {
      expect(edge.step({ x: 1535, y: 500 }, screens, time)).toEqual({ x: 0, y: 0 })
    }
  })

  it('rejects non-finite cursor readings before they reach setPosition()', () => {
    expect(isUsableDragCoordinate(100, 200)).toBe(true)
    expect(isUsableDragCoordinate(-1920, -200)).toBe(true)
    expect(isUsableDragCoordinate(0, 0)).toBe(true)
    expect(isUsableDragCoordinate(Number.NaN, 0)).toBe(false)
    expect(isUsableDragCoordinate(0, Number.NaN)).toBe(false)
    expect(isUsableDragCoordinate(Number.POSITIVE_INFINITY, 0)).toBe(false)
    expect(isUsableDragCoordinate(1_000_001, 0)).toBe(false)
    expect(isUsableDragCoordinate(0, -1_000_001)).toBe(false)

    // This is exactly what the drag timer produces when Electron reports a bad
    // cursor point on a DPI transition: NaN, which native setPosition() refused.
    const target = dragPosition({ x: Number.NaN, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 0 })
    expect(isUsableDragCoordinate(target.x, target.y)).toBe(false)
  })
})

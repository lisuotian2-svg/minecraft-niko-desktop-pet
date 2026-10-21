import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectorState } from '../src/main/fullscreen'
import type { Logger } from '../src/main/logger'
import { PeekController } from '../src/main/peek'
import type { PetWindowController } from '../src/main/pet-window'

vi.mock('electron', () => {
  const display = {
    id: 7,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    scaleFactor: 1
  }
  return {
    screen: {
      getAllDisplays: () => [display],
      getPrimaryDisplay: () => display,
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }
})

const active: DetectorState = { active: true, displayId: 7, source: 'helper' }

function createFixture(): {
  controller: PeekController
  beginPeek: ReturnType<typeof vi.fn>
  endPeek: ReturnType<typeof vi.fn>
} {
  let peeking = false
  const beginPeek = vi.fn(() => { peeking = true; return true })
  const endPeek = vi.fn(() => { peeking = false })
  const pet = {
    getBounds: () => ({ x: 800, y: 600, width: 420, height: 420 }),
    beginPeek,
    endPeek,
    isPeeking: () => peeking,
    isVisible: () => true,
    isClosing: () => false,
    isDragging: () => false,
    moveForPeek: vi.fn()
  } as unknown as PetWindowController
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger
  return {
    controller: new PeekController({ pet, logger, sendState: vi.fn(), random: () => 0 }),
    beginPeek,
    endPeek
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PeekController settings', () => {
  it('exits immediately when disabled and resumes from the cached fullscreen state', () => {
    const { controller, beginPeek, endPeek } = createFixture()
    try {
      controller.setDetectorState(active)
      expect(controller.getState().active).toBe(true)
      controller.setEnabled(false)
      expect(controller.getState().active).toBe(false)
      expect(endPeek).toHaveBeenCalledTimes(1)
      controller.setDetectorState(active)
      expect(controller.getState().active).toBe(false)
      controller.setEnabled(true)
      expect(controller.getState().active).toBe(true)
      expect(beginPeek).toHaveBeenCalledTimes(2)
    } finally {
      controller.dispose()
    }
  })

  it('reschedules a hidden peek when frequency changes', () => {
    const { controller } = createFixture()
    try {
      controller.setDetectorState(active)
      controller.setFrequency('high')
      vi.advanceTimersByTime(9_999)
      expect(controller.getState().phase).toBe('hidden')
      vi.advanceTimersByTime(1)
      expect(controller.getState().phase).toBe('peeking')
    } finally {
      controller.dispose()
    }
  })
})

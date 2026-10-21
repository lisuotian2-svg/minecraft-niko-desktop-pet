import { describe, expect, it } from 'vitest'
import { GestureMachine } from '../src/shared/gesture'

describe('left-button gesture timing', () => {
  it('makes a short stationary press a click', () => {
    const gesture = new GestureMachine()
    expect(gesture.press(0, 10, 20)).toEqual(['press'])
    expect(gesture.release(200)).toEqual(['click', 'release'])
    expect(gesture.phase).toBe('idle')
  })

  it('does not begin dragging for movement before 250 ms', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.move(249, 8, 0)).toEqual([])
    expect(gesture.release(249)).toEqual(['click', 'release'])
  })

  it('starts drag only for movement in the 250-1500 ms window', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.move(250, 5, 0)).toEqual([])
    expect(gesture.move(300, 6, 0)).toEqual(['dragStart'])
    expect(gesture.tick(4000)).toEqual([])
    expect(gesture.release(4000)).toEqual(['dragEnd', 'release'])
  })

  it('toggles torch at 1.5 s, gathers at 2.4 s, and closes at 3 s', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.tick(1499)).toEqual([])
    expect(gesture.tick(1500)).toEqual(['toggleTorch'])
    expect(gesture.tick(2400)).toEqual(['gatherStart'])
    expect(gesture.tick(3000)).toEqual(['close'])
    expect(gesture.phase).toBe('closing')
    expect(gesture.release(3100)).toEqual([])
  })

  it('releasing after torch cancels close and gathering', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.release(1800)).toEqual(['toggleTorch', 'release'])
    expect(gesture.tick(4000)).toEqual([])
    gesture.press(5000, 0, 0)
    expect(gesture.release(7500)).toEqual(['toggleTorch', 'gatherStart', 'gatherStop', 'release'])
    expect(gesture.tick(9000)).toEqual([])
  })

  it('movement after 1.5 s cannot start a drag or cancel the close clock', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.move(1600, 100, 100)).toEqual(['toggleTorch'])
    expect(gesture.move(2700, 200, 200)).toEqual(['gatherStart'])
    expect(gesture.tick(3000)).toEqual(['close'])
  })

  it('cancels timers on pointer cancellation', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.cancel()).toEqual([])
    expect(gesture.tick(4000)).toEqual([])
    expect(gesture.release(4000)).toEqual([])
  })

  it('does not interpret movement inside the 250 ms gate as a still hold', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    gesture.move(100, 20, 0)
    expect(gesture.tick(3000)).toEqual([])
    expect(gesture.release(3000)).toEqual(['release'])
  })
})

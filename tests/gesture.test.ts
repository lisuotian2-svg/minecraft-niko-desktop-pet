import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GESTURE_TIMING,
  GestureMachine,
  MAX_LONG_PRESS_MS,
  MIN_LONG_PRESS_MS
} from '../src/shared/gesture'
import {
  ACTION_PRIORITY,
  InteractionActions,
  RENDERER_ACTION_IDS,
  SYSTEM_ACTION_IDS,
  TorchController,
  type ActionHostPort,
  type ActionHostState,
  type TorchVisualPort
} from '../src/renderer/interaction-actions'
import {
  ACTION_LABELS,
  type ActionId,
  type ActionRequest,
  type BehaviorMode
} from '../src/shared/contracts'

function request(id: ActionId, source: ActionRequest['source'] = 'hotkey'): ActionRequest {
  return { id, source }
}

function hostState(overrides: Partial<ActionHostState> = {}): ActionHostState {
  return {
    hidden: false,
    frozen: false,
    fullscreenPeek: false,
    gesturePhase: 'idle',
    closing: false,
    mode: 'idle',
    activeAction: null,
    torchOn: false,
    torchManual: false,
    ...overrides
  }
}

interface PortCalls {
  performed: ActionId[]
  cancelled: string[]
  checked: ActionId[]
}

function makePort(
  state: ActionHostState = hostState(),
  canRun: (action: ActionId) => boolean = () => true
): { port: ActionHostPort; calls: PortCalls } {
  const calls: PortCalls = { performed: [], cancelled: [], checked: [] }
  return {
    calls,
    port: {
      getState: () => state,
      canRun: (action) => {
        calls.checked.push(action)
        return canRun(action)
      },
      perform: (action) => {
        calls.performed.push(action)
        return true
      },
      cancel: (reason) => { calls.cancelled.push(reason) }
    }
  }
}

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

  it('keeps the long press alive when early jitter returns inside the slop', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.move(100, 8, 0)).toEqual([])
    expect(gesture.move(200, 2, 0)).toEqual([])
    expect(gesture.tick(250)).toEqual([])
    expect(gesture.tick(1500)).toEqual(['toggleTorch'])
    expect(gesture.tick(2400)).toEqual(['gatherStart'])
    expect(gesture.tick(3000)).toEqual(['close'])
  })

  it('turns early jitter into a drag at the gate if the pointer never returns', () => {
    const gesture = new GestureMachine()
    gesture.press(0, 0, 0)
    expect(gesture.move(100, 8, 0)).toEqual([])
    expect(gesture.tick(250)).toEqual(['dragStart'])
    expect(gesture.tick(1500)).toEqual([])
    expect(gesture.release(1600)).toEqual(['dragEnd', 'release'])
  })

  it('derives gather/close deadlines from longPressMs', () => {
    const gesture = new GestureMachine({ longPressMs: 1000 })
    expect(gesture.torchDelayMs).toBe(1000)
    expect(gesture.gatherDelayMs).toBe(1900)
    expect(gesture.closeDelayMs).toBe(2500)
    gesture.press(0, 0, 0)
    expect(gesture.tick(999)).toEqual([])
    expect(gesture.tick(1000)).toEqual(['toggleTorch'])
    expect(gesture.tick(1899)).toEqual([])
    expect(gesture.tick(1900)).toEqual(['gatherStart'])
    expect(gesture.tick(2499)).toEqual([])
    expect(gesture.tick(2500)).toEqual(['close'])
  })

  it('clamps longPressMs and nextDeadline exposes the drag/torch deadlines', () => {
    const gesture = new GestureMachine({ longPressMs: 50 })
    expect(gesture.torchDelayMs).toBe(MIN_LONG_PRESS_MS)
    gesture.setTiming({ longPressMs: 99_999 })
    expect(gesture.torchDelayMs).toBe(MAX_LONG_PRESS_MS)
    expect(DEFAULT_GESTURE_TIMING.longPressMs).toBe(1500)

    gesture.press(1000, 0, 0)
    expect(gesture.nextDeadline(1000)).toBe(1250)
    gesture.move(1100, 8, 0)
    expect(gesture.nextDeadline(1100)).toBe(1250)
    expect(gesture.tick(1250)).toEqual(['dragStart'])
    expect(gesture.nextDeadline(1250)).toBeNull()

    const held = new GestureMachine({ longPressMs: 1500 })
    held.press(1000, 0, 0)
    held.move(1100, 2, 0)
    expect(held.nextDeadline(1100)).toBe(1250)
    expect(held.nextDeadline(1300)).toBe(2500)
    held.tick(1250)
    expect(held.nextDeadline(1250)).toBe(2500)
  })
})

describe('interaction action gate', () => {
  it('delegates system actions to main and never performs them in renderer', () => {
    const { port, calls } = makePort()
    const bus = new InteractionActions(port)
    for (const id of SYSTEM_ACTION_IDS) {
      expect(bus.performAction(request(id))).toEqual({ id, ok: false, reason: 'system-action-delegated' })
    }
    expect(calls.performed).toEqual([])
    expect(calls.checked).toEqual([])
  })

  it('rejects unknown ids and bad sources with a result', () => {
    const { port } = makePort()
    const bus = new InteractionActions(port)
    expect(bus.performAction({ id: 'nope' as ActionId, source: 'hotkey' })).toEqual({
      id: 'nope', ok: false, reason: 'invalid-action'
    })
    expect(bus.performAction({ id: 'pet', source: 'bad' as ActionRequest['source'] })).toEqual({
      id: 'pet', ok: false, reason: 'invalid-source'
    })
  })

  it('blocks hidden, frozen, peek, gesture and closing states', () => {
    const cases: Array<[Partial<ActionHostState>, string]> = [
      [{ hidden: true }, 'hidden'],
      [{ frozen: true }, 'frozen'],
      [{ fullscreenPeek: true }, 'fullscreen'],
      [{ gesturePhase: 'pressed' }, 'gesture'],
      [{ gesturePhase: 'closing', closing: true }, 'closing']
    ]
    for (const [overrides, reason] of cases) {
      const { port, calls } = makePort(hostState(overrides))
      const result = new InteractionActions(port).performAction(request('pet'))
      expect(result).toEqual({ id: 'pet', ok: false, reason })
      expect(calls.performed).toEqual([])
    }
  })

  it('enforces sleep/wake/feed/mode locks before the behavior callback', () => {
    const sleepState = hostState({ mode: 'sleep', activeAction: 'sleep' })
    expect(new InteractionActions(makePort(sleepState).port).performAction(request('sleep'))).toEqual({
      id: 'sleep', ok: false, reason: 'already-sleeping'
    })
    expect(new InteractionActions(makePort(hostState()).port).performAction(request('wake'))).toEqual({
      id: 'wake', ok: false, reason: 'not-sleeping'
    })
    expect(new InteractionActions(makePort(hostState({ mode: 'doze' })).port).performAction(request('wake'))).toEqual({
      id: 'wake', ok: true
    })
    expect(new InteractionActions(makePort(hostState({ mode: 'eat' })).port).performAction(request('feed'))).toEqual({
      id: 'feed', ok: false, reason: 'busy'
    })
    expect(new InteractionActions(makePort(hostState({ torchManual: true })).port).performAction(request('wave'))).toEqual({
      id: 'wave', ok: false, reason: 'manual-torch'
    })
    expect(new InteractionActions(makePort(hostState({ activeAction: 'feed' })).port).performAction(request('pet'))).toEqual({
      id: 'pet', ok: false, reason: 'busy'
    })
  })

  it('lets wake interrupt sleep and calls behavior only after canRun', () => {
    const { port, calls } = makePort(hostState({ mode: 'sleep', activeAction: 'sleep' }))
    const bus = new InteractionActions(port)
    expect(bus.performAction(request('wake'))).toEqual({ id: 'wake', ok: true })
    expect(calls.checked).toEqual(['wake'])
    expect(calls.performed).toEqual(['wake'])
  })

  it('returns behavior-lock / behavior-error instead of logging', () => {
    const locked = makePort(hostState(), () => false)
    expect(new InteractionActions(locked.port).performAction(request('pet'))).toEqual({
      id: 'pet', ok: false, reason: 'behavior-lock'
    })
    expect(locked.calls.performed).toEqual([])

    const throws: ActionHostPort = {
      getState: () => hostState(),
      canRun: () => true,
      perform: () => { throw new Error('behavior failed') },
      cancel: () => undefined
    }
    expect(new InteractionActions(throws).performAction(request('wave'))).toEqual({
      id: 'wave', ok: false, reason: 'behavior-error'
    })

    const refuses: ActionHostPort = {
      getState: () => hostState(),
      canRun: () => true,
      perform: () => false
    }
    expect(new InteractionActions(refuses).performAction(request('feed'))).toEqual({
      id: 'feed', ok: false, reason: 'behavior-rejected'
    })
  })

  it('models priority, labels and full action coverage', () => {
    const ids = [...RENDERER_ACTION_IDS, ...SYSTEM_ACTION_IDS].sort()
    expect(ids).toEqual(Object.keys(ACTION_LABELS).sort())
    for (const id of ids) expect(ACTION_PRIORITY[id]).toBeDefined()
    expect(ACTION_PRIORITY.photo).toBe('system')
    expect(ACTION_PRIORITY.pet).toBe('explicit')
  })

  it('mirrors busy state and forwards cancels to the behavior port', () => {
    const busy = makePort(hostState({ gesturePhase: 'dragging' }))
    expect(new InteractionActions(busy.port).isBusy()).toBe(true)
    const idle = makePort(hostState())
    const bus = new InteractionActions(idle.port)
    expect(bus.isBusy()).toBe(false)
    bus.cancel('gesture')
    expect(idle.calls.cancelled).toEqual(['gesture'])
  })
})

describe('torch controller lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeController(
    settings: { autoTorch: boolean; darkThreshold: number } = { autoTorch: true, darkThreshold: 30 },
    busy = false
  ): {
    controller: TorchController
    visuals: boolean[]
    sounds: boolean[]
    setBusy: (value: boolean) => void
  } {
    let isBusy = busy
    const visuals: boolean[] = []
    const sounds: boolean[] = []
    const port: TorchVisualPort = {
      applyVisual: (on) => { visuals.push(on) },
      playSound: (on) => { sounds.push(on) },
      isBusy: () => isBusy
    }
    const controller = new TorchController({
      settings,
      port,
      autoCooldownMs: 0,
      autoDurationMs: () => 15_000,
      now: () => 0
    })
    return { controller, visuals, sounds, setBusy: (value) => { isBusy = value } }
  }

  it('triggers immediately on a cold start in the dark and releases after 12-18 s', () => {
    const { controller, visuals, sounds } = makeController()
    controller.setBrightness(20)
    expect(controller.getState()).toMatchObject({ on: true, auto: true, manual: false })
    expect(visuals).toEqual([true])
    expect(sounds).toEqual([true])

    vi.advanceTimersByTime(15_000)
    expect(controller.getState()).toMatchObject({ on: false, auto: false })
    expect(visuals).toEqual([true, false])
    expect(sounds).toEqual([true, false])
  })

  it('does not trigger or make sound while hidden, and restores extinguished', () => {
    const { controller, sounds } = makeController()
    controller.setHidden(true)
    controller.setBrightness(5)
    expect(controller.getState()).toMatchObject({ on: false, auto: false, hidden: true })
    expect(sounds).toEqual([])
    controller.setHidden(false)
    controller.setBrightness(5)
    expect(controller.getState().on).toBe(true)
  })

  it('requires a new bright→dark edge after a manual off', () => {
    const { controller, sounds } = makeController()
    controller.setBrightness(20)
    expect(controller.getState().auto).toBe(true)
    controller.toggleManual(false)
    expect(controller.getState()).toMatchObject({ on: false, auto: false, manual: false })

    controller.setBrightness(20)
    expect(controller.getState().on).toBe(false)
    controller.setBrightness(80)
    controller.setBrightness(20)
    expect(controller.getState().on).toBe(true)
    expect(sounds.filter((value) => value === false).length).toBeGreaterThanOrEqual(1)
  })

  it('cancels auto timers and torch on close, then restores safely', () => {
    const { controller, sounds } = makeController()
    controller.setBrightness(20)
    controller.setClosing(true)
    expect(controller.getState()).toMatchObject({ on: false, auto: false, closing: true })
    vi.advanceTimersByTime(30_000)
    expect(controller.getState().on).toBe(false)
    expect(sounds).toEqual([true])

    controller.setClosing(false)
    controller.restore()
    expect(controller.getState()).toMatchObject({ on: false, hidden: false, closing: false })
  })

  it('does not auto-trigger while behavior is busy, then retries the same dark edge', () => {
    const { controller, setBusy } = makeController({ autoTorch: true, darkThreshold: 30 }, true)
    controller.setBrightness(20)
    expect(controller.getState().on).toBe(false)
    setBusy(false)
    controller.setBrightness(20)
    expect(controller.getState().on).toBe(true)
  })

  it('supports manual toggle and ignores auto when disabled', () => {
    const { controller, sounds } = makeController({ autoTorch: false, darkThreshold: 30 })
    controller.setBrightness(20)
    expect(controller.getState().on).toBe(false)
    expect(controller.toggleManual(true)).toBe(true)
    expect(controller.getState()).toMatchObject({ on: true, manual: true })
    expect(controller.toggleManual(false)).toBe(false)
    expect(controller.getState()).toMatchObject({ on: false, manual: false })
    expect(sounds).toEqual([true, false])
  })
})

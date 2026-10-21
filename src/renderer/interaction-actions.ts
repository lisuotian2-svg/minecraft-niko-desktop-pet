import {
  ACTION_LABELS,
  isActionId,
  type ActionId,
  type ActionRequest,
  type ActionResult,
  type ActionSource,
  type BehaviorMode
} from '../shared/contracts'
import type { GesturePhase } from '../shared/gesture'

export const SYSTEM_ACTION_IDS = ['togglePet', 'photo', 'settings'] as const
export type SystemActionId = (typeof SYSTEM_ACTION_IDS)[number]

// Product rule (2026-10-21): hide is long-press only. Main's togglePet action is
// therefore a reveal/find action; this renderer bus must never hide the pet.
// It rejects system ids below so a misrouted request cannot create a second
// hide path.

export const RENDERER_ACTION_IDS = ['pet', 'feed', 'torch', 'dance', 'wave', 'sleep', 'wake'] as const
export type RendererActionId = (typeof RENDERER_ACTION_IDS)[number]

export type ActionPriority = 'system' | 'state' | 'explicit'

/** Labels are for settings/tray only; the pet canvas never renders text. */
export function actionLabel(id: ActionId): string {
  return ACTION_LABELS[id]
}

export const ACTION_PRIORITY: Readonly<Record<ActionId, ActionPriority>> = Object.freeze({
  togglePet: 'system',
  photo: 'system',
  settings: 'system',
  sleep: 'state',
  wake: 'state',
  pet: 'explicit',
  feed: 'explicit',
  torch: 'explicit',
  dance: 'explicit',
  wave: 'explicit'
})

export function isSystemAction(id: ActionId): id is SystemActionId {
  return (SYSTEM_ACTION_IDS as readonly string[]).includes(id)
}

export function isRendererAction(id: ActionId): id is RendererActionId {
  return (RENDERER_ACTION_IDS as readonly string[]).includes(id)
}

function isActionSource(value: unknown): value is ActionSource {
  return value === 'hotkey' || value === 'tray' || value === 'ui' || value === 'gesture'
}

export interface ActionHostState {
  hidden: boolean
  frozen: boolean
  fullscreenPeek: boolean
  gesturePhase: GesturePhase
  closing: boolean
  /** Behavior's current mode; used for sleep/wake/feed locks. */
  mode: BehaviorMode
  /** A timed behavior action currently owns the single action slot. */
  activeAction: ActionId | null
  torchOn: boolean
  torchManual: boolean
}

/**
 * Behavior integration points. `canRun` is the final behavior lock; the bus
 * never starts an action that behavior has not approved.
 */
export interface ActionHostPort {
  getState(): ActionHostState
  canRun(action: RendererActionId): boolean
  /** Return false when the behavior refused the action after its own checks. */
  perform(action: RendererActionId): boolean | void
  /** Called when a gesture/photo/close takes priority over an active action. */
  cancel?(reason: ActionCancelReason): void
}

export type ActionCancelReason = 'gesture' | 'close' | 'photo' | 'system'

const BUSY_MODES: readonly BehaviorMode[] = ['eat', 'drag', 'peek', 'close']
const SLEEP_BLOCKED_ACTIONS: readonly RendererActionId[] = ['feed', 'torch', 'dance', 'wave']
const FEED_BLOCKED_MODES: readonly BehaviorMode[] = ['sleep', 'doze', 'eat', 'drag', 'peek', 'close']
const SOCIAL_BLOCKED_MODES: readonly BehaviorMode[] = ['sleep', 'doze', 'eat', 'drag', 'peek', 'close']
const TORCH_BLOCKED_MODES: readonly BehaviorMode[] = ['sleep', 'doze', 'eat', 'drag', 'peek', 'close']

function modeBlocked(mode: BehaviorMode, blocked: readonly BehaviorMode[]): boolean {
  return blocked.includes(mode)
}

/**
 * Renderer action whitelist, priority and gate. It returns an ActionResult for
 * every call: system actions are explicitly delegated to main, and rejected
 * actions carry a terse machine-readable reason (never just a log line).
 */
export class InteractionActions {
  constructor(private readonly port: ActionHostPort) {}

  performAction(request: ActionRequest): ActionResult {
    const id = request.id
    if (!isActionId(id)) return { id, ok: false, reason: 'invalid-action' }
    if (!isActionSource(request.source)) return { id, ok: false, reason: 'invalid-source' }
    if (isSystemAction(id)) return { id, ok: false, reason: 'system-action-delegated' }
    if (!isRendererAction(id)) return { id, ok: false, reason: 'unsupported-action' }

    const state = this.port.getState()
    const rejection = this.gate(id, state)
    if (rejection !== null) return { id, ok: false, reason: rejection }
    if (!this.port.canRun(id)) return { id, ok: false, reason: 'behavior-lock' }

    try {
      const performed = this.port.perform(id)
      if (performed === false) return { id, ok: false, reason: 'behavior-rejected' }
    } catch {
      return { id, ok: false, reason: 'behavior-error' }
    }
    return { id, ok: true }
  }

  /** True while a gesture, explicit action or exclusive behavior mode owns the pet. */
  isBusy(): boolean {
    const state = this.port.getState()
    return state.hidden ||
      state.frozen ||
      state.fullscreenPeek ||
      state.closing ||
      state.gesturePhase !== 'idle' ||
      state.activeAction !== null ||
      state.mode === 'sleep' ||
      state.mode === 'doze' ||
      modeBlocked(state.mode, BUSY_MODES)
  }

  /** Gesture/photo/close can pre-empt the current action. */
  cancel(reason: ActionCancelReason): void {
    this.port.cancel?.(reason)
  }

  getPriority(id: ActionId): ActionPriority {
    return ACTION_PRIORITY[id]
  }

  private gate(action: RendererActionId, state: ActionHostState): string | null {
    if (state.hidden) return 'hidden'
    if (state.closing || state.gesturePhase === 'closing') return 'closing'
    if (state.frozen) return 'frozen'
    if (state.fullscreenPeek) return 'fullscreen'
    if (state.gesturePhase !== 'idle') return 'gesture'

    if (state.activeAction !== null && state.activeAction !== action) {
      const waking = action === 'wake' && (state.mode === 'sleep' || state.mode === 'doze')
      if (!waking) return 'busy'
    }

    if (action === 'sleep') {
      if (state.mode === 'sleep') return 'already-sleeping'
      if (state.mode !== 'idle' && state.mode !== 'walk' && state.mode !== 'sit' && state.mode !== 'doze') {
        return 'busy'
      }
    }
    if (action === 'wake' && state.mode !== 'sleep' && state.mode !== 'doze') return 'not-sleeping'
    if (SLEEP_BLOCKED_ACTIONS.includes(action) && (state.mode === 'sleep' || state.mode === 'doze')) {
      return 'busy'
    }
    if (action === 'feed' && modeBlocked(state.mode, FEED_BLOCKED_MODES)) return 'busy'
    if ((action === 'dance' || action === 'wave') && modeBlocked(state.mode, SOCIAL_BLOCKED_MODES)) return 'busy'
    if (action === 'torch' && modeBlocked(state.mode, TORCH_BLOCKED_MODES)) return 'busy'
    if (state.torchManual && (action === 'feed' || action === 'dance' || action === 'wave')) return 'manual-torch'
    return null
  }
}

// ---------------------------------------------------------------------------
// Torch session (INT-P0-04)
// ---------------------------------------------------------------------------

export interface TorchControllerSettings {
  autoTorch: boolean
  darkThreshold: number
}

export interface TorchVisualPort {
  applyVisual(on: boolean): void
  playSound(on: boolean): void
  isBusy?(): boolean
  log?(message: string): void
}

export type TimerHandle = ReturnType<typeof setTimeout>

export interface TorchScheduler {
  setTimeout(callback: () => void, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export interface TorchControllerOptions {
  settings: TorchControllerSettings
  port: TorchVisualPort
  autoCooldownMs?: number
  autoDurationMs?: () => number
  now?: () => number
  random?: () => number
  scheduler?: TorchScheduler
}

export interface TorchControllerState {
  on: boolean
  manual: boolean
  auto: boolean
  hidden: boolean
  closing: boolean
  dark: boolean
  lastAutoAt: number
}

const defaultScheduler: TorchScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle)
}

/**
 * Owns manual/auto torch state and timers so hide/close/restore cannot leave a
 * lit, sounding or re-triggering torch behind. The actual pet.ts wiring is a
 * behavior/Lead integration step; this class has no DOM or Three dependency.
 */
export class TorchController {
  private settings: TorchControllerSettings
  private on = false
  private manual = false
  private auto = false
  private hidden = false
  private closing = false
  private dark = false
  private darkEdge = false
  // Cold start must be able to trigger immediately; a plain 0 would suppress
  // auto torch for the first 10 minutes of renderer uptime.
  private lastAutoAt = Number.NEGATIVE_INFINITY
  private autoTimer: TimerHandle | null = null
  private readonly autoCooldownMs: number
  private readonly durationMs: () => number
  private readonly now: () => number
  private readonly scheduler: TorchScheduler

  constructor(private readonly options: TorchControllerOptions) {
    this.settings = { ...options.settings }
    this.autoCooldownMs = Math.max(0, options.autoCooldownMs ?? 10 * 60_000)
    this.durationMs = options.autoDurationMs ?? (() => 12_000 + (options.random ?? Math.random)() * 6_000)
    this.now = options.now ?? (() => performance.now())
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  getState(): TorchControllerState {
    return {
      on: this.on,
      manual: this.manual,
      auto: this.auto,
      hidden: this.hidden,
      closing: this.closing,
      dark: this.dark,
      lastAutoAt: this.lastAutoAt
    }
  }

  isOn(): boolean { return this.on }

  setSettings(settings: TorchControllerSettings): void {
    this.settings = { ...settings }
    if (!this.settings.autoTorch && this.auto) this.stopAuto(false)
  }

  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return
    this.hidden = hidden
    this.manual = false
    this.auto = false
    this.dark = false
    this.darkEdge = false
    this.stopAutoTimer()
    this.applyOff(true)
  }

  setClosing(closing: boolean): void {
    if (closing === this.closing) return
    this.closing = closing
    if (closing) {
      this.manual = false
      this.auto = false
      this.dark = false
      this.darkEdge = false
      this.stopAutoTimer()
      this.applyOff(true)
    }
  }

  /** Re-show/restore always starts extinguished and waits for a fresh dark edge. */
  restore(): void {
    this.hidden = false
    this.closing = false
    this.manual = false
    this.auto = false
    this.dark = false
    this.darkEdge = false
    this.stopAutoTimer()
    this.applyOff(true)
  }

  setBrightness(value: number | null): void {
    const isDark = value !== null && value <= this.settings.darkThreshold
    if (this.hidden || this.closing) {
      this.dark = isDark
      this.darkEdge = false
      if (this.auto) this.stopAuto(true)
      return
    }
    if (value === null || !this.settings.autoTorch) {
      this.dark = false
      this.darkEdge = false
      if (this.auto) this.stopAuto(true)
      return
    }
    if (!isDark) {
      this.dark = false
      this.darkEdge = false
      if (this.auto) this.stopAuto(false)
      return
    }

    const wasDark = this.dark
    this.dark = true
    if (!wasDark) this.darkEdge = true
    if (!this.darkEdge) return
    if (this.manual || this.on) return
    if (this.options.port.isBusy?.()) return
    if (this.now() - this.lastAutoAt < this.autoCooldownMs) return
    this.startAuto()
  }

  toggleManual(on = !this.on): boolean {
    if (this.hidden || this.closing) return false
    if (on) {
      this.manual = true
      this.auto = false
      this.darkEdge = false
      this.stopAutoTimer()
      this.applyOn(true)
    } else {
      this.manual = false
      this.auto = false
      this.darkEdge = false
      this.stopAutoTimer()
      this.applyOff(false)
    }
    return this.on
  }

  dispose(): void {
    this.stopAutoTimer()
    this.applyOff(true)
  }

  private startAuto(): void {
    this.auto = true
    this.darkEdge = false
    this.lastAutoAt = this.now()
    this.applyOn(true)
    const duration = Math.max(1000, this.durationMs())
    this.autoTimer = this.scheduler.setTimeout(() => {
      this.autoTimer = null
      if (!this.auto) return
      this.auto = false
      this.darkEdge = false
      if (this.on && !this.manual) this.applyOff(false)
    }, duration)
    this.options.port.log?.(`auto torch on for ${Math.round(duration / 1000)}s`)
  }

  private stopAuto(silent: boolean): void {
    this.stopAutoTimer()
    this.auto = false
    this.darkEdge = false
    if (this.on && !this.manual) this.applyOff(silent)
  }

  private stopAutoTimer(): void {
    if (this.autoTimer === null) return
    this.scheduler.clearTimeout(this.autoTimer)
    this.autoTimer = null
  }

  private applyOn(sound: boolean): void {
    if (this.on) return
    this.on = true
    this.options.port.applyVisual(true)
    if (sound) this.options.port.playSound(true)
  }

  private applyOff(silent: boolean): void {
    const wasOn = this.on
    this.on = false
    this.options.port.applyVisual(false)
    if (wasOn && !silent) this.options.port.playSound(false)
  }
}

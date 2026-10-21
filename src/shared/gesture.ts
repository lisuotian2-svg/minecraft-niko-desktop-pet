export type GesturePhase = 'idle' | 'pressed' | 'dragging' | 'torch' | 'gathering' | 'closing'

export type GestureAction =
  | 'press'
  | 'click'
  | 'dragStart'
  | 'dragEnd'
  | 'toggleTorch'
  | 'gatherStart'
  | 'gatherStop'
  | 'close'
  | 'release'

export interface GestureTiming {
  /** Hold duration before the torch toggles. Settings range: 1000–2000 ms. */
  longPressMs: number
  /** Movement inside this gate never starts a drag. */
  dragDelayMs: number
  /** Gather preview starts at longPressMs + gatherOffsetMs. */
  gatherOffsetMs: number
  /** Close starts at longPressMs + closeOffsetMs. */
  closeOffsetMs: number
  /** Distance from the press origin that counts as movement. */
  slopPx: number
}

export const MIN_LONG_PRESS_MS = 1000
export const MAX_LONG_PRESS_MS = 2000

export const DEFAULT_GESTURE_TIMING: Readonly<GestureTiming> = Object.freeze({
  longPressMs: 1500,
  dragDelayMs: 50,
  gatherOffsetMs: 900,
  closeOffsetMs: 1500,
  slopPx: 5
})

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function normalizeLongPressMs(value: number | undefined): number {
  return Math.round(clamp(finiteOr(value, DEFAULT_GESTURE_TIMING.longPressMs), MIN_LONG_PRESS_MS, MAX_LONG_PRESS_MS))
}

function normalizeTiming(input: Partial<GestureTiming>): GestureTiming {
  const longPressMs = normalizeLongPressMs(input.longPressMs)
  const gatherOffsetMs = Math.round(clamp(finiteOr(input.gatherOffsetMs, DEFAULT_GESTURE_TIMING.gatherOffsetMs), 0, 5000))
  return {
    longPressMs,
    dragDelayMs: Math.round(clamp(finiteOr(input.dragDelayMs, DEFAULT_GESTURE_TIMING.dragDelayMs), 50, 1000)),
    gatherOffsetMs,
    // The close phase is always at least one millisecond after the gather preview.
    closeOffsetMs: Math.round(clamp(
      finiteOr(input.closeOffsetMs, DEFAULT_GESTURE_TIMING.closeOffsetMs),
      gatherOffsetMs + 1,
      6000
    )),
    slopPx: Math.round(clamp(finiteOr(input.slopPx, DEFAULT_GESTURE_TIMING.slopPx), 1, 50))
  }
}

/**
 * Pure left-button gesture clock. DOM events and effects stay in the renderer.
 *
 * Movement inside the short drag gate is remembered as the current
 * position, not as a permanent "already moved" flag. At the gate deadline the
 * machine decides from the current position: still inside the slop means the
 * long press continues, outside means a drag starts. This keeps a small early
 * jitter from making both the torch and close unreachable.
 */
export class GestureMachine {
  private phaseValue: GesturePhase = 'idle'
  private pressedAt = 0
  private startX = 0
  private startY = 0
  private lastX = 0
  private lastY = 0
  private timingValue: GestureTiming

  constructor(timing: Partial<GestureTiming> = {}) {
    this.timingValue = normalizeTiming(timing)
  }

  get phase(): GesturePhase { return this.phaseValue }
  get isPressed(): boolean { return this.phaseValue !== 'idle' && this.phaseValue !== 'closing' }
  get isDragging(): boolean { return this.phaseValue === 'dragging' }
  get isClosing(): boolean { return this.phaseValue === 'closing' }
  get timing(): Readonly<GestureTiming> { return this.timingValue }
  get torchDelayMs(): number { return this.timingValue.longPressMs }
  get gatherDelayMs(): number { return this.timingValue.longPressMs + this.timingValue.gatherOffsetMs }
  get closeDelayMs(): number { return this.timingValue.longPressMs + this.timingValue.closeOffsetMs }

  /** Merge a new configuration. Settings changes take effect immediately. */
  setTiming(timing: Partial<GestureTiming>): void {
    this.timingValue = normalizeTiming({ ...this.timingValue, ...timing })
  }

  /**
   * Absolute timestamp of the next phase decision. The renderer uses one
   * timeout chain instead of duplicating 1500/2400/3000 in another file.
   */
  nextDeadline(now: number): number | null {
    if (this.phaseValue === 'idle' || this.phaseValue === 'closing' || this.phaseValue === 'dragging') return null
    const elapsed = now - this.pressedAt
    if (this.phaseValue === 'pressed') {
      if (elapsed >= this.torchDelayMs) return now
      if (elapsed < this.timingValue.dragDelayMs) return this.pressedAt + this.timingValue.dragDelayMs
      if (this.distanceFromStart() > this.timingValue.slopPx) return now
      return this.pressedAt + this.torchDelayMs
    }
    if (this.phaseValue === 'torch') return this.pressedAt + this.gatherDelayMs
    return this.pressedAt + this.closeDelayMs
  }

  press(now: number, x: number, y: number): GestureAction[] {
    if (this.phaseValue !== 'idle') return []
    this.phaseValue = 'pressed'
    this.pressedAt = now
    this.startX = x
    this.startY = y
    this.lastX = x
    this.lastY = y
    return ['press']
  }

  move(now: number, x: number, y: number): GestureAction[] {
    // Decide using this event's coordinates; the previous sample could still
    // be outside the slop when the cursor has already moved back inside it.
    if (this.phaseValue === 'pressed') {
      this.lastX = x
      this.lastY = y
    }
    return this.tick(now)
  }

  tick(now: number): GestureAction[] {
    const actions: GestureAction[] = []
    const elapsed = now - this.pressedAt
    if (this.phaseValue === 'pressed') {
      // Torch wins at its deadline even if the pointer jittered earlier. A drag
      // is only possible before the torch deadline and is decided by the
      // current position, never by a permanent early-move flag.
      if (elapsed >= this.torchDelayMs) {
        this.phaseValue = 'torch'
        actions.push('toggleTorch')
      } else if (elapsed >= this.timingValue.dragDelayMs && this.distanceFromStart() > this.timingValue.slopPx) {
        this.phaseValue = 'dragging'
        actions.push('dragStart')
      }
    }
    if (this.phaseValue === 'torch' && elapsed >= this.gatherDelayMs) {
      this.phaseValue = 'gathering'
      actions.push('gatherStart')
    }
    if (this.phaseValue === 'gathering' && elapsed >= this.closeDelayMs) {
      this.phaseValue = 'closing'
      actions.push('close')
    }
    return actions
  }

  release(now: number): GestureAction[] {
    if (this.phaseValue === 'idle' || this.phaseValue === 'closing') return []
    const actions = this.tick(now)
    if (actions.includes('close')) return actions
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    else if (this.phaseValue === 'gathering') actions.push('gatherStop')
    else if (this.phaseValue === 'pressed' && now - this.pressedAt < this.torchDelayMs) actions.push('click')
    actions.push('release')
    this.phaseValue = 'idle'
    return actions
  }

  cancel(): GestureAction[] {
    if (this.phaseValue === 'idle' || this.phaseValue === 'closing') return []
    const actions: GestureAction[] = []
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    if (this.phaseValue === 'gathering') actions.push('gatherStop')
    this.phaseValue = 'idle'
    return actions
  }

  forceClose(): GestureAction[] {
    if (this.phaseValue === 'closing') return []
    const actions: GestureAction[] = []
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    if (this.phaseValue === 'gathering') actions.push('gatherStop')
    this.phaseValue = 'closing'
    actions.push('close')
    return actions
  }

  reset(): void {
    this.phaseValue = 'idle'
    this.pressedAt = 0
    this.lastX = this.startX
    this.lastY = this.startY
  }

  private distanceFromStart(): number {
    return Math.hypot(this.lastX - this.startX, this.lastY - this.startY)
  }
}

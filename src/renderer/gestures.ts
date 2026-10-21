import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import type { DragFootprint } from '../shared/walk'
import { reboundEase } from '../shared/easing'
import {
  GestureMachine,
  type GestureAction,
  type GesturePhase,
  type GestureTiming
} from '../shared/gesture'
import type { PetAnimator } from './animator'
import type { PetAudio } from './audio'
import type { CharacterHitTest } from './hit-test'

export interface GestureEffects {
  toggleTorch(): void
  startGathering(): void
  stopGathering(): void
  close(): Promise<void>
  /** Called before a new press starts so an active action can yield to the gesture. */
  /** Return true when this press woke the pet, so release does not also pet it. */
  onGestureStart?(): boolean | void
}

export class PetGestures {
  private readonly machine: GestureMachine
  private interactive = false
  private pressSequence = 0
  private activePointerId: number | null = null
  private tweenFrame = 0
  private tweenGeneration = 0
  private cursorPollPending = false
  private clockTimer: number | null = null
  private closePromise: Promise<void> | null = null
  private suppressNextClick = false
  private pressAnchor = { x: 0, y: 0 }
  private pressFootprint: DragFootprint | undefined
  private squashTimer: number | null = null
  private squashedAt = 0
  private readonly unsubscribeSettings: () => void

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewer: SkinViewer,
    private readonly hitTest: CharacterHitTest,
    private readonly animator: PetAnimator,
    private readonly audio: PetAudio,
    private readonly api: PetApi,
    private readonly effects: GestureEffects,
    timing: Partial<GestureTiming> = {}
  ) {
    this.machine = new GestureMachine(timing)
    // Keep longPressMs real even before pet.ts forwards it explicitly. pet.ts may
    // still call setLongPressMs() from applySettings; the result is idempotent.
    void api.getSettings()
      .then((settings) => this.setLongPressMs(settings.longPressMs))
      .catch((error: unknown) => this.api.log(`gesture settings load error: ${String(error)}`))
    this.unsubscribeSettings = api.onSettings((settings) => this.setLongPressMs(settings.longPressMs))
    window.addEventListener('mousemove', (event) => this.updateCursor(event.clientX, event.clientY))
    window.setInterval(() => { this.pollCursor() }, 33)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('lostpointercapture', this.onCaptureLost)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('blur', this.onBlur)
  }

  get isPressed(): boolean { return this.machine.isPressed }
  get isInteractive(): boolean { return this.interactive }
  get isDragging(): boolean { return this.machine.isDragging }
  get isClosing(): boolean { return this.machine.isClosing }
  get gesturePhase(): GesturePhase { return this.machine.phase }
  get longPressMs(): number { return this.machine.timing.longPressMs }
  get timing(): Readonly<GestureTiming> { return this.machine.timing }

  /** Settings.longPressMs -> shared state machine; gather/close are derived from it. */
  setLongPressMs(value: number): void {
    this.machine.setTiming({ longPressMs: value })
    if (this.activePointerId !== null) this.scheduleClock()
  }

  setTiming(timing: Partial<GestureTiming>): void {
    this.machine.setTiming(timing)
    if (this.activePointerId !== null) this.scheduleClock()
  }

  dispose(): void {
    this.unsubscribeSettings()
    this.clearClockTimers()
    this.stopTween()
    this.clearSquashTimer()
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
  }

  forceClose(): Promise<void> {
    this.apply(this.machine.forceClose())
    return this.closePromise ?? Promise.resolve()
  }

  resetAfterRestore(): void {
    this.clearSquashTimer()
    this.clearClockTimers()
    this.machine.reset()
    this.activePointerId = null
    this.closePromise = null
    this.suppressNextClick = false
    this.stopTween()
    this.setScale(1, 1)
    this.animator.setDragging(false)
    this.setInteractive(false)
  }

  private setInteractive(value: boolean): void {
    const next = this.machine.isClosing ? false : value
    if (this.interactive === next) return
    this.interactive = next
    this.api.setInteractive(next)
    this.api.log(`renderer interactive -> ${next}`)
  }

  private updateCursor(clientX: number, clientY: number): void {
    this.animator.setCursor(clientX, clientY)
    this.setInteractive(this.machine.isPressed || this.hitTest.hit(clientX, clientY))
  }

  // Forwarded mousemove is the fast path. Polling recovers from Windows/Electron
  // combinations that stop forwarding moves while the window is click-through.
  private pollCursor(): void {
    if (this.cursorPollPending || this.machine.isClosing) return
    this.cursorPollPending = true
    void this.api.getCursorPoint()
      .then((point) => this.updateCursor(point.x, point.y))
      .catch((error: unknown) => this.api.log(`cursor poll error: ${String(error)}`))
      .finally(() => { this.cursorPollPending = false })
  }

  private setScale(scaleX: number, scaleY: number): void {
    this.viewer.playerObject.scale.set(scaleX, scaleY, 1)
    // M0 verified this offset keeps the outer skin's feet planted while squashed.
    this.viewer.playerObject.position.y = -16.25 * (1 - scaleY)
  }

  private stopTween(): void {
    this.tweenGeneration += 1
    if (this.tweenFrame !== 0) cancelAnimationFrame(this.tweenFrame)
    this.tweenFrame = 0
  }

  private clearSquashTimer(): void {
    if (this.squashTimer !== null) window.clearTimeout(this.squashTimer)
    this.squashTimer = null
  }

  private squash(): void {
    this.stopTween()
    this.setScale(1.05, 0.88)
    this.squashedAt = performance.now()
  }

  private rebound(): void {
    this.stopTween()
    const generation = this.tweenGeneration
    const start = performance.now()
    const fromX = this.viewer.playerObject.scale.x
    const fromY = this.viewer.playerObject.scale.y
    const frame = (now: number): void => {
      if (generation !== this.tweenGeneration) return
      const elapsed = Math.min(1, (now - start) / 220)
      const ease = reboundEase(elapsed)
      this.setScale(fromX + (1 - fromX) * ease, fromY + (1 - fromY) * ease)
      if (elapsed < 1) this.tweenFrame = requestAnimationFrame(frame)
      else this.tweenFrame = 0
    }
    this.tweenFrame = requestAnimationFrame(frame)
  }

  private scheduleClock(): void {
    this.clearClockTimers()
    this.scheduleNextClock()
  }

  /**
   * One timeout chain driven by GestureMachine.nextDeadline(). The short drag
   * gate, longPressMs, gather offset and close offset all come from the shared
   * state machine; this file no longer duplicates 1500/2400/3000.
   */
  private scheduleNextClock(): void {
    if (this.clockTimer !== null) return
    const now = performance.now()
    const deadline = this.machine.nextDeadline(now)
    if (deadline === null) return
    const sequence = this.pressSequence
    const delay = Math.max(0, deadline - now)
    this.clockTimer = window.setTimeout(() => {
      this.clockTimer = null
      if (sequence !== this.pressSequence) return
      this.apply(this.machine.tick(performance.now()))
      if (this.activePointerId !== null && !this.machine.isClosing) this.scheduleNextClock()
    }, delay)
  }

  private clearClockTimers(): void {
    if (this.clockTimer !== null) window.clearTimeout(this.clockTimer)
    this.clockTimer = null
  }

  private apply(actions: readonly GestureAction[]): void {
    for (const action of actions) {
      switch (action) {
        case 'press':
          // A quick drag should not first push the head down by 12%. Stationary
          // presses keep the squash feedback, and short clicks pulse on release.
          this.clearSquashTimer()
          this.squashedAt = 0
          this.squashTimer = window.setTimeout(() => {
            this.squashTimer = null
            if (this.machine.phase === 'pressed') this.squash()
          }, 100)
          this.audio.press()
          this.api.log('press')
          break
        case 'click':
          if (this.squashedAt === 0) this.squash()
          if (!this.suppressNextClick) {
            this.animator.pet()
            this.api.log('pet reaction')
          } else {
            this.api.log('wake by click')
          }
          this.suppressNextClick = false
          break
        case 'dragStart':
          this.clearClockTimers()
          this.clearSquashTimer()
          this.rebound()
          this.animator.setDragging(true)
          this.api.startDrag(this.pressFootprint, this.pressAnchor)
          this.api.log('drag started')
          break
        case 'dragEnd':
          this.api.endDrag()
          this.animator.setDragging(false)
          this.animator.land()
          this.api.log('drag ended')
          break
        case 'toggleTorch':
          this.effects.toggleTorch()
          this.api.log('torch toggled by hold')
          break
        case 'gatherStart':
          this.effects.startGathering()
          this.api.log('close gathering')
          break
        case 'gatherStop':
          this.effects.stopGathering()
          this.api.log('close gathering cancelled')
          break
        case 'close':
          this.clearClockTimers()
          this.clearSquashTimer()
          this.setInteractive(false)
          this.stopTween()
          this.closePromise = this.effects.close().catch((error: unknown) => {
            this.api.log(`close effect error: ${String(error)}`)
          })
          this.api.log('close burst')
          break
        case 'release':
          this.suppressNextClick = false
          this.audio.release()
          this.api.log('release')
          break
      }
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.hitTest.hit(event.clientX, event.clientY)) return
    const now = performance.now()
    const actions = this.machine.press(now, event.screenX, event.screenY)
    if (actions.length === 0) return
    // CSS pixels match Electron DIP; screenX can use different coordinate spaces
    // on mixed-DPI monitors, so it is used only for the small movement threshold.
    this.pressAnchor = { x: event.clientX, y: event.clientY }
    this.pressFootprint = this.hitTest.dragFootprint() ?? undefined
    void this.api.stopWalk()
    // Gesture priority: an active renderer action yields before the press starts.
    this.suppressNextClick = this.effects.onGestureStart?.() === true
    event.preventDefault()
    this.activePointerId = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    this.pressSequence += 1
    this.setInteractive(true)
    this.apply(actions)
    this.scheduleClock()
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    // The transparent canvas has no browser menu. Open settings only when the
    // actual visible skin is under the right-click, using the same raycast as
    // left-click and mouse pass-through.
    event.preventDefault()
    if (event.button !== 2 || this.machine.isClosing || !this.hitTest.hit(event.clientX, event.clientY)) return
    this.api.openSettings()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.updateCursor(event.clientX, event.clientY)
    if (event.pointerId === this.activePointerId) {
      this.apply(this.machine.move(performance.now(), event.screenX, event.screenY))
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.release(true)
  }
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.release(false)
  }
  private readonly onCaptureLost = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) this.release(false)
  }
  private readonly onBlur = (): void => { this.release(false) }

  private release(complete: boolean): void {
    if (this.activePointerId === null) return
    const pointerId = this.activePointerId
    this.activePointerId = null
    this.clearClockTimers()
    this.clearSquashTimer()
    this.apply(complete ? this.machine.release(performance.now()) : this.machine.cancel())
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId)
    if (this.machine.isClosing) return
    const remaining = this.squashedAt === 0 ? 0 : Math.max(0, 32 - (performance.now() - this.squashedAt))
    const sequence = this.pressSequence
    window.setTimeout(() => {
      if (!this.machine.isPressed && sequence === this.pressSequence) this.rebound()
    }, remaining)
  }
}

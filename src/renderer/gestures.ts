import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import { reboundEase } from '../shared/easing'
import { GestureMachine, type GestureAction, type GesturePhase } from '../shared/gesture'
import type { PetAnimator } from './animator'
import type { PetAudio } from './audio'
import type { CharacterHitTest } from './hit-test'

export interface GestureEffects {
  toggleTorch(): void
  startGathering(): void
  stopGathering(): void
  close(): Promise<void>
}

export class PetGestures {
  private readonly machine = new GestureMachine()
  private interactive = false
  private pressStartedAt = 0
  private pressSequence = 0
  private activePointerId: number | null = null
  private tweenFrame = 0
  private tweenGeneration = 0
  private cursorPollPending = false
  private clockTimers: number[] = []
  private closePromise: Promise<void> | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewer: SkinViewer,
    private readonly hitTest: CharacterHitTest,
    private readonly animator: PetAnimator,
    private readonly audio: PetAudio,
    private readonly api: PetApi,
    private readonly effects: GestureEffects
  ) {
    window.addEventListener('mousemove', (event) => this.updateCursor(event.clientX, event.clientY))
    window.setInterval(() => { this.pollCursor() }, 33)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('lostpointercapture', this.onCaptureLost)
    window.addEventListener('blur', this.onBlur)
  }

  get isPressed(): boolean { return this.machine.isPressed }
  get isInteractive(): boolean { return this.interactive }
  get isDragging(): boolean { return this.machine.isDragging }
  get isClosing(): boolean { return this.machine.isClosing }
  get gesturePhase(): GesturePhase { return this.machine.phase }

  forceClose(): Promise<void> {
    this.apply(this.machine.forceClose())
    return this.closePromise ?? Promise.resolve()
  }

  resetAfterRestore(): void {
    this.clearClockTimers()
    this.machine.reset()
    this.activePointerId = null
    this.closePromise = null
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
    const sequence = this.pressSequence
    for (const deadline of [1500, 2400, 3000]) {
      const timer = window.setTimeout(() => {
        if (sequence === this.pressSequence) this.apply(this.machine.tick(performance.now()))
      }, deadline)
      this.clockTimers.push(timer)
    }
  }

  private clearClockTimers(): void {
    for (const timer of this.clockTimers) window.clearTimeout(timer)
    this.clockTimers = []
  }

  private apply(actions: readonly GestureAction[]): void {
    for (const action of actions) {
      switch (action) {
        case 'press':
          this.stopTween()
          this.setScale(1.05, 0.88)
          this.audio.press()
          this.api.log('press')
          break
        case 'click':
          this.animator.pet()
          this.api.log('pet reaction')
          break
        case 'dragStart':
          this.clearClockTimers()
          this.animator.setDragging(true)
          this.api.startDrag()
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
          this.setInteractive(false)
          this.stopTween()
          this.closePromise = this.effects.close().catch((error: unknown) => {
            this.api.log(`close effect error: ${String(error)}`)
          })
          this.api.log('close burst')
          break
        case 'release':
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
    event.preventDefault()
    this.activePointerId = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    this.pressSequence += 1
    this.pressStartedAt = now
    this.setInteractive(true)
    this.apply(actions)
    this.scheduleClock()
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
    this.apply(complete ? this.machine.release(performance.now()) : this.machine.cancel())
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId)
    if (this.machine.isClosing) return
    const remaining = Math.max(0, 32 - (performance.now() - this.pressStartedAt))
    const sequence = this.pressSequence
    window.setTimeout(() => {
      if (!this.machine.isPressed && sequence === this.pressSequence) this.rebound()
    }, remaining)
  }
}

import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import { reboundEase } from '../shared/easing'
import type { PetAnimator } from './animator'
import type { PetAudio } from './audio'
import type { CharacterHitTest } from './hit-test'

/** M1 pointer input: click only. Long press and drag are reserved for later milestones. */
export class PetGestures {
  private interactive = false
  private pressed = false
  private pressStartedAt = 0
  private pressSequence = 0
  private tweenFrame = 0
  private tweenGeneration = 0
  private cursorPollPending = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewer: SkinViewer,
    private readonly hitTest: CharacterHitTest,
    private readonly animator: PetAnimator,
    private readonly audio: PetAudio,
    private readonly api: PetApi
  ) {
    window.addEventListener('mousemove', (event) => this.updateCursor(event.clientX, event.clientY))
    window.setInterval(() => { this.pollCursor() }, 33)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('blur', this.onBlur)
  }

  get isPressed(): boolean { return this.pressed }
  get isInteractive(): boolean { return this.interactive }

  private setInteractive(next: boolean): void {
    if (this.interactive === next) return
    this.interactive = next
    this.api.setInteractive(next)
    this.api.log(`renderer interactive -> ${next}`)
  }

  private updateCursor(clientX: number, clientY: number): void {
    this.animator.setCursor(clientX, clientY)
    this.setInteractive(this.pressed || this.hitTest.hit(clientX, clientY))
  }

  // Forwarded mousemove is the fast path. Polling recovers from Windows/Electron
  // combinations that stop forwarding moves while the window is click-through.
  private pollCursor(): void {
    if (this.cursorPollPending) return
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

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.hitTest.hit(event.clientX, event.clientY)) return
    event.preventDefault()
    this.canvas.setPointerCapture(event.pointerId)
    this.pressed = true
    this.pressSequence += 1
    this.pressStartedAt = performance.now()
    this.setInteractive(true)
    this.stopTween()
    this.setScale(1.05, 0.88)
    this.audio.press()
    this.api.log('press')
  }

  private readonly onPointerUp = (): void => { this.release(true) }
  private readonly onPointerCancel = (): void => { this.release(false) }
  private readonly onBlur = (): void => { this.release(false) }

  private release(completeClick: boolean): void {
    if (!this.pressed) return
    this.pressed = false
    if (completeClick) {
      this.audio.release()
      this.animator.pet()
      this.api.log('pet reaction')
    }
    this.api.log('release')
    const remaining = Math.max(0, 32 - (performance.now() - this.pressStartedAt))
    const sequence = this.pressSequence
    window.setTimeout(() => {
      if (!this.pressed && sequence === this.pressSequence) this.rebound()
    }, remaining)
  }
}

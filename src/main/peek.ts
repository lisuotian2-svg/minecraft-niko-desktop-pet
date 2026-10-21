import { screen, type Display } from 'electron'
import {
  EMPTY_FULLSCREEN_STATE,
  type Bounds,
  type FullscreenState,
  type PeekEdge,
  type PeekPhase
} from '../shared/contracts'
import {
  PEEK_POST_REVEAL_DELAY_MS,
  PEEK_REVEAL_MS,
  createPeekPlacement,
  enterProgress,
  leaveProgress,
  nextPeekIntervalMs,
  peekBoundsAt,
  peekHoldMs,
  pickPeekEdge,
  type PeekPlacement
} from '../shared/peek'
import type { DetectorState } from './fullscreen'
import type { Logger } from './logger'
import { PET_WINDOW_SIZE, type PetWindowController } from './pet-window'

/**
 * Owns the fullscreen peek schedule and the pet window position on an edge.
 * The renderer owns the head-only pose; this controller only emits the frozen
 * FullscreenState contract and moves the transparent window.
 *
 * Interaction rules from P0-1 / user decisions:
 * - only current fullscreen display is used;
 * - edges are bottom/left/right, chosen randomly;
 * - 20-45 s between peeks, 4-8 s revealed;
 * - clicking the head restores the normal bottom window for 10 s, then peeks
 *   again if the display is still fullscreen;
 * - tray hide, drag and close pause/suspend the peek cycle.
 */

export interface PeekControllerOptions {
  pet: PetWindowController
  logger: Logger
  sendState: (state: FullscreenState) => void
  random?: () => number
  now?: () => number
}

interface DisplayLike {
  id: number
  bounds: Bounds
  workArea: Bounds
  scaleFactor: number
}

function toBounds(rect: Electron.Rectangle): Bounds {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function displayBounds(display: Display | DisplayLike): Bounds {
  return toBounds(display.bounds)
}

export class PeekController {
  private readonly pet: PetWindowController
  private readonly logger: Logger
  private readonly send: (state: FullscreenState) => void
  private readonly random: () => number
  private readonly now: () => number
  private enabled = true
  private active = false
  private displayId: number | null = null
  private edge: PeekEdge = 'bottom'
  private phase: PeekPhase = 'idle'
  private placement: PeekPlacement | null = null
  private windowSize = PET_WINDOW_SIZE
  private currentBounds: Bounds | null = null
  private revealUntil: number | null = null
  private lastSentKey = ''
  private nextTimer: ReturnType<typeof setTimeout> | null = null
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private revealTimer: ReturnType<typeof setTimeout> | null = null
  private animationTimer: ReturnType<typeof setInterval> | null = null
  private superviseTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(options: PeekControllerOptions) {
    this.pet = options.pet
    this.logger = options.logger
    this.send = options.sendState
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
    const bounds = this.pet.getBounds()
    if (bounds) {
      this.windowSize = bounds.width
      this.currentBounds = toBounds(bounds)
    }
    this.superviseTimer = setInterval(() => this.supervise(), 200)
    screen.on('display-added', this.onDisplayChange)
    screen.on('display-removed', this.onDisplayChange)
    screen.on('display-metrics-changed', this.onDisplayChange)
  }

  /** Called by FullscreenDetector on every debounced detection change. */
  setDetectorState(state: DetectorState): void {
    if (this.disposed) return
    if (!this.enabled) {
      if (this.active) this.exitFullscreen()
      return
    }
    if (!state.active) {
      if (this.active) this.exitFullscreen()
      return
    }
    const target = this.resolveDisplay(state.displayId)
    if (!target) {
      this.logger.warn('fullscreen active but no matching Electron display; returning to normal')
      this.exitFullscreen()
      return
    }
    if (this.active && this.displayId === target.id) return
    if (this.active) {
      this.retarget(target)
      return
    }
    this.enterFullscreen(target)
  }

  /** User clicked the head-only pose (pet:peek-reveal). */
  reveal(): void {
    if (!this.active || this.disposed) return
    if (this.phase !== 'peeking' && this.phase !== 'revealed') return
    if (!this.pet.isVisible() || this.pet.isClosing()) return
    this.clearPeekTimers()
    this.phase = 'returning'
    this.revealUntil = this.now() + PEEK_REVEAL_MS
    const display = this.currentDisplay()
    this.pet.endPeek(display ? this.normalBoundsFor(display) : undefined)
    this.currentBounds = this.currentPetBounds()
    this.logger.info(`peek revealed by click; normal for ${PEEK_REVEAL_MS / 1000}s`)
    this.sendCurrent()
    this.revealTimer = setTimeout(() => this.finishReveal(), PEEK_REVEAL_MS)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && this.active) this.exitFullscreen()
  }

  getState(): FullscreenState {
    if (!this.active) return { ...EMPTY_FULLSCREEN_STATE }
    return {
      active: true,
      displayId: this.displayId,
      edge: this.edge,
      phase: this.phase,
      windowBounds: this.currentBounds,
      headAnchor: { x: Math.round(this.windowSize / 2), y: Math.round(this.windowSize / 2) },
      revealUntil: this.revealUntil
    }
  }

  refreshDisplays(): void {
    if (!this.active) return
    const display = this.currentDisplay()
    if (!display) {
      this.logger.warn('peek display disappeared; returning to normal')
      this.exitFullscreen()
      return
    }
    if (this.phase === 'peeking' || this.phase === 'revealed') {
      this.cancelPeek()
      this.enterHidden(display)
      return
    }
    if (this.phase === 'hidden') {
      this.enterHidden(display)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.active = false
    this.clearPeekTimers()
    if (this.superviseTimer) clearInterval(this.superviseTimer)
    this.superviseTimer = null
    screen.removeListener('display-added', this.onDisplayChange)
    screen.removeListener('display-removed', this.onDisplayChange)
    screen.removeListener('display-metrics-changed', this.onDisplayChange)
  }

  private enterFullscreen(display: Display | DisplayLike): void {
    this.active = true
    this.displayId = display.id
    this.edge = pickPeekEdge(this.random)
    this.revealUntil = null
    this.windowSize = this.pet.getBounds()?.width ?? this.windowSize
    this.placement = createPeekPlacement(this.edge, displayBounds(display), this.windowSize, this.random)
    this.currentBounds = this.placement.hidden
    if (this.pet.beginPeek()) {
      this.phase = 'hidden'
      this.pet.moveForPeek(this.placement.hidden)
      this.sendCurrent()
      this.scheduleNext()
      this.logger.info(`peek fullscreen display=${display.id}; next peek in 20-45s`)
      return
    }
    // The pet is hidden/closing/dragging. Keep the fullscreen state and wait
    // for the supervisor; do not force a hidden window to appear.
    this.phase = 'hidden'
    this.sendCurrent()
    this.logger.info(`peek pending until pet is visible (display=${display.id})`)
  }

  private retarget(display: Display | DisplayLike): void {
    this.cancelPeek()
    this.displayId = display.id
    this.edge = pickPeekEdge(this.random)
    this.placement = createPeekPlacement(this.edge, displayBounds(display), this.windowSize, this.random)
    this.enterHidden(display)
    this.logger.info(`peek retargeted to display=${display.id}`)
  }

  private exitFullscreen(): void {
    this.clearPeekTimers()
    const display = this.currentDisplay()
    this.active = false
    this.displayId = null
    this.placement = null
    this.revealUntil = null
    this.phase = 'idle'
    if (this.pet.isPeeking() && !this.pet.isClosing()) {
      this.pet.endPeek(display ? this.normalBoundsFor(display) : undefined)
    }
    this.currentBounds = this.currentPetBounds()
    this.sendCurrent()
    this.logger.info('peek fullscreen ended; normal bottom restored')
  }

  private enterHidden(display: Display | DisplayLike): void {
    if (!this.active || !this.pet.isVisible() || this.pet.isClosing()) return
    if (!this.pet.isPeeking() && !this.pet.beginPeek()) return
    this.windowSize = this.pet.getBounds()?.width ?? this.windowSize
    this.placement = createPeekPlacement(this.edge, displayBounds(display), this.windowSize, this.random)
    this.phase = 'hidden'
    this.revealUntil = null
    this.currentBounds = this.placement.hidden
    this.pet.moveForPeek(this.placement.hidden)
    this.sendCurrent()
    this.scheduleNext()
  }

  private scheduleNext(delayMs = nextPeekIntervalMs(this.random)): void {
    this.clearNextTimer()
    if (!this.active || !this.pet.isVisible() || this.pet.isClosing() || this.phase !== 'hidden') return
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null
      this.startPeek()
    }, delayMs)
  }

  private startPeek(): void {
    if (!this.active || this.disposed || !this.pet.isVisible() || this.pet.isClosing() || this.phase !== 'hidden') return
    const display = this.currentDisplay()
    if (!display) {
      this.exitFullscreen()
      return
    }
    if (!this.pet.isPeeking()) {
      if (!this.pet.beginPeek()) return
    }
    this.windowSize = this.pet.getBounds()?.width ?? this.windowSize
    this.edge = pickPeekEdge(this.random)
    this.placement = createPeekPlacement(this.edge, displayBounds(display), this.windowSize, this.random)
    this.phase = 'peeking'
    this.pet.moveForPeek(this.placement.hidden)
    this.currentBounds = this.placement.hidden
    this.sendCurrent()
    const startedAt = this.now()
    this.clearAnimation()
    this.animationTimer = setInterval(() => {
      if (!this.active || !this.pet.isVisible() || this.pet.isClosing() || this.phase !== 'peeking') {
        this.clearAnimation()
        return
      }
      const progress = enterProgress(this.now() - startedAt)
      if (this.placement) {
        this.currentBounds = peekBoundsAt(this.placement, progress)
        this.pet.moveForPeek(this.currentBounds)
      }
      if (progress >= 1) {
        this.clearAnimation()
        this.phase = 'revealed'
        this.sendCurrent()
        this.holdTimer = setTimeout(() => this.retract(), peekHoldMs(this.random))
      }
    }, 16)
    this.logger.info(`peek enter edge=${this.edge} display=${display.id}`)
  }

  private retract(): void {
    if (!this.active || this.disposed || this.phase !== 'revealed' || !this.placement) return
    this.clearHoldTimer()
    this.phase = 'returning'
    this.sendCurrent()
    const startedAt = this.now()
    this.clearAnimation()
    this.animationTimer = setInterval(() => {
      if (!this.active || !this.pet.isVisible() || this.pet.isClosing() || this.phase !== 'returning') {
        this.clearAnimation()
        return
      }
      const progress = leaveProgress(this.now() - startedAt)
      if (this.placement) {
        this.currentBounds = peekBoundsAt(this.placement, progress)
        this.pet.moveForPeek(this.currentBounds)
      }
      if (progress <= 0.001) {
        this.clearAnimation()
        this.phase = 'hidden'
        if (this.placement) {
          this.currentBounds = this.placement.hidden
          this.pet.moveForPeek(this.placement.hidden)
        }
        this.sendCurrent()
        this.scheduleNext()
      }
    }, 16)
    this.logger.info('peek retract')
  }

  private finishReveal(): void {
    this.revealTimer = null
    this.revealUntil = null
    if (!this.active || this.disposed) return
    if (!this.pet.isVisible() || this.pet.isClosing() || this.pet.isDragging()) {
      this.phase = 'hidden'
      this.currentBounds = this.currentPetBounds()
      this.sendCurrent()
      return
    }
    if (!this.pet.isPeeking()) {
      if (!this.pet.beginPeek()) {
        this.phase = 'hidden'
        this.sendCurrent()
        return
      }
    }
    const display = this.currentDisplay()
    if (!display) {
      this.exitFullscreen()
      return
    }
    this.windowSize = this.pet.getBounds()?.width ?? this.windowSize
    this.edge = pickPeekEdge(this.random)
    this.placement = createPeekPlacement(this.edge, displayBounds(display), this.windowSize, this.random)
    this.phase = 'hidden'
    this.currentBounds = this.placement.hidden
    this.pet.moveForPeek(this.placement.hidden)
    this.sendCurrent()
    this.scheduleNext(PEEK_POST_REVEAL_DELAY_MS)
    this.logger.info('peek resumed after 10s reveal')
  }

  private supervise(): void {
    if (this.disposed || !this.enabled || !this.active) return
    if (this.pet.isClosing()) {
      this.clearPeekTimers()
      return
    }
    // A drag can only start after reveal/normal; keep the reveal timer running
    // so the 10 s window still ends (finishReveal defers while dragging).
    if (this.pet.isDragging()) return
    if (!this.pet.isVisible()) {
      this.clearPeekTimers()
      this.clearAnimation()
      this.revealUntil = null
      if (this.phase !== 'hidden') {
        this.phase = 'hidden'
        this.currentBounds = this.currentPetBounds()
        this.sendCurrent()
      }
      return
    }
    if (this.pet.isPeeking()) {
      if (this.phase === 'hidden' && this.nextTimer === null && this.revealUntil === null) this.scheduleNext()
      return
    }
    // The pet is visible in normal mode while fullscreen is still active. This
    // happens after tray show, drag/close restore, or an external show. Give the
    // user a 10 s normal window before hiding to the edge again.
    if (this.phase !== 'returning' && this.revealUntil === null) {
      this.phase = 'returning'
      this.revealUntil = this.now() + PEEK_REVEAL_MS
      this.currentBounds = this.currentPetBounds()
      this.sendCurrent()
      this.revealTimer = setTimeout(() => this.finishReveal(), PEEK_REVEAL_MS)
      this.logger.info('peek paused: pet shown normally for 10s')
    }
  }

  private currentDisplay(): Display | null {
    if (this.displayId === null) return null
    return screen.getAllDisplays().find((display) => display.id === this.displayId) ?? null
  }

  private resolveDisplay(displayId: number | null): Display | null {
    const displays = screen.getAllDisplays()
    if (displays.length === 0) return null
    if (displayId !== null) {
      const found = displays.find((display) => display.id === displayId)
      if (found) return found
    }
    const primary = screen.getPrimaryDisplay()
    this.logger.warn(`peek display ${String(displayId)} not found; using primary ${primary.id}`)
    return primary
  }

  private currentPetBounds(): Bounds | null {
    const bounds = this.pet.getBounds()
    return bounds ? toBounds(bounds) : null
  }

  /** Normal taskbar bounds on the display currently showing fullscreen. */
  private normalBoundsFor(display: Display | DisplayLike): Bounds {
    const area = display.workArea
    const size = Math.max(1, this.windowSize)
    return {
      x: Math.round(area.x + Math.max(0, (area.width - size) / 2)),
      y: Math.round(Math.max(area.y, area.y + area.height - size)),
      width: size,
      height: size
    }
  }

  private clearNextTimer(): void {
    if (this.nextTimer) clearTimeout(this.nextTimer)
    this.nextTimer = null
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.holdTimer = null
  }

  private clearRevealTimer(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer)
    this.revealTimer = null
  }

  private clearAnimation(): void {
    if (this.animationTimer) clearInterval(this.animationTimer)
    this.animationTimer = null
  }

  private clearPeekTimers(): void {
    this.clearNextTimer()
    this.clearHoldTimer()
    this.clearRevealTimer()
    this.clearAnimation()
  }

  private cancelPeek(): void {
    this.clearPeekTimers()
    this.phase = 'hidden'
    this.revealUntil = null
  }

  private sendCurrent(): void {
    if (this.disposed) return
    const state = this.getState()
    const key = JSON.stringify(state)
    if (key === this.lastSentKey) return
    this.lastSentKey = key
    try {
      this.send(state)
    } catch (error: unknown) {
      this.logger.warn(`peek state send failed: ${String(error)}`)
    }
  }

  private readonly onDisplayChange = (): void => {
    this.logger.info('display change observed by peek controller')
    this.refreshDisplays()
  }
}

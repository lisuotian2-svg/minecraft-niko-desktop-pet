import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { DragEdgePush, dragPosition, isPetOnAnyDisplay, isUsableDragCoordinate } from '../shared/drag'
import {
  bottomWindowY,
  clampDragPosition,
  clampWindowX,
  nextWalkDelayMs,
  roundWindowCoordinate,
  stepWalk,
  walkDurationMs,
  walkSpeed,
  type WalkDirection,
  type WalkArea,
  type DragFootprint
} from '../shared/walk'
import type { Logger } from './logger'
import type { WalkFrequency } from '../shared/settings'

export const PET_WINDOW_SIZE = 420

export interface CloseScene {
  width: number
  height: number
  originX: number
  originY: number
}

export class PetWindowController {
  private win: BrowserWindow | null = null
  private interactive = false
  private timer: ReturnType<typeof setInterval> | null = null
  private x = 0
  private y = 0
  private manuallyPlaced = false
  private footprintRatio: DragFootprint | null = null
  private direction: WalkDirection = 1
  private walking = false
  private nextWalkAt = 0
  private walkEndAt = 0
  private lastTickAt = 0
  private pauseStartedAt = 0
  private quitting = false
  private requestedPetSize: number
  private windowSize = PET_WINDOW_SIZE
  private dragging = false
  private dragTimer: ReturnType<typeof setInterval> | null = null
  private dragOffset = { x: 0, y: 0 }
  private dragEdgePush = new DragEdgePush()
  private lastDragWarnAt = 0
  private closing = false
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private closeScene: CloseScene | null = null
  private compactBounds: Electron.Rectangle | null = null
  private restorationPending = false
  private peeking = false
  private peekRestoreBounds: Electron.Rectangle | null = null
  private resizeSuppressUntil = 0
  private lastResizeWarnAt = 0
  private walkPaused = false
  private walkEnabled = true
  private walkFrequency: WalkFrequency = 'normal'
  private walkSpeedMultiplier = 1
  private opacity = 1

  constructor(private readonly logger: Logger, petSize = 220, private readonly startHidden = false) {
    this.requestedPetSize = petSize
  }

  create(): BrowserWindow {
    const area = screen.getPrimaryDisplay().workArea
    this.windowSize = sizeForArea(this.requestedPetSize, area)
    this.x = roundWindowCoordinate(area.x + (area.width - this.windowSize) / 2)
    this.y = bottomWindowY(area, this.windowSize)
    this.win = new BrowserWindow({
      width: this.windowSize,
      height: this.windowSize,
      x: this.x,
      y: this.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      show: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    const win = this.win
    win.setOpacity(this.opacity)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    this.logger.info('pet window created; interactive=false')
    win.webContents.once('did-finish-load', () => {
      this.logger.info('pet renderer loaded')
      if (!win.isDestroyed()) {
        if (!this.startHidden) win.showInactive()
        this.sendWalkingState()
        // Renderer listeners can attach slightly after did-finish-load on some builds.
        setTimeout(() => {
          if (!win.isDestroyed() && this.walking) this.sendWalkingState()
        }, 400)
      }
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      this.logger.error(`pet renderer load failed (${code}): ${description}`)
    })
    // A renderer reload can discard pointer capture before it sends drag:end.
    // Settle the native window immediately so it does not keep following the cursor.
    win.webContents.on('did-start-loading', () => {
      if (this.dragging) this.endDrag()
    })
    win.webContents.on('render-process-gone', () => {
      if (this.dragging) this.endDrag()
    })
    win.on('close', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.hide()
    })
    win.on('closed', () => {
      this.win = null
      this.interactive = false
      this.stopDragTimer()
      this.clearCloseTimer()
      this.stopTimer()
    })
    win.on('show', () => {
      this.resume()
      if (this.restorationPending) {
        this.restorationPending = false
        win.webContents.send('pet:restored')
      }
    })
    win.on('hide', () => this.pause())
    // Guard against OS/DPI feedback resizing the transparent window horizontally.
    // Windows can round DIP bounds by 1-2 px at 125%/150% scaling. A strict
    // comparison plus an immediate setBounds created a 30-50 events/second
    // self-excitation loop (audit PLT-01). Keep a tolerance, ignore the resize
    // events caused by our own setBounds, and never correct while peeking,
    // dragging or closing.
    win.on('resize', () => {
      if (this.closing || this.dragging || this.peeking) return
      const now = Date.now()
      if (now < this.resizeSuppressUntil) return
      const bounds = win.getBounds()
      const widthDelta = Math.abs(bounds.width - this.windowSize)
      const heightDelta = Math.abs(bounds.height - this.windowSize)
      if (widthDelta <= 2 && heightDelta <= 2) return
      if (now - this.lastResizeWarnAt >= 1000) {
        this.lastResizeWarnAt = now
        this.logger.warn(`pet resize guard: ${bounds.width}x${bounds.height} -> ${this.windowSize}`)
      }
      this.resizeSuppressUntil = now + 250
      win.setBounds({
        x: bounds.x,
        y: this.manuallyPlaced ? bounds.y : bottomWindowY(screen.getDisplayMatching(bounds).workArea, this.windowSize),
        width: this.windowSize,
        height: this.windowSize
      }, false)
    })

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    const debug = !app.isPackaged && process.argv.includes('--debug-walk')
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      if (debug) url.searchParams.set('nikoDebug', '1')
      void win.loadURL(url.href)
    } else {
      void win.loadFile(
        join(__dirname, '../renderer/index.html'),
        debug ? { query: { nikoDebug: '1' } } : undefined
      )
    }

    this.lastTickAt = performance.now()
    this.nextWalkAt = this.lastTickAt + this.nextWalkDelay()
    this.timer = setInterval(() => this.tick(), 1000 / 30)
    return win
  }

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  show(): void {
    const win = this.getWindow()
    if (!win) return
    if (this.closing) this.finishClose()
    if (this.peeking) this.endPeek()
    this.reconcileDisplay()
    win.showInactive()
  }

  hide(): void {
    if (this.closing) {
      this.finishClose()
      return
    }
    if (this.dragging) this.endDrag()
    this.getWindow()?.hide()
  }

  isVisible(): boolean {
    return this.getWindow()?.isVisible() ?? false
  }

  setOpacity(value: number): void {
    this.opacity = Math.max(0.3, Math.min(1, value))
    this.getWindow()?.setOpacity(this.opacity)
  }

  isPeeking(): boolean {
    return this.peeking
  }

  isDragging(): boolean {
    return this.dragging
  }

  isClosing(): boolean {
    return this.closing
  }

  isWalkPaused(): boolean {
    return this.walkPaused
  }

  setWalkingPreferences(enabled: boolean, frequency: WalkFrequency, speedMultiplier: number): void {
    const changed = this.walkEnabled !== enabled || this.walkFrequency !== frequency
    this.walkEnabled = enabled
    this.walkFrequency = frequency
    this.walkSpeedMultiplier = speedMultiplier
    if (!enabled && this.walking) this.stopWalk()
    if (changed) this.nextWalkAt = performance.now() + this.nextWalkDelay()
  }

  private nextWalkDelay(): number { return nextWalkDelayMs(Math.random, this.walkFrequency) }

  /**
   * Pause/resume automatic walking without touching window visibility, drag or
   * peek placement. Pausing stops the current walk and keeps the pet in place;
   * resuming schedules the next lazy walk. Drag/peek timers are unaffected.
   */
  setWalkPaused(paused: boolean): void {
    if (this.walkPaused === paused) return
    this.walkPaused = paused
    if (paused) {
      this.stopWalk()
      this.logger.info('pet walking paused')
    } else {
      this.lastTickAt = performance.now()
      this.nextWalkAt = performance.now() + this.nextWalkDelay()
      this.logger.info('pet walking resumed')
    }
  }

  getBounds(): Electron.Rectangle | null {
    return this.getWindow()?.getBounds() ?? null
  }

  /**
   * Switch the window into edge-peek mode. The caller (PeekController) owns
   * placement; this method only stops walking and remembers the normal bounds
   * so endPeek() can restore the taskbar position.
   */
  beginPeek(): boolean {
    const win = this.getWindow()
    if (!win || !win.isVisible() || this.peeking || this.dragging || this.closing) return false
    this.stopWalk()
    this.peekRestoreBounds = win.getBounds()
    this.peeking = true
    // A focusable always-on-top window would make the foreground watcher see
    // our own Electron process after a head click. Keep the peek window
    // non-activating so the fullscreen app remains the foreground window; the
    // pointer/hit-test path still needs real-machine confirmation.
    win.setFocusable(false)
    this.logger.info('pet peek mode entered')
    return true
  }

  moveForPeek(bounds: Electron.Rectangle): void {
    const win = this.getWindow()
    if (!win || !this.peeking || this.closing) return
    this.applyBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    })
  }

  /** Restore the normal compact taskbar window after a peek or reveal. */
  endPeek(targetBounds?: Electron.Rectangle): void {
    if (!this.peeking) return
    this.peeking = false
    const win = this.getWindow()
    win?.setFocusable(true)
    const restore = targetBounds ?? this.peekRestoreBounds
    this.peekRestoreBounds = null
    if (win && restore) {
      this.x = restore.x
      this.y = restore.y
      this.windowSize = restore.width
      this.applyBounds(restore)
    }
    this.nextWalkAt = performance.now() + this.nextWalkDelay()
    this.reconcileDisplay()
    this.logger.info('pet peek mode left')
  }

  setInteractive(value: boolean): void {
    const win = this.getWindow()
    if (this.closing || (this.dragging && !value)) return
    if (!win || value === this.interactive) return
    this.interactive = value
    win.setIgnoreMouseEvents(!value, { forward: true })
    this.logger.info(`interactive -> ${value}`)
  }

  forceWalk(direction?: WalkDirection): void {
    if (this.dragging || this.closing || this.peeking || this.walkPaused || !this.walkEnabled) return
    if (direction !== undefined) this.setDirection(direction)
    const wasWalking = this.walking
    this.walking = true
    this.walkEndAt = Number.POSITIVE_INFINITY
    // Always resend: the renderer may have missed the did-finish-load state event,
    // and a debug forceWalk after that must still start the walk animation.
    this.sendWalkingState()
    if (!wasWalking) this.logger.info(`walk started, direction=${this.direction}`)
  }

  stopWalk(): void {
    if (this.walking) {
      this.walking = false
      this.sendWalkingState()
      this.logger.info('walk stopped')
    }
    this.nextWalkAt = performance.now() + this.nextWalkDelay()
  }

  reconcileDisplay(): void {
    const win = this.getWindow()
    if (!win || this.dragging || this.closing || this.peeking) return
    const display = screen.getDisplayMatching(win.getBounds())
    const area = display.workArea
    const nextSize = sizeForArea(this.requestedPetSize, area)
    this.x += (this.windowSize - nextSize) / 2
    if (this.manuallyPlaced) this.y += (this.windowSize - nextSize) / 2
    this.windowSize = nextSize
    if (this.manuallyPlaced) {
      // Keep partial offscreen placement. Recover only when a display change
      // makes the entire pet unreachable; deliberate drag exits are handled below.
      if (!isPetOnAnyDisplay({ x: this.x, y: this.y }, this.visibleDragFootprint(),
        screen.getAllDisplays().map((item) => item.bounds))) {
        const position = clampDragPosition(this.x, this.y, display.bounds, nextSize, this.dragFootprint(nextSize))
        this.x = position.x
        this.y = position.y
      }
    } else {
      this.x = clampWindowX(this.x, area, nextSize)
      this.y = bottomWindowY(area, nextSize)
    }
    const x = roundWindowCoordinate(this.x)
    const y = roundWindowCoordinate(this.y)
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y || bounds.width !== this.windowSize || bounds.height !== this.windowSize) {
      this.applyBounds({ x, y, width: this.windowSize, height: this.windowSize })
      this.logger.info(`pet bounds -> ${x},${y} ${this.windowSize}x${this.windowSize}`)
    }
  }

  setPetSize(size: number): void {
    this.requestedPetSize = size
    if (this.peeking) return
    this.reconcileDisplay()
  }

  startDrag(footprint?: DragFootprint, anchor?: { x: number; y: number }): void {
    const win = this.getWindow()
    if (!win || !win.isVisible() || this.dragging || this.closing || this.peeking) return
    this.stopWalk()
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    if (footprint) {
      this.footprintRatio = {
        x: footprint.x / bounds.width,
        y: footprint.y / bounds.height,
        width: footprint.width / bounds.width,
        height: footprint.height / bounds.height
      }
    }
    // Use the original pointer-down position, not the cursor after the drag gate.
    this.dragOffset = anchor ?? { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
    this.dragEdgePush = new DragEdgePush()
    this.dragging = true
    this.dragTick()
    if (!this.quitting) this.dragTimer = setInterval(() => this.dragTick(), 1000 / 60)
    this.logger.info('pet drag started')
  }

  endDrag(): void {
    if (!this.dragging) return
    this.dragTick(false)
    this.dragging = false
    this.stopDragTimer()
    const win = this.getWindow()
    if (!win || this.closing || this.quitting) return
    const bounds = win.getBounds()
    this.x = bounds.x
    this.y = bounds.y
    this.manuallyPlaced = true
    // Release keeps the exact location, even with only part of the pet visible.
    this.nextWalkAt = performance.now() + this.nextWalkDelay()
    this.logger.info(`pet drag landed -> ${this.x},${this.y} ${bounds.width}x${bounds.height}`)
  }

  beginClose(): CloseScene {
    const win = this.getWindow()
    if (!win || !win.isVisible()) throw new Error('Pet window is unavailable')
    if (this.closing && this.closeScene) return this.closeScene
    this.dragging = false
    this.stopDragTimer()
    this.stopWalk()
    const bounds = win.getBounds()
    // Close from a peek window: the compact bounds to restore after closing must
    // be the normal taskbar window, not the offscreen peek position.
    const restoreBounds = this.peekRestoreBounds ?? bounds
    const display = screen.getDisplayMatching(bounds)
    const expanded = display.bounds
    this.compactBounds = restoreBounds
    this.closeScene = {
      width: expanded.width,
      height: expanded.height,
      originX: Math.round(bounds.x + bounds.width / 2 - expanded.x),
      originY: Math.round(bounds.y + bounds.height * 0.52 - expanded.y)
    }
    this.peeking = false
    this.peekRestoreBounds = null
    this.closing = true
    this.interactive = false
    win.setFocusable(true)
    win.setIgnoreMouseEvents(true, { forward: true })
    this.applyBounds(expanded)
    this.closeTimer = setTimeout(() => this.finishClose(), 1200)
    this.logger.info(`pet close expanded -> ${expanded.x},${expanded.y} ${expanded.width}x${expanded.height}`)
    return this.closeScene
  }

  finishClose(): void {
    if (!this.closing) return
    this.clearCloseTimer()
    const win = this.getWindow()
    const compactBounds = this.compactBounds
    this.closeScene = null
    this.compactBounds = null
    if (win) {
      win.hide()
      if (compactBounds) {
        this.applyBounds(compactBounds)
        this.x = compactBounds.x
        this.y = compactBounds.y
        this.windowSize = compactBounds.width
      }
    }
    this.closing = false
    this.restorationPending = true
    this.reconcileDisplay()
    this.logger.info('pet close completed; compact bounds restored; tray retained')
  }

  prepareToQuit(): void {
    this.quitting = true
    this.stopDragTimer()
    this.clearCloseTimer()
    this.stopTimer()
  }

  private applyBounds(bounds: Electron.Rectangle): void {
    // Suppress the resize event generated by our own setBounds. Windows may
    // round the requested DIP size, which previously caused an infinite guard.
    // Normalize -0 as well: Electron's native bindings reject it.
    this.resizeSuppressUntil = Date.now() + 250
    this.getWindow()?.setBounds({
      x: roundWindowCoordinate(bounds.x),
      y: roundWindowCoordinate(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    }, false)
  }

  private tick(): void {
    const now = performance.now()
    const dtSeconds = Math.min(0.1, Math.max(0, (now - this.lastTickAt) / 1000))
    this.lastTickAt = now
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    if (this.dragging || this.closing || this.peeking) return
    if (this.walkPaused || !this.walkEnabled) {
      if (this.walking) this.stopWalk()
      return
    }
    if (!this.walking && now >= this.nextWalkAt) {
      this.walking = true
      this.walkEndAt = now + walkDurationMs()
      this.sendWalkingState()
      this.logger.info(`walk started, direction=${this.direction}`)
    }
    if (this.walking && now >= this.walkEndAt) {
      this.stopWalk()
      return
    }
    if (!this.walking) return

    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const footprint = this.dragFootprint(this.windowSize)
    const walkArea = this.manuallyPlaced
      ? typeof footprint === 'number'
        ? { ...area, x: area.x - (this.windowSize - footprint) / 2, width: area.width + this.windowSize - footprint }
        : { ...area, x: area.x - footprint.x, width: area.width + this.windowSize - footprint.width }
      : area
    const next = stepWalk(
      { x: this.x, direction: this.direction },
      dtSeconds,
      walkSpeed(this.windowSize, this.walkSpeedMultiplier),
      walkArea,
      this.windowSize
    )
    this.x = next.x
    this.setDirection(next.direction)
    const x = roundWindowCoordinate(this.x)
    const y = this.manuallyPlaced ? roundWindowCoordinate(this.y) : bottomWindowY(area, this.windowSize)
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y) {
      try {
        win.setPosition(x, y, false)
      } catch (error: unknown) {
        this.logger.error(`walk setPosition failed (${x},${y}): ${String(error)}`)
      }
    }
  }

  private setDirection(direction: WalkDirection): void {
    if (direction === this.direction) return
    this.direction = direction
    const win = this.getWindow()
    if (win && !win.webContents.isLoading()) win.webContents.send('pet:facing', direction)
    this.logger.info(`facing -> ${direction}`)
  }

  private sendWalkingState(): void {
    const win = this.getWindow()
    if (!win || win.webContents.isLoading()) return
    win.webContents.send('pet:facing', this.direction)
    win.webContents.send('pet:walking', this.walking)
  }

  private pause(): void {
    if (this.pauseStartedAt === 0) this.pauseStartedAt = performance.now()
    this.logger.info('pet hidden; walking paused')
  }

  private resume(): void {
    const now = performance.now()
    if (this.pauseStartedAt !== 0) {
      const pausedFor = now - this.pauseStartedAt
      this.nextWalkAt += pausedFor
      if (Number.isFinite(this.walkEndAt)) this.walkEndAt += pausedFor
      this.pauseStartedAt = 0
    }
    this.lastTickAt = now
    this.logger.info('pet shown; walking resumed')
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private dragTick(advance = true): void {
    const win = this.getWindow()
    if (!this.dragging || !win || !win.isVisible()) {
      this.stopDragTimer()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const displays = screen.getAllDisplays().map((item) => item.bounds)
    // On release/cancel retain the last applied position, with no extra edge push.
    const target = advance
      ? dragPosition(cursor, this.dragOffset, this.dragEdgePush.step(cursor, displays, performance.now()))
      : win.getBounds()
    const x = roundWindowCoordinate(target.x)
    const y = roundWindowCoordinate(target.y)
    // Windows/Electron can hand back a non-finite cursor or bounds while a
    // window crosses a mixed-DPI display boundary. setPosition() throws a
    // native conversion error for that, which used to surface as an uncaught
    // main-process exception. Keep the last good position instead.
    if (!isUsableDragCoordinate(x, y)) {
      if (performance.now() - this.lastDragWarnAt >= 1000) {
        this.lastDragWarnAt = performance.now()
        this.logger.warn(`drag tick skipped invalid target x=${String(target.x)} y=${String(target.y)} ` +
          `cursor=${String(cursor.x)},${String(cursor.y)} anchor=${this.dragOffset.x},${this.dragOffset.y}`)
      }
      return
    }
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y) {
      try {
        win.setPosition(x, y, false)
      } catch (error: unknown) {
        this.logger.error(`drag setPosition failed (${x},${y}): ${String(error)}`)
        this.dragging = false
        this.stopDragTimer()
        return
      }
    }
    this.x = x
    this.y = y
    if (displays.length > 0 && !isPetOnAnyDisplay({ x, y }, this.visibleDragFootprint(), displays)) {
      this.logger.info(`pet dragged completely off all displays -> quit at ${x},${y}`)
      this.dragging = false
      this.prepareToQuit()
      app.quit()
    }
  }

  private visibleDragFootprint(): DragFootprint {
    const footprint = this.dragFootprint(this.windowSize)
    // Extra room covers the dangling limbs and elastic motion during the drag.
    const margin = this.windowSize * 0.06
    const box = typeof footprint === 'number'
      ? { x: (this.windowSize - footprint) / 2, y: (this.windowSize - footprint) / 2,
          width: footprint, height: footprint }
      : footprint
    return { x: box.x - margin, y: box.y - margin,
      width: box.width + margin * 2, height: box.height + margin * 2 }
  }

  private stopDragTimer(): void {
    if (this.dragTimer !== null) clearInterval(this.dragTimer)
    this.dragTimer = null
  }

  private dragFootprint(size: number): number | DragFootprint {
    const ratio = this.footprintRatio
    return ratio ? {
      x: ratio.x * size,
      y: ratio.y * size,
      width: ratio.width * size,
      height: ratio.height * size
    } : this.requestedPetSize
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer)
    this.closeTimer = null
  }
}

function sizeForArea(petSize: number, area: WalkArea): number {
  const requested = Math.round((PET_WINDOW_SIZE * petSize) / 220)
  return Math.max(1, Math.min(requested, area.width, area.height))
}

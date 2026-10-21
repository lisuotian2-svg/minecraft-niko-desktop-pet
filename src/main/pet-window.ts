import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import {
  bottomWindowY,
  clampWindowX,
  nextWalkDelayMs,
  stepWalk,
  walkDurationMs,
  walkSpeed,
  type WalkDirection,
  type WalkArea
} from '../shared/walk'
import type { Logger } from './logger'

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
  private closing = false
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private closeScene: CloseScene | null = null
  private compactBounds: Electron.Rectangle | null = null
  private restorationPending = false

  constructor(private readonly logger: Logger, petSize = 220) {
    this.requestedPetSize = petSize
  }

  create(): BrowserWindow {
    const area = screen.getPrimaryDisplay().workArea
    this.windowSize = sizeForArea(this.requestedPetSize, area)
    this.x = Math.round(area.x + (area.width - this.windowSize) / 2)
    this.win = new BrowserWindow({
      width: this.windowSize,
      height: this.windowSize,
      x: this.x,
      y: bottomWindowY(area, this.windowSize),
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
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: true })
    this.logger.info('pet window created; interactive=false')
    win.webContents.once('did-finish-load', () => {
      this.logger.info('pet renderer loaded')
      if (!win.isDestroyed()) {
        win.showInactive()
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
    win.on('resize', () => {
      if (this.closing) return
      const bounds = win.getBounds()
      if (bounds.width !== this.windowSize || bounds.height !== this.windowSize) {
        this.logger.warn(`pet resize guard: ${bounds.width}x${bounds.height} -> ${this.windowSize}`)
        win.setBounds({
          x: bounds.x,
          y: bottomWindowY(screen.getDisplayMatching(bounds).workArea, this.windowSize),
          width: this.windowSize,
          height: this.windowSize
        }, false)
      }
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
    this.nextWalkAt = this.lastTickAt + nextWalkDelayMs()
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

  setInteractive(value: boolean): void {
    const win = this.getWindow()
    if (this.closing || (this.dragging && !value)) return
    if (!win || value === this.interactive) return
    this.interactive = value
    win.setIgnoreMouseEvents(!value, { forward: true })
    this.logger.info(`interactive -> ${value}`)
  }

  forceWalk(direction?: WalkDirection): void {
    if (this.dragging || this.closing) return
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
    this.nextWalkAt = performance.now() + nextWalkDelayMs()
  }

  reconcileDisplay(): void {
    const win = this.getWindow()
    if (!win || this.dragging || this.closing) return
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const nextSize = sizeForArea(this.requestedPetSize, area)
    this.x += (this.windowSize - nextSize) / 2
    this.windowSize = nextSize
    this.x = clampWindowX(this.x, area, this.windowSize)
    const x = Math.round(this.x)
    const y = bottomWindowY(area, this.windowSize)
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y || bounds.width !== this.windowSize || bounds.height !== this.windowSize) {
      win.setBounds({ x, y, width: this.windowSize, height: this.windowSize }, false)
      this.logger.info(`pet bounds -> ${x},${y} ${this.windowSize}x${this.windowSize}`)
    }
  }

  setPetSize(size: number): void {
    this.requestedPetSize = size
    this.reconcileDisplay()
  }

  startDrag(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible() || this.dragging || this.closing) return
    this.stopWalk()
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    this.dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
    this.dragging = true
    this.dragTick()
    this.dragTimer = setInterval(() => this.dragTick(), 1000 / 60)
    this.logger.info('pet drag started')
  }

  endDrag(): void {
    if (!this.dragging) return
    this.dragging = false
    this.stopDragTimer()
    const win = this.getWindow()
    if (!win || this.closing) return
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const nextSize = sizeForArea(this.requestedPetSize, area)
    const x = Math.round(clampWindowX(cursor.x - this.dragOffset.x, area, nextSize))
    const y = bottomWindowY(area, nextSize)
    this.windowSize = nextSize
    this.x = x
    win.setBounds({ x, y, width: nextSize, height: nextSize }, false)
    this.nextWalkAt = performance.now() + nextWalkDelayMs()
    this.logger.info(`pet drag landed -> ${x},${y} ${nextSize}x${nextSize}`)
  }

  beginClose(): CloseScene {
    const win = this.getWindow()
    if (!win || !win.isVisible()) throw new Error('Pet window is unavailable')
    if (this.closing && this.closeScene) return this.closeScene
    this.dragging = false
    this.stopDragTimer()
    this.stopWalk()
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const expanded = display.bounds
    this.compactBounds = bounds
    this.closeScene = {
      width: expanded.width,
      height: expanded.height,
      originX: Math.round(bounds.x + bounds.width / 2 - expanded.x),
      originY: Math.round(bounds.y + bounds.height * 0.52 - expanded.y)
    }
    this.closing = true
    this.interactive = false
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setBounds(expanded, false)
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
        win.setBounds(compactBounds, false)
        this.x = compactBounds.x
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

  private tick(): void {
    const now = performance.now()
    const dtSeconds = Math.min(0.1, Math.max(0, (now - this.lastTickAt) / 1000))
    this.lastTickAt = now
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    if (this.dragging || this.closing) return
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
    const next = stepWalk(
      { x: this.x, direction: this.direction },
      dtSeconds,
      walkSpeed(this.windowSize),
      area,
      this.windowSize
    )
    this.x = next.x
    this.setDirection(next.direction)
    const x = Math.round(this.x)
    const y = bottomWindowY(area, this.windowSize)
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y) win.setPosition(x, y, false)
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

  private dragTick(): void {
    const win = this.getWindow()
    if (!this.dragging || !win || !win.isVisible()) {
      this.stopDragTimer()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const displays = screen.getAllDisplays()
    const minX = Math.min(...displays.map((display) => display.bounds.x))
    const minY = Math.min(...displays.map((display) => display.bounds.y))
    const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
    const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height))
    const x = Math.round(Math.min(Math.max(minX, maxX - this.windowSize), Math.max(minX, cursor.x - this.dragOffset.x)))
    const y = Math.round(Math.min(Math.max(minY, maxY - this.windowSize), Math.max(minY, cursor.y - this.dragOffset.y)))
    const bounds = win.getBounds()
    if (bounds.x !== x || bounds.y !== y) win.setPosition(x, y, false)
    this.x = x
  }

  private stopDragTimer(): void {
    if (this.dragTimer !== null) clearInterval(this.dragTimer)
    this.dragTimer = null
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

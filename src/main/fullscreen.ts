import { app, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Bounds } from '../shared/contracts'
import type { Logger } from './logger'

/**
 * Foreground-fullscreen watcher.
 *
 * Preferred source: native/fullscreen-watcher (C# helper, no npm dependency).
 * Fallback: the same C# source compiled at runtime through PowerShell Add-Type.
 * Both emit one compact JSON line per poll. The helper reports native monitor
 * facts; this module maps the monitor to an Electron display id and debounces
 * changes. It never reports window titles.
 */

export type DetectorSource = 'helper' | 'powershell' | 'unavailable'

export interface DetectorState {
  active: boolean
  displayId: number | null
  source: DetectorSource
  reason?: string
}

export interface DetectorStatus {
  source: DetectorSource
  running: boolean
  available: boolean
  lastActive: boolean
  lastAt: number | null
  lastError: string | null
  helperPath: string
  fallbackPath: string
}

export interface FullscreenDetectorOptions {
  logger: Logger
  onState: (state: DetectorState) => void
  /** Poll interval in ms; the helper/fallback clamps to at least 100/250. */
  intervalMs?: number
}

interface NativeMonitor {
  device?: string
  bounds?: Bounds
  workArea?: Bounds
  dpi?: number
}

interface NativeProbeState {
  kind?: string
  active?: unknown
  pid?: unknown
  process?: unknown
  className?: unknown
  maximized?: unknown
  minimized?: unknown
  cloaked?: unknown
  windowBounds?: Bounds
  monitor?: NativeMonitor
  message?: unknown
}

const IGNORED_PROCESSES = new Set([
  'explorer',
  'shellexperiencehost',
  'searchhost',
  'startmenuexperiencehost',
  'textinputhost',
  'lockapp'
])
const IGNORED_CLASSES = new Set(['progman', 'workerw', 'shell_traywnd', 'traynotifywnd'])
const PROCESS_LIST = 'explorer.exe,ShellExperienceHost.exe,SearchHost.exe,StartMenuExperienceHost.exe,TextInputHost.exe,LockApp.exe'
const CLASS_LIST = 'Progman,WorkerW,Shell_TrayWnd,TrayNotifyWnd'

function processKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  const lower = value.toLowerCase()
  return lower.endsWith('.exe') ? lower.slice(0, -4) : lower
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validBounds(value: unknown): value is Bounds {
  if (!isRecord(value)) return false
  return typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y)
    && typeof value.width === 'number' && Number.isFinite(value.width)
    && typeof value.height === 'number' && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0
}

export class FullscreenDetector {
  private readonly logger: Logger
  private readonly onState: (state: DetectorState) => void
  private readonly intervalMs: number
  private readonly helperPath: string
  private readonly fallbackPath: string
  private child: ChildProcess | null = null
  private lineReader: ReturnType<typeof createInterface> | null = null
  private source: DetectorSource = 'unavailable'
  private running = false
  private stopping = false
  private fallbackStarted = false
  private lastActive = false
  private lastAt: number | null = null
  private lastError: string | null = null
  private lastEmitted: DetectorState | null = null
  private candidate: DetectorState | null = null
  private candidateCount = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private lastFallbackLogAt = 0

  constructor(options: FullscreenDetectorOptions) {
    this.logger = options.logger
    this.onState = options.onState
    this.intervalMs = Math.max(250, Math.round(options.intervalMs ?? 500))
    const devDir = join(app.getAppPath(), 'native', 'fullscreen-watcher')
    const packedDir = join(process.resourcesPath, 'native')
    this.helperPath = app.isPackaged
      ? join(packedDir, 'FullscreenWatcher.exe')
      : join(devDir, 'bin', 'FullscreenWatcher.exe')
    this.fallbackPath = app.isPackaged
      ? join(packedDir, 'fallback.ps1')
      : join(devDir, 'fallback.ps1')
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.stopping = false
    this.fallbackStarted = false
    this.emitState({ active: false, displayId: null, source: 'unavailable', reason: 'starting' })
    if (existsSync(this.helperPath)) {
      this.startHelper()
      return
    }
    this.logger.warn(`fullscreen helper missing at ${this.helperPath}; starting PowerShell fallback`)
    this.startFallback()
  }

  stop(): void {
    this.stopping = true
    this.running = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.lineReader?.close()
    this.lineReader = null
    const child = this.child
    this.child = null
    if (child && !child.killed) {
      try { child.kill() } catch (error: unknown) { this.logger.warn(`fullscreen probe stop failed: ${String(error)}`) }
    }
    this.source = 'unavailable'
  }

  getStatus(): DetectorStatus {
    return {
      source: this.source,
      running: this.running,
      available: this.source !== 'unavailable',
      lastActive: this.lastActive,
      lastAt: this.lastAt,
      lastError: this.lastError,
      helperPath: this.helperPath,
      fallbackPath: this.fallbackPath
    }
  }

  private startHelper(): void {
    this.source = 'helper'
    const args = [
      '--interval', String(this.intervalMs),
      '--exclude-pid', String(process.pid),
      '--exclude-processes', PROCESS_LIST,
      '--exclude-classes', CLASS_LIST
    ]
    const child = spawn(this.helperPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.attachChild(child, 'helper')
    this.logger.info(`fullscreen helper started: ${this.helperPath}`)
  }

  private startFallback(): void {
    if (this.fallbackStarted) return
    this.fallbackStarted = true
    this.source = 'powershell'
    if (!existsSync(this.fallbackPath)) {
      this.source = 'unavailable'
      this.lastError = 'fallback.ps1 missing'
      this.logger.error(`fullscreen fallback missing at ${this.fallbackPath}`)
      this.emitState({ active: false, displayId: null, source: 'unavailable', reason: this.lastError })
      return
    }
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', this.fallbackPath,
      '-IntervalMs', String(Math.max(250, this.intervalMs)),
      '-ExcludePid', String(process.pid),
      '-ExcludeProcesses', PROCESS_LIST,
      '-ExcludeClasses', CLASS_LIST
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.attachChild(child, 'powershell')
    this.logger.info('fullscreen PowerShell fallback started')
  }

  private attachChild(child: ChildProcess, source: DetectorSource): void {
    this.child = child
    this.source = source
    if (child.stdout) {
      this.lineReader = createInterface({ input: child.stdout })
      this.lineReader.on('line', (line) => this.onLine(line))
    }
    let stderrLogged = false
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrLogged) return
      stderrLogged = true
      this.lastError = String(chunk).trim().slice(0, 500)
      this.logger.warn(`fullscreen ${source} stderr: ${this.lastError}`)
    })
    child.on('error', (error) => {
      this.lastError = String(error)
      this.logger.error(`fullscreen ${source} spawn error: ${this.lastError}`)
      if (!this.stopping && this.running && this.child === child) this.onChildExit(source, child)
    })
    child.on('exit', (code) => {
      if (this.stopping) return
      this.logger.warn(`fullscreen ${source} exited code=${code ?? 'null'}`)
      if (this.child === child) this.onChildExit(source, child)
    })
  }

  private onChildExit(source: DetectorSource, child: ChildProcess): void {
    if (this.child !== child || this.stopping) return
    this.child = null
    this.lineReader?.close()
    this.lineReader = null
    if (source === 'helper' && !this.fallbackStarted) {
      this.logger.warn('fullscreen helper exited; switching to PowerShell fallback')
      this.startFallback()
      return
    }
    this.source = 'unavailable'
    this.lastError = this.lastError ?? 'probe exited'
    this.emitState({ active: false, displayId: null, source: 'unavailable', reason: this.lastError })
    // A single delayed retry avoids a tight crash loop while still recovering
    // from a one-off helper failure.
    if (this.running && this.restartTimer === null) {
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (!this.running) return
        if (existsSync(this.helperPath)) {
          this.fallbackStarted = false
          this.startHelper()
        } else {
          this.fallbackStarted = false
          this.startFallback()
        }
      }, 3000)
    }
  }

  private onLine(line: string): void {
    const text = line.trim()
    if (text.length === 0) return
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      this.lastError = 'invalid probe JSON'
      this.logger.warn(`fullscreen probe emitted invalid JSON (${text.length} chars)`)
      return
    }
    if (!isRecord(value)) return
    const probe = value as NativeProbeState
    if (probe.kind === 'error') {
      this.lastError = typeof probe.message === 'string' ? probe.message : 'probe error'
      this.logger.warn(`fullscreen probe error: ${this.lastError}`)
      return
    }
    if (probe.kind !== 'state') return
    this.lastAt = Date.now()

    const key = processKey(probe.process)
    const className = typeof probe.className === 'string' ? probe.className.toLowerCase() : ''
    const ignored = probe.pid === process.pid
      || IGNORED_PROCESSES.has(key)
      || IGNORED_CLASSES.has(className)
      || probe.maximized === true
      || probe.minimized === true
      || probe.cloaked === true
    const active = probe.active === true && !ignored
    const displayId = active ? this.resolveDisplayId(probe.monitor?.bounds) : null
    const next: DetectorState = {
      active: active && displayId !== null,
      displayId: active ? displayId : null,
      source: this.source,
      reason: active && displayId === null ? 'display-unresolved' : undefined
    }

    // Hysteresis: two consecutive identical samples (~1 s with the default
    // 500 ms interval) before entering/leaving fullscreen.
    if (this.candidate && this.candidate.active === next.active && this.candidate.displayId === next.displayId) {
      this.candidateCount += 1
    } else {
      this.candidate = next
      this.candidateCount = 1
    }
    if (this.candidateCount < 2) return
    if (this.lastEmitted && this.lastEmitted.active === next.active && this.lastEmitted.displayId === next.displayId) {
      this.lastActive = next.active
      return
    }
    this.lastActive = next.active
    this.lastEmitted = next
    if (next.active) {
      const display = screen.getAllDisplays().find((item) => item.id === next.displayId)
      this.logger.info(`fullscreen active display=${next.displayId} source=${next.source} workArea=${display ? `${display.workArea.width}x${display.workArea.height}` : 'unknown'}`)
    } else {
      this.logger.info(`fullscreen inactive source=${next.source}`)
    }
    this.onState(next)
  }

  private resolveDisplayId(monitorBounds: Bounds | undefined): number | null {
    const displays = screen.getAllDisplays()
    if (displays.length === 0) return null
    if (displays.length === 1) return displays[0]?.id ?? null
    if (!monitorBounds) return null
    const width = monitorBounds.width
    const height = monitorBounds.height
    const sizeMatches = displays.filter((display) => {
      const expectedWidth = Math.round(display.bounds.width * display.scaleFactor)
      const expectedHeight = Math.round(display.bounds.height * display.scaleFactor)
      return Math.abs(expectedWidth - width) <= 3 && Math.abs(expectedHeight - height) <= 3
    })
    if (sizeMatches.length === 1) return sizeMatches[0]?.id ?? null

    const primary = screen.getPrimaryDisplay()
    const originX = primary.bounds.x
    const originY = primary.bounds.y
    const candidates = sizeMatches.length > 1 ? sizeMatches : displays
    let best: { id: number; score: number } | null = null
    for (const display of candidates) {
      // Approximate the physical position using the primary display scale. This
      // is sufficient for common layouts and single-DPI setups; the helper's
      // device name is logged by future diagnostic work if this ever mismatches.
      const expectedX = Math.round((display.bounds.x - originX) * primary.scaleFactor)
      const expectedY = Math.round((display.bounds.y - originY) * primary.scaleFactor)
      const score = Math.abs(expectedX - monitorBounds.x) + Math.abs(expectedY - monitorBounds.y)
      if (!best || score < best.score) best = { id: display.id, score }
    }
    const result = best?.id ?? null
    if (result === null) {
      const now = Date.now()
      if (now - this.lastFallbackLogAt > 30_000) {
        this.lastFallbackLogAt = now
        this.logger.warn(`fullscreen display unresolved (monitor ${width}x${height}); ignoring`)
      }
    }
    return result
  }

  private emitState(state: DetectorState): void {
    if (this.stopping) return
    this.lastEmitted = state
    this.lastActive = state.active
    this.onState(state)
  }
}

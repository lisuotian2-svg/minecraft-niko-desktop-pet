import { globalShortcut } from 'electron'
import {
  ACTION_LABELS,
  DEFAULT_HOTKEYS,
  type ActionId,
  type ActionRequest
} from '../shared/contracts'
import type { Logger } from './logger'

/**
 * HotkeyManager skeleton (task-11). It is intentionally not wired into
 * src/main/index.ts yet: Lead will pass settings.hotkeys, register after app
 * ready, and remove the existing hard-coded Ctrl+Alt+P registration.
 *
 * The manager owns only the accelerators it registered; it never calls
 * globalShortcut.unregisterAll() because that could remove bindings owned by
 * another part of the app.
 */

export type HotkeyBindings = Record<ActionId, string | null>

export type HotkeyErrorReason = 'invalid' | 'duplicate' | 'occupied' | 'exception'

export interface HotkeyError {
  action: ActionId
  accelerator: string
  reason: HotkeyErrorReason
  detail?: string
}

export interface HotkeyApplyResult {
  ok: boolean
  bindings: HotkeyBindings
  errors: HotkeyError[]
}

export interface HotkeyStatus {
  action: ActionId
  label: string
  accelerator: string | null
  registered: boolean
}

export interface HotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface HotkeyManagerOptions {
  logger: Logger
  onAction: (request: ActionRequest) => void
  /** Initial bindings; defaults to contracts.DEFAULT_HOTKEYS for every action. */
  bindings?: Partial<HotkeyBindings>
  /** Injectable Electron globalShortcut for unit tests; defaults to the real one. */
  shortcuts?: HotkeyRegistrar
}

const ACCELERATOR_PATTERN = /^[A-Za-z0-9+]+$/

function normalizeBindings(input: Partial<HotkeyBindings>): HotkeyBindings {
  const result: HotkeyBindings = { ...DEFAULT_HOTKEYS }
  for (const action of Object.keys(DEFAULT_HOTKEYS) as ActionId[]) {
    const value = input[action]
    if (value === undefined) continue
    if (value === null) {
      result[action] = null
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      result[action] = trimmed.length === 0 ? null : trimmed.slice(0, 64)
    }
  }
  return result
}

function validateAccelerator(accelerator: string): boolean {
  if (accelerator.length === 0 || accelerator.length > 64) return false
  if (!ACCELERATOR_PATTERN.test(accelerator)) return false
  const parts = accelerator.split('+').filter((part) => part.length > 0)
  if (parts.length === 0) return false
  if (parts.length > 4) return false
  // A trailing/duplicated separator (Control++) is not a valid Electron accelerator.
  if (accelerator.endsWith('+') || accelerator.includes('++')) return false
  return true
}

export class HotkeyManager {
  private readonly logger: Logger
  private readonly onAction: (request: ActionRequest) => void
  private readonly shortcuts: HotkeyRegistrar
  private bindings: HotkeyBindings
  private registered = new Map<ActionId, string>()

  constructor(options: HotkeyManagerOptions) {
    this.logger = options.logger
    this.onAction = options.onAction
    this.shortcuts = options.shortcuts ?? globalShortcut
    this.bindings = normalizeBindings(options.bindings ?? {})
  }

  /** Register/replace all bindings atomically, with rollback on any failure. */
  apply(next: Partial<HotkeyBindings>): HotkeyApplyResult {
    const candidate = normalizeBindings({ ...this.bindings, ...next })
    const errors = this.validateBindings(candidate)
    if (errors.length > 0) {
      return { ok: false, bindings: this.getBindings(), errors }
    }

    const previousBindings = this.getBindings()
    const previousRegistered = new Map(this.registered)
    this.unregisterAll()

    const newRegistered = new Map<ActionId, string>()
    for (const action of Object.keys(DEFAULT_HOTKEYS) as ActionId[]) {
      const accelerator = candidate[action]
      if (!accelerator) continue
      try {
        const ok = this.shortcuts.register(accelerator, () => {
          this.onAction({ id: action, source: 'hotkey' })
        })
        if (!ok) {
          errors.push({ action, accelerator, reason: 'occupied' })
          continue
        }
        newRegistered.set(action, accelerator)
      } catch (error: unknown) {
        errors.push({
          action,
          accelerator,
          reason: 'exception',
          detail: error instanceof Error ? error.message : String(error)
        })
      }
    }

    if (errors.length > 0) {
      // Roll back: remove whatever the candidate registered, then restore the
      // previous bindings where possible.
      for (const accelerator of newRegistered.values()) this.shortcuts.unregister(accelerator)
      newRegistered.clear()
      this.registered = new Map()
      for (const [action, accelerator] of previousRegistered) {
        try {
          if (this.shortcuts.register(accelerator, () => {
            this.onAction({ id: action, source: 'hotkey' })
          })) {
            this.registered.set(action, accelerator)
          }
        } catch (error: unknown) {
          this.logger.warn(`hotkey rollback failed for ${action}: ${String(error)}`)
        }
      }
      this.bindings = previousBindings
      this.logger.warn(`hotkey apply failed; kept previous bindings (${errors.map((item) => `${item.action}:${item.reason}`).join(', ')})`)
      return { ok: false, bindings: this.getBindings(), errors }
    }

    this.bindings = candidate
    this.registered = newRegistered
    this.logger.info(`hotkeys registered: ${[...newRegistered.entries()].map(([action, accelerator]) => `${action}=${accelerator}`).join(', ') || 'none'}`)
    return { ok: true, bindings: this.getBindings(), errors: [] }
  }

  /** Convenience alias for wiring: register every non-null binding. */
  registerAll(next: Partial<HotkeyBindings> = this.bindings): HotkeyApplyResult {
    return this.apply(next)
  }

  /** Unregister only this manager's accelerators (not globalShortcut.unregisterAll). */
  unregisterAll(): void {
    for (const accelerator of this.registered.values()) {
      try {
        this.shortcuts.unregister(accelerator)
      } catch (error: unknown) {
        this.logger.warn(`hotkey unregister failed: ${String(error)}`)
      }
    }
    this.registered.clear()
  }

  getBindings(): HotkeyBindings {
    return { ...this.bindings }
  }

  getStatus(): HotkeyStatus[] {
    return (Object.keys(DEFAULT_HOTKEYS) as ActionId[]).map((action) => ({
      action,
      label: ACTION_LABELS[action],
      accelerator: this.bindings[action],
      registered: this.registered.has(action)
    }))
  }

  /** Basic syntax check; actual OS ownership is authoritative via apply(). */
  validateAccelerator(accelerator: string | null): boolean {
    return accelerator === null || validateAccelerator(accelerator)
  }

  private validateBindings(bindings: HotkeyBindings): HotkeyError[] {
    const errors: HotkeyError[] = []
    const used = new Map<string, ActionId>()
    for (const action of Object.keys(DEFAULT_HOTKEYS) as ActionId[]) {
      const accelerator = bindings[action]
      if (accelerator === null) continue
      if (!validateAccelerator(accelerator)) {
        errors.push({ action, accelerator, reason: 'invalid' })
        continue
      }
      const key = accelerator.toLowerCase()
      const previous = used.get(key)
      if (previous) {
        errors.push({ action, accelerator, reason: 'duplicate', detail: `also used by ${previous}` })
        continue
      }
      used.set(key, action)
    }
    return errors
  }
}

import {
  ACTIVITY_LEVELS,
  DEFAULT_HOTKEYS,
  PERFORMANCE_MODES,
  type ActionId,
  type ActivityLevel,
  type PerformanceMode
} from './contracts'

/** How often the fullscreen peek cycle runs. */
export type PeekFrequency = 'low' | 'standard' | 'high'
export const PEEK_FREQUENCIES: readonly PeekFrequency[] = Object.freeze(['low', 'standard', 'high'])
export type WalkFrequency = 'low' | 'normal' | 'high'
export const WALK_FREQUENCIES: readonly WalkFrequency[] = Object.freeze(['low', 'normal', 'high'])
export type PhotoScope = 'current' | 'all'
export const PHOTO_SCOPES: readonly PhotoScope[] = Object.freeze(['current', 'all'])

/**
 * Persisted settings schema v2.
 *
 * v1 files migrate without resetting the existing user choices: size, volume,
 * nickname, photoDir, firstRun, etc. are preserved. New v2-only fields use
 * their defaults, except `autostart` which keeps the value already present in
 * an existing v1 file (new installs get `true`, an old explicit `false` stays
 * false). The previous v1 schema is still accepted by parseSettingsJson().
 */
export interface PetSettings {
  version: 2
  firstRun: boolean
  size: number
  nickname: string
  volume: number
  muted: boolean
  autostart: boolean
  longPressMs: number
  darkThreshold: number
  autoTorch: boolean
  clickSounds: boolean
  particles: boolean
  photoDir: string
  photoPrefix: string
  photoNotify: boolean
  photoScope: PhotoScope
  walkEnabled: boolean
  walkFrequency: WalkFrequency
  walkSpeedMultiplier: number
  opacity: number
  shadowEnabled: boolean
  idleMicroMotion: boolean
  lastDisplayId?: number
  lastX?: number

  // v2 additions (interface prep for behavior / settings UI / packaging).
  activityLevel: ActivityLevel
  performanceMode: PerformanceMode
  randomActions: boolean
  actionSounds: boolean
  fullscreenPeek: boolean
  peekFrequency: PeekFrequency
  sleepEnabled: boolean
  sleepAfterIdleSec: number
  wakeLieInSec: number
  closeSignEnabled: boolean
  startHidden: boolean
  hotkeys: Record<ActionId, string | null>
}

export const DEFAULT_SETTINGS: Readonly<PetSettings> = Object.freeze({
  version: 2,
  firstRun: true,
  size: 220,
  nickname: 'Niko',
  volume: 0.4,
  muted: false,
  // New installs default ON. Existing v1 files keep their stored value.
  autostart: true,
  longPressMs: 1500,
  darkThreshold: 30,
  autoTorch: true,
  clickSounds: true,
  particles: true,
  photoDir: '',
  photoPrefix: '',
  photoNotify: false,
  photoScope: 'current',
  walkEnabled: true,
  walkFrequency: 'normal',
  walkSpeedMultiplier: 1,
  opacity: 1,
  shadowEnabled: true,
  idleMicroMotion: true,
  activityLevel: 'low',
  performanceMode: 'normal',
  randomActions: true,
  actionSounds: true,
  fullscreenPeek: true,
  peekFrequency: 'standard',
  sleepEnabled: true,
  sleepAfterIdleSec: 360,
  wakeLieInSec: 3,
  closeSignEnabled: true,
  startHidden: false,
  hotkeys: { ...DEFAULT_HOTKEYS }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const clamped = Math.min(max, Math.max(min, value))
  return integer ? Math.round(clamped) : clamped
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

function isHotkeysType(value: unknown): boolean {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  return Object.keys(DEFAULT_HOTKEYS).every((action) => {
    const candidate = value[action]
    return candidate === undefined || candidate === null || typeof candidate === 'string'
  })
}

function hasValidFieldTypes(input: Record<string, unknown>): boolean {
  const booleans = [
    'firstRun', 'muted', 'autostart', 'autoTorch', 'clickSounds', 'particles',
    'randomActions', 'actionSounds', 'fullscreenPeek', 'sleepEnabled',
    'closeSignEnabled', 'startHidden', 'photoNotify', 'walkEnabled',
    'shadowEnabled', 'idleMicroMotion'
  ]
  const numbers = [
    'size', 'volume', 'longPressMs', 'darkThreshold', 'lastDisplayId', 'lastX',
    'sleepAfterIdleSec', 'wakeLieInSec', 'walkSpeedMultiplier', 'opacity'
  ]
  const strings = ['nickname', 'photoDir', 'photoPrefix']
  const enums: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['activityLevel', ACTIVITY_LEVELS],
    ['performanceMode', PERFORMANCE_MODES],
    ['peekFrequency', PEEK_FREQUENCIES],
    ['walkFrequency', WALK_FREQUENCIES],
    ['photoScope', PHOTO_SCOPES]
  ]
  return booleans.every((key) => input[key] === undefined || typeof input[key] === 'boolean') &&
    numbers.every((key) => input[key] === undefined || (typeof input[key] === 'number' && Number.isFinite(input[key]))) &&
    strings.every((key) => input[key] === undefined || typeof input[key] === 'string') &&
    enums.every(([key, allowed]) => input[key] === undefined
      || (typeof input[key] === 'string' && allowed.includes(input[key] as string))) &&
    isHotkeysType(input.hotkeys)
}

function parseHotkeys(value: unknown): Record<ActionId, string | null> {
  const result: Record<ActionId, string | null> = { ...DEFAULT_HOTKEYS }
  if (!isRecord(value)) return result
  for (const action of Object.keys(DEFAULT_HOTKEYS) as ActionId[]) {
    const candidate = value[action]
    if (candidate === null) result[action] = null
    else if (typeof candidate === 'string') {
      const trimmed = candidate.trim()
      result[action] = trimmed.length === 0 ? null : trimmed.slice(0, 64)
    }
  }
  return result
}

/** Manual schema validation. Out-of-range numeric fields are clamped on load and save. */
export function parseSettings(value: unknown): PetSettings {
  const input = isRecord(value) ? value : {}
  const nickname = typeof input.nickname === 'string' ? input.nickname.slice(0, 24) : DEFAULT_SETTINGS.nickname
  const photoDir = typeof input.photoDir === 'string' ? input.photoDir : DEFAULT_SETTINGS.photoDir
  const photoPrefix = typeof input.photoPrefix === 'string' ? input.photoPrefix.slice(0, 24) : DEFAULT_SETTINGS.photoPrefix
  // v1 files were written with autostart=false by default. A missing field in a
  // v1 file therefore means "keep the old default", not "turn it on now".
  const migratingV1 = input.version === 1
  const autostartFallback = migratingV1 ? false : DEFAULT_SETTINGS.autostart
  const result: PetSettings = {
    version: 2,
    firstRun: booleanOr(input.firstRun, DEFAULT_SETTINGS.firstRun),
    size: boundedNumber(input.size, DEFAULT_SETTINGS.size, 80, 500, true),
    nickname,
    volume: boundedNumber(input.volume, DEFAULT_SETTINGS.volume, 0, 1),
    muted: booleanOr(input.muted, DEFAULT_SETTINGS.muted),
    autostart: booleanOr(input.autostart, autostartFallback),
    longPressMs: boundedNumber(input.longPressMs, DEFAULT_SETTINGS.longPressMs, 1000, 2000, true),
    darkThreshold: boundedNumber(input.darkThreshold, DEFAULT_SETTINGS.darkThreshold, 10, 60, true),
    autoTorch: booleanOr(input.autoTorch, DEFAULT_SETTINGS.autoTorch),
    clickSounds: booleanOr(input.clickSounds, DEFAULT_SETTINGS.clickSounds),
    particles: booleanOr(input.particles, DEFAULT_SETTINGS.particles),
    photoDir,
    photoPrefix,
    photoNotify: booleanOr(input.photoNotify, DEFAULT_SETTINGS.photoNotify),
    photoScope: enumOr(input.photoScope, PHOTO_SCOPES, DEFAULT_SETTINGS.photoScope),
    walkEnabled: booleanOr(input.walkEnabled, DEFAULT_SETTINGS.walkEnabled),
    walkFrequency: enumOr(input.walkFrequency, WALK_FREQUENCIES, DEFAULT_SETTINGS.walkFrequency),
    walkSpeedMultiplier: boundedNumber(input.walkSpeedMultiplier, DEFAULT_SETTINGS.walkSpeedMultiplier, 0.5, 2),
    opacity: boundedNumber(input.opacity, DEFAULT_SETTINGS.opacity, 0.3, 1),
    shadowEnabled: booleanOr(input.shadowEnabled, DEFAULT_SETTINGS.shadowEnabled),
    idleMicroMotion: booleanOr(input.idleMicroMotion, DEFAULT_SETTINGS.idleMicroMotion),
    activityLevel: enumOr(input.activityLevel, ACTIVITY_LEVELS, DEFAULT_SETTINGS.activityLevel),
    performanceMode: enumOr(input.performanceMode, PERFORMANCE_MODES, DEFAULT_SETTINGS.performanceMode),
    randomActions: booleanOr(input.randomActions, DEFAULT_SETTINGS.randomActions),
    actionSounds: booleanOr(input.actionSounds, DEFAULT_SETTINGS.actionSounds),
    fullscreenPeek: booleanOr(input.fullscreenPeek, DEFAULT_SETTINGS.fullscreenPeek),
    peekFrequency: enumOr(input.peekFrequency, PEEK_FREQUENCIES, DEFAULT_SETTINGS.peekFrequency),
    sleepEnabled: booleanOr(input.sleepEnabled, DEFAULT_SETTINGS.sleepEnabled),
    sleepAfterIdleSec: boundedNumber(input.sleepAfterIdleSec, DEFAULT_SETTINGS.sleepAfterIdleSec, 60, 86_400, true),
    wakeLieInSec: boundedNumber(input.wakeLieInSec, DEFAULT_SETTINGS.wakeLieInSec, 1, 60, true),
    closeSignEnabled: booleanOr(input.closeSignEnabled, DEFAULT_SETTINGS.closeSignEnabled),
    startHidden: booleanOr(input.startHidden, DEFAULT_SETTINGS.startHidden),
    hotkeys: parseHotkeys(input.hotkeys)
  }
  if (typeof input.lastDisplayId === 'number' && Number.isFinite(input.lastDisplayId)) {
    result.lastDisplayId = Math.trunc(input.lastDisplayId)
  }
  if (typeof input.lastX === 'number' && Number.isFinite(input.lastX)) {
    result.lastX = Math.round(input.lastX)
  }
  return result
}

export interface ParsedSettingsJson {
  settings: PetSettings
  corrupted: boolean
}

/** Distinguish broken or incompatible files so the store can rename them before recovery. */
export function parseSettingsJson(text: string): ParsedSettingsJson {
  try {
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
    const version = value.version
    if (version !== undefined && version !== 1 && version !== 2) {
      return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
    }
    if (!hasValidFieldTypes(value)) {
      return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
    }
    return { settings: parseSettings(value), corrupted: false }
  } catch {
    return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
  }
}

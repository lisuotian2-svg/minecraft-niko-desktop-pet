/** Settings shared by the main process, preload and renderer. */
export interface PetSettings {
  version: 1
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
  lastDisplayId?: number
  lastX?: number
}

export const DEFAULT_SETTINGS: Readonly<PetSettings> = Object.freeze({
  version: 1,
  firstRun: true,
  size: 220,
  nickname: 'Niko',
  volume: 0.4,
  muted: false,
  autostart: false,
  longPressMs: 1500,
  darkThreshold: 30,
  autoTorch: true,
  clickSounds: true,
  particles: true,
  photoDir: ''
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

function hasValidFieldTypes(input: Record<string, unknown>): boolean {
  const booleans = ['firstRun', 'muted', 'autostart', 'autoTorch', 'clickSounds', 'particles']
  const numbers = ['size', 'volume', 'longPressMs', 'darkThreshold', 'lastDisplayId', 'lastX']
  const strings = ['nickname', 'photoDir']
  return booleans.every((key) => input[key] === undefined || typeof input[key] === 'boolean') &&
    numbers.every((key) => input[key] === undefined || (typeof input[key] === 'number' && Number.isFinite(input[key]))) &&
    strings.every((key) => input[key] === undefined || typeof input[key] === 'string')
}

/** Manual schema validation. Out-of-range numeric fields are clamped on load and save. */
export function parseSettings(value: unknown): PetSettings {
  const input = isRecord(value) ? value : {}
  const nickname = typeof input.nickname === 'string' ? input.nickname.slice(0, 24) : DEFAULT_SETTINGS.nickname
  const photoDir = typeof input.photoDir === 'string' ? input.photoDir : DEFAULT_SETTINGS.photoDir
  const result: PetSettings = {
    version: 1,
    firstRun: booleanOr(input.firstRun, DEFAULT_SETTINGS.firstRun),
    size: boundedNumber(input.size, DEFAULT_SETTINGS.size, 80, 500, true),
    nickname,
    volume: boundedNumber(input.volume, DEFAULT_SETTINGS.volume, 0, 1),
    muted: booleanOr(input.muted, DEFAULT_SETTINGS.muted),
    autostart: booleanOr(input.autostart, DEFAULT_SETTINGS.autostart),
    longPressMs: boundedNumber(input.longPressMs, DEFAULT_SETTINGS.longPressMs, 1000, 2000, true),
    darkThreshold: boundedNumber(input.darkThreshold, DEFAULT_SETTINGS.darkThreshold, 10, 60, true),
    autoTorch: booleanOr(input.autoTorch, DEFAULT_SETTINGS.autoTorch),
    clickSounds: booleanOr(input.clickSounds, DEFAULT_SETTINGS.clickSounds),
    particles: booleanOr(input.particles, DEFAULT_SETTINGS.particles),
    photoDir
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
    if (!isRecord(value) || (value.version !== undefined && value.version !== 1) || !hasValidFieldTypes(value)) {
      return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
    }
    return { settings: parseSettings(value), corrupted: false }
  } catch {
    return { settings: parseSettings(DEFAULT_SETTINGS), corrupted: true }
  }
}

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { DEFAULT_HOTKEYS } from '../src/shared/contracts'
import { DEFAULT_SETTINGS, parseSettings, parseSettingsJson } from '../src/shared/settings'
import { Logger } from '../src/main/logger'
import { SettingsStore } from '../src/main/settings'

const directories: string[] = []
const temporaryParent = resolve(process.cwd(), 'artifacts')

async function temporaryStore(): Promise<{ path: string; store: SettingsStore }> {
  await mkdir(temporaryParent, { recursive: true })
  const path = await mkdtemp(join(temporaryParent, 'qa-settings-v2-'))
  directories.push(path)
  return { path, store: new SettingsStore(path, new Logger(path)) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => {
    const child = relative(temporaryParent, resolve(path))
    if (child === '' || child.startsWith('..') || isAbsolute(child)) {
      throw new Error(`Refusing to remove path outside test artifacts: ${path}`)
    }
    await rm(path, { recursive: true, force: true })
  }))
})

/** A fully populated v1 settings.json, as M1/M2 wrote it. */
const v1Fixture = {
  version: 1,
  firstRun: false,
  size: 321,
  nickname: 'Niko-v1',
  volume: 0.65,
  muted: true,
  autostart: false,
  longPressMs: 1800,
  darkThreshold: 42,
  autoTorch: false,
  clickSounds: false,
  particles: false,
  photoDir: 'D:\\NikoPhotos',
  lastDisplayId: 2,
  lastX: 777
}

function expectedMigratedV1(overrides: Partial<typeof v1Fixture> = {}): Record<string, unknown> {
  return {
    ...DEFAULT_SETTINGS,
    ...v1Fixture,
    ...overrides,
    version: 2,
    hotkeys: { ...DEFAULT_HOTKEYS }
  }
}

describe('settings v2 migration', () => {
  it('migrates a v1 file to v2 and preserves every old choice', () => {
    const parsed = parseSettingsJson(JSON.stringify(v1Fixture))
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings).toEqual(expectedMigratedV1())
    expect(parsed.settings).toMatchObject({
      version: 2,
      activityLevel: 'low',
      performanceMode: 'normal',
      randomActions: true,
      actionSounds: true,
      fullscreenPeek: true,
      peekFrequency: 'standard',
      sleepEnabled: true,
      sleepAfterIdleSec: 1200,
      wakeLieInSec: 3,
      closeSignEnabled: true,
      startHidden: false
    })
    expect(parsed.settings.hotkeys).toEqual({ ...DEFAULT_HOTKEYS })
  })

  it('keeps an explicit v1 autostart=true and preserves an explicit false', () => {
    expect(parseSettingsJson(JSON.stringify({ ...v1Fixture, autostart: true })).settings.autostart).toBe(true)
    expect(parseSettingsJson(JSON.stringify({ ...v1Fixture, autostart: false })).settings.autostart).toBe(false)
  })

  it('keeps the old v1 default autostart=false when the field is missing', () => {
    const parsed = parseSettingsJson('{"version":1,"size":300}')
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings).toEqual({
      ...DEFAULT_SETTINGS,
      size: 300,
      autostart: false
    })
  })

  it('accepts a current v2 file and uses the new-install autostart default', () => {
    const parsed = parseSettingsJson('{"version":2,"size":300}')
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings).toEqual({ ...DEFAULT_SETTINGS, size: 300 })
    expect(parsed.settings.autostart).toBe(true)
  })

  it('keeps an explicit v2 autostart=false', () => {
    const parsed = parseSettingsJson('{"version":2,"autostart":false}')
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings).toMatchObject({ version: 2, autostart: false })
  })

  it('rejects future versions as corrupted and falls back to v2 defaults', () => {
    for (const text of ['{"version":3,"size":300}', '{"version":0,"size":300}', '{"version":"2","size":300}']) {
      expect(parseSettingsJson(text)).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    }
  })
})

describe('settings v2 clamping and validation', () => {
  it('clamps new numeric fields and falls back on invalid enum/boolean values', () => {
    const lower = parseSettings({
      size: 1,
      volume: -2,
      longPressMs: 1,
      darkThreshold: 1,
      sleepAfterIdleSec: 0,
      wakeLieInSec: 0,
      activityLevel: 'hyper',
      performanceMode: 'ultra',
      peekFrequency: 'sometimes',
      randomActions: 'yes'
    })
    expect(lower).toMatchObject({
      size: 80,
      volume: 0,
      longPressMs: 1000,
      darkThreshold: 10,
      sleepAfterIdleSec: 60,
      wakeLieInSec: 1,
      activityLevel: 'low',
      performanceMode: 'normal',
      peekFrequency: 'standard',
      randomActions: true
    })

    const upper = parseSettings({
      size: 999,
      volume: 9,
      longPressMs: 9999,
      darkThreshold: 999,
      sleepAfterIdleSec: 999999,
      wakeLieInSec: 999
    })
    expect(upper).toMatchObject({
      size: 500,
      volume: 1,
      longPressMs: 2000,
      darkThreshold: 60,
      sleepAfterIdleSec: 86400,
      wakeLieInSec: 60
    })
  })

  it('clamps out-of-range numbers in JSON without treating the file as corrupted', () => {
    const parsed = parseSettingsJson(
      '{"version":2,"size":999,"volume":9,"sleepAfterIdleSec":0,"wakeLieInSec":999}'
    )
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings).toMatchObject({
      size: 500,
      volume: 1,
      sleepAfterIdleSec: 60,
      wakeLieInSec: 60
    })
  })

  it('treats wrong v2 enum/boolean field types in JSON as corrupted', () => {
    expect(parseSettingsJson('{"version":2,"activityLevel":"hyper"}')).toEqual({
      settings: DEFAULT_SETTINGS,
      corrupted: true
    })
    expect(parseSettingsJson('{"version":2,"performanceMode":"ultra"}').corrupted).toBe(true)
    expect(parseSettingsJson('{"version":2,"randomActions":"yes"}').corrupted).toBe(true)
  })
})

describe('settings v2 hotkeys', () => {
  it('fills missing actions, clears null/blank entries, truncates long strings, and ignores unknown keys', () => {
    const long = 'Control+' + 'A'.repeat(80)
    const settings = parseSettings({
      hotkeys: {
        photo: null,
        feed: '   ',
        wave: long,
        unknown: 'Control+Q'
      }
    })
    expect(settings.hotkeys.photo).toBeNull()
    expect(settings.hotkeys.feed).toBeNull()
    expect(settings.hotkeys.wave).toBe(long.trim().slice(0, 64))
    expect(settings.hotkeys.togglePet).toBe(DEFAULT_HOTKEYS.togglePet)
    expect(Object.hasOwn(settings.hotkeys, 'unknown')).toBe(false)
  })

  it('resets the whole hotkey map when the container is not an object', () => {
    expect(parseSettings({ hotkeys: 'bad' }).hotkeys).toEqual({ ...DEFAULT_HOTKEYS })
    expect(parseSettings({ hotkeys: [] }).hotkeys).toEqual({ ...DEFAULT_HOTKEYS })
    expect(parseSettings({ hotkeys: null }).hotkeys).toEqual({ ...DEFAULT_HOTKEYS })
  })

  it('accepts valid partial hotkeys in JSON and fills the rest from defaults', () => {
    const parsed = parseSettingsJson('{"version":2,"hotkeys":{"photo":null}}')
    expect(parsed.corrupted).toBe(false)
    expect(parsed.settings.hotkeys.photo).toBeNull()
    expect(parsed.settings.hotkeys.feed).toBe(DEFAULT_HOTKEYS.feed)
  })

  it('treats malformed hotkey containers/values in JSON as corrupted', () => {
    for (const text of [
      '{"version":2,"hotkeys":"bad"}',
      '{"version":2,"hotkeys":[]}',
      '{"version":2,"hotkeys":{"photo":5}}',
      '{"version":2,"hotkeys":{"photo":{"key":"P"}}}'
    ]) {
      expect(parseSettingsJson(text)).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    }
  })
})

describe('SettingsStore v2 persistence', () => {
  it('creates v2 defaults with autostart ON when settings.json is absent', async () => {
    const { path, store } = await temporaryStore()
    const settings = await store.load()
    expect(settings.version).toBe(2)
    expect(settings.autostart).toBe(true)
    expect(settings.hotkeys).toEqual({ ...DEFAULT_HOTKEYS })
    const saved = JSON.parse(await readFile(join(path, 'settings.json'), 'utf8')) as typeof settings
    expect(saved).toEqual(settings)
    const names = await readdir(path)
    expect(names.some((name) => /^settings\.corrupt-\d+-\d+\.json$/.test(name))).toBe(false)
  })

  it('migrates an existing v1 file, rewrites it as v2, and keeps autostart=false', async () => {
    const { path, store } = await temporaryStore()
    await writeFile(join(path, 'settings.json'), JSON.stringify(v1Fixture), 'utf8')
    const settings = await store.load()
    expect(settings).toEqual(expectedMigratedV1())

    const saved = JSON.parse(await readFile(join(path, 'settings.json'), 'utf8')) as typeof settings
    expect(saved.version).toBe(2)
    expect(saved.autostart).toBe(false)
    expect(saved.size).toBe(321)
    expect(saved.nickname).toBe('Niko-v1')
    expect(saved.photoDir).toBe('D:\\NikoPhotos')
    expect(saved.activityLevel).toBe('low')
    expect(saved.hotkeys).toEqual({ ...DEFAULT_HOTKEYS })

    const names = await readdir(path)
    expect(names.some((name) => /^settings\.corrupt-\d+-\d+\.json$/.test(name))).toBe(false)
  })

  it('backs up an invalid future-version file and restores v2 defaults', async () => {
    const { path, store } = await temporaryStore()
    await writeFile(join(path, 'settings.json'), '{"version":3,"size":300}', 'utf8')
    const settings = await store.load()
    expect(settings.version).toBe(2)
    expect(settings.autostart).toBe(true)
    expect(settings.size).toBe(220)

    const names = await readdir(path)
    expect(names.some((name) => /^settings\.corrupt-\d+-\d+\.json$/.test(name))).toBe(true)
    const saved = JSON.parse(await readFile(join(path, 'settings.json'), 'utf8')) as typeof settings
    expect(saved.version).toBe(2)
    expect(saved.autostart).toBe(true)
  })
})

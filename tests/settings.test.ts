import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings, parseSettingsJson } from '../src/shared/settings'

describe('settings validation', () => {
  it('uses the settings v2 defaults when fields are missing', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toMatchObject({
      version: 2,
      autostart: true,
      size: 220,
      volume: 0.4,
      longPressMs: 1500,
      darkThreshold: 30,
      autoTorch: true,
      clickSounds: true,
      particles: true,
      activityLevel: 'low',
      performanceMode: 'normal',
      peekFrequency: 'standard',
      sleepAfterIdleSec: 360,
      wakeLieInSec: 3
    })
  })

  it('clamps numeric bounds and trims nickname while preserving valid booleans', () => {
    const settings = parseSettings({
      size: 900,
      volume: -0.2,
      longPressMs: 2222,
      darkThreshold: 1,
      nickname: 'x'.repeat(30),
      muted: true,
      lastX: 123.8
    })
    expect(settings).toMatchObject({
      size: 500,
      volume: 0,
      longPressMs: 2000,
      darkThreshold: 10,
      nickname: 'x'.repeat(24),
      muted: true,
      lastX: 124
    })
    expect(parseSettings({ size: 12, volume: 3, longPressMs: 500, darkThreshold: 90 })).toMatchObject({
      size: 80, volume: 1, longPressMs: 1000, darkThreshold: 60
    })
  })

  it('keeps desktop and photo choices while bounding the new sliders', () => {
    expect(parseSettings({
      version: 2,
      opacity: 0.1,
      walkEnabled: false,
      walkFrequency: 'high',
      walkSpeedMultiplier: 4,
      shadowEnabled: false,
      idleMicroMotion: false,
      photoPrefix: '旅途',
      photoScope: 'all',
      photoNotify: true,
      sleepAfterIdleSec: 3600
    })).toMatchObject({
      opacity: 0.3,
      walkEnabled: false,
      walkFrequency: 'high',
      walkSpeedMultiplier: 2,
      shadowEnabled: false,
      idleMicroMotion: false,
      photoPrefix: '旅途',
      photoScope: 'all',
      photoNotify: true,
      sleepAfterIdleSec: 3600
    })
  })

  it('recovers from malformed JSON and rejects future/incompatible schema versions', () => {
    expect(parseSettingsJson('{"size":')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('{"version":3,"size":300}')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('{"version":1,"size":"large"}')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('null')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })

    // v1 is accepted and migrated to v2; the old file default autostart=false wins.
    expect(parseSettingsJson('{"version":1,"size":300}')).toMatchObject({
      settings: { version: 2, size: 300, autostart: false },
      corrupted: false
    })
    // v2 is a valid current schema; a missing autostart uses the new-install default true.
    expect(parseSettingsJson('{"version":2,"size":300}')).toMatchObject({
      settings: { version: 2, size: 300, autostart: true },
      corrupted: false
    })
  })
})

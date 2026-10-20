import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings, parseSettingsJson } from '../src/shared/settings'

describe('settings validation', () => {
  it('uses the M1 defaults when fields are missing', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toMatchObject({
      version: 1,
      size: 220,
      volume: 0.4,
      autostart: false,
      longPressMs: 1500,
      darkThreshold: 30,
      autoTorch: true,
      clickSounds: true,
      particles: true
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

  it('recovers from malformed JSON and incompatible schema versions', () => {
    expect(parseSettingsJson('{"size":')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('{"version":2,"size":300}')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('{"version":1,"size":"large"}')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('null')).toEqual({ settings: DEFAULT_SETTINGS, corrupted: true })
    expect(parseSettingsJson('{"version":1,"size":300}')).toMatchObject({
      settings: { size: 300 }, corrupted: false
    })
  })
})

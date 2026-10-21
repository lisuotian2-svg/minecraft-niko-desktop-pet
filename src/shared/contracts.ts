/**
 * Shared contracts frozen by the Lead. Keep this file free of Electron/Three imports:
 * it is consumed by main, preload and renderer.
 */

export type ActionId =
  | 'togglePet'
  | 'photo'
  | 'settings'
  | 'feed'
  | 'pet'
  | 'torch'
  | 'dance'
  | 'wave'
  | 'sleep'
  | 'wake'

export type ActionSource = 'hotkey' | 'tray' | 'ui' | 'gesture'

export interface ActionRequest {
  id: ActionId
  source: ActionSource
}

export interface ActionResult {
  id: ActionId
  ok: boolean
  reason?: string
}

export const ACTION_LABELS: Readonly<Record<ActionId, string>> = Object.freeze({
  togglePet: '显示 / 隐藏 Niko',
  photo: '拍照',
  settings: '打开设置',
  feed: '喂食',
  pet: '摸头',
  torch: '切换火把',
  dance: '跳舞',
  wave: '挥手',
  sleep: '睡觉',
  wake: '叫醒'
})

/** Safe first-run defaults. Users can clear or rebind every entry in settings. */
export const DEFAULT_HOTKEYS: Readonly<Record<ActionId, string | null>> = Object.freeze({
  togglePet: 'Control+Alt+Shift+N',
  photo: 'Control+Alt+P',
  settings: 'Control+Alt+Shift+S',
  feed: 'Control+Alt+Shift+F',
  pet: 'Control+Alt+Shift+M',
  torch: 'Control+Alt+Shift+T',
  dance: 'Control+Alt+Shift+D',
  wave: 'Control+Alt+Shift+W',
  sleep: 'Control+Alt+Shift+Z',
  wake: 'Control+Alt+Shift+Q'
})

export type BehaviorMode =
  | 'idle'
  | 'walk'
  | 'pet'
  | 'stretch'
  | 'eat'
  | 'drag'
  | 'sit'
  | 'doze'
  | 'sleep'
  | 'wake'
  | 'peek'
  | 'close'

export type ActivityLevel = 'low' | 'normal' | 'high'
export const ACTIVITY_LEVELS: readonly ActivityLevel[] = ['low', 'normal', 'high']
export const ACTIVITY_LABELS: Readonly<Record<ActivityLevel, string>> = Object.freeze({
  low: '低打扰（5–15 分钟一次小动作）',
  normal: '普通（2–5 分钟）',
  high: '活跃（1–2 分钟）'
})

export type PerformanceMode = 'simple' | 'normal' | 'gorgeous'
export const PERFORMANCE_MODES: readonly PerformanceMode[] = ['simple', 'normal', 'gorgeous']
export interface PerformancePreset {
  mode: PerformanceMode
  label: string
  ambientOcclusion: boolean
  outline: boolean
  antialias: boolean
  idleMicroMotion: boolean
  particleScale: number
  maxFps: 30 | 60
}
export const PERFORMANCE_PRESETS: Readonly<Record<PerformanceMode, PerformancePreset>> = Object.freeze({
  simple: Object.freeze({
    mode: 'simple', label: '简约', ambientOcclusion: false, outline: false, antialias: false,
    idleMicroMotion: false, particleScale: 0.55, maxFps: 30
  }),
  normal: Object.freeze({
    mode: 'normal', label: '普通', ambientOcclusion: true, outline: true, antialias: true,
    idleMicroMotion: true, particleScale: 0.8, maxFps: 30
  }),
  gorgeous: Object.freeze({
    mode: 'gorgeous', label: '华丽', ambientOcclusion: true, outline: true, antialias: true,
    idleMicroMotion: true, particleScale: 1, maxFps: 60
  })
})

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplaySnapshot {
  id: number
  bounds: Bounds
  workArea: Bounds
  scaleFactor: number
  primary: boolean
}

export type PeekEdge = 'left' | 'right' | 'bottom'
export type PeekPhase = 'idle' | 'hidden' | 'peeking' | 'revealed' | 'returning'

/**
 * Main owns the fullscreen watcher and window placement; renderer owns the
 * head-only pose. `phase` is the only state the renderer needs for pose transitions.
 */
export interface FullscreenState {
  active: boolean
  displayId: number | null
  edge: PeekEdge
  phase: PeekPhase
  windowBounds: Bounds | null
  headAnchor: { x: number; y: number } | null
  revealUntil: number | null
}

export const EMPTY_FULLSCREEN_STATE: Readonly<FullscreenState> = Object.freeze({
  active: false,
  displayId: null,
  edge: 'bottom',
  phase: 'idle',
  windowBounds: null,
  headAnchor: null,
  revealUntil: null
})

/** Close prompt: a hand + Minecraft sign peeks from an edge; the body never appears. */
export type SignEdge = 'left' | 'right' | 'bottom'
export type SignPhase = 'hidden' | 'entering' | 'holding' | 'leaving'

export interface CloseSignState {
  visible: boolean
  edge: SignEdge
  phase: SignPhase
  windowBounds: Bounds | null
}

export const IPC_CHANNELS = Object.freeze({
  peekState: 'pet:peek-state',
  action: 'pet:action',
  actionResult: 'pet:action-result',
  closeSign: 'pet:close-sign',
  performance: 'pet:performance',
  activity: 'pet:activity'
})

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && Object.hasOwn(ACTION_LABELS, value)
}

export function isPerformanceMode(value: unknown): value is PerformanceMode {
  return value === 'simple' || value === 'normal' || value === 'gorgeous'
}

export function isActivityLevel(value: unknown): value is ActivityLevel {
  return value === 'low' || value === 'normal' || value === 'high'
}

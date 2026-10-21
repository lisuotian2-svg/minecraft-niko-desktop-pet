import type { ActivityLevel, BehaviorMode } from '../shared/contracts'

/**
 * Life Director — L1 pure logic.
 *
 * This file intentionally has no Three.js, DOM animation, rAF loop or timer.
 * The renderer host (later L1 integration) calls:
 *   life.tick(now, context)
 *   director.update(now, context)
 * and applies the returned decision/micro-motion through the existing action
 * lock. Keeping this pure makes it testable and prevents it from fighting
 * gestures/peek/close.
 *
 * Numbers (energy/mood/boredom/affection) are hidden internal state. They must
 * never be rendered on the pet canvas.
 */

export const LIFE_STATE_VERSION = 1
export const LIFE_STORAGE_KEY = 'niko-pet.life.v1'

export const LIFE_ACTIONS = [
  'stop-look',
  'stretch',
  'yawn',
  'groom',
  'wander',
  'eat',
  'sit',
  'doze',
  'sleep',
  'approach-cursor'
] as const
export type LifeActionId = (typeof LIFE_ACTIONS)[number]

export const MICRO_MOTIONS = [
  'breath-shift',
  'glance',
  'weight-shift',
  'toe-tap',
  'hat-sway',
  'purr',
  'sigh'
] as const
export type MicroMotionKind = (typeof MICRO_MOTIONS)[number]

export interface LifeStats {
  /** 0..1 */
  energy: number
  /** 0..1 general mood, not a visible meter */
  mood: number
  /** 0..1, grows while awake with nothing to do */
  boredom: number
  /** 0..1, slowly earned by petting/feeding */
  affection: number
}

export interface LifeMemory {
  lastInteractionAt: number | null
  lastPetAt: number | null
  lastFeedAt: number | null
  lastSleepAt: number | null
  lastWakeAt: number | null
  lastAutonomousAt: number | null
  lastSleepDurationMs: number | null
  averageSleepDurationMs: number | null
  petStreak: number
  overpetUntil: number | null
  interactionCount: number
  lastAction: LifeActionId | null
}

export interface LifeSnapshot {
  version: typeof LIFE_STATE_VERSION
  savedAt: number
  stats: LifeStats
  memory: LifeMemory
}

export interface LifeTickContext {
  mode: BehaviorMode
  walking: boolean
  systemIdleSec: number | null
  fullscreen: boolean
  gestureActive: boolean
  closing: boolean
  photoFrozen: boolean
  dark: boolean
}

export interface PetReaction {
  accepted: boolean
  reaction: 'enjoy' | 'soft-protest' | 'turn-away' | 'sleepy-ignore'
  /** The host can use this as a non-text feedback hint. */
  feedback: 'happy' | 'nudge' | 'annoyed' | 'sleepy'
  reason: 'ok' | 'overpet' | 'sleeping'
}

export interface CommandReaction {
  outcome: 'accept' | 'delay' | 'refuse'
  delayMs: number
  reaction: 'normal' | 'sleepy-ignore' | 'grumpy-delay' | 'tired-ignore'
  feedback: 'ok' | 'sleepy' | 'annoyed' | 'tired'
  reason: string
}

export interface WakePlan {
  lieInMs: number
  energyAfterSleep: number
}

export interface LifeDebugState {
  stats: LifeStats
  memory: LifeMemory
  sleeping: boolean
  dirty: boolean
}

export const DEFAULT_LIFE_STATS: Readonly<LifeStats> = Object.freeze({
  energy: 0.78,
  mood: 0.62,
  boredom: 0.18,
  affection: 0.4
})

const DEFAULT_MEMORY: Readonly<LifeMemory> = Object.freeze({
  lastInteractionAt: null,
  lastPetAt: null,
  lastFeedAt: null,
  lastSleepAt: null,
  lastWakeAt: null,
  lastAutonomousAt: null,
  lastSleepDurationMs: null,
  averageSleepDurationMs: null,
  petStreak: 0,
  overpetUntil: null,
  interactionCount: 0,
  lastAction: null
})

// Per-second rates. Tuned for a lazy companion: noticeable over tens of
// minutes, but not a hunger/energy minigame.
const WAKE_ENERGY_DRAIN = 0.00006
const BOREDOM_GAIN = 0.00008
const MOOD_DRIFT = 0.00001
const SLEEP_ENERGY_GAIN = 0.0008
const SLEEP_BOREDOM_DRAIN = 0.00005
const LOW_ENERGY_MOOD_PULL = 0.000006
const MAX_OFFLINE_SEC = 8 * 60 * 60
const PET_STREAK_WINDOW_MS = 3500
const OVERPET_WINDOW_MS = 4000

export interface ActionEffect {
  energy: number
  mood: number
  boredom: number
  baseDurationMs: number
}

export const ACTION_EFFECTS: Readonly<Record<LifeActionId, ActionEffect>> = Object.freeze({
  'stop-look': { energy: -0.001, mood: 0.004, boredom: -0.08, baseDurationMs: 4200 },
  stretch: { energy: -0.008, mood: 0.012, boredom: -0.13, baseDurationMs: 2500 },
  yawn: { energy: -0.002, mood: 0.004, boredom: -0.03, baseDurationMs: 2200 },
  groom: { energy: -0.004, mood: 0.01, boredom: -0.2, baseDurationMs: 3600 },
  wander: { energy: -0.018, mood: 0.008, boredom: -0.16, baseDurationMs: 9000 },
  eat: { energy: 0.06, mood: 0.03, boredom: -0.18, baseDurationMs: 4200 },
  sit: { energy: -0.002, mood: 0.006, boredom: -0.05, baseDurationMs: 12000 },
  doze: { energy: 0.012, mood: 0.008, boredom: -0.03, baseDurationMs: 30000 },
  sleep: { energy: 0, mood: 0.01, boredom: 0, baseDurationMs: 0 },
  'approach-cursor': { energy: -0.006, mood: 0.014, boredom: -0.1, baseDurationMs: 6500 }
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asTime(value: unknown): number | null {
  const num = asNullableNumber(value)
  return num !== null && num >= 0 ? num : null
}

function copyStats(stats: LifeStats): LifeStats {
  return {
    energy: clamp01(stats.energy),
    mood: clamp01(stats.mood),
    boredom: clamp01(stats.boredom),
    affection: clamp01(stats.affection)
  }
}

function copyMemory(memory: LifeMemory): LifeMemory {
  return {
    lastInteractionAt: asTime(memory.lastInteractionAt),
    lastPetAt: asTime(memory.lastPetAt),
    lastFeedAt: asTime(memory.lastFeedAt),
    lastSleepAt: asTime(memory.lastSleepAt),
    lastWakeAt: asTime(memory.lastWakeAt),
    lastAutonomousAt: asTime(memory.lastAutonomousAt),
    lastSleepDurationMs: asNullableNumber(memory.lastSleepDurationMs),
    averageSleepDurationMs: asNullableNumber(memory.averageSleepDurationMs),
    petStreak: Math.max(0, Math.trunc(asNumber(memory.petStreak, 0))),
    overpetUntil: asTime(memory.overpetUntil),
    interactionCount: Math.max(0, Math.trunc(asNumber(memory.interactionCount, 0))),
    lastAction: memory.lastAction !== null && (LIFE_ACTIONS as readonly string[]).includes(memory.lastAction)
      ? memory.lastAction
      : null
  }
}

function copySnapshot(snapshot: LifeSnapshot): LifeSnapshot {
  return {
    version: LIFE_STATE_VERSION,
    savedAt: asNumber(snapshot.savedAt, 0),
    stats: copyStats(snapshot.stats),
    memory: copyMemory(snapshot.memory)
  }
}

/** Parse localStorage JSON without trusting it. Returns null for bad/old data. */
export function parseLifeSnapshot(raw: unknown): LifeSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (record.version !== LIFE_STATE_VERSION) return null
  const stats = record.stats
  const memory = record.memory
  if (typeof stats !== 'object' || stats === null) return null
  if (typeof memory !== 'object' || memory === null) return null
  const statsRecord = stats as Record<string, unknown>
  const memoryRecord = memory as Record<string, unknown>
  const candidate: LifeSnapshot = {
    version: LIFE_STATE_VERSION,
    savedAt: asNumber(record.savedAt, 0),
    stats: {
      energy: asNumber(statsRecord.energy, DEFAULT_LIFE_STATS.energy),
      mood: asNumber(statsRecord.mood, DEFAULT_LIFE_STATS.mood),
      boredom: asNumber(statsRecord.boredom, DEFAULT_LIFE_STATS.boredom),
      affection: asNumber(statsRecord.affection, DEFAULT_LIFE_STATS.affection)
    },
    memory: {
      lastInteractionAt: asTime(memoryRecord.lastInteractionAt),
      lastPetAt: asTime(memoryRecord.lastPetAt),
      lastFeedAt: asTime(memoryRecord.lastFeedAt),
      lastSleepAt: asTime(memoryRecord.lastSleepAt),
      lastWakeAt: asTime(memoryRecord.lastWakeAt),
      lastAutonomousAt: asTime(memoryRecord.lastAutonomousAt),
      lastSleepDurationMs: asNullableNumber(memoryRecord.lastSleepDurationMs),
      averageSleepDurationMs: asNullableNumber(memoryRecord.averageSleepDurationMs),
      petStreak: Math.max(0, Math.trunc(asNumber(memoryRecord.petStreak, 0))),
      overpetUntil: asTime(memoryRecord.overpetUntil),
      interactionCount: Math.max(0, Math.trunc(asNumber(memoryRecord.interactionCount, 0))),
      lastAction: typeof memoryRecord.lastAction === 'string' &&
        (LIFE_ACTIONS as readonly string[]).includes(memoryRecord.lastAction)
        ? memoryRecord.lastAction as LifeActionId
        : null
    }
  }
  return copySnapshot(candidate)
}

export class LifeModel {
  private stats: LifeStats
  private memory: LifeMemory
  private lastTickAt: number
  private sleeping = false
  private sleepStartedAt: number | null = null
  private dirty = false

  constructor(now = Date.now()) {
    this.stats = { ...DEFAULT_LIFE_STATS }
    this.memory = { ...DEFAULT_MEMORY }
    this.lastTickAt = now
  }

  getStats(): LifeStats { return { ...this.stats } }

  getMemory(): LifeMemory { return { ...this.memory } }

  get isDirty(): boolean { return this.dirty }

  get isSleeping(): boolean { return this.sleeping }

  clearDirty(): void { this.dirty = false }

  getDebugState(): LifeDebugState {
    return {
      stats: this.getStats(),
      memory: this.getMemory(),
      sleeping: this.sleeping,
      dirty: this.dirty
    }
  }

  snapshot(now = Date.now()): LifeSnapshot {
    return {
      version: LIFE_STATE_VERSION,
      savedAt: now,
      stats: this.getStats(),
      memory: this.getMemory()
    }
  }

  restore(raw: unknown, now = Date.now()): boolean {
    const snapshot = parseLifeSnapshot(raw)
    if (!snapshot) return false
    this.stats = copyStats(snapshot.stats)
    this.memory = copyMemory(snapshot.memory)
    this.lastTickAt = now
    const offlineSec = clamp((now - snapshot.savedAt) / 1000, 0, MAX_OFFLINE_SEC)
    if (offlineSec > 0) {
      // Being closed for a while is rest, not a frozen clock.
      this.stats.energy = clamp01(this.stats.energy + offlineSec * 0.00002)
      this.stats.boredom = clamp01(this.stats.boredom - offlineSec * 0.00001)
    }
    // An overpet streak should not survive a restart as a punishment.
    this.memory.petStreak = 0
    this.memory.overpetUntil = null
    this.sleeping = false
    this.sleepStartedAt = null
    this.dirty = false
    return true
  }

  /**
   * Advance biological state. The host calls this from its existing animator
   * frame; dt is clamped so a lost/suspended frame cannot drain energy at once.
   */
  tick(now: number, context?: Partial<LifeTickContext>): void {
    const dt = clamp((now - this.lastTickAt) / 1000, 0, 300)
    this.lastTickAt = now
    if (dt <= 0) return
    if (this.sleeping) {
      this.stats.energy = clamp01(this.stats.energy + SLEEP_ENERGY_GAIN * dt)
      this.stats.boredom = clamp01(this.stats.boredom - SLEEP_BOREDOM_DRAIN * dt)
      this.stats.mood = clamp01(this.stats.mood + MOOD_DRIFT * dt * 0.5)
    } else {
      this.stats.energy = clamp01(this.stats.energy - WAKE_ENERGY_DRAIN * dt)
      this.stats.boredom = clamp01(this.stats.boredom + BOREDOM_GAIN * dt)
      const moodTarget = 0.55 + (this.stats.affection - 0.4) * 0.1
      this.stats.mood += (moodTarget - this.stats.mood) * Math.min(1, MOOD_DRIFT * dt * 60)
      if (this.stats.energy < 0.2) this.stats.mood = clamp01(this.stats.mood - LOW_ENERGY_MOOD_PULL * dt)
      if (this.stats.boredom > 0.8) this.stats.mood = clamp01(this.stats.mood - 0.000004 * dt)
      // A dark/fullscreen idle period is not social time; no direct stat change.
      void context
    }
    this.dirty = true
  }

  onPet(now: number): PetReaction {
    this.memory.lastInteractionAt = now
    this.memory.lastPetAt = now
    this.memory.interactionCount += 1
    if (this.sleeping) {
      this.dirty = true
      return { accepted: false, reaction: 'sleepy-ignore', feedback: 'sleepy', reason: 'sleeping' }
    }
    const previousPetAt = this.memory.lastPetAt
    const previousStreak = this.memory.petStreak
    const continuous = previousPetAt !== null && now - previousPetAt <= PET_STREAK_WINDOW_MS
    this.memory.petStreak = continuous ? previousStreak + 1 : 1
    if (this.memory.petStreak > 1) {
      // Do not double-count the same interaction when lastPetAt was already set
      // by onPet above; this branch is for the memory bookkeeping only.
      void previousStreak
    }
    const overpet = this.memory.petStreak >= 3 ||
      (this.memory.overpetUntil !== null && now < this.memory.overpetUntil)
    if (overpet) {
      this.memory.overpetUntil = now + OVERPET_WINDOW_MS
      this.stats.affection = clamp01(this.stats.affection + 0.004)
      this.stats.mood = clamp01(this.stats.mood - 0.008)
      this.dirty = true
      return {
        accepted: true,
        reaction: this.memory.petStreak >= 4 ? 'turn-away' : 'soft-protest',
        feedback: 'annoyed',
        reason: 'overpet'
      }
    }
    this.stats.affection = clamp01(this.stats.affection + 0.024)
    this.stats.mood = clamp01(this.stats.mood + 0.02)
    this.stats.boredom = clamp01(this.stats.boredom - 0.03)
    this.dirty = true
    return { accepted: true, reaction: 'enjoy', feedback: 'happy', reason: 'ok' }
  }

  onFeed(now: number): PetReaction {
    this.memory.lastInteractionAt = now
    this.memory.lastFeedAt = now
    this.memory.interactionCount += 1
    if (this.sleeping) {
      this.dirty = true
      return { accepted: false, reaction: 'sleepy-ignore', feedback: 'sleepy', reason: 'sleeping' }
    }
    this.stats.energy = clamp01(this.stats.energy + 0.08)
    this.stats.mood = clamp01(this.stats.mood + 0.03)
    this.stats.boredom = clamp01(this.stats.boredom - 0.12)
    this.stats.affection = clamp01(this.stats.affection + 0.012)
    this.dirty = true
    return { accepted: true, reaction: 'enjoy', feedback: 'happy', reason: 'ok' }
  }

  onDrag(now: number): void {
    this.memory.lastInteractionAt = now
    this.stats.mood = clamp01(this.stats.mood - 0.006)
    this.stats.energy = clamp01(this.stats.energy - 0.004)
    this.dirty = true
  }

  /**
   * Commands may be accepted, delayed or refused, but every outcome carries a
   * feedback hint so the host can show a non-text gesture (eye/ear/turn).
   */
  onCommand(action: LifeActionId | string, now: number, context?: Partial<LifeTickContext>): CommandReaction {
    this.memory.lastInteractionAt = now
    this.memory.interactionCount += 1
    this.dirty = true
    if (this.sleeping && action !== 'wake') {
      return {
        outcome: 'delay',
        delayMs: 900,
        reaction: 'sleepy-ignore',
        feedback: 'sleepy',
        reason: 'sleeping'
      }
    }
    if (context?.fullscreen || context?.photoFrozen || context?.closing) {
      return { outcome: 'refuse', delayMs: 0, reaction: 'tired-ignore', feedback: 'tired', reason: 'context' }
    }
    if (this.stats.energy < 0.12 && action !== 'sleep' && action !== 'wake') {
      return { outcome: 'refuse', delayMs: 0, reaction: 'tired-ignore', feedback: 'tired', reason: 'tired' }
    }
    if (this.memory.overpetUntil !== null && now < this.memory.overpetUntil &&
      (action === 'approach-cursor' || action === 'pet')) {
      return { outcome: 'delay', delayMs: 600, reaction: 'grumpy-delay', feedback: 'annoyed', reason: 'overpet' }
    }
    if (this.stats.mood < 0.25 && action !== 'sleep' && action !== 'wake') {
      return {
        outcome: 'delay',
        delayMs: 450 + Math.round(Math.random() * 450),
        reaction: 'grumpy-delay',
        feedback: 'annoyed',
        reason: 'mood'
      }
    }
    this.stats.mood = clamp01(this.stats.mood + 0.004)
    return { outcome: 'accept', delayMs: 0, reaction: 'normal', feedback: 'ok', reason: 'ok' }
  }

  onAutonomous(action: LifeActionId, now: number): void {
    const effect = ACTION_EFFECTS[action]
    this.stats.energy = clamp01(this.stats.energy + effect.energy)
    this.stats.mood = clamp01(this.stats.mood + effect.mood)
    this.stats.boredom = clamp01(this.stats.boredom + effect.boredom)
    this.memory.lastAutonomousAt = now
    this.memory.lastAction = action
    this.dirty = true
  }

  onSleepStart(now: number): void {
    if (this.sleeping) return
    this.sleeping = true
    this.sleepStartedAt = now
    this.memory.lastSleepAt = now
    this.memory.lastInteractionAt = now
    this.stats.mood = clamp01(this.stats.mood + 0.01)
    this.dirty = true
  }

  /** Returns the lie-in time for the wake sequence; host applies 2–4 s. */
  onWake(now: number): WakePlan {
    const sleptFor = this.sleepStartedAt !== null ? Math.max(0, now - this.sleepStartedAt) : 0
    if (sleptFor > 0) {
      this.memory.lastSleepDurationMs = sleptFor
      const oldAverage = this.memory.averageSleepDurationMs
      this.memory.averageSleepDurationMs = oldAverage === null
        ? sleptFor
        : oldAverage * 0.7 + sleptFor * 0.3
    }
    this.sleeping = false
    this.sleepStartedAt = null
    this.memory.lastWakeAt = now
    this.memory.lastInteractionAt = now
    this.stats.energy = clamp01(this.stats.energy + 0.02)
    this.stats.mood = clamp01(this.stats.mood + 0.01)
    this.dirty = true
    const lieInMs = clamp(2000 + (1 - this.stats.energy) * 1800, 2000, 4000)
    return { lieInMs: Math.round(lieInMs), energyAfterSleep: this.stats.energy }
  }

  shouldSleep(context: Partial<LifeTickContext>): { should: boolean; pressure: number; reason: string } {
    if (context.fullscreen || context.gestureActive || context.closing || context.photoFrozen) {
      return { should: false, pressure: 0, reason: 'busy' }
    }
    const idleSec = context.systemIdleSec ?? 0
    const idleFactor = clamp(idleSec / 600, 0, 1)
    const pressure = clamp01((1 - this.stats.energy) * 0.65 + idleFactor * 0.25 + this.stats.boredom * 0.1)
    if (this.sleeping) return { should: false, pressure, reason: 'already-sleeping' }
    if (pressure > 0.72 && this.stats.energy < 0.35 && idleSec >= 120) {
      return { should: true, pressure, reason: 'sleep-pressure' }
    }
    if (this.stats.energy < 0.18) {
      return { should: true, pressure, reason: 'low-energy' }
    }
    return { should: false, pressure, reason: 'awake' }
  }
}

// ---------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------

export const ACTIVITY_PROFILES: Readonly<Record<ActivityLevel, {
  actionMinMs: number
  actionMaxMs: number
  microMinMs: number
  microMaxMs: number
}>> = Object.freeze({
  low: { actionMinMs: 120_000, actionMaxMs: 300_000, microMinMs: 9_000, microMaxMs: 22_000 },
  normal: { actionMinMs: 60_000, actionMaxMs: 150_000, microMinMs: 6_000, microMaxMs: 14_000 },
  high: { actionMinMs: 25_000, actionMaxMs: 75_000, microMinMs: 4_000, microMaxMs: 9_000 }
})

export const ACTION_COOLDOWNS: Readonly<Record<LifeActionId, readonly [number, number]>> = Object.freeze({
  'stop-look': [30_000, 60_000],
  stretch: [120_000, 240_000],
  yawn: [90_000, 180_000],
  groom: [150_000, 300_000],
  wander: [180_000, 360_000],
  eat: [300_000, 600_000],
  sit: [300_000, 600_000],
  doze: [300_000, 600_000],
  sleep: [600_000, 1_200_000],
  'approach-cursor': [120_000, 240_000]
})

export const L1_DIRECTOR_ACTIONS: readonly LifeActionId[] = Object.freeze([
  'stop-look', 'stretch', 'yawn', 'groom', 'eat', 'sit', 'doze'
])

export const ALL_DIRECTOR_ACTIONS: readonly LifeActionId[] = Object.freeze([...LIFE_ACTIONS])

export interface DirectorContext {
  mode: BehaviorMode
  walking: boolean
  gestureActive: boolean
  closing: boolean
  frozen: boolean
  fullscreen: boolean
  photoFrozen: boolean
  userActive: boolean
  cursorNear: boolean
  systemIdleSec: number | null
  dark: boolean
  activityLevel: ActivityLevel
  availableActions?: readonly LifeActionId[]
}

export interface DirectorDecision {
  action: LifeActionId
  reason: string
  durationMs: number
  speedScale: number
  amplitudeScale: number
  variant: number
  interruptible: boolean
}

export interface MicroMotionDecision {
  kind: MicroMotionKind
  reason: string
  durationMs: number
  amplitudeScale: number
}

export interface DirectorResult {
  decision: DirectorDecision | null
  micro: MicroMotionDecision | null
  nextActionAt: number
  nextMicroAt: number
}

export interface LifeDirectorOptions {
  random?: () => number
  availableActions?: readonly LifeActionId[]
}

function unitRandom(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value)) return 0.5
  return clamp(value, 0, 1)
}

function duration(base: number, scale: number): number {
  return Math.max(500, Math.round(base * scale))
}

export class BehaviorDirector {
  private readonly random: () => number
  private readonly defaultAvailable: readonly LifeActionId[]
  private nextActionAt = 0
  private nextMicroAt = 0
  private microUntil = 0
  private readonly cooldowns = new Map<LifeActionId, number>()
  private readonly recent: LifeActionId[] = []
  private lastReason = 'init'

  constructor(private readonly life: LifeModel, options: LifeDirectorOptions = {}) {
    this.random = options.random ?? Math.random
    this.defaultAvailable = options.availableActions ?? L1_DIRECTOR_ACTIONS
  }

  /**
   * Pure-ish (injected random) decision step. The host calls this from its
   * existing frame; it creates no timers/rAF loop and does not start actions.
   */
  update(now: number, context: DirectorContext): DirectorResult {
    if (this.nextActionAt === 0) {
      const profile = this.profile(context.activityLevel)
      this.nextActionAt = now + this.range(profile.actionMinMs, profile.actionMaxMs) * 0.5
      this.nextMicroAt = now + this.range(profile.microMinMs, profile.microMaxMs)
    }
    const blocked = context.closing || context.frozen || context.fullscreen ||
      context.photoFrozen || context.gestureActive ||
      (context.mode !== 'idle' && context.mode !== 'walk') || context.walking
    if (blocked) {
      return {
        decision: null,
        micro: null,
        nextActionAt: this.nextActionAt,
        nextMicroAt: this.nextMicroAt
      }
    }

    let decision: DirectorDecision | null = null
    // Low interruption: while the user is active, no autonomous body action.
    // Micro-motions are still allowed, they are what keeps it alive.
    if (!context.userActive && now >= this.nextActionAt) {
      decision = this.selectAction(now, context)
      if (decision) {
        this.life.onAutonomous(decision.action, now)
        this.recent.push(decision.action)
        if (this.recent.length > 4) this.recent.shift()
        this.lastReason = decision.reason
      }
      const profile = this.profile(context.activityLevel)
      this.nextActionAt = now + this.range(profile.actionMinMs, profile.actionMaxMs)
    }

    let micro: MicroMotionDecision | null = null
    if (now >= this.nextMicroAt && now >= this.microUntil) {
      micro = this.selectMicro(now, context)
      const profile = this.profile(context.activityLevel)
      this.nextMicroAt = now + this.range(profile.microMinMs, profile.microMaxMs)
      if (micro) this.microUntil = now + micro.durationMs
    }

    return {
      decision,
      micro,
      nextActionAt: this.nextActionAt,
      nextMicroAt: this.nextMicroAt
    }
  }

  reset(now: number, activityLevel: ActivityLevel = 'low'): void {
    this.cooldowns.clear()
    this.recent.length = 0
    this.nextActionAt = now + this.range(
      this.profile(activityLevel).actionMinMs,
      this.profile(activityLevel).actionMaxMs
    ) * 0.4
    this.nextMicroAt = now + 2500
    this.microUntil = 0
  }

  getDebugState(): {
    nextActionAt: number
    nextMicroAt: number
    lastReason: string
    recent: readonly LifeActionId[]
    cooldowns: Readonly<Record<string, number>>
  } {
    const cooldowns: Record<string, number> = {}
    for (const [action, until] of this.cooldowns) cooldowns[action] = until
    return {
      nextActionAt: this.nextActionAt,
      nextMicroAt: this.nextMicroAt,
      lastReason: this.lastReason,
      recent: [...this.recent],
      cooldowns
    }
  }

  private profile(level: ActivityLevel): { actionMinMs: number; actionMaxMs: number; microMinMs: number; microMaxMs: number } {
    return ACTIVITY_PROFILES[level] ?? ACTIVITY_PROFILES.low
  }

  private range(min: number, max: number): number {
    return min + unitRandom(this.random) * Math.max(0, max - min)
  }

  private selectAction(now: number, context: DirectorContext): DirectorDecision | null {
    const available = context.availableActions ?? this.defaultAvailable
    const allowed = new Set(available)
    const stats = this.life.getStats()
    const recentPenalty = (action: LifeActionId): number => {
      if (this.recent[this.recent.length - 1] === action) return 0.35
      if (this.recent.includes(action)) return 0.65
      return 1
    }
    const weights = new Map<LifeActionId, number>()
    const set = (action: LifeActionId, weight: number): void => {
      if (!allowed.has(action)) return
      const until = this.cooldowns.get(action) ?? 0
      if (now < until) return
      weights.set(action, Math.max(0, weight * recentPenalty(action)))
    }
    // Base weights are intentionally modest; boredom and low energy reshape them.
    set('stop-look', 0.2 + stats.boredom * 0.5)
    set('stretch', 0.08 + (1 - stats.energy) * 0.2 + stats.boredom * 0.18)
    set('yawn', 0.05 + (1 - stats.energy) * 0.4)
    set('groom', 0.06 + stats.boredom * 0.35)
    set('wander', 0.08 + stats.energy * 0.12 + stats.boredom * 0.16)
    set('eat', 0.03 + (1 - stats.energy) * 0.18 + 0.03)
    set('sit', 0.05 + (1 - stats.energy) * 0.3)
    set('doze', 0.03 + (1 - stats.energy) * 0.5)
    if (stats.energy < 0.35) set('sleep', 0.1 + (1 - stats.energy) * 0.5)
    if (context.cursorNear && stats.affection > 0.5) {
      set('approach-cursor', 0.08 + stats.affection * 0.2)
    }
    if (context.dark) {
      const wander = weights.get('wander')
      if (wander !== undefined) weights.set('wander', wander * 0.6)
    }
    if ((context.systemIdleSec ?? 0) > 300 && stats.energy < 0.45) {
      const sit = weights.get('sit')
      const doze = weights.get('doze')
      if (sit !== undefined) weights.set('sit', sit * 1.3)
      if (doze !== undefined) weights.set('doze', doze * 1.4)
    }
    const entries: Array<{ action: LifeActionId; weight: number }> = []
    for (const [action, weight] of weights) {
      if (weight > 0) entries.push({ action, weight })
    }
    if (entries.length === 0) return null
    let total = 0
    for (const entry of entries) total += entry.weight
    let pick = unitRandom(this.random) * total
    let chosen: LifeActionId | null = null
    for (const entry of entries) {
      pick -= entry.weight
      if (pick <= 0) {
        chosen = entry.action
        break
      }
    }
    if (chosen === null) chosen = entries[entries.length - 1]?.action ?? null
    if (chosen === null) return null
    const effect = ACTION_EFFECTS[chosen]
    const cooldown = ACTION_COOLDOWNS[chosen]
    this.cooldowns.set(chosen, now + this.range(cooldown[0], cooldown[1]))
    const reason = this.reasonFor(chosen, context, stats)
    const baseDuration = chosen === 'sleep' ? 0 : effect.baseDurationMs
    return {
      action: chosen,
      reason,
      durationMs: baseDuration === 0 ? 0 : duration(baseDuration, 0.82 + unitRandom(this.random) * 0.36),
      speedScale: Math.round((0.86 + unitRandom(this.random) * 0.28) * 100) / 100,
      amplitudeScale: Math.round((0.82 + unitRandom(this.random) * 0.34) * 100) / 100,
      variant: Math.floor(unitRandom(this.random) * 3),
      interruptible: true
    }
  }

  private reasonFor(action: LifeActionId, context: DirectorContext, stats: LifeStats): string {
    if (action === 'sleep' || action === 'doze' || action === 'yawn') return stats.energy < 0.3 ? 'tired' : 'winding-down'
    if (action === 'eat') return stats.energy < 0.5 ? 'hungry-cat' : 'snack'
    if (action === 'approach-cursor') return 'social'
    if (action === 'wander') return stats.boredom > 0.5 ? 'bored' : 'curious'
    if (action === 'groom') return 'self-care'
    if (action === 'stretch') return stats.boredom > 0.4 ? 'restless' : 'wake-up'
    if (context.dark) return 'dim-room'
    return 'idle'
  }

  private selectMicro(now: number, context: DirectorContext): MicroMotionDecision | null {
    const stats = this.life.getStats()
    const weights = new Map<MicroMotionKind, number>()
    const set = (kind: MicroMotionKind, weight: number): void => {
      if (weight > 0) weights.set(kind, weight)
    }
    set('breath-shift', 0.25 + (1 - stats.energy) * 0.08)
    set('glance', 0.18 + stats.boredom * 0.2)
    set('weight-shift', 0.12 + (1 - stats.energy) * 0.12)
    set('toe-tap', stats.energy > 0.2 ? 0.08 + stats.boredom * 0.1 : 0)
    set('hat-sway', 0.07 + stats.boredom * 0.08)
    set('purr', context.userActive ? 0.03 : 0.08 + stats.affection * 0.12)
    set('sigh', 0.06 + (1 - stats.energy) * 0.2 + (1 - stats.mood) * 0.18)
    if (context.dark) {
      const glance = weights.get('glance')
      if (glance !== undefined) weights.set('glance', glance * 1.2)
    }
    const entries: Array<{ kind: MicroMotionKind; weight: number }> = []
    for (const [kind, weight] of weights) entries.push({ kind, weight })
    if (entries.length === 0) return null
    let total = 0
    for (const entry of entries) total += entry.weight
    let pick = unitRandom(this.random) * total
    let chosen: MicroMotionKind = 'breath-shift'
    for (const entry of entries) {
      pick -= entry.weight
      if (pick <= 0) {
        chosen = entry.kind
        break
      }
    }
    const baseDuration = chosen === 'purr' ? 1800 : chosen === 'sigh' ? 1400 : 900
    void now
    return {
      kind: chosen,
      reason: chosen === 'purr' ? 'affection' : chosen === 'sigh' ? 'mood' : 'alive',
      durationMs: duration(baseDuration, 0.75 + unitRandom(this.random) * 0.5),
      amplitudeScale: Math.round((0.7 + unitRandom(this.random) * 0.5) * 100) / 100
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence (renderer localStorage; no numeric UI)
// ---------------------------------------------------------------------------

export interface LifeStorage {
  read(): string | null
  write(value: string): void
  remove(): void
}

export class BrowserLifeStorage implements LifeStorage {
  read(): string | null {
    try {
      return globalThis.localStorage?.getItem(LIFE_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  }

  write(value: string): void {
    try {
      globalThis.localStorage?.setItem(LIFE_STORAGE_KEY, value)
    } catch {
      // A locked/private localStorage is not worth crashing the pet over.
    }
  }

  remove(): void {
    try {
      globalThis.localStorage?.removeItem(LIFE_STORAGE_KEY)
    } catch {
      // Ignore storage failures.
    }
  }
}

/**
 * Thin persistence wrapper. Writes are throttled; the host calls save on
 * important changes or at most once per interval. No timer is created here.
 */
export class LifeStore {
  private lastSavedAt = 0
  private lastError: string | null = null

  constructor(
    private readonly model: LifeModel,
    private readonly storage: LifeStorage = new BrowserLifeStorage(),
    private readonly minSaveIntervalMs = 30_000
  ) {}

  get error(): string | null { return this.lastError }

  load(now = Date.now()): boolean {
    const raw = this.storage.read()
    if (raw === null) return false
    try {
      const parsed: unknown = JSON.parse(raw)
      const ok = this.model.restore(parsed, now)
      if (ok) {
        this.lastSavedAt = now
        this.lastError = null
      }
      return ok
    } catch (error) {
      this.lastError = String(error)
      return false
    }
  }

  /** Save only when dirty and outside the throttle, unless force=true. */
  save(now = Date.now(), force = false): boolean {
    if (!force) {
      if (!this.model.isDirty) return false
      if (now - this.lastSavedAt < this.minSaveIntervalMs) return false
    }
    try {
      this.storage.write(JSON.stringify(this.model.snapshot(now)))
      this.model.clearDirty()
      this.lastSavedAt = now
      this.lastError = null
      return true
    } catch (error) {
      this.lastError = String(error)
      return false
    }
  }

  /** Important transitions (sleep, wake, feed, hide) should force a flush. */
  flush(now = Date.now()): boolean {
    return this.save(now, true)
  }
}

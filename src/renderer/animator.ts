import { Vector3 } from 'three'
import type { SkinViewer } from 'skinview3d'
import {
  EMPTY_FULLSCREEN_STATE,
  type ActionId,
  type BehaviorMode,
  type FullscreenState
} from '../shared/contracts'
import type { WalkDirection } from '../shared/walk'
import { walkSpeed } from '../shared/walk'
import { ElasticValue } from '../shared/elastic'
import { BlinkTexture } from './viewer'

const IDLE_YAW = -Math.PI / 8
// Head local yaw is ±55°. Anything outside that is solved by turning the whole
// body (0..360°); the head leads and the body follows on the shortest path.
const MAX_GAZE_YAW = (55 * Math.PI) / 180
// Input range stays generous (up to 60° pitch) but the rendered head pitch is
// clamped separately so the bottom corners of the 8×8 head box cannot visibly
// sink into the 12-unit body at extreme angles.
const MAX_GAZE_PITCH = Math.PI / 3
const HEAD_PITCH_LIMIT = 0.72
const HEAD_PITCH_LIFT = 0.35
const HEAD_TURN_TAU = 0.1
// 95% of a 180° body turn in ~1.0 s: 0.34 s time constant.
const BODY_TURN_TAU = 0.34
const WALK_BODY_TAU = 0.18
const BODY_TURN_TRIGGER = 0.05
const BODY_TURN_SETTLE = 0.08
const BEHIND_AMBIGUITY = 0.12
// Free idle only gets small, occasional body shifts (no continuous 360 spin).
const IDLE_BODY_TURN_ANGLE = 0.35
const IDLE_BODY_TURN_HOLD_MIN_MS = 2500
const IDLE_BODY_TURN_HOLD_MAX_MS = 5500
const IDLE_BODY_TURN_GAP_MIN_MS = 10_000
const IDLE_BODY_TURN_GAP_MAX_MS = 20_000
const STRETCH_DURATION_MS = 2500
const EAT_DURATION_MS = 3800
const PET_DURATION_MS = 2500
const PET_COOLDOWN_MS = 1500
// User decision 2026-10-21: cursor tracking is only a short reaction window
// after a real pet click. The pet must not continuously follow the desktop mouse.
const CURSOR_LOOK_MS = 2000
const LAND_DURATION_MS = 720

// Walk tuning. The leg swing is intentionally small: the window moves at
// walkSpeed() (~40 px/s at 420 px), so a large swing makes the feet skate.
// The step frequency is derived from the actual pixels-per-model-unit and
// actual window speed, which keeps the planted foot in sync for every size.
const WALK_LEG_SWING = 0.18
const WALK_ARM_SWING = 0.3
const WALK_LEG_LENGTH = 12
const WALK_MIN_STEP_HZ = 0.8
const WALK_MAX_STEP_HZ = 3.2
const PEEK_ZOOM = 0.9

export type AnimatorAction = 'eat' | 'stretch' | 'pet'

export type AnimatorEvent =
  | { type: 'pet' }
  | { type: 'peekReveal' }
  | { type: 'cancelled'; action: AnimatorAction }

export interface FrameInfo {
  now: number
  mode: BehaviorMode
  walking: boolean
  dragging: boolean
  visible: boolean
  jumpY: number
  scaleX: number
  scaleY: number
}

export interface AnimationState {
  walking: boolean
  facing: WalkDirection
  petting: boolean
  blinking: boolean
  walkBlend: number
  headYaw: number
  headPitch: number
  headRotationX: number
  headRotationY: number
  stretching: boolean
  dragging: boolean
  torchOn: boolean
  eating: boolean
  behaviorMode: BehaviorMode
  walkStepFrequency: number
  bodyYaw: number
  bodyTurning: boolean
  cursorLooking: boolean
  peeking: boolean
  inertiaLean: number
  elasticBob: number
  elasticSquash: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function blend(from: number, to: number, weight: number): number {
  return from + (to - from) * weight
}

/** Wrap an angle into (-π, π]. */
function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/** Shortest signed angular path from `from` to `to`, wrapped into (-π, π]. */
function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from)
}

/**
 * Renderer-side animation state. `mode` is the single action lock requested by
 * the frozen contracts: when an exclusive action is active, random actions and
 * clicks cannot stack on top of it. Walking remains an independent locomotion
 * flag because main owns the window movement; a pet reaction is allowed while
 * walking, but eat/stretch refuse to start while main is moving.
 */
export class PetAnimator {
  private walking = false
  private facing: WalkDirection = 1
  private walkBlend = 0
  private gaitPhase = 0
  private lastStepFrequency = 1.35
  private walkSpeedOverride: number | null = null
  private walkSpeedMultiplier = 1
  private idleMicroMotion = true
  private walkPosePaused = false
  private cursorX: number | null = null
  private cursorY: number | null = null
  private nextBlinkAt = performance.now() + 3000 + Math.random() * 4000
  private secondBlinkAt = 0
  private blinkUntil = 0
  private petUntil = 0
  private petEyesUntil = 0
  private cursorLookUntil = 0
  private lastPetAt = Number.NEGATIVE_INFINITY
  private glance = 0
  private glancePitch = 0
  private nextGlanceAt = performance.now() + 3500
  private blinkTexture: BlinkTexture | null = null
  private lastFrameAt = performance.now()
  private frameId = 0
  private headYaw = 0
  private headPitch = 0
  private footstep: (() => void) | null = null
  private dragging = false
  private dragBlend = 0
  private torchOn = false
  private torchBlend = 0
  private stretchStartedAt = 0
  private stretchUntil = 0
  private landingStartedAt = 0
  private eatStartedAt = 0
  private eatUntil = 0
  private frozen = false
  private mode: BehaviorMode = 'idle'
  private actionUntil = 0
  private bodyYaw = IDLE_YAW
  private bodyTurning = false
  private bodyTurnSign = 1
  private bodyTurnAmount = 0
  private idleBodyTarget = IDLE_YAW
  private idleBodyTurnUntil = 0
  private nextIdleBodyTurnAt = performance.now() + 8000 + Math.random() * 10_000
  private readonly eventListeners = new Set<(event: AnimatorEvent) => void>()
  private readonly frameListeners = new Set<(info: FrameInfo) => void>()
  private readonly scratchA = new Vector3()
  private readonly scratchB = new Vector3()
  private readonly scratchC = new Vector3()
  private peekState: FullscreenState = { ...EMPTY_FULLSCREEN_STATE }
  private peekMode = false
  private savedZoom = 0.55
  private readonly leanSpring = new ElasticValue(110, 12, 0.13)
  private readonly bobSpring = new ElasticValue(135, 14, 1.25)
  private readonly squashSpring = new ElasticValue(145, 14, 0.09)
  private lastWindowX: number | null = null
  private windowVelocityX = 0
  private sleepBlend = 0
  private maxFps: 30 | 60 = 30
  private lastRenderAt = 0

  constructor(private readonly viewer: SkinViewer) {
    this.bodyYaw = normalizeAngle(this.viewer.playerWrapper.rotation.y)
    // Animator owns pose updates; rendering is capped separately by the setting.
    this.viewer.renderPaused = true
    this.frameId = requestAnimationFrame(this.frame)
  }

  setMaxFps(fps: 30 | 60): void { this.maxFps = fps }
  setWalkSpeedMultiplier(multiplier: number): void { this.walkSpeedMultiplier = multiplier }
  setIdleMicroMotion(enabled: boolean): void {
    this.idleMicroMotion = enabled
    if (!enabled) {
      this.glance = 0
      this.glancePitch = 0
      this.idleBodyTarget = IDLE_YAW
      this.idleBodyTurnUntil = 0
    }
  }

  sleep(): boolean {
    if (this.frozen || this.peekMode || this.walking || !this.canStartExclusive()) return false
    this.mode = 'sleep'
    this.cursorLookUntil = 0
    return true
  }

  wake(): boolean {
    if (this.mode !== 'sleep') return false
    this.mode = this.baseMode()
    this.bobSpring.kick(5)
    this.squashSpring.kick(-0.5)
    return true
  }

  /** Single action-lock state consumed by pet.ts and the interaction action bus. */
  get behaviorMode(): BehaviorMode { return this.mode }

  get isFrozen(): boolean { return this.frozen }

  /**
   * The action currently owning the single slot, expressed with the frozen
   * ActionId vocabulary. Stretch has no ActionId and intentionally reports null;
   * the host's canRun() still rejects other actions while it is exclusive.
   */
  get activeAction(): ActionId | null {
    if (this.mode === 'pet') return 'pet'
    if (this.mode === 'eat') return 'feed'
    return null
  }

  get isExclusiveAction(): boolean {
    return this.mode === 'eat' || this.mode === 'stretch' || this.mode === 'pet' ||
      this.mode === 'drag' || this.mode === 'close' || this.mode === 'peek' ||
      this.mode === 'sit' || this.mode === 'doze' || this.mode === 'sleep' || this.mode === 'wake'
  }

  setBlinkTexture(texture: BlinkTexture): void { this.blinkTexture = texture }

  onFootstep(callback: () => void): void { this.footstep = callback }

  onEvent(callback: (event: AnimatorEvent) => void): () => void {
    this.eventListeners.add(callback)
    return () => { this.eventListeners.delete(callback) }
  }

  onFrame(callback: (info: FrameInfo) => void): () => void {
    this.frameListeners.add(callback)
    return () => { this.frameListeners.delete(callback) }
  }

  /** Future IPC: let main tell the renderer its actual walking speed. */
  setWalkSpeed(pxPerSecond: number | null): void {
    this.walkSpeedOverride = pxPerSecond !== null && Number.isFinite(pxPerSecond) && pxPerSecond > 0
      ? pxPerSecond
      : null
  }

  /**
   * Renderer half of a production walk pause. Main must also stop moving the
   * window (pet:walk:pause/resume); freezing the pose alone would leave the pet
   * sliding across the desktop because main owns window.x.
   */
  setWalkPosePaused(paused: boolean): void {
    this.walkPosePaused = paused
    if (paused) this.gaitPhase = 0
  }

  /**
   * Head-only fullscreen peek. Main owns the window placement and sends the
   * FullscreenState; the renderer hides the body and keeps only the head, with
   * the head centre aligned to the contract's headAnchor.
   *
   * - hidden/peeking/revealed: head-only (window is at an edge or sliding).
   * - returning with revealUntil === null: still retracting off-screen, keep
   *   head-only so no body flashes.
   * - returning with revealUntil !== null: reveal-click moved the window back
   *   to the normal bottom position; restore the full body.
   */
  setFullscreenPeek(state: FullscreenState): void {
    this.peekState = state
    const headOnly = state.active && (
      state.phase === 'hidden' ||
      state.phase === 'peeking' ||
      state.phase === 'revealed' ||
      (state.phase === 'returning' && state.revealUntil === null)
    )
    if (headOnly !== this.peekMode) this.applyPeekMode(headOnly)
  }

  get isPeeking(): boolean { return this.peekMode }

  private applyPeekMode(on: boolean): void {
    this.resetElasticMotion()
    if (on) {
      if (this.mode === 'close') return
      this.cancelActiveAction()
      this.mode = 'peek'
      this.bodyTurning = false
      this.bodyTurnAmount = 0
      this.walkPosePaused = false
      this.savedZoom = this.viewer.zoom
      this.viewer.zoom = PEEK_ZOOM
      this.viewer.controls.update()
      const skin = this.viewer.playerObject.skin
      // Hide and remove the body parts from the default raycast layer so an
      // invisible torso cannot be clicked through the transparent head-only view.
      for (const part of [skin.body, skin.rightArm, skin.leftArm, skin.rightLeg, skin.leftLeg]) {
        part.visible = false
        part.layers.set(1)
      }
      this.viewer.playerWrapper.position.x = 0
      this.viewer.playerWrapper.position.y = 0
      this.viewer.playerWrapper.rotation.x = 0
      this.viewer.playerWrapper.rotation.z = 0
      this.bodyYaw = 0
      this.viewer.playerWrapper.rotation.y = 0
      this.peekMode = true
      return
    }
    if (!this.peekMode) return
    const skin = this.viewer.playerObject.skin
    for (const part of [skin.body, skin.rightArm, skin.leftArm, skin.rightLeg, skin.leftLeg]) {
      part.visible = true
      part.layers.set(0)
    }
    this.viewer.zoom = this.savedZoom
    this.viewer.controls.update()
    this.viewer.playerWrapper.position.x = 0
    this.viewer.playerWrapper.position.y = 0
    this.viewer.playerWrapper.rotation.x = 0
    this.viewer.playerWrapper.rotation.z = 0
    this.bodyYaw = IDLE_YAW
    this.viewer.playerWrapper.rotation.y = this.bodyYaw
    this.peekMode = false
    if (this.mode === 'peek') this.mode = this.baseMode()
  }

  setWalking(walking: boolean): void {
    if (walking === this.walking) return
    if (walking && !this.walking) this.gaitPhase = 0
    this.walking = walking
    if (!this.peekMode) this.bobSpring.kick(walking ? 5.8 : 2.8)
    if (walking && (this.mode === 'eat' || this.mode === 'stretch')) {
      // No walk-pause IPC yet: cancel the long action rather than gliding
      // across the desktop while the body is eating/stretching.
      this.cancelActiveAction()
    } else if (this.mode === 'idle' || this.mode === 'walk') {
      this.mode = this.baseMode()
    }
  }

  setFacing(facing: WalkDirection): void {
    if (facing !== this.facing && this.walking && !this.peekMode) {
      this.leanSpring.kick(facing === 1 ? -0.8 : 0.8)
    }
    this.facing = facing
  }

  setDragging(dragging: boolean): void {
    if (dragging === this.dragging) return
    if (dragging) {
      this.cancelActiveAction()
      this.dragging = true
      this.mode = 'drag'
      this.actionUntil = 0
      this.landingStartedAt = 0
      this.bobSpring.kick(-3.4)
    } else {
      this.dragging = false
      if (this.mode === 'drag') this.mode = this.baseMode()
    }
  }

  land(): void {
    this.dragging = false
    if (this.mode === 'drag') this.mode = this.baseMode()
    this.landingStartedAt = performance.now()
    this.bobSpring.kick(7.5)
    this.squashSpring.kick(-0.95)
  }

  setTorchOn(on: boolean): void { this.torchOn = on }

  setClosing(closing: boolean): void {
    if (closing) {
      if (this.peekMode) this.applyPeekMode(false)
      this.cancelActiveAction()
      this.mode = 'close'
    } else if (this.mode === 'close') {
      this.mode = this.baseMode()
    }
  }

  /** Reset transient animation/product state after the tray restores the pet. */
  resetBehavior(): void {
    if (this.peekMode) this.applyPeekMode(false)
    this.cancelActiveAction()
    this.walking = false
    this.walkBlend = 0
    this.gaitPhase = 0
    this.resetElasticMotion()
    this.dragging = false
    this.dragBlend = 0
    this.sleepBlend = 0
    this.landingStartedAt = 0
    this.mode = 'idle'
    this.actionUntil = 0
    this.walkPosePaused = false
    this.cursorLookUntil = 0
    this.bodyYaw = IDLE_YAW
    this.bodyTurning = false
    this.bodyTurnAmount = 0
    this.idleBodyTarget = IDLE_YAW
    this.idleBodyTurnUntil = 0
    this.nextIdleBodyTurnAt = performance.now() + 8000 + Math.random() * 10_000
    this.viewer.playerWrapper.rotation.y = this.bodyYaw
  }

  /** Returns true when the pet reaction actually started. */
  pet(): boolean {
    const now = performance.now()
    if (this.frozen) return false
    // Head-only peek: a click on the head is a reveal request, not a normal pet.
    // It also starts the same 2 s cursor-look window; main moves the window back
    // to the bottom and pet.ts calls api.revealPeek().
    if (this.peekMode) {
      this.cursorLookUntil = now + CURSOR_LOOK_MS
      this.emit({ type: 'peekReveal' })
      return true
    }
    if (now - this.lastPetAt < PET_COOLDOWN_MS) return false
    if (!this.canPet()) return false
    this.lastPetAt = now
    this.petUntil = now + PET_DURATION_MS
    this.petEyesUntil = now + 850
    this.bobSpring.kick(10)
    this.squashSpring.kick(-1.2)
    this.leanSpring.kick(this.facing === 1 ? -1.1 : 1.1)
    this.secondBlinkAt = now + 1200
    // Only this reaction window looks at the cursor; afterwards idle is
    // autonomous (random glances/breathing), per the latest user decision.
    this.cursorLookUntil = now + CURSOR_LOOK_MS
    this.mode = 'pet'
    this.actionUntil = this.petUntil
    this.emit({ type: 'pet' })
    return true
  }

  /** Returns true when stretching actually started. */
  stretch(): boolean {
    const now = performance.now()
    if (this.frozen || this.walking) return false
    if (!this.canStartExclusive()) return false
    this.stretchStartedAt = now
    this.stretchUntil = now + STRETCH_DURATION_MS
    this.mode = 'stretch'
    this.actionUntil = this.stretchUntil
    return true
  }

  /** Returns true when eating actually started. */
  eat(): boolean {
    const now = performance.now()
    if (this.frozen || this.walking) return false
    if (!this.canStartExclusive()) return false
    this.eatStartedAt = now
    this.eatUntil = now + EAT_DURATION_MS
    this.mode = 'eat'
    this.actionUntil = this.eatUntil
    return true
  }

  cancelEat(): void {
    this.eatUntil = 0
    if (this.mode === 'eat') this.mode = this.baseMode()
    if (this.actionUntil > 0 && this.mode !== 'eat' && this.mode !== 'stretch' && this.mode !== 'pet') {
      this.actionUntil = 0
    }
  }

  /** Cancel an exclusive action; pet.ts listens for the event to hide props. */
  cancelAction(): void {
    this.cancelActiveAction()
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen
    this.lastFrameAt = performance.now()
  }

  setCursor(x: number, y: number): void {
    this.cursorX = x
    this.cursorY = y
  }

  /** True when a scheduled random action may start without stacking. */
  canStartScheduled(action: 'eat' | 'stretch'): boolean {
    if (this.frozen || this.walking) return false
    if (!this.canStartExclusive()) return false
    return action === 'eat' ? this.eatUntil === 0 : this.stretchUntil === 0
  }

  getState(): AnimationState {
    const now = performance.now()
    const skin = this.viewer.playerObject.skin
    return {
      walking: this.walking,
      facing: this.facing,
      petting: now < this.petUntil,
      blinking: this.blinkTexture?.isClosed ?? false,
      walkBlend: this.walkBlend,
      headYaw: this.headYaw,
      headPitch: this.headPitch,
      headRotationX: skin.head.rotation.x,
      headRotationY: skin.head.rotation.y,
      stretching: now < this.stretchUntil,
      dragging: this.dragging,
      torchOn: this.torchOn,
      eating: now < this.eatUntil,
      behaviorMode: this.mode,
      walkStepFrequency: this.lastStepFrequency,
      bodyYaw: this.bodyYaw,
      bodyTurning: this.bodyTurning,
      cursorLooking: now < this.cursorLookUntil &&
        (this.mode === 'idle' || this.mode === 'pet' || this.mode === 'peek') &&
        !this.walking,
      peeking: this.peekMode,
      inertiaLean: this.leanSpring.value,
      elasticBob: this.bobSpring.value,
      elasticSquash: this.squashSpring.value
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId)
    this.eventListeners.clear()
    this.frameListeners.clear()
  }

  private resetElasticMotion(): void {
    this.leanSpring.reset()
    this.bobSpring.reset()
    this.squashSpring.reset()
    this.windowVelocityX = 0
    this.lastWindowX = null
  }

  private baseMode(): BehaviorMode { return this.walking ? 'walk' : 'idle' }

  private canStartExclusive(): boolean {
    return this.mode === 'idle' || this.mode === 'walk'
  }

  private canPet(): boolean {
    return this.mode === 'idle' || this.mode === 'walk' || this.mode === 'pet'
  }

  private cancelActiveAction(): AnimatorAction | null {
    let action: AnimatorAction | null = null
    if (this.mode === 'eat') action = 'eat'
    else if (this.mode === 'stretch') action = 'stretch'
    else if (this.mode === 'pet') action = 'pet'
    if (!action) return null
    this.eatUntil = 0
    this.stretchUntil = 0
    this.petUntil = 0
    this.petEyesUntil = 0
    this.secondBlinkAt = 0
    this.actionUntil = 0
    this.mode = this.baseMode()
    this.emit({ type: 'cancelled', action })
    return action
  }

  private emit(event: AnimatorEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  private emitFrame(now: number): void {
    if (this.frameListeners.size === 0) return
    const info: FrameInfo = {
      now,
      mode: this.mode,
      walking: this.walking,
      dragging: this.dragging,
      visible: this.viewer.playerObject.visible,
      jumpY: this.viewer.playerWrapper.position.y,
      scaleX: this.viewer.playerObject.scale.x,
      scaleY: this.viewer.playerObject.scale.y
    }
    for (const listener of this.frameListeners) listener(info)
  }

  private readonly frame = (now: number): void => {
    if (this.frozen) {
      this.lastFrameAt = now
      this.frameId = requestAnimationFrame(this.frame)
      return
    }
    const dt = clamp((now - this.lastFrameAt) / 1000, 0, 0.05)
    this.lastFrameAt = now
    this.update(now, dt)
    if (now - this.lastRenderAt >= 1000 / this.maxFps - 1) {
      this.viewer.render()
      this.lastRenderAt = now
    }
    this.frameId = requestAnimationFrame(this.frame)
  }

  private pixelsPerUnit(): number {
    const a = this.scratchA.set(0, 0, 0)
    const b = this.scratchB.set(0, 1, 0)
    this.viewer.playerObject.localToWorld(a)
    this.viewer.playerObject.localToWorld(b)
    a.project(this.viewer.camera)
    b.project(this.viewer.camera)
    const pixels = Math.abs(b.y - a.y) * this.viewer.height * 0.5
    return pixels > 0.1 ? pixels : 6.875
  }

  private currentStepFrequency(): number {
    const pixelsPerUnit = this.pixelsPerUnit()
    const speed = this.walkSpeedOverride ?? walkSpeed(this.viewer.width, this.walkSpeedMultiplier)
    const stepLength = 2 * WALK_LEG_LENGTH * Math.sin(WALK_LEG_SWING) * pixelsPerUnit
    if (!(stepLength > 0.01)) return this.lastStepFrequency
    return clamp(speed / stepLength, WALK_MIN_STEP_HZ, WALK_MAX_STEP_HZ)
  }

  /**
   * Low-interruption free idle: rarely shift the body a small amount (±20°)
   * for a few seconds, then return to the default 3/4 yaw. Full 360° turns are
   * reserved for the 2 s click-look window, never for constant idle tracking.
   */
  private updateAutonomousIdle(now: number): void {
    if (!this.idleMicroMotion) {
      this.idleBodyTarget = IDLE_YAW
      this.idleBodyTurnUntil = 0
      return
    }
    if (this.mode !== 'idle') {
      this.idleBodyTarget = IDLE_YAW
      this.idleBodyTurnUntil = 0
      return
    }
    if (now >= this.nextIdleBodyTurnAt) {
      if (Math.random() < 0.35) {
        this.idleBodyTarget = normalizeAngle(IDLE_YAW +
          (Math.random() * 2 - 1) * IDLE_BODY_TURN_ANGLE)
        this.idleBodyTurnUntil = now + IDLE_BODY_TURN_HOLD_MIN_MS +
          Math.random() * (IDLE_BODY_TURN_HOLD_MAX_MS - IDLE_BODY_TURN_HOLD_MIN_MS)
      } else {
        this.idleBodyTarget = IDLE_YAW
        this.idleBodyTurnUntil = 0
      }
      this.nextIdleBodyTurnAt = now + IDLE_BODY_TURN_GAP_MIN_MS +
        Math.random() * (IDLE_BODY_TURN_GAP_MAX_MS - IDLE_BODY_TURN_GAP_MIN_MS)
    } else if (this.idleBodyTurnUntil > 0 && now >= this.idleBodyTurnUntil) {
      this.idleBodyTarget = IDLE_YAW
      this.idleBodyTurnUntil = 0
    }
  }

  private updatePeek(now: number, dt: number): void {
    const skin = this.viewer.playerObject.skin
    if (Math.abs(this.viewer.zoom - PEEK_ZOOM) > 1e-4) {
      this.viewer.zoom = PEEK_ZOOM
      this.viewer.controls.update()
    }
    for (const part of [skin.body, skin.rightArm, skin.leftArm, skin.rightLeg, skin.leftLeg]) {
      part.visible = false
      part.layers.set(1)
    }
    skin.head.visible = true
    const breath = Math.sin(now * 0.0019)
    const centerX = this.viewer.width / 2
    const centerY = this.viewer.height / 2
    const cursorKnown = this.cursorX !== null && this.cursorY !== null
    const cursorTracking = cursorKnown && now < this.cursorLookUntil
    if (this.idleMicroMotion && now >= this.nextGlanceAt) {
      this.glance = (Math.random() * 2 - 1) * 0.18
      this.glancePitch = (Math.random() * 2 - 1) * 0.16
      this.nextGlanceAt = now + 3500 + Math.random() * 3000
    }
    const cursorDx = (this.cursorX ?? centerX) - centerX
    const cursorDy = (this.cursorY ?? centerY) - centerY
    const targetYaw = cursorTracking
      ? clamp(Math.atan2(cursorDx, cursorDy), -MAX_GAZE_YAW, MAX_GAZE_YAW)
      : clamp(this.glance, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    const targetPitch = cursorTracking
      ? clamp((cursorDy / (this.viewer.height * 0.62)) * MAX_GAZE_PITCH,
        -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
      : clamp(this.glancePitch, -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
    const headApproach = 1 - Math.exp(-dt / HEAD_TURN_TAU)
    this.headYaw += (targetYaw - this.headYaw) * headApproach
    this.headPitch += (targetPitch - this.headPitch) * headApproach
    const safePitch = clamp(this.headPitch, -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT)
    this.viewer.playerWrapper.rotation.x = 0
    this.viewer.playerWrapper.rotation.y = 0
    this.viewer.playerWrapper.rotation.z = 0
    skin.head.rotation.y = clamp(this.headYaw, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    skin.head.rotation.x = safePitch
    skin.head.rotation.z = 0.018 * Math.sin(now * 0.004)
    skin.head.position.y = 0
    this.centerPeekHead(breath)
  }

  /** Align the head centre to FullscreenState.headAnchor (window CSS pixels). */
  private centerPeekHead(breath: number): void {
    const head = this.viewer.playerObject.skin.head
    const wrapper = this.viewer.playerWrapper
    const anchor = this.peekState.headAnchor ?? {
      x: Math.round(this.viewer.width / 2),
      y: Math.round(this.viewer.height / 2)
    }
    const targetX = (anchor.x / Math.max(1, this.viewer.width)) * 2 - 1
    const targetY = 1 - (anchor.y / Math.max(1, this.viewer.height)) * 2
    let offsetX = 0
    let offsetY = 0
    for (let pass = 0; pass < 2; pass += 1) {
      wrapper.position.x = offsetX
      wrapper.position.y = offsetY
      this.viewer.playerWrapper.updateMatrixWorld(true)
      const center = this.scratchA.set(0, 4, 0)
      head.localToWorld(center)
      const projected = this.scratchB.copy(center).project(this.viewer.camera)
      const up = this.scratchC.copy(center)
      up.y += 1
      up.project(this.viewer.camera)
      const right = this.scratchC.copy(center)
      right.x += 1
      right.project(this.viewer.camera)
      const slopeY = up.y - projected.y
      const slopeX = right.x - projected.x
      if (Math.abs(slopeY) > 1e-6) offsetY += (targetY - projected.y) / slopeY
      if (Math.abs(slopeX) > 1e-6) offsetX += (targetX - projected.x) / slopeX
    }
    wrapper.position.x = offsetX
    wrapper.position.y = offsetY + 0.08 * breath
  }

  private update(now: number, dt: number): void {
    if (this.peekMode) {
      this.updatePeek(now, dt)
      this.updateBlink(now)
      this.emitFrame(now)
      return
    }
    if (this.mode === 'eat' && now >= this.eatUntil) {
      this.mode = this.baseMode()
      this.actionUntil = 0
    } else if (this.mode === 'stretch' && now >= this.stretchUntil) {
      this.mode = this.baseMode()
      this.actionUntil = 0
    } else if (this.mode === 'pet' && now >= this.petUntil) {
      this.mode = this.baseMode()
      this.actionUntil = 0
    }

    const skin = this.viewer.playerObject.skin
    const approach = 1 - Math.exp(-dt / 0.16)
    this.walkBlend += (((this.walking && !this.walkPosePaused) ? 1 : 0) - this.walkBlend) * approach
    this.dragBlend += ((this.dragging ? 1 : 0) - this.dragBlend) * (1 - Math.exp(-dt / 0.085))
    this.sleepBlend += ((this.mode === 'sleep' ? 1 : 0) - this.sleepBlend) * (1 - Math.exp(-dt / 0.3))
    this.torchBlend += ((this.torchOn ? 1 : 0) - this.torchBlend) * (1 - Math.exp(-dt / 0.18))
    const stretchElapsed = now - this.stretchStartedAt
    const stretchWeight = now < this.stretchUntil
      ? Math.min(smoothstep(stretchElapsed / 350), smoothstep((this.stretchUntil - now) / 520))
      : 0
    const eatElapsed = now - this.eatStartedAt
    const eatWeight = now < this.eatUntil
      ? Math.min(smoothstep(eatElapsed / 250), smoothstep((this.eatUntil - now) / 350))
      : 0
    const petProgress = clamp((this.petUntil - now) / PET_DURATION_MS, 0, 1)
    const petEnvelope = Math.sin(Math.PI * petProgress)
    const activeWalk = this.walkBlend * (1 - 0.9 * this.dragBlend) * (1 - 0.95 * stretchWeight)

    // User decision: cursor following is only a 2 s reaction window after a real
    // pet click. Outside it, idle is autonomous (random glances/breathing) and
    // the body returns to its default 3/4 yaw; no continuous desktop-mouse look.
    const centerX = this.viewer.width / 2
    const centerY = this.viewer.height / 2
    const cursorKnown = this.cursorX !== null && this.cursorY !== null
    const cursorDx = (this.cursorX ?? centerX) - centerX
    const cursorDy = (this.cursorY ?? centerY) - centerY
    const idleLike = !this.walking && (this.mode === 'idle' || this.mode === 'pet')
    const cursorTracking = idleLike && now < this.cursorLookUntil
    const autonomousIdle = idleLike && !cursorTracking
    if (autonomousIdle) this.updateAutonomousIdle(now)
    // atan2(dx, dy) maps the cursor position around the pet to a full circle:
    // below centre = front (0), right = +90°, above = 180°, left = -90°.
    // IDLE_YAW keeps the familiar 3/4 framing when the cursor is centred.
    const idleWorldYaw = this.idleBodyTarget
    const desiredWorldYaw = cursorTracking && cursorKnown
      ? normalizeAngle(IDLE_YAW + Math.atan2(cursorDx, cursorDy))
      : idleWorldYaw
    let bodyDelta = shortestAngle(this.bodyYaw, desiredWorldYaw)
    // Exactly behind is ambiguous (+π vs -π). Latch the chosen side until the
    // cursor moves clearly off the seam, otherwise the body/head would jitter.
    const behind = Math.abs(Math.abs(bodyDelta) - Math.PI) < BEHIND_AMBIGUITY
    if (behind) {
      bodyDelta = this.bodyTurnSign * Math.PI
    } else if (Math.abs(bodyDelta) > 0.02) {
      this.bodyTurnSign = Math.sign(bodyDelta) || 1
    }
    if (cursorTracking) {
      if (Math.abs(bodyDelta) > MAX_GAZE_YAW + BODY_TURN_TRIGGER) this.bodyTurning = true
      else if (Math.abs(bodyDelta) < BODY_TURN_SETTLE) this.bodyTurning = false
    } else {
      this.bodyTurning = false
    }
    let bodyStep = 0
    let bodyTau = BODY_TURN_TAU
    if (this.walking) {
      // Walking: body faces movement direction, head is forward/neutral; do not
      // look at the cursor. Keep the long-standing 0.28 / -0.45 walk yaw values.
      const walkYaw = this.facing === 1 ? 0.28 : -0.45
      bodyStep = shortestAngle(this.bodyYaw, walkYaw)
      bodyTau = WALK_BODY_TAU
    } else if (cursorTracking && this.bodyTurning) {
      bodyStep = bodyDelta
      bodyTau = BODY_TURN_TAU
    } else if (autonomousIdle) {
      // Free idle: occasional small body shifts/return to the default 3/4 yaw.
      // This is not cursor tracking and deliberately has no foot-shuffle/footstep.
      bodyStep = bodyDelta
      bodyTau = BODY_TURN_TAU
    }
    const turnAmount = cursorTracking && this.bodyTurning
      ? Math.min(1, Math.abs(bodyDelta) / 1.2)
      : 0
    this.bodyTurnAmount += (turnAmount - this.bodyTurnAmount) * (1 - Math.exp(-dt / 0.12))
    this.bodyYaw = normalizeAngle(this.bodyYaw + bodyStep * (1 - Math.exp(-dt / bodyTau)))
    this.viewer.playerWrapper.rotation.y = this.bodyYaw

    const stepFrequency = this.walking ? this.currentStepFrequency() : this.lastStepFrequency
    this.lastStepFrequency = stepFrequency
    const oldStep = Math.floor(this.gaitPhase / Math.PI)
    if (this.walking && !this.dragging && !this.walkPosePaused) this.gaitPhase += dt * Math.PI * stepFrequency
    if (this.walking && !this.dragging && !this.walkPosePaused &&
      Math.floor(this.gaitPhase / Math.PI) !== oldStep && this.walkBlend > 0.5) {
      this.footstep?.()
    }
    const stride = Math.sin(this.gaitPhase) * activeWalk
    const dangling = Math.sin(now * 0.007) * 0.075
    const torchWeight = this.torchBlend * (1 - 0.9 * this.dragBlend) * (1 - stretchWeight)
    skin.rightArm.rotation.x = blend(-WALK_ARM_SWING * stride, 0.18 + dangling, this.dragBlend)
    skin.leftArm.rotation.x = blend(WALK_ARM_SWING * stride, -0.14 - dangling, this.dragBlend)
    skin.rightArm.rotation.z = -0.13 * this.dragBlend
    skin.leftArm.rotation.z = 0.13 * this.dragBlend
    skin.rightArm.rotation.x = blend(skin.rightArm.rotation.x, -0.85 + 0.025 * Math.sin(now * 0.005), torchWeight)
    skin.rightArm.rotation.z = blend(skin.rightArm.rotation.z, -0.16, torchWeight)
    // Eating: right hand lifts the bread to the mouth; the left arm rests.
    const chew = Math.sin(now * 0.014) * 0.055
    skin.rightArm.rotation.x = blend(skin.rightArm.rotation.x, -1.86 + chew, eatWeight)
    skin.rightArm.rotation.z = blend(skin.rightArm.rotation.z, -0.34, eatWeight)
    skin.leftArm.rotation.x = blend(skin.leftArm.rotation.x, 0.08, eatWeight)
    skin.leftArm.rotation.z = blend(skin.leftArm.rotation.z, 0.18, eatWeight)
    skin.rightLeg.rotation.x = blend(WALK_LEG_SWING * stride, 0.11 + dangling, this.dragBlend)
    skin.leftLeg.rotation.x = blend(-WALK_LEG_SWING * stride, -0.13 - dangling, this.dragBlend)
    skin.rightArm.rotation.x = blend(skin.rightArm.rotation.x, -0.25, stretchWeight)
    skin.leftArm.rotation.x = blend(skin.leftArm.rotation.x, -0.25, stretchWeight)
    skin.rightArm.rotation.z = blend(skin.rightArm.rotation.z, -2.35, stretchWeight)
    skin.leftArm.rotation.z = blend(skin.leftArm.rotation.z, 2.35, stretchWeight)
    // Gentle body answer to petting; it is intentionally slower than the old
    // ~1.9 Hz shake so it reads as leaning into a hand rather than vibrating.
    skin.rightArm.rotation.x += 0.06 * petEnvelope
    skin.leftArm.rotation.x += 0.04 * petEnvelope
    skin.rightLeg.rotation.x *= 1 - stretchWeight
    skin.leftLeg.rotation.x *= 1 - stretchWeight
    // A small curled seated pose keeps the head visible and feet near the floor.
    skin.rightArm.rotation.x = blend(skin.rightArm.rotation.x, -0.38, this.sleepBlend)
    skin.leftArm.rotation.x = blend(skin.leftArm.rotation.x, -0.38, this.sleepBlend)
    skin.rightLeg.rotation.x = blend(skin.rightLeg.rotation.x, -0.72, this.sleepBlend)
    skin.leftLeg.rotation.x = blend(skin.leftLeg.rotation.x, -0.72, this.sleepBlend)
    // Idle 360° turn: a quiet alternating foot shuffle and a slight weight lean,
    // with no footsteps triggered (those belong to walking only).
    if (cursorTracking && this.bodyTurning && this.bodyTurnAmount > 0.01) {
      const shuffle = Math.sin(now * 0.017) * 0.06 * this.bodyTurnAmount
      skin.rightLeg.rotation.x += shuffle
      skin.leftLeg.rotation.x -= shuffle
      skin.rightArm.rotation.x -= shuffle * 0.6
      skin.leftArm.rotation.x += shuffle * 0.6
    }

    // Main moves the window during walks and drags. Follow that real motion
    // with a delayed lean; the spring carries through when movement stops.
    const windowX = window.screenX
    if (this.lastWindowX !== null && dt > 0) {
      const speed = clamp((windowX - this.lastWindowX) / dt, -900, 900)
      const targetSpeed = this.walking || this.dragging ? speed : 0
      this.windowVelocityX += (targetSpeed - this.windowVelocityX) *
        (1 - Math.exp(-dt / 0.09))
    }
    this.lastWindowX = windowX
    const inertiaLean = this.leanSpring.step(
      clamp(-this.windowVelocityX * 0.0012, -0.08, 0.08), dt)
    const elasticBob = this.bobSpring.step(0, dt)
    const elasticSquash = this.squashSpring.step(0, dt)
    const breath = Math.sin(now * 0.0019)
    const landingElapsed = now - this.landingStartedAt
    const landingProgress = this.landingStartedAt > 0
      ? clamp(landingElapsed / LAND_DURATION_MS, 0, 1)
      : 1
    const landingBounce = landingProgress < 1
      ? Math.abs(Math.sin(landingProgress * Math.PI * 2.5)) * Math.pow(1 - landingProgress, 2)
      : 0
    const landingSquash = landingProgress < 1
      ? Math.exp(-landingProgress * 18) * 0.07
      : 0
    skin.body.scale.set(1 + 0.006 * breath + landingSquash * 0.35 -
        elasticSquash * 0.45,
      1 + 0.012 * breath - landingSquash + elasticSquash,
      1 + 0.006 * breath - elasticSquash * 0.25)
    this.viewer.playerWrapper.position.y = 0.05 * breath +
      0.25 * Math.abs(Math.sin(this.gaitPhase)) * activeWalk +
      1.35 * landingBounce - 0.45 * this.dragBlend - 0.1 * petEnvelope + elasticBob -
      2.0 * this.sleepBlend

    if (this.idleMicroMotion && now >= this.nextGlanceAt) {
      this.glance = (Math.random() * 2 - 1) * 0.18
      // Occasional natural up/down glance, not only left/right.
      this.glancePitch = (Math.random() * 2 - 1) * 0.16
      this.nextGlanceAt = now + 3500 + Math.random() * 3000
    }
    const gazeRangeY = this.viewer.height * 0.62
    // Three.js: +rotation.x tips the +z face downward. Cursor below the canvas
    // center must therefore produce a positive angle (look down); the old sign
    // was inverted.
    const cursorPitch = clamp(((this.cursorY ?? centerY) - centerY) / gazeRangeY, -1, 1) * MAX_GAZE_PITCH
    const petSway = Math.sin(now * 0.0048) * 0.06 * petEnvelope
    let targetHeadYaw = 0
    let targetHeadPitch = 0
    if (this.walking) {
      // Walking: head neutral and facing the body's movement direction.
      targetHeadYaw = 0
      targetHeadPitch = 0
    } else if (cursorTracking) {
      // 2 s click-look window only: body + local residual = cursor direction.
      targetHeadYaw = clamp(bodyDelta + petSway, -MAX_GAZE_YAW, MAX_GAZE_YAW)
      targetHeadPitch = clamp(cursorPitch - 0.08 * petEnvelope, -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
    } else if (this.mode === 'idle' || this.mode === 'pet') {
      // Free idle: random side glances / breathing, no cursor tracking.
      targetHeadYaw = clamp(this.glance + petSway, -MAX_GAZE_YAW, MAX_GAZE_YAW)
      targetHeadPitch = clamp(this.glancePitch - 0.08 * petEnvelope,
        -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
    }
    // Head leads: fast local follow; body uses BODY_TURN_TAU above.
    const headApproach = 1 - Math.exp(-dt / HEAD_TURN_TAU)
    this.headYaw += (targetHeadYaw - this.headYaw) * headApproach
    this.headPitch += (targetHeadPitch - this.headPitch) * headApproach
    const safePitch = clamp(this.headPitch - 0.27 * stretchWeight - 0.1 * eatWeight,
      -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT)
    skin.head.rotation.y = clamp(this.headYaw + 0.1 * eatWeight, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    skin.head.rotation.x = blend(safePitch, 0.28, this.sleepBlend)
    skin.head.rotation.z = (this.mode === 'pet' ? petSway : 0) + 0.025 * stride - inertiaLean * 0.35
    skin.head.position.y = 0.07 * breath + 0.16 * petEnvelope + 0.08 * stretchWeight +
      HEAD_PITCH_LIFT * Math.abs(Math.sin(safePitch))
    // Body follows the head a little instead of staying a rigid block; this
    // also gives walk/pet a visible weight shift without moving the feet.
    const turnLean = cursorTracking && this.bodyTurning
      ? -Math.sign(bodyDelta) * 0.035 * this.bodyTurnAmount
      : 0
    skin.body.rotation.x = -0.2 * stretchWeight + 0.06 * this.dragBlend +
      0.03 * activeWalk + 0.08 * safePitch + 0.22 * this.sleepBlend
    skin.body.rotation.z = 0.025 * Math.sin(now * 0.004) * stretchWeight +
      0.018 * petEnvelope + turnLean + inertiaLean * 0.55
    this.viewer.playerWrapper.rotation.z = 0.012 * Math.sin(this.gaitPhase) * activeWalk -
      0.012 * petEnvelope + inertiaLean

    this.updateBlink(now)
    this.emitFrame(now)
  }

  private updateBlink(now: number): void {
    if (now >= this.nextBlinkAt) {
      this.blinkUntil = now + 130
      this.nextBlinkAt = now + 3000 + Math.random() * 4000
      if (Math.random() < 0.18) this.secondBlinkAt = now + 250
    }
    if (this.secondBlinkAt > 0 && now >= this.secondBlinkAt) {
      this.blinkUntil = now + 120
      this.secondBlinkAt = 0
    }
    this.blinkTexture?.setClosed(this.mode === 'sleep' || now < this.blinkUntil || now < this.petEyesUntil)
  }
}

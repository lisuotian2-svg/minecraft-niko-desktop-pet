import type { SkinViewer } from 'skinview3d'
import type { WalkDirection } from '../shared/walk'
import { BlinkTexture } from './viewer'

const IDLE_YAW = -Math.PI / 8
// More human-like neck range: ~55° left/right and ~60° up/down.
const MAX_GAZE_YAW = Math.PI / 3.1
const MAX_GAZE_PITCH = Math.PI / 3
const STRETCH_DURATION_MS = 2500
const LAND_DURATION_MS = 720

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

export interface AnimationState {
  walking: boolean
  facing: WalkDirection
  petting: boolean
  blinking: boolean
  walkBlend: number
  headYaw: number
  headPitch: number
  stretching: boolean
  dragging: boolean
  torchOn: boolean
  eating: boolean
}

export class PetAnimator {
  private walking = false
  private facing: WalkDirection = 1
  private walkBlend = 0
  private gaitPhase = 0
  private cursorX: number | null = null
  private cursorY: number | null = null
  private nextBlinkAt = performance.now() + 3000 + Math.random() * 4000
  private secondBlinkAt = 0
  private blinkUntil = 0
  private petUntil = 0
  private petEyesUntil = 0
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

  constructor(private readonly viewer: SkinViewer) {
    this.frameId = requestAnimationFrame(this.frame)
  }

  setBlinkTexture(texture: BlinkTexture): void { this.blinkTexture = texture }

  onFootstep(callback: () => void): void { this.footstep = callback }

  setWalking(walking: boolean): void {
    if (walking && !this.walking) this.gaitPhase = 0
    this.walking = walking
  }

  setFacing(facing: WalkDirection): void { this.facing = facing }

  setDragging(dragging: boolean): void {
    if (dragging === this.dragging) return
    this.dragging = dragging
    if (dragging) this.landingStartedAt = 0
  }

  land(): void {
    this.dragging = false
    this.landingStartedAt = performance.now()
  }

  setTorchOn(on: boolean): void { this.torchOn = on }

  stretch(): void {
    const now = performance.now()
    this.stretchStartedAt = now
    this.stretchUntil = now + STRETCH_DURATION_MS
  }

  eat(): void {
    const now = performance.now()
    this.eatStartedAt = now
    this.eatUntil = now + 3800
  }

  cancelEat(): void {
    this.eatUntil = 0
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen
    this.lastFrameAt = performance.now()
  }

  setCursor(x: number, y: number): void {
    this.cursorX = x
    this.cursorY = y
  }

  pet(): void {
    const now = performance.now()
    this.petUntil = now + 2500
    this.petEyesUntil = now + 850
    this.secondBlinkAt = now + 1200
  }

  getState(): AnimationState {
    return {
      walking: this.walking,
      facing: this.facing,
      petting: performance.now() < this.petUntil,
      blinking: this.blinkTexture?.isClosed ?? false,
      walkBlend: this.walkBlend,
      headYaw: this.headYaw,
      headPitch: this.headPitch,
      stretching: performance.now() < this.stretchUntil,
      dragging: this.dragging,
      torchOn: this.torchOn,
      eating: performance.now() < this.eatUntil
    }
  }

  dispose(): void { cancelAnimationFrame(this.frameId) }

  private readonly frame = (now: number): void => {
    if (this.frozen) {
      this.lastFrameAt = now
      this.frameId = requestAnimationFrame(this.frame)
      return
    }
    const dt = clamp((now - this.lastFrameAt) / 1000, 0, 0.05)
    this.lastFrameAt = now
    this.update(now, dt)
    this.frameId = requestAnimationFrame(this.frame)
  }

  private update(now: number, dt: number): void {
    const skin = this.viewer.playerObject.skin
    const approach = 1 - Math.exp(-dt / 0.16)
    this.walkBlend += ((this.walking ? 1 : 0) - this.walkBlend) * approach
    this.dragBlend += ((this.dragging ? 1 : 0) - this.dragBlend) * (1 - Math.exp(-dt / 0.085))
    this.torchBlend += ((this.torchOn ? 1 : 0) - this.torchBlend) * (1 - Math.exp(-dt / 0.18))
    const stretchElapsed = now - this.stretchStartedAt
    const stretchWeight = now < this.stretchUntil
      ? Math.min(smoothstep(stretchElapsed / 350), smoothstep((this.stretchUntil - now) / 520))
      : 0
    const eatElapsed = now - this.eatStartedAt
    const eatWeight = now < this.eatUntil
      ? Math.min(smoothstep(eatElapsed / 250), smoothstep((this.eatUntil - now) / 350))
      : 0
    const activeWalk = this.walkBlend * (1 - 0.9 * this.dragBlend) * (1 - 0.95 * stretchWeight)

    // Keep the 3/4 camera readable while walking: the pet turns toward its
    // direction, not away from the camera. The old ±72°/45° targets showed its back.
    const yawTarget = this.walking
      ? (this.facing === 1 ? 0.28 : -0.45)
      : IDLE_YAW
    this.viewer.playerWrapper.rotation.y += (yawTarget - this.viewer.playerWrapper.rotation.y) *
      (1 - Math.exp(-dt / 0.105))

    const oldStep = Math.floor(this.gaitPhase / Math.PI)
    if (this.walking && !this.dragging) this.gaitPhase += dt * Math.PI * 3.1
    if (this.walking && !this.dragging && Math.floor(this.gaitPhase / Math.PI) !== oldStep && this.walkBlend > 0.5) {
      this.footstep?.()
    }
    const stride = Math.sin(this.gaitPhase) * activeWalk
    const dangling = Math.sin(now * 0.007) * 0.075
    const torchWeight = this.torchBlend * (1 - 0.9 * this.dragBlend) * (1 - stretchWeight)
    skin.rightArm.rotation.x = blend(-0.42 * stride, 0.18 + dangling, this.dragBlend)
    skin.leftArm.rotation.x = blend(0.42 * stride, -0.14 - dangling, this.dragBlend)
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
    skin.rightLeg.rotation.x = blend(0.52 * stride, 0.11 + dangling, this.dragBlend)
    skin.leftLeg.rotation.x = blend(-0.52 * stride, -0.13 - dangling, this.dragBlend)
    skin.rightArm.rotation.x = blend(skin.rightArm.rotation.x, -0.25, stretchWeight)
    skin.leftArm.rotation.x = blend(skin.leftArm.rotation.x, -0.25, stretchWeight)
    skin.rightArm.rotation.z = blend(skin.rightArm.rotation.z, -2.35, stretchWeight)
    skin.leftArm.rotation.z = blend(skin.leftArm.rotation.z, 2.35, stretchWeight)
    skin.rightLeg.rotation.x *= 1 - stretchWeight
    skin.leftLeg.rotation.x *= 1 - stretchWeight
    skin.body.rotation.x = -0.2 * stretchWeight + 0.06 * this.dragBlend
    skin.body.rotation.z = 0.035 * Math.sin(now * 0.004) * stretchWeight

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
    skin.body.scale.set(1 + 0.006 * breath + landingSquash * 0.35,
      1 + 0.012 * breath - landingSquash,
      1 + 0.006 * breath)
    this.viewer.playerWrapper.position.y = 0.05 * breath +
      0.35 * Math.abs(Math.sin(this.gaitPhase)) * activeWalk +
      1.35 * landingBounce - 0.45 * this.dragBlend

    if (now >= this.nextGlanceAt) {
      this.glance = (Math.random() * 2 - 1) * 0.18
      // Occasional natural up/down glance, not only left/right.
      this.glancePitch = (Math.random() * 2 - 1) * 0.16
      this.nextGlanceAt = now + 3500 + Math.random() * 3000
    }
    const centerX = this.viewer.width / 2
    const centerY = this.viewer.height / 2
    const gazeRangeX = this.viewer.width * 0.9
    const gazeRangeY = this.viewer.height * 0.62
    const cursorYaw = clamp(((this.cursorX ?? centerX) - centerX) / gazeRangeX, -1, 1) * MAX_GAZE_YAW
    const cursorPitch = clamp((centerY - (this.cursorY ?? centerY)) / gazeRangeY, -1, 1) * MAX_GAZE_PITCH
    const petProgress = clamp((this.petUntil - now) / 2500, 0, 1)
    const petEnvelope = Math.sin(Math.PI * petProgress)
    const petSway = Math.sin(now * 0.012) * 0.075 * petEnvelope
    const targetHeadYaw = clamp(cursorYaw + this.glance + petSway, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    const targetHeadPitch = clamp(cursorPitch + this.glancePitch - 0.08 * petEnvelope, -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
    const headApproach = 1 - Math.exp(-dt / 0.13)
    this.headYaw += (targetHeadYaw - this.headYaw) * headApproach
    this.headPitch += (targetHeadPitch - this.headPitch) * headApproach
    // Looking at the cursor while the body turns would otherwise twist the face away.
    skin.head.rotation.y = this.headYaw * (1 - 0.65 * this.walkBlend)
    skin.head.rotation.x = clamp(this.headPitch - 0.27 * stretchWeight - 0.1 * eatWeight, -1.15, 1.15)
    skin.head.rotation.y = clamp(skin.head.rotation.y + 0.1 * eatWeight, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    skin.head.rotation.z = petSway + 0.025 * stride
    skin.head.position.y = 0.07 * breath + 0.16 * petEnvelope + 0.08 * stretchWeight

    this.updateBlink(now)
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
    this.blinkTexture?.setClosed(now < this.blinkUntil || now < this.petEyesUntil)
  }
}

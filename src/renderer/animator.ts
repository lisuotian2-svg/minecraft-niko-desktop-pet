import type { SkinViewer } from 'skinview3d'
import type { WalkDirection } from '../shared/walk'
import { BlinkTexture } from './viewer'

const IDLE_YAW = -Math.PI / 8
const MAX_GAZE_YAW = Math.PI / 6
const MAX_GAZE_PITCH = Math.PI / 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface AnimationState {
  walking: boolean
  facing: WalkDirection
  petting: boolean
  blinking: boolean
  walkBlend: number
  headYaw: number
  headPitch: number
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
  private nextGlanceAt = performance.now() + 3500
  private blinkTexture: BlinkTexture | null = null
  private lastFrameAt = performance.now()
  private frameId = 0
  private headYaw = 0
  private headPitch = 0
  private footstep: (() => void) | null = null

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
      headPitch: this.headPitch
    }
  }

  dispose(): void { cancelAnimationFrame(this.frameId) }

  private readonly frame = (now: number): void => {
    const dt = clamp((now - this.lastFrameAt) / 1000, 0, 0.05)
    this.lastFrameAt = now
    this.update(now, dt)
    this.frameId = requestAnimationFrame(this.frame)
  }

  private update(now: number, dt: number): void {
    const skin = this.viewer.playerObject.skin
    const approach = 1 - Math.exp(-dt / 0.16)
    this.walkBlend += ((this.walking ? 1 : 0) - this.walkBlend) * approach

    // Keep the 3/4 camera readable while walking: the pet turns toward its
    // direction, not away from the camera. The old ±72°/45° targets showed its back.
    const yawTarget = this.walking
      ? (this.facing === 1 ? 0.28 : -0.45)
      : IDLE_YAW
    this.viewer.playerWrapper.rotation.y += (yawTarget - this.viewer.playerWrapper.rotation.y) *
      (1 - Math.exp(-dt / 0.105))

    const oldStep = Math.floor(this.gaitPhase / Math.PI)
    if (this.walking) this.gaitPhase += dt * Math.PI * 3.1
    if (this.walking && Math.floor(this.gaitPhase / Math.PI) !== oldStep && this.walkBlend > 0.5) {
      this.footstep?.()
    }
    const stride = Math.sin(this.gaitPhase) * this.walkBlend
    skin.rightArm.rotation.x = -0.42 * stride
    skin.leftArm.rotation.x = 0.42 * stride
    skin.rightLeg.rotation.x = 0.52 * stride
    skin.leftLeg.rotation.x = -0.52 * stride

    const breath = Math.sin(now * 0.0019)
    skin.body.scale.set(1 + 0.006 * breath, 1 + 0.012 * breath, 1 + 0.006 * breath)
    this.viewer.playerWrapper.position.y = 0.05 * breath +
      0.35 * Math.abs(Math.sin(this.gaitPhase)) * this.walkBlend

    if (now >= this.nextGlanceAt) {
      this.glance = (Math.random() * 2 - 1) * 0.12
      this.nextGlanceAt = now + 3500 + Math.random() * 3000
    }
    const centerX = this.viewer.width / 2
    const centerY = this.viewer.height / 2
    const gazeRangeX = this.viewer.width * (600 / 420)
    const gazeRangeY = this.viewer.height * (600 / 420)
    const cursorYaw = clamp(((this.cursorX ?? centerX) - centerX) / gazeRangeX, -1, 1) * MAX_GAZE_YAW
    const cursorPitch = clamp((centerY - (this.cursorY ?? centerY)) / gazeRangeY, -1, 1) * MAX_GAZE_PITCH
    const petProgress = clamp((this.petUntil - now) / 2500, 0, 1)
    const petEnvelope = Math.sin(Math.PI * petProgress)
    const petSway = Math.sin(now * 0.012) * 0.075 * petEnvelope
    const targetHeadYaw = clamp(cursorYaw + this.glance + petSway, -MAX_GAZE_YAW, MAX_GAZE_YAW)
    const targetHeadPitch = clamp(cursorPitch - 0.08 * petEnvelope, -MAX_GAZE_PITCH, MAX_GAZE_PITCH)
    const headApproach = 1 - Math.exp(-dt / 0.19)
    this.headYaw += (targetHeadYaw - this.headYaw) * headApproach
    this.headPitch += (targetHeadPitch - this.headPitch) * headApproach
    // Looking at the cursor while the body turns would otherwise twist the face away.
    skin.head.rotation.y = this.headYaw * (1 - 0.65 * this.walkBlend)
    skin.head.rotation.x = this.headPitch
    skin.head.rotation.z = petSway + 0.025 * stride
    skin.head.position.y = 0.07 * breath + 0.16 * petEnvelope

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

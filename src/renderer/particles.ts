import type { PetApi } from '../preload/index'

/** Coordinates in CSS pixels relative to the current pet window. */
export interface ParticlePoint {
  x: number
  y: number
}

type ParticleKind = 'effect' | 'glitter'
type ParticleMode = 'gather' | 'burst'

interface Particle {
  active: boolean
  mode: ParticleMode
  kind: ParticleKind
  x: number
  y: number
  vx: number
  vy: number
  age: number
  lifetime: number
  size: number
  color: number
  frameOffset: number
}

const TEXTURE_NAMES = [
  'effect0', 'effect1', 'effect2', 'effect3',
  'effect4', 'effect5', 'effect6', 'effect7',
  'glitter0', 'glitter1', 'glitter2', 'glitter3',
  'glitter4', 'glitter5', 'glitter6', 'glitter7'
] as const
const COLORS = ['#A855F7', '#C084FC', '#7C3AED', '#4C1D95'] as const
const MAX_PARTICLES = 168
const BURST_COUNT = 144
const GRAVITY = 260 // Screen pixels per second squared.

function random(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function freshParticle(): Particle {
  return {
    active: false,
    mode: 'gather',
    kind: 'effect',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    lifetime: 1,
    size: 8,
    color: 0,
    frameOffset: 0
  }
}

/**
 * Minecraft textured particles drawn in screen space above the skin viewer.
 * The overlay grows with the Electron window and never intercepts input.
 */
export class PurpleParticles {
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private readonly particles = Array.from({ length: MAX_PARTICLES }, freshParticle)
  private readonly textures: Array<HTMLCanvasElement | undefined> = new Array(16 * COLORS.length)
  private readonly sourceImages: ImageBitmap[] = []
  private gathering = false
  private gatherCenter: ParticlePoint = { x: 0, y: 0 }
  private gatherAccumulator = 0
  private frameHandle = 0
  private previousFrameTime = 0
  private canvasWidth = 0
  private canvasHeight = 0
  private pixelRatio = 0

  constructor(private readonly api: PetApi) {
    const context = this.canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Particle canvas 2D context is unavailable')
    this.context = context
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;background:transparent;z-index:10;'
    document.body.appendChild(this.canvas)
    this.resizeCanvas()
    void this.loadTextures()
  }

  /** Begin sparse inward movement at the 2.4-second hold threshold. */
  startGathering(origin: ParticlePoint): void {
    this.gatherCenter = this.toScreen(origin)
    if (!this.gathering) {
      this.gathering = true
      this.gatherAccumulator = 0
      for (let index = 0; index < 4; index += 1) this.spawnGather()
    }
    this.ensureFrame()
  }

  /** Cancel a preview on release; already visible motes fade promptly. */
  stopGathering(): void {
    this.gathering = false
    this.gatherAccumulator = 0
    for (const particle of this.particles) {
      if (particle.active && particle.mode === 'gather') {
        particle.lifetime = Math.min(particle.lifetime, particle.age + 0.22)
      }
    }
  }

  /** Emit a full-screen expanding burst when the hold reaches 3 seconds. */
  burst(origin: ParticlePoint): void {
    this.stopGathering()
    const center = this.toScreen(origin)
    for (let index = 0; index < BURST_COUNT; index += 1) {
      const particle = this.takeParticle()
      if (!particle) break
      const angle = random(0, Math.PI * 2)
      const speed = random(300, 1030)
      particle.active = true
      particle.mode = 'burst'
      particle.kind = Math.random() < 0.55 ? 'effect' : 'glitter'
      particle.x = center.x + random(-18, 18)
      particle.y = center.y + random(-24, 24)
      particle.vx = Math.cos(angle) * speed
      particle.vy = Math.sin(angle) * speed - random(180, 390)
      particle.age = 0
      particle.lifetime = random(0.9, 1.6)
      particle.size = random(8, 20)
      particle.color = Math.floor(Math.random() * COLORS.length)
      particle.frameOffset = Math.floor(Math.random() * 8)
    }
    this.ensureFrame()
  }

  getParticleCount(): number {
    let count = 0
    for (const particle of this.particles) if (particle.active) count += 1
    return count
  }

  /** Remove the effect immediately, including when the pet is hidden to tray. */
  clear(): void {
    this.gathering = false
    this.gatherAccumulator = 0
    for (const particle of this.particles) particle.active = false
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.previousFrameTime = 0
    this.context.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
  }

  dispose(): void {
    this.clear()
    for (const image of this.sourceImages) image.close()
    this.canvas.remove()
  }

  private toScreen(point: ParticlePoint): ParticlePoint {
    return { x: window.screenX + point.x, y: window.screenY + point.y }
  }

  private takeParticle(): Particle | undefined {
    return this.particles.find((particle) => !particle.active)
  }

  private spawnGather(): void {
    const particle = this.takeParticle()
    if (!particle) return
    const angle = random(0, Math.PI * 2)
    const radius = random(62, 155)
    particle.active = true
    particle.mode = 'gather'
    particle.kind = Math.random() < 0.55 ? 'effect' : 'glitter'
    particle.x = this.gatherCenter.x + Math.cos(angle) * radius
    particle.y = this.gatherCenter.y + Math.sin(angle) * radius
    particle.vx = -Math.cos(angle) * random(28, 65) - Math.sin(angle) * 28
    particle.vy = -Math.sin(angle) * random(28, 65) + Math.cos(angle) * 28
    particle.age = 0
    particle.lifetime = random(0.55, 0.9)
    particle.size = random(5, 11)
    particle.color = Math.floor(Math.random() * COLORS.length)
    particle.frameOffset = Math.floor(Math.random() * 8)
  }

  private ensureFrame(): void {
    if (this.frameHandle) return
    this.previousFrameTime = 0
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.frameHandle = 0
    const delta = this.previousFrameTime === 0 ? 0 : Math.min(0.05, (now - this.previousFrameTime) / 1000)
    this.previousFrameTime = now
    this.step(delta)
    this.draw()
    if (this.gathering || this.getParticleCount() > 0) {
      this.frameHandle = requestAnimationFrame(this.frame)
    } else {
      this.previousFrameTime = 0
    }
  }

  private step(delta: number): void {
    if (this.gathering) {
      this.gatherAccumulator += delta
      while (this.gatherAccumulator >= 0.065) {
        this.gatherAccumulator -= 0.065
        if (this.getParticleCount() < 16) this.spawnGather()
      }
    }
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.age += delta
      if (particle.age >= particle.lifetime) {
        particle.active = false
        continue
      }
      if (particle.mode === 'gather') {
        const dx = this.gatherCenter.x - particle.x
        const dy = this.gatherCenter.y - particle.y
        particle.vx += (dx * 13 - particle.vx * 2.4) * delta
        particle.vy += (dy * 13 - particle.vy * 2.4) * delta
      } else {
        particle.vy += GRAVITY * delta
        particle.vx *= Math.exp(-0.16 * delta)
      }
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
    }
  }

  private resizeCanvas(): void {
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    if (width === this.canvasWidth && height === this.canvasHeight && ratio === this.pixelRatio) return
    this.canvasWidth = width
    this.canvasHeight = height
    this.pixelRatio = ratio
    this.canvas.width = Math.ceil(width * ratio)
    this.canvas.height = Math.ceil(height * ratio)
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
    this.context.imageSmoothingEnabled = false
  }

  private draw(): void {
    this.resizeCanvas()
    const context = this.context
    context.clearRect(0, 0, this.canvasWidth, this.canvasHeight)
    context.globalCompositeOperation = 'lighter'
    for (const particle of this.particles) {
      if (!particle.active) continue
      const progress = particle.age / particle.lifetime
      const fadeIn = Math.min(1, progress / 0.1)
      const fadeOut = Math.min(1, (1 - progress) / 0.27)
      const opacity = Math.max(0, Math.min(fadeIn, fadeOut))
      const x = particle.x - window.screenX
      const y = particle.y - window.screenY
      if (x < -60 || x > this.canvasWidth + 60 || y < -60 || y > this.canvasHeight + 60) continue
      const frame = (particle.frameOffset + Math.floor(progress * 8)) % 8
      const textureIndex = (particle.kind === 'effect' ? 0 : 8) + frame
      const texture = this.textures[textureIndex * COLORS.length + particle.color]
      const trailFactor = particle.mode === 'gather' ? 0.018 : 0.035
      this.drawSprite(texture, x - particle.vx * trailFactor * 1.8, y - particle.vy * trailFactor * 1.8,
        particle.size * 0.47, opacity * 0.16, particle.color)
      this.drawSprite(texture, x - particle.vx * trailFactor, y - particle.vy * trailFactor,
        particle.size * 0.7, opacity * 0.32, particle.color)
      this.drawSprite(texture, x, y, particle.size, opacity, particle.color)
    }
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
  }

  private drawSprite(
    texture: HTMLCanvasElement | undefined,
    x: number,
    y: number,
    size: number,
    alpha: number,
    color: number
  ): void {
    const context = this.context
    context.globalAlpha = alpha
    if (texture) {
      context.drawImage(texture, x - size / 2, y - size / 2, size, size)
    } else {
      // A visible fallback while textures decode or if a local asset is missing.
      context.fillStyle = COLORS[color] ?? COLORS[0]
      context.fillRect(x - size / 2, y - size / 2, size, size)
    }
  }

  private async loadTextures(): Promise<void> {
    await Promise.all(TEXTURE_NAMES.map(async (name, index) => {
      try {
        const bytes = await this.api.loadAsset(name)
        const image = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
        this.sourceImages.push(image)
        for (let color = 0; color < COLORS.length; color += 1) {
          const tinted = document.createElement('canvas')
          tinted.width = image.width
          tinted.height = image.height
          const context = tinted.getContext('2d', { alpha: true })
          if (!context) continue
          context.imageSmoothingEnabled = false
          context.drawImage(image, 0, 0)
          context.globalCompositeOperation = 'source-in'
          context.fillStyle = COLORS[color] ?? COLORS[0]
          context.fillRect(0, 0, tinted.width, tinted.height)
          this.textures[index * COLORS.length + color] = tinted
        }
      } catch (error) {
        this.api.log(`particle texture ${name} error: ${String(error)}`)
      }
    }))
  }
}

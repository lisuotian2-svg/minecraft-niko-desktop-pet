/** Tiny canvas overlay for bread crumbs and pixel hearts. */
export interface SnackPoint {
  x: number
  y: number
}

interface Snack {
  active: boolean
  kind: 'crumb' | 'heart'
  x: number
  y: number
  vx: number
  vy: number
  age: number
  lifetime: number
  size: number
  color: string
}

const MAX_SNACKS = 48
const CRUMB_COLORS = ['#8a5a32', '#b07a45', '#6b4226', '#d09a5f']
const HEART_COLORS = ['#ff7aa8', '#ff9ec1', '#ff4f8b']

function random(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class SnackParticles {
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private readonly particles = Array.from({ length: MAX_SNACKS }, (): Snack => ({
    active: false,
    kind: 'crumb',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    lifetime: 1,
    size: 4,
    color: CRUMB_COLORS[0] ?? '#8a5a32'
  }))
  private frameHandle = 0
  private previousTime = 0
  private width = 0
  private height = 0
  private ratio = 0

  constructor() {
    const context = this.canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Snack canvas 2D context is unavailable')
    this.context = context
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;background:transparent;z-index:9;'
    document.body.appendChild(this.canvas)
    this.resize()
  }

  crumbs(origin: SnackPoint): void {
    const center = this.toScreen(origin)
    for (let index = 0; index < 8; index += 1) {
      const particle = this.take()
      if (!particle) break
      particle.active = true
      particle.kind = 'crumb'
      particle.x = center.x + random(-10, 10)
      particle.y = center.y + random(-4, 8)
      particle.vx = random(-42, 42)
      particle.vy = random(-50, 10)
      particle.age = 0
      particle.lifetime = random(0.55, 0.9)
      particle.size = random(2, 5)
      particle.color = CRUMB_COLORS[Math.floor(Math.random() * CRUMB_COLORS.length)] ?? CRUMB_COLORS[0]!
    }
    this.ensureFrame()
  }

  hearts(origin: SnackPoint): void {
    const center = this.toScreen(origin)
    for (let index = 0; index < 3; index += 1) {
      const particle = this.take()
      if (!particle) break
      particle.active = true
      particle.kind = 'heart'
      particle.x = center.x + random(-18, 18)
      particle.y = center.y + random(-14, 2)
      particle.vx = random(-14, 14)
      particle.vy = random(-34, -18)
      particle.age = 0
      particle.lifetime = random(0.9, 1.4)
      particle.size = random(5, 8)
      particle.color = HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)] ?? HEART_COLORS[0]!
    }
    this.ensureFrame()
  }

  clear(): void {
    for (const particle of this.particles) particle.active = false
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.previousTime = 0
    this.context.clearRect(0, 0, this.width, this.height)
  }

  private take(): Snack | undefined {
    return this.particles.find((particle) => !particle.active)
  }

  private toScreen(point: SnackPoint): SnackPoint {
    return { x: window.screenX + point.x, y: window.screenY + point.y }
  }

  private ensureFrame(): void {
    if (this.frameHandle) return
    this.previousTime = 0
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.frameHandle = 0
    const delta = this.previousTime === 0 ? 0 : Math.min(0.05, (now - this.previousTime) / 1000)
    this.previousTime = now
    this.step(delta)
    this.draw()
    if (this.particles.some((particle) => particle.active)) {
      this.frameHandle = requestAnimationFrame(this.frame)
    } else {
      this.previousTime = 0
    }
  }

  private step(delta: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue
      particle.age += delta
      if (particle.age >= particle.lifetime) {
        particle.active = false
        continue
      }
      particle.vy += 260 * delta
      particle.x += particle.vx * delta
      particle.y += particle.vy * delta
    }
  }

  private draw(): void {
    this.resize()
    const context = this.context
    context.clearRect(0, 0, this.width, this.height)
    context.imageSmoothingEnabled = false
    for (const particle of this.particles) {
      if (!particle.active) continue
      const progress = particle.age / particle.lifetime
      const alpha = progress < 0.2 ? progress / 0.2 : 1 - Math.max(0, (progress - 0.55) / 0.45)
      const x = particle.x - window.screenX
      const y = particle.y - window.screenY
      context.globalAlpha = Math.max(0, Math.min(1, alpha))
      context.fillStyle = particle.color
      if (particle.kind === 'crumb') {
        context.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(particle.size)), Math.max(1, Math.round(particle.size)))
      } else {
        const pixel = Math.max(1, Math.round(particle.size / 3))
        context.fillRect(Math.round(x - pixel), Math.round(y - pixel), pixel * 2, pixel * 2)
        context.fillRect(Math.round(x + pixel), Math.round(y - pixel), pixel * 2, pixel * 2)
        context.fillRect(Math.round(x - pixel), Math.round(y + pixel), pixel * 4, pixel * 2)
        context.fillRect(Math.round(x), Math.round(y + pixel * 3), pixel * 2, pixel)
      }
    }
    context.globalAlpha = 1
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth)
    const height = Math.max(1, window.innerHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    if (width === this.width && height === this.height && ratio === this.ratio) return
    this.width = width
    this.height = height
    this.ratio = ratio
    this.canvas.width = Math.ceil(width * ratio)
    this.canvas.height = Math.ceil(height * ratio)
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
}

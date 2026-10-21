import type { CloseSignState, SignEdge } from '../shared/contracts'

/**
 * 2D overlay for the close prompt: a pixel hand holds a Minecraft-style wooden
 * sign reading "I'M IN THE TRAY". It never draws the pet body.
 *
 * Main owns the close sequence and sends CloseSignState (after the purple
 * particles). This class only animates entering/holding/leaving and reports a
 * click on the sign through `onReveal`. The window must be interactive for the
 * click to reach the renderer; that is a main/preload integration point.
 */

const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  "'": ['00110', '00110', '00000', '00000', '00000', '00000', '00000'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100']
})

const SIGN_TEXT = "I'M IN THE TRAY"
const ENTER_MS = 350
const LEAVE_MS = 300

export interface CloseSignOverlayOptions {
  onReveal?: () => void
}

export class CloseSignOverlay {
  private readonly canvas = document.createElement('canvas')
  private readonly context: CanvasRenderingContext2D
  private readonly onReveal?: () => void
  private state: CloseSignState = {
    visible: false,
    edge: 'bottom',
    phase: 'hidden',
    windowBounds: null
  }
  private phaseStartedAt = 0
  private frameHandle = 0
  private width = 0
  private height = 0
  private ratio = 0
  private signRect = { x: 0, y: 0, width: 0, height: 0 }

  constructor(options: CloseSignOverlayOptions = {}) {
    const context = this.canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Close sign canvas 2D context is unavailable')
    this.context = context
    this.onReveal = options.onReveal
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;background:transparent;z-index:12;'
    document.body.appendChild(this.canvas)
    window.addEventListener('pointerdown', this.onPointerDown)
    this.resize()
  }

  setState(state: CloseSignState): void {
    if (!state.visible || state.phase === 'hidden') {
      this.clear()
      return
    }
    const phaseChanged = state.phase !== this.state.phase || state.edge !== this.state.edge
    this.state = state
    if (phaseChanged) this.phaseStartedAt = performance.now()
    this.ensureFrame()
  }

  clear(): void {
    this.state = {
      visible: false,
      edge: 'bottom',
      phase: 'hidden',
      windowBounds: null
    }
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
    this.context.clearRect(0, 0, this.width, this.height)
  }

  dispose(): void {
    this.clear()
    window.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.remove()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.state.visible || this.state.phase !== 'holding') return
    const rect = this.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const hit = this.signRect
    if (x < hit.x - 16 || x > hit.x + hit.width + 16 || y < hit.y - 16 || y > hit.y + hit.height + 16) {
      return
    }
    event.preventDefault()
    this.onReveal?.()
  }

  private ensureFrame(): void {
    if (this.frameHandle) return
    this.frameHandle = requestAnimationFrame(this.frame)
  }

  private readonly frame = (now: number): void => {
    this.frameHandle = 0
    if (!this.state.visible) return
    this.draw(now)
    if (this.state.phase === 'entering' || this.state.phase === 'leaving') {
      this.frameHandle = requestAnimationFrame(this.frame)
    }
  }

  private draw(now: number): void {
    this.resize()
    const context = this.context
    context.clearRect(0, 0, this.width, this.height)
    const progress = this.phaseProgress(now)
    if (progress <= 0.001) return
    const w = this.width
    const h = this.height
    const edge: SignEdge = this.state.edge
    const signWidth = Math.round(Math.min(430, Math.max(240, w * 0.28)))
    const signHeight = Math.round(signWidth * 0.42)
    const hidden = this.state.phase === 'hidden'
    if (hidden) return
    let x = 0
    let y = 0
    if (edge === 'left') {
      x = Math.round(-signWidth + progress * (signWidth + 36))
      y = Math.round(h * 0.56 - signHeight / 2)
    } else if (edge === 'right') {
      x = Math.round(w - progress * (signWidth + 36))
      y = Math.round(h * 0.56 - signHeight / 2)
    } else {
      x = Math.round(w / 2 - signWidth / 2)
      y = Math.round(h - signHeight - 18 + (1 - progress) * (signHeight + 80))
    }
    this.signRect = { x, y, width: signWidth, height: signHeight }
    this.drawArm(context, edge, x, y, signWidth, signHeight)
    this.drawBoard(context, x, y, signWidth, signHeight)
  }

  private phaseProgress(now: number): number {
    if (this.state.phase === 'holding') return 1
    if (this.state.phase === 'entering') {
      return Math.min(1, (now - this.phaseStartedAt) / ENTER_MS)
    }
    if (this.state.phase === 'leaving') {
      return Math.max(0, 1 - (now - this.phaseStartedAt) / LEAVE_MS)
    }
    return 0
  }

  private drawArm(
    context: CanvasRenderingContext2D,
    edge: SignEdge,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const sleeve = '#6b3039'
    const sleeveDark = '#4c1d2a'
    const skin = '#f7b99f'
    const skinDark = '#c86886'
    const arm = Math.round(height * 0.42)
    if (edge === 'bottom') {
      const cx = Math.round(x + width * 0.55)
      context.fillStyle = sleeve
      context.fillRect(cx - arm / 2, y + height - 4, arm, Math.max(24, this.height - y - height + 24))
      context.fillStyle = sleeveDark
      context.fillRect(cx - arm / 2, y + height - 4, arm, 6)
      context.fillStyle = skin
      context.fillRect(cx - arm / 2 + 4, y + height - 18, arm - 8, 18)
      context.fillStyle = skinDark
      context.fillRect(cx - arm / 2 + 4, y + height - 18, arm - 8, 4)
      return
    }
    const right = edge === 'right'
    const armY = Math.round(y + height * 0.55)
    const armX = right ? x + width - 4 : x - 28
    context.fillStyle = sleeve
    context.fillRect(right ? armX : armX - 52, armY - arm / 2, right ? this.width - armX : 80, arm)
    context.fillStyle = sleeveDark
    context.fillRect(right ? armX : armX - 52, armY - arm / 2, right ? 8 : 80, 5)
    context.fillStyle = skin
    context.fillRect(right ? armX + 8 : armX - 42, armY - arm / 2 + 4, 34, arm - 8)
    context.fillStyle = skinDark
    context.fillRect(right ? armX + 8 : armX - 42, armY + arm / 2 - 10, 34, 4)
  }

  private drawBoard(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const border = 5
    context.fillStyle = '#5c3a1f'
    context.fillRect(x, y, width, height)
    context.fillStyle = '#8a5a32'
    context.fillRect(x + border, y + border, width - border * 2, height - border * 2)
    context.fillStyle = '#a97745'
    context.fillRect(x + border, y + border, width - border * 2, 7)
    context.fillStyle = '#6b4226'
    context.fillRect(x + border + 3, y + border + 3, width - border * 2 - 6, 3)
    // Two wooden posts hint at Minecraft's sign silhouette.
    context.fillStyle = '#5c3a1f'
    context.fillRect(x + 10, y + height, 10, 26)
    context.fillRect(x + width - 20, y + height, 10, 26)
    const scale = Math.max(2, Math.min(4, Math.round(width / 115)))
    const glyphHeight = 7 * scale
    const gap = scale
    const textWidth = [...SIGN_TEXT].reduce((sum, letter) => sum + 5 * scale + gap, 0) - gap
    const textX = Math.round(x + (width - textWidth) / 2)
    const textY = Math.round(y + (height - glyphHeight) / 2)
    context.fillStyle = '#2b1a0e'
    let cursor = textX
    for (const letter of SIGN_TEXT) {
      const glyph = GLYPHS[letter] ?? GLYPHS[' '] ?? []
      for (let row = 0; row < glyph.length; row += 1) {
        const line = glyph[row] ?? ''
        for (let column = 0; column < line.length; column += 1) {
          if (line[column] === '1') {
            context.fillRect(cursor + column * scale, textY + row * scale, scale, scale)
          }
        }
      }
      cursor += 5 * scale + gap
    }
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

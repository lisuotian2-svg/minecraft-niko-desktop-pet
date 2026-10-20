import { SkinViewer } from 'skinview3d'
import { Raycaster, Vector2 } from 'three'
import { reboundEase } from '../shared/easing'
import './pet.css'

interface CursorPoint {
  x: number
  y: number
}

interface PetApi {
  setInteractive(interactive: boolean): void
  quit(): void
  log(message: string): void
  getCursorPoint(): Promise<CursorPoint>
  loadAsset(name: 'skin' | 'Ya1' | 'Ya2'): Promise<Uint8Array>
}

declare global {
  interface Window {
    petApi: PetApi
  }
}

const canvas: HTMLCanvasElement = (() => {
  const element = document.querySelector<HTMLCanvasElement>('#pet')
  if (!element) throw new Error('Pet canvas is missing')
  return element
})()

const viewer = new SkinViewer({
  canvas,
  width: 420,
  height: 420,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
  enableControls: false
})

viewer.background = null
viewer.renderer.setClearColor(0x000000, 0)
viewer.camera.position.set(30, 18, 52)
viewer.controls.target.set(0, 7, 0)
viewer.controls.update()
viewer.camera.updateProjectionMatrix()
// 420px canvas, pet target height ~220px: the 0.55 zoom frames the full Slim model
// with the feet near 85% of the canvas height.
viewer.zoom = 0.55
viewer.controls.update()
viewer.playerWrapper.rotation.y = -Math.PI / 8
;(window as Window & { __nikoViewer?: SkinViewer }).__nikoViewer = viewer
window.petApi.log('viewer ready')

const contextAttributes = viewer.renderer.getContext().getContextAttributes()
if (contextAttributes?.alpha !== true || viewer.renderer.getClearAlpha() !== 0) {
  window.petApi.log('ERROR: WebGL canvas alpha is unavailable; transparent background cannot be guaranteed')
} else {
  window.petApi.log('transparent WebGL alpha confirmed')
}

const raycaster = new Raycaster()
const pointer = new Vector2()
let skinPixels: Uint8ClampedArray | null = null
let skinWidth = 64
let skinHeight = 64
let skinReady = false
let interactive = false
let pressed = false
let pressStartedAt = 0
let pressSequence = 0
let tweenFrame = 0
let tweenGeneration = 0
let cursorPollPending = false

function setInteractive(next: boolean): void {
  if (interactive === next) return
  interactive = next
  window.petApi.setInteractive(next)
  window.petApi.log(`renderer interactive -> ${next}`)
}

function isVisibleTexel(u: number, v: number): boolean {
  if (!skinPixels) return true
  const x = Math.min(skinWidth - 1, Math.max(0, Math.floor(u * skinWidth)))
  const y = Math.min(skinHeight - 1, Math.max(0, Math.floor((1 - v) * skinHeight)))
  const alpha = skinPixels[(y * skinWidth + x) * 4 + 3]
  return alpha !== undefined && alpha > 16
}

function hitCharacter(clientX: number, clientY: number): boolean {
  if (!skinReady) return false
  const rect = canvas.getBoundingClientRect()
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false

  pointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(pointer, viewer.camera)
  const hits = raycaster.intersectObject(viewer.playerObject.skin, true)
  return hits.some((hit) => hit.uv !== undefined && isVisibleTexel(hit.uv.x, hit.uv.y))
}

function updateCursor(clientX: number, clientY: number): void {
  setInteractive(pressed || hitCharacter(clientX, clientY))
}

window.addEventListener('mousemove', (event) => {
  updateCursor(event.clientX, event.clientY)
})

// Forwarded mousemove is the fast path. Screen cursor polling also recovers from
// Windows/Electron combinations that stop dispatching moves while click-through.
window.setInterval(() => {
  if (cursorPollPending) return
  cursorPollPending = true
  void window.petApi.getCursorPoint()
    .then((point) => updateCursor(point.x, point.y))
    .catch((error: unknown) => window.petApi.log(`cursor poll error: ${String(error)}`))
    .finally(() => { cursorPollPending = false })
}, 33)

function setScale(scaleX: number, scaleY: number): void {
  viewer.playerObject.scale.set(scaleX, scaleY, 1)
  // The outer skin's feet are at local y=-16.25. Counter the origin-based scale to keep
  // the feet planted at the same point on screen.
  viewer.playerObject.position.y = -16.25 * (1 - scaleY)
}

function stopTween(): void {
  tweenGeneration += 1
  if (tweenFrame !== 0) cancelAnimationFrame(tweenFrame)
  tweenFrame = 0
}

function rebound(): void {
  stopTween()
  const generation = tweenGeneration
  const start = performance.now()
  const fromX = viewer.playerObject.scale.x
  const fromY = viewer.playerObject.scale.y

  function frame(now: number): void {
    if (generation !== tweenGeneration) return
    const elapsed = Math.min(1, (now - start) / 220)
    const ease = reboundEase(elapsed)
    setScale(fromX + (1 - fromX) * ease, fromY + (1 - fromY) * ease)
    if (elapsed < 1) tweenFrame = requestAnimationFrame(frame)
    else tweenFrame = 0
  }

  tweenFrame = requestAnimationFrame(frame)
}

const audio = new AudioContext()
const audioBuffers: Partial<Record<'down' | 'up', AudioBuffer>> = {}

async function loadAudio(name: 'down' | 'up', file: 'Ya1' | 'Ya2'): Promise<void> {
  try {
    const bytes = await window.petApi.loadAsset(file)
    audioBuffers[name] = await audio.decodeAudioData(Uint8Array.from(bytes).buffer)
    window.petApi.log(`audio ${file}.mp3 decoded`)
  } catch (error) {
    window.petApi.log(`audio error ${file}.mp3: ${String(error)}`)
  }
}

void Promise.all([loadAudio('down', 'Ya1'), loadAudio('up', 'Ya2')])

function playAudio(name: 'down' | 'up'): void {
  const buffer = audioBuffers[name]
  if (!buffer) {
    window.petApi.log(`audio ${name} not ready`)
    return
  }

  try {
    const source = audio.createBufferSource()
    const gain = audio.createGain()
    source.buffer = buffer
    gain.gain.value = 0.4
    source.connect(gain).connect(audio.destination)
    source.start()
    void audio.resume().catch((error: unknown) => window.petApi.log(`audio resume error: ${String(error)}`))
  } catch (error) {
    window.petApi.log(`audio play error: ${String(error)}`)
  }
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !hitCharacter(event.clientX, event.clientY)) return
  event.preventDefault()
  canvas.setPointerCapture(event.pointerId)
  pressed = true
  pressSequence += 1
  pressStartedAt = performance.now()
  setInteractive(true)
  stopTween()
  setScale(1.05, 0.88)
  playAudio('down')
  window.petApi.log('press')
})

function release(playSound: boolean): void {
  if (!pressed) return
  pressed = false
  if (playSound) playAudio('up')
  window.petApi.log('release')
  const remaining = Math.max(0, 32 - (performance.now() - pressStartedAt))
  const sequence = pressSequence
  window.setTimeout(() => {
    if (!pressed && sequence === pressSequence) rebound()
  }, remaining)
}

canvas.addEventListener('pointerup', () => release(true))
canvas.addEventListener('pointercancel', () => release(false))
window.addEventListener('blur', () => release(false))

async function loadSkin(): Promise<void> {
  let assetUrl: string | null = null
  try {
    const bytes = await window.petApi.loadAsset('skin')
    assetUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
    await viewer.loadSkin(assetUrl, { model: 'slim' })
    viewer.playerObject.skin.setOuterLayerVisible(true)
    const source = viewer.skinCanvas
    const context = source.getContext('2d', { willReadFrequently: true })
    if (context) {
      skinWidth = source.width
      skinHeight = source.height
      skinPixels = context.getImageData(0, 0, skinWidth, skinHeight).data
    }
    skinReady = true
    window.petApi.log(`skin loaded: slim, outer layer visible, ${skinWidth}x${skinHeight}`)
  } catch (error) {
    window.petApi.log(`skin load error: ${String(error)}`)
  } finally {
    if (assetUrl) URL.revokeObjectURL(assetUrl)
  }
}

void loadSkin()

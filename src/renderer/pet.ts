import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'
import { PetAnimator } from './animator'
import { PetAudio } from './audio'
import { PetGestures } from './gestures'
import { CharacterHitTest } from './hit-test'
import { PetBread } from './bread'
import { PurpleParticles } from './particles'
import { SnackParticles } from './snacks'
import { PetTorch } from './torch'
import { BlinkTexture, createViewer, loadSkin } from './viewer'
import './pet.css'

interface NikoDebugApi {
  viewer: SkinViewer
  getState(): ReturnType<PetAnimator['getState']> & {
    pressed: boolean
    interactive: boolean
    skinReady: boolean
    size: number | null
    volume: number | null
    scaleX: number
    scaleY: number
    zoom: number
    torchOn: boolean
    dragging: boolean
    closing: boolean
    gesturePhase: PetGestures['gesturePhase']
  }
  forceWalk(direction?: WalkDirection): Promise<void>
  stopWalk(): Promise<void>
  stretch(): void
  eat(): void
  toggleTorch(on?: boolean): boolean
  forceClose(): Promise<void>
  photo(): Promise<string | null>
  getTorch(): ReturnType<PetTorch['getState']>
  getParticles(): number
}

declare global {
  interface Window {
    petApi: PetApi
    __niko?: NikoDebugApi
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#pet') ?? (() => {
  throw new Error('Pet canvas is missing')
})()

const api = window.petApi
const viewer = createViewer(canvas, api)
const animator = new PetAnimator(viewer)
const audio = new PetAudio(api)
const hitTest = new CharacterHitTest(canvas, viewer)
const torch = new PetTorch(viewer, api)
const bread = new PetBread(viewer, api)
const particles = new PurpleParticles(api)
const snacks = new SnackParticles()
let torchOn = false
let manualTorch = false
let autoTorchActive = false
let autoTorchTimer = 0
let lastAutoTorchAt = 0
let brightnessValue: number | null = null
let eating = false
let eatTimers: number[] = []

function petOrigin(): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.52 }
}

function cancelEat(): void {
  for (const timer of eatTimers) window.clearTimeout(timer)
  eatTimers = []
  eating = false
  bread.setVisible(false)
  animator.cancelEat()
}

function eat(): void {
  if (!skinReady || eating || torchOn || gestures.isDragging || gestures.isClosing) return
  if (torchOn) toggleTorch(false)
  eating = true
  animator.eat()
  bread.setVisible(true)
  bread.setBite(0)
  const origin = petOrigin()
  const biteTimes = [900, 1600, 2300, 3000]
  biteTimes.forEach((delay, index) => {
    const timer = window.setTimeout(() => {
      if (!eating) return
      bread.setBite(index + 1)
      audio.chew()
      snacks.crumbs(origin)
      if (index === biteTimes.length - 1) {
        window.setTimeout(() => {
          if (!eating) return
          audio.burp()
          snacks.hearts(origin)
        }, 280)
      }
    }, delay)
    eatTimers.push(timer)
  })
  const finish = window.setTimeout(() => {
    bread.setVisible(false)
    eating = false
    eatTimers = []
  }, 3900)
  eatTimers.push(finish)
}

function clearAutoTorch(): void {
  if (autoTorchTimer !== 0) window.clearTimeout(autoTorchTimer)
  autoTorchTimer = 0
  autoTorchActive = false
}

function toggleTorch(on = !torchOn, manual = true): boolean {
  if (manual) {
    manualTorch = on
    if (on) clearAutoTorch()
  }
  if (on === torchOn) return torchOn
  if (on) cancelEat()
  torchOn = on
  torch.setOn(on)
  animator.setTorchOn(on)
  audio.torch(on)
  return torchOn
}

function maybeAutoTorch(value: number | null): void {
  brightnessValue = value
  if (value === null || !currentSettings?.autoTorch) return
  if (value > currentSettings.darkThreshold) {
    if (autoTorchActive) {
      clearAutoTorch()
      if (torchOn && !manualTorch) toggleTorch(false, false)
    }
    return
  }
  if (manualTorch || autoTorchActive || torchOn || eating) return
  if (performance.now() - lastAutoTorchAt < 10 * 60_000) return
  if (gestures.isPressed || gestures.isClosing || !viewer.playerObject.visible) return
  autoTorchActive = true
  lastAutoTorchAt = performance.now()
  toggleTorch(true, false)
  const duration = 12_000 + Math.random() * 6_000
  autoTorchTimer = window.setTimeout(() => {
    autoTorchActive = false
    autoTorchTimer = 0
    if (torchOn && !manualTorch) toggleTorch(false, false)
  }, duration)
  api.log(`auto torch on for ${Math.round(duration / 1000)}s (brightness ${value})`)
}

function stretch(): void {
  if (eating || torchOn || gestures.isDragging || gestures.isClosing) return
  animator.stretch()
  audio.stretch()
}

async function closePet(): Promise<void> {
  clearAutoTorch()
  cancelEat()
  snacks.clear()
  particles.burst(petOrigin())
  viewer.playerObject.visible = false
  audio.close()
  try {
    await api.beginClose()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1200))
    await api.finishClose()
  } catch (error) {
    // Main has its own close timeout. If the IPC fails before expansion, restore
    // the renderer immediately so a later tray show is still usable.
    particles.clear()
    viewer.playerObject.visible = true
    gestures.resetAfterRestore()
    throw error
  }
}

const gestures = new PetGestures(canvas, viewer, hitTest, animator, audio, api, {
  toggleTorch: () => { toggleTorch() },
  startGathering: () => particles.startGathering(petOrigin()),
  stopGathering: () => particles.stopGathering(),
  close: closePet
})
let skinReady = false
let currentSettings: PetSettings | null = null

api.onRestored(() => {
  viewer.playerObject.visible = true
  particles.clear()
  snacks.clear()
  clearAutoTorch()
  cancelEat()
  gestures.resetAfterRestore()
  api.log('pet restored from tray')
})

function resizeViewer(): void {
  // Only initialise on load and on an explicit settings/size change. Do not listen to
  // every window 'resize' event: feeding innerWidth back on each resize caused a
  // horizontal window growth loop on this transparent Windows window.
  const width = Math.max(1, window.innerWidth)
  const height = Math.max(1, window.innerHeight)
  viewer.setSize(width, height)
}
resizeViewer()

function applySettings(settings: PetSettings): void {
  currentSettings = settings
  audio.setSettings(settings)
  // Main resizes the square window for size changes, so this preserves M0 framing.
  viewer.zoom = 0.55
  viewer.controls.update()
  resizeViewer()
  maybeAutoTorch(brightnessValue)
}

api.onSettings(applySettings)
void api.getSettings().then(applySettings)
  .catch((error: unknown) => api.log(`settings load error: ${String(error)}`))

api.onWalking((walking) => {
  animator.setWalking(walking)
  api.log(`walking -> ${walking}`)
})
api.onFacing((direction) => {
  animator.setFacing(direction)
  api.log(`facing -> ${direction}`)
})
api.onBrightness((value) => maybeAutoTorch(value))
api.onPhotoFreeze((frozen) => animator.setFrozen(frozen))
animator.onFootstep(() => audio.step())

function scheduleSnack(): void {
  const delay = 8 * 60_000 + Math.random() * 12 * 60_000
  window.setTimeout(() => {
    if (!document.hidden && !eating && !torchOn && !gestures.isPressed && !gestures.isClosing) eat()
    scheduleSnack()
  }, delay)
}

function scheduleStretch(): void {
  const delay = 8 * 60_000 + Math.random() * 7 * 60_000
  window.setTimeout(() => {
    if (!document.hidden && !eating && !torchOn && !gestures.isPressed && !gestures.isClosing) stretch()
    scheduleStretch()
  }, delay)
}

void loadSkin(viewer, api).then((pixels) => {
  hitTest.setSkin(pixels)
  animator.setBlinkTexture(new BlinkTexture(viewer))
  skinReady = true
  scheduleSnack()
  scheduleStretch()
}).catch((error: unknown) => api.log(`skin load error: ${String(error)}`))

if (import.meta.env.DEV || new URLSearchParams(window.location.search).get('nikoDebug') === '1') {
  window.__niko = {
    viewer,
    getState: () => ({
      ...animator.getState(),
      pressed: gestures.isPressed,
      interactive: gestures.isInteractive,
      skinReady,
      size: currentSettings?.size ?? null,
      volume: currentSettings?.volume ?? null,
      scaleX: viewer.playerObject.scale.x,
      scaleY: viewer.playerObject.scale.y,
      zoom: viewer.zoom,
      torchOn,
      manualTorch,
      autoTorch: autoTorchActive,
      brightness: brightnessValue,
      dragging: gestures.isDragging,
      closing: gestures.isClosing,
      gesturePhase: gestures.gesturePhase
    }),
    forceWalk: (direction) => api.forceWalk(direction),
    stopWalk: () => api.stopWalk(),
    stretch,
    eat,
    toggleTorch,
    forceClose: () => gestures.forceClose(),
    photo: () => api.takePhoto(),
    getTorch: () => torch.getState(),
    getParticles: () => particles.getParticleCount()
  }
}

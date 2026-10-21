import { Vector3 } from 'three'
import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import {
  EMPTY_FULLSCREEN_STATE,
  PERFORMANCE_PRESETS,
  isPerformanceMode
} from '../shared/contracts'
import type {
  ActionRequest,
  ActionResult,
  CloseSignState,
  FullscreenState,
  PerformanceMode
} from '../shared/contracts'
import { DEFAULT_SETTINGS, type PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'
import { PetAnimator } from './animator'
import { PetAudio } from './audio'
import { PetGestures } from './gestures'
import { CharacterHitTest } from './hit-test'
import { PetBread } from './bread'
import {
  InteractionActions,
  TorchController,
  type ActionHostPort,
  type ActionHostState
} from './interaction-actions'
import { PurpleParticles } from './particles'
import { CloseSignOverlay } from './sign'
import { ContactShadow, SnackParticles } from './snacks'
import { PetTorch } from './torch'
import { BlinkTexture, createViewer, loadSkin } from './viewer'
import './pet.css'

/**
 * Close-sign channels are part of the task-10 contract but are not yet exposed
 * by preload/main. They are optional so the head-only peek (G1 blocker) can
 * ship and the sign wiring can be added without another renderer refactor.
 */
interface PetApiWithCloseSign extends PetApi {
  onCloseSign?(callback: (state: CloseSignState) => void): () => void
  revealFromCloseSign?(): void
}

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
  pet(): boolean
  stretch(): boolean
  eat(): boolean
  toggleTorch(on?: boolean): boolean
  forceClose(): Promise<void>
  photo(): Promise<string | null>
  getTorch(): ReturnType<PetTorch['getState']>
  getTorchController(): ReturnType<TorchController['getState']>
  getActionState(): ActionHostState
  performAction(request: ActionRequest): ActionResult
  setWalkPaused(paused: boolean): void
  getPeekState(): FullscreenState
  revealPeek(): void
  getParticles(): number
  getShadow(): { enabled: boolean; visible: boolean }
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
// The contact shadow canvas is inserted before #pet; it must stay behind the
// WebGL canvas, while snack particles remain above it.
canvas.style.position = 'relative'
canvas.style.zIndex = '1'

const api = window.petApi
const viewer = createViewer(canvas, api)
const animator = new PetAnimator(viewer)
const audio = new PetAudio(api)
const hitTest = new CharacterHitTest(canvas, viewer)
const torch = new PetTorch(viewer, api)
const bread = new PetBread(viewer, api)
const particles = new PurpleParticles(api)
const snacks = new SnackParticles()
const shadow = new ContactShadow()
const closeSign = new CloseSignOverlay({
  onReveal: () => {
    const closeApi = api as PetApiWithCloseSign
    if (typeof closeApi.revealFromCloseSign === 'function') {
      try {
        closeApi.revealFromCloseSign()
      } catch (error) {
        api.log(`close sign reveal error: ${String(error)}`)
      }
    } else {
      api.log('close sign reveal unavailable: waiting for pet:close-sign-reveal preload/main')
    }
  }
})
let brightnessValue: number | null = null
let eating = false
let eatTimers: number[] = []
let walking = false
let peekActive = false
let peekState: FullscreenState = { ...EMPTY_FULLSCREEN_STATE }
let gestureController: PetGestures | null = null
const footPoint = new Vector3()
const headPoint = new Vector3()
const mouthPoint = new Vector3()

const torchController = new TorchController({
  settings: {
    autoTorch: DEFAULT_SETTINGS.autoTorch,
    darkThreshold: DEFAULT_SETTINGS.darkThreshold
  },
  port: {
    applyVisual: (on) => {
      torch.setOn(on)
      animator.setTorchOn(on)
    },
    playSound: (on) => audio.torch(on),
    isBusy: () => (gestureController?.isPressed ?? false) ||
      (gestureController?.isClosing ?? false) ||
      eating || document.hidden || animator.isExclusiveAction,
    log: (message) => api.log(message)
  }
})
document.addEventListener('visibilitychange', () => {
  torchController.setHidden(document.hidden)
})
torchController.setHidden(document.hidden)

function petOrigin(): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.52 }
}

/** Project a world-space Three point into window CSS pixels for 2D overlays. */
function toWindow(point: Vector3): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  point.project(viewer.camera)
  return {
    x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-point.y * 0.5 + 0.5) * rect.height
  }
}

function headOrigin(): { x: number; y: number } {
  headPoint.set(0, 5, 0)
  viewer.playerObject.skin.head.localToWorld(headPoint)
  return toWindow(headPoint)
}

function mouthOrigin(): { x: number; y: number } {
  mouthPoint.set(0, 3.5, 3.5)
  viewer.playerObject.skin.head.localToWorld(mouthPoint)
  return toWindow(mouthPoint)
}

function footAnchor(): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  footPoint.set(0, -24, 0)
  viewer.playerObject.localToWorld(footPoint)
  footPoint.project(viewer.camera)
  return {
    x: rect.left + (footPoint.x * 0.5 + 0.5) * rect.width,
    // Keep the shadow on the ground line instead of bobbing with the walk.
    y: rect.top + rect.height * 0.885
  }
}

function hideEat(): void {
  for (const timer of eatTimers) window.clearTimeout(timer)
  eatTimers = []
  eating = false
  bread.setVisible(false)
}

function cancelEat(): void {
  hideEat()
  animator.cancelEat()
}

function eat(): boolean {
  if (!skinReady || eating || torchController.isOn() || walking || gestures.isDragging || gestures.isClosing) return false
  if (!animator.eat()) return false
  eating = true
  bread.setVisible(true)
  bread.setBite(0)
  const biteTimes = [900, 1600, 2300, 3000]
  biteTimes.forEach((delay, index) => {
    const timer = window.setTimeout(() => {
      if (!eating) return
      bread.setBite(index + 1)
      audio.chew()
      snacks.crumbs(mouthOrigin())
      if (index === biteTimes.length - 1) {
        window.setTimeout(() => {
          if (!eating) return
          audio.burp()
          snacks.hearts(headOrigin())
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
  return true
}

function toggleTorch(on?: boolean): boolean {
  return torchController.toggleManual(on)
}

function stretch(): boolean {
  if (eating || torchController.isOn() || walking || gestures.isDragging || gestures.isClosing) return false
  if (!animator.stretch()) return false
  audio.stretch()
  return true
}

async function closePet(): Promise<void> {
  torchController.setClosing(true)
  cancelEat()
  animator.setClosing(true)
  actions.cancel('close')
  closeSign.clear()
  shadow.clear()
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
    animator.setClosing(false)
    torchController.restore()
    gestures.resetAfterRestore()
    throw error
  }
}

const actionPort: ActionHostPort = {
  getState: (): ActionHostState => ({
    hidden: document.hidden || !viewer.playerObject.visible,
    frozen: animator.isFrozen,
    fullscreenPeek: peekActive,
    gesturePhase: gestureController?.gesturePhase ?? 'idle',
    closing: (gestureController?.isClosing ?? false) || animator.behaviorMode === 'close',
    mode: animator.behaviorMode,
    activeAction: animator.activeAction,
    torchOn: torchController.isOn(),
    torchManual: torchController.getState().manual
  }),
  canRun: (action) => {
    if (animator.isFrozen) return false
    const mode = animator.behaviorMode
    if (action === 'pet') return mode === 'idle' || mode === 'walk' || mode === 'pet'
    if (action === 'feed') {
      // P0-a keeps the existing bread animation as the feed target; the proper
      // hand-offered bread interaction is P0-b.
      return !walking && (mode === 'idle' || mode === 'walk') && !torchController.isOn()
    }
    if (action === 'torch') return !animator.isExclusiveAction
    // dance/wave/sleep/wake need the P0-b posture timeline; the bus gets an
    // explicit behavior-lock rather than a fake success.
    return false
  },
  perform: (action) => {
    switch (action) {
      case 'pet': return animator.pet()
      case 'feed': return eat()
      case 'torch':
        torchController.toggleManual()
        return true
      default:
        return false
    }
  },
  cancel: (reason) => {
    if (reason === 'gesture' || reason === 'close') {
      animator.cancelAction()
      hideEat()
    }
  }
}
const actions = new InteractionActions(actionPort)

/**
 * Renderer half of a production walk pause. The optional preload method is the
 * Lead/platform integration point; until it exists the animator freezes its
 * pose but main still moves the window, so actions that need a true pause are
 * rejected by canRun() instead of being allowed to slide.
 */
function setProductionWalkPaused(paused: boolean): void {
  animator.setWalkPosePaused(paused)
  try {
    void api.setWalkPaused(paused).catch((error: unknown) =>
      api.log(`walk pause error: ${String(error)}`))
  } catch (error) {
    api.log(`walk pause error: ${String(error)}`)
  }
}

const gestures = new PetGestures(canvas, viewer, hitTest, animator, audio, api, {
  toggleTorch: () => { torchController.toggleManual() },
  startGathering: () => particles.startGathering(petOrigin()),
  stopGathering: () => particles.stopGathering(),
  close: closePet,
  onGestureStart: () => { actions.cancel('gesture') }
})
gestureController = gestures
let skinReady = false
let currentSettings: PetSettings | null = null

// task-11 preload contract: onAction is required on PetApi and forwards
// validated pet:action IPC requests to the renderer action bus.
api.onAction((request) => {
  const result = actions.performAction(request)
  api.log(`action ${request.id} ${result.ok ? 'ok' : `rejected: ${result.reason ?? 'unknown'}`}`)
})

// Close sign is task-10 renderer-side; preload/main must expose the channels
// before it can appear after the particle burst.
const closeApi = api as PetApiWithCloseSign
if (typeof closeApi.onCloseSign === 'function') {
  closeApi.onCloseSign((state) => closeSign.setState(state))
}

api.onRestored(() => {
  viewer.playerObject.visible = true
  particles.clear()
  snacks.clear()
  shadow.clear()
  closeSign.clear()
  torchController.restore()
  cancelEat()
  peekActive = false
  peekState = { ...EMPTY_FULLSCREEN_STATE }
  animator.setFullscreenPeek(peekState)
  animator.setClosing(false)
  animator.resetBehavior()
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

function performancePreset(settings: PetSettings): { mode: PerformanceMode; shadow: boolean } {
  const candidate = (settings as PetSettings & { performanceMode?: unknown }).performanceMode
  const mode: PerformanceMode = isPerformanceMode(candidate) ? candidate : 'normal'
  return { mode, shadow: PERFORMANCE_PRESETS[mode].mode !== 'simple' }
}

function applySettings(settings: PetSettings): void {
  currentSettings = settings
  audio.setSettings(settings)
  torchController.setSettings({
    autoTorch: settings.autoTorch,
    darkThreshold: settings.darkThreshold
  })
  // Main resizes the square window for size changes, so this preserves M0 framing.
  viewer.zoom = 0.55
  viewer.controls.update()
  resizeViewer()
  // performanceMode is owned by platform; until it lands, normal is the default.
  shadow.setEnabled(performancePreset(settings).shadow)
}

api.onSettings(applySettings)
void api.getSettings().then(applySettings)
  .catch((error: unknown) => api.log(`settings load error: ${String(error)}`))

api.onWalking((nextWalking) => {
  walking = nextWalking
  animator.setWalking(nextWalking)
  api.log(`walking -> ${walking}`)
})
api.onPeekState((state) => {
  peekState = state
  peekActive = state.active && state.phase !== 'idle'
  if (peekActive) {
    cancelEat()
    shadow.clear()
    torchController.setHidden(true)
  } else {
    torchController.restore()
  }
  animator.setFullscreenPeek(state)
  api.log(`peek ${state.phase} active=${String(state.active)} edge=${state.edge}`)
})
api.onFacing((direction) => {
  animator.setFacing(direction)
  api.log(`facing -> ${direction}`)
})
api.onBrightness((value) => {
  brightnessValue = value
  torchController.setBrightness(value)
})
api.onPhotoFreeze((frozen) => animator.setFrozen(frozen))
animator.onFootstep(() => audio.step())

// The interaction action bus (task-6) should call the animator methods directly:
// animator.pet()/stretch()/eat() return false when another exclusive action or
// walking blocks them. No second action bus is created here.
animator.onEvent((event) => {
  if (event.type === 'pet') {
    audio.purr()
    snacks.hearts(headOrigin())
  } else if (event.type === 'peekReveal') {
    // Clicking the head-only peek returns the normal window to the bottom for
    // 10 s. Main owns that transition; the renderer only requests it.
    api.revealPeek()
  } else if (event.type === 'cancelled' && event.action === 'eat') {
    hideEat()
  }
})

animator.onFrame((info) => {
  if (!info.visible || info.mode === 'close' || info.mode === 'peek') {
    shadow.setState({ x: 0, y: 0, width: 0, height: 0, opacity: 0, visible: false })
    return
  }
  const anchor = footAnchor()
  const jump = Math.max(0, info.jumpY)
  const width = Math.max(24, viewer.height * 0.2 * info.scaleX)
  const height = Math.max(4, viewer.height * 0.03 * info.scaleY)
  const opacity = info.dragging ? 0.12 : Math.max(0.08, 0.2 / (1 + jump * 0.2))
  shadow.setState({
    x: anchor.x,
    y: anchor.y,
    width: width * (1 - Math.min(0.25, jump * 0.03)),
    height: height * (1 - Math.min(0.2, jump * 0.02)),
    opacity,
    visible: true
  })
})

function scheduleSnack(): void {
  const delay = 8 * 60_000 + Math.random() * 12 * 60_000
  window.setTimeout(() => {
    if (!document.hidden && !peekActive && !walking && !eating && !torchController.isOn() &&
      !gestures.isPressed && !gestures.isClosing && animator.canStartScheduled('eat')) eat()
    scheduleSnack()
  }, delay)
}

function scheduleStretch(): void {
  const delay = 8 * 60_000 + Math.random() * 7 * 60_000
  window.setTimeout(() => {
    if (!document.hidden && !peekActive && !walking && !eating && !torchController.isOn() &&
      !gestures.isPressed && !gestures.isClosing && animator.canStartScheduled('stretch')) stretch()
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
      torchOn: torchController.isOn(),
      manualTorch: torchController.getState().manual,
      autoTorch: torchController.getState().auto,
      brightness: brightnessValue,
      dragging: gestures.isDragging,
      closing: gestures.isClosing,
      gesturePhase: gestures.gesturePhase
    }),
    forceWalk: (direction) => api.forceWalk(direction),
    stopWalk: () => api.stopWalk(),
    pet: () => animator.pet(),
    stretch,
    eat,
    toggleTorch,
    forceClose: () => gestures.forceClose(),
    photo: () => api.takePhoto(),
    getTorch: () => torch.getState(),
    getTorchController: () => torchController.getState(),
    getActionState: () => actionPort.getState(),
    performAction: (request) => actions.performAction(request),
    setWalkPaused: setProductionWalkPaused,
    getPeekState: () => peekState,
    revealPeek: () => api.revealPeek(),
    getParticles: () => particles.getParticleCount(),
    getShadow: () => ({
      enabled: currentSettings ? performancePreset(currentSettings).shadow : true,
      visible: viewer.playerObject.visible
    })
  }
}

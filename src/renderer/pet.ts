import type { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'
import { PetAnimator } from './animator'
import { PetAudio } from './audio'
import { PetGestures } from './gestures'
import { CharacterHitTest } from './hit-test'
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
  }
  forceWalk(direction?: WalkDirection): Promise<void>
  stopWalk(): Promise<void>
}

declare global {
  interface Window {
    petApi: PetApi
    __niko?: NikoDebugApi
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#pet')
if (!canvas) throw new Error('Pet canvas is missing')

const api = window.petApi
const viewer = createViewer(canvas, api)
const animator = new PetAnimator(viewer)
const audio = new PetAudio(api)
const hitTest = new CharacterHitTest(canvas, viewer)
const gestures = new PetGestures(canvas, viewer, hitTest, animator, audio, api)
let skinReady = false
let currentSettings: PetSettings | null = null

function resizeViewer(): void {
  // The M1 window is a fixed 420x420 square. Do not feed window.innerWidth back into
  // the viewer: that created a resize feedback loop on this transparent Windows window.
  viewer.setSize(420, 420)
}
resizeViewer()

function applySettings(settings: PetSettings): void {
  currentSettings = settings
  audio.setSettings(settings)
  // Main resizes the square window for size changes, so this preserves M0 framing.
  viewer.zoom = 0.55
  viewer.controls.update()
  resizeViewer()
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
animator.onFootstep(() => audio.step())

void loadSkin(viewer, api).then((pixels) => {
  hitTest.setSkin(pixels)
  animator.setBlinkTexture(new BlinkTexture(viewer))
  skinReady = true
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
      zoom: viewer.zoom
    }),
    forceWalk: (direction) => api.forceWalk(direction),
    stopWalk: () => api.stopWalk()
  }
}

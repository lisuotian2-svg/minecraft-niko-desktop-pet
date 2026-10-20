import { SkinViewer } from 'skinview3d'
import type { PetApi } from '../preload/index'

export interface SkinPixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function createViewer(canvas: HTMLCanvasElement, api: PetApi): SkinViewer {
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
  // M0 desktop acceptance established this framing for a 220 px pet in a 420 px canvas.
  viewer.zoom = 0.55
  viewer.controls.update()
  viewer.playerWrapper.rotation.y = -Math.PI / 8
  viewer.nameTag = null
  api.log('viewer ready')

  const attributes = viewer.renderer.getContext().getContextAttributes()
  if (attributes?.alpha !== true || viewer.renderer.getClearAlpha() !== 0) {
    api.log('ERROR: WebGL canvas alpha is unavailable; transparent background cannot be guaranteed')
  } else {
    api.log('transparent WebGL alpha confirmed')
  }
  return viewer
}

export async function loadSkin(viewer: SkinViewer, api: PetApi): Promise<SkinPixels> {
  let assetUrl: string | null = null
  try {
    const bytes = await api.loadAsset('skin')
    assetUrl = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
    await viewer.loadSkin(assetUrl, { model: 'slim' })
    viewer.playerObject.skin.setOuterLayerVisible(true)
    const source = viewer.skinCanvas
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Skin canvas has no 2D context')
    const pixels = context.getImageData(0, 0, source.width, source.height)
    api.log(`skin loaded: slim, outer layer visible, ${source.width}x${source.height}`)
    return { data: pixels.data, width: source.width, height: source.height }
  } finally {
    if (assetUrl) URL.revokeObjectURL(assetUrl)
  }
}

/** Blink by changing only the runtime texture; the original skin asset stays untouched. */
export class BlinkTexture {
  private readonly context: CanvasRenderingContext2D
  private readonly original: ImageData
  private closed = false

  constructor(private readonly viewer: SkinViewer) {
    const context = viewer.skinCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Skin canvas has no 2D context')
    this.context = context
    this.original = context.getImageData(0, 0, viewer.skinCanvas.width, viewer.skinCanvas.height)
  }

  get isClosed(): boolean { return this.closed }

  setClosed(closed: boolean): void {
    if (this.closed === closed) return
    this.closed = closed
    this.context.putImageData(this.original, 0, 0)
    if (closed) {
      // Front face UVs: each 2x2 patch replaces an eye with a lid and a dark lash.
      // The hat texture remains a separate outer layer above these pixels.
      this.context.fillStyle = '#c86886'
      this.context.fillRect(9, 13, 2, 2)
      this.context.fillRect(13, 13, 2, 2)
      this.context.fillStyle = '#6b3039'
      this.context.fillRect(9, 14, 2, 1)
      this.context.fillRect(13, 14, 2, 1)
    }
    const texture = this.viewer.playerObject.skin.map
    if (texture) texture.needsUpdate = true
  }
}

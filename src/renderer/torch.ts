import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PointLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader
} from 'three'
import type { SkinViewer } from 'skinview3d'
import type { AssetName, PetApi } from '../preload/index'

export interface TorchState {
  visible: boolean
  lightIntensity: number
}

/** Minecraft's torch texture occupies pixels 7..8 and rows 6..15. */
function createTorchGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(2, 10, 2)
  const uv = geometry.getAttribute('uv') as BufferAttribute
  const face = (index: number, x0: number, y0: number, x1: number, y1: number): void => {
    const u0 = x0 / 16
    const u1 = x1 / 16
    const v0 = 1 - y1 / 16
    const v1 = 1 - y0 / 16
    const first = index * 4
    uv.setXY(first, u0, v1)
    uv.setXY(first + 1, u1, v1)
    uv.setXY(first + 2, u0, v0)
    uv.setXY(first + 3, u1, v0)
  }
  // BoxGeometry face order: right, left, top, bottom, front, back.
  for (const index of [0, 1, 4, 5]) face(index, 7, 6, 9, 16)
  face(2, 7, 6, 9, 8)
  face(3, 7, 14, 9, 16)
  uv.needsUpdate = true
  return geometry
}

async function loadPixelTexture(api: PetApi, name: AssetName): Promise<Texture> {
  const bytes = await api.loadAsset(name)
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
  try {
    const texture = await new TextureLoader().loadAsync(url)
    texture.magFilter = NearestFilter
    texture.minFilter = NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = SRGBColorSpace
    return texture
  } finally {
    URL.revokeObjectURL(url)
  }
}

export class PetTorch {
  private readonly root = new Group()
  private readonly geometry = createTorchGeometry()
  private readonly shaftMaterial = new MeshBasicMaterial({ color: 0x9d6538, alphaTest: 0.1 })
  private readonly flameMaterial = new SpriteMaterial({
    color: 0xffcc75,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: AdditiveBlending
  })
  private readonly flame = new Sprite(this.flameMaterial)
  private readonly light = new PointLight(0xffa64d, 0, 22, 2)
  private shaftTexture: Texture | null = null
  private flameTexture: Texture | null = null
  private on = false
  private disposed = false
  private frameId = 0

  constructor(private readonly viewer: SkinViewer, private readonly api: PetApi) {
    // The arm joint is the shoulder. y=-10 puts the torch base in the right hand.
    this.root.position.set(0, -10, 0.75)
    this.root.rotation.x = 0.65
    const shaft = new Mesh(this.geometry, this.shaftMaterial)
    shaft.position.y = 5
    this.root.add(shaft)
    this.flame.position.set(0, 10.3, 0)
    this.flame.scale.set(3.5, 4.4, 1)
    this.flame.visible = false
    this.root.add(this.flame)
    this.light.position.set(0, 10.3, 0)
    this.root.add(this.light)
    this.root.visible = false
    viewer.playerObject.skin.rightArm.add(this.root)
    void this.loadTextures()
  }

  setOn(on: boolean): void {
    if (this.disposed || this.on === on) return
    this.on = on
    this.root.visible = on
    if (on) {
      this.light.intensity = 2.6
      this.frameId = requestAnimationFrame(this.frame)
    } else {
      this.light.intensity = 0
      cancelAnimationFrame(this.frameId)
      this.frameId = 0
    }
  }

  getState(): TorchState {
    return { visible: this.root.visible, lightIntensity: this.light.intensity }
  }

  getFlameWorldPosition(target: import('three').Vector3): import('three').Vector3 {
    return this.flame.getWorldPosition(target)
  }

  dispose(): void {
    if (this.disposed) return
    this.setOn(false)
    this.disposed = true
    this.viewer.playerObject.skin.rightArm.remove(this.root)
    this.geometry.dispose()
    this.shaftMaterial.dispose()
    this.flameMaterial.dispose()
    this.shaftTexture?.dispose()
    this.flameTexture?.dispose()
  }

  private async loadTextures(): Promise<void> {
    const results = await Promise.allSettled([
      loadPixelTexture(this.api, 'torchTexture'),
      loadPixelTexture(this.api, 'flameTexture')
    ])
    const [shaftResult, flameResult] = results
    if (shaftResult?.status === 'fulfilled') {
      if (this.disposed) shaftResult.value.dispose()
      else {
        this.shaftTexture = shaftResult.value
        this.shaftMaterial.map = shaftResult.value
        this.shaftMaterial.color.set(0xffffff)
        this.shaftMaterial.needsUpdate = true
      }
    } else {
      this.api.log(`torch texture error: ${String(shaftResult?.reason)}`)
    }
    if (flameResult?.status === 'fulfilled') {
      if (this.disposed) flameResult.value.dispose()
      else {
        this.flameTexture = flameResult.value
        this.flameMaterial.map = flameResult.value
        this.flameMaterial.color.set(0xffffff)
        this.flameMaterial.needsUpdate = true
        this.flame.visible = true
      }
    } else {
      this.api.log(`flame texture error: ${String(flameResult?.reason)}`)
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.on || this.disposed) return
    const flicker = 1 + 0.09 * Math.sin(now * 0.019) + 0.055 * Math.sin(now * 0.047)
    this.light.intensity = 2.6 * flicker
    this.light.position.x = 0.2 * Math.sin(now * 0.011)
    this.light.position.y = 10.3 + 0.18 * Math.sin(now * 0.017)
    this.flame.position.y = 10.3 + 0.18 * Math.sin(now * 0.017)
    this.flame.scale.set(3.5 * flicker, 4.4 * flicker, 1)
    this.frameId = requestAnimationFrame(this.frame)
  }
}

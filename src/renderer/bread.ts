import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader
} from 'three'
import type { SkinViewer } from 'skinview3d'
import type { AssetName, PetApi } from '../preload/index'

/** A small bread item held in the right hand while eating. */
export class PetBread {
  private readonly root = new Group()
  private readonly geometry = new BoxGeometry(6, 6, 1)
  private readonly material = new MeshBasicMaterial({ transparent: true, alphaTest: 0.1 })
  private readonly mesh = new Mesh(this.geometry, this.material)
  private texture: Texture | null = null
  private disposed = false

  constructor(private readonly viewer: SkinViewer, private readonly api: PetApi) {
    this.root.position.set(0, -9.8, -1.2)
    this.root.rotation.set(0.18, 0.28, -0.08)
    this.mesh.rotation.set(0.15, 0, 0)
    this.root.add(this.mesh)
    this.root.visible = false
    viewer.playerObject.skin.rightArm.add(this.root)
    void this.loadTexture('breadTexture')
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return
    this.root.visible = visible
  }

  /** Shrink the item with each bite (0 = whole, 4 = finished). */
  setBite(bite: number): void {
    const scale = Math.max(0.28, 1 - bite * 0.18)
    this.mesh.scale.set(scale, scale, 1)
  }

  dispose(): void {
    this.disposed = true
    this.root.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.texture?.dispose()
  }

  private async loadTexture(name: AssetName): Promise<void> {
    try {
      const bytes = await this.api.loadAsset(name)
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
      try {
        const texture = await new TextureLoader().loadAsync(url)
        texture.magFilter = NearestFilter
        texture.minFilter = NearestFilter
        texture.generateMipmaps = false
        texture.colorSpace = SRGBColorSpace
        this.texture = texture
        if (!this.disposed) {
          this.material.map = texture
          this.material.needsUpdate = true
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      this.api.log(`bread texture error: ${String(error)}`)
    }
  }
}

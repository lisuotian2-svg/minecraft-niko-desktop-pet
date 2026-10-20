import type { SkinViewer } from 'skinview3d'
import { Raycaster, Vector2 } from 'three'
import type { SkinPixels } from './viewer'

export class CharacterHitTest {
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private skin: SkinPixels | null = null

  constructor(private readonly canvas: HTMLCanvasElement, private readonly viewer: SkinViewer) {}

  setSkin(skin: SkinPixels): void { this.skin = skin }

  hit(clientX: number, clientY: number): boolean {
    if (!this.skin) return false
    const rect = this.canvas.getBoundingClientRect()
    if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false

    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera)
    const hits = this.raycaster.intersectObject(this.viewer.playerObject.skin, true)
    return hits.some((hit) => hit.uv !== undefined && this.visibleTexel(hit.uv.x, hit.uv.y))
  }

  private visibleTexel(u: number, v: number): boolean {
    const skin = this.skin
    if (!skin) return false
    const x = Math.min(skin.width - 1, Math.max(0, Math.floor(u * skin.width)))
    const y = Math.min(skin.height - 1, Math.max(0, Math.floor((1 - v) * skin.height)))
    const alpha = skin.data[(y * skin.width + x) * 4 + 3]
    return alpha !== undefined && alpha > 16
  }
}

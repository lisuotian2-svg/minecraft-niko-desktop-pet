import type { SkinViewer } from 'skinview3d'
import { Mesh, Raycaster, Vector2, Vector3 } from 'three'
import type { DragFootprint } from '../shared/walk'
import type { SkinPixels } from './viewer'

export class CharacterHitTest {
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private skin: SkinPixels | null = null

  constructor(private readonly canvas: HTMLCanvasElement, private readonly viewer: SkinViewer) {}

  setSkin(skin: SkinPixels): void { this.skin = skin }

  /** Project the model into canvas pixels so empty transparent margins can cross screen edges. */
  dragFootprint(): DragFootprint | null {
    if (!this.skin) return null
    const skin = this.viewer.playerObject.skin
    skin.updateWorldMatrix(true, true)
    this.viewer.camera.updateMatrixWorld()
    const rect = this.canvas.getBoundingClientRect()
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    skin.traverse((object) => {
      if (!(object instanceof Mesh) || !object.visible) return
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      const box = object.geometry.boundingBox
      if (!box) return
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const point = new Vector3(x, y, z).applyMatrix4(object.matrixWorld).project(this.viewer.camera)
            left = Math.min(left, (point.x * 0.5 + 0.5) * rect.width)
            right = Math.max(right, (point.x * 0.5 + 0.5) * rect.width)
            top = Math.min(top, (-point.y * 0.5 + 0.5) * rect.height)
            bottom = Math.max(bottom, (-point.y * 0.5 + 0.5) * rect.height)
          }
        }
      }
    })
    if (![left, top, right, bottom].every(Number.isFinite)) return null
    const margin = Math.max(8, rect.width * 0.012)
    left = Math.max(0, left - margin)
    top = Math.max(0, top - margin)
    right = Math.min(rect.width, right + margin)
    bottom = Math.min(rect.height, bottom + margin)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

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

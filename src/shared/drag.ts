import type { DragFootprint, DragPosition, WalkArea } from './walk'

/** Coordinates beyond this cannot come from a real desktop and make Electron's
 * native setPosition() throw; treat them as a transient bad cursor reading. */
const MAX_DRAG_COORD = 1_000_000

export function isUsableDragCoordinate(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) &&
    Math.abs(x) <= MAX_DRAG_COORD && Math.abs(y) <= MAX_DRAG_COORD
}

/** All coordinates are Electron DIP, including negative monitor coordinates. */
export function dragPosition(cursor: DragPosition, anchor: DragPosition, push: DragPosition): DragPosition {
  return { x: Math.round(cursor.x - anchor.x + push.x), y: Math.round(cursor.y - anchor.y + push.y) }
}

export function isPetOnAnyDisplay(position: DragPosition, footprint: DragFootprint, displays: readonly WalkArea[]): boolean {
  const left = position.x + footprint.x
  const top = position.y + footprint.y
  return displays.some((area) => left < area.x + area.width && left + footprint.width > area.x &&
    top < area.y + area.height && top + footprint.height > area.y)
}

function contains(point: DragPosition, areas: readonly WalkArea[]): boolean {
  return areas.some((area) => point.x >= area.x && point.x < area.x + area.width &&
    point.y >= area.y && point.y < area.y + area.height)
}

/** The OS confines the cursor to displays. Continue a held drag only at an outer edge,
 * never at a connected monitor seam. The cumulative push avoids snapping on reversal. */
export class DragEdgePush {
  private push = { x: 0, y: 0 }
  private edge = { x: 0, y: 0 }
  private edgeSince = 0
  private lastAt: number | null = null

  step(cursor: DragPosition, displays: readonly WalkArea[], now: number): DragPosition {
    const edge = {
      x: !contains({ x: cursor.x - 1, y: cursor.y }, displays) ? -1
        : !contains({ x: cursor.x + 1, y: cursor.y }, displays) ? 1 : 0,
      y: !contains({ x: cursor.x, y: cursor.y - 1 }, displays) ? -1
        : !contains({ x: cursor.x, y: cursor.y + 1 }, displays) ? 1 : 0
    }
    // Do not continue through stale coordinates while monitors are being removed.
    if (!contains(cursor, displays)) edge.x = edge.y = 0
    if (edge.x !== this.edge.x || edge.y !== this.edge.y) {
      this.edge = edge
      this.edgeSince = now
    }
    const elapsed = this.lastAt === null ? 0 : Math.max(0, Math.min(50, now - this.lastAt))
    this.lastAt = now
    if (now - this.edgeSince >= 300) {
      const distance = 360 * elapsed / 1000 / (Math.hypot(edge.x, edge.y) || 1)
      this.push.x += edge.x * distance
      this.push.y += edge.y * distance
    }
    return { ...this.push }
  }
}

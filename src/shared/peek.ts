import type { Bounds, PeekEdge } from './contracts'

/**
 * Pure peek scheduling and edge geometry. This module deliberately has no
 * Electron/Three imports so it can be unit-tested and reused by main/preload.
 *
 * Coordinates are Electron DIP screen coordinates. The renderer owns the
 * head-only pose; main assumes the head is centred in the (square) pet window,
 * which the frozen `FullscreenState.headAnchor` contract communicates.
 */

export const PEEK_EDGES: readonly PeekEdge[] = Object.freeze(['bottom', 'left', 'right'])
export const PEEK_INTERVAL_MIN_MS = 20_000
export const PEEK_INTERVAL_MAX_MS = 45_000
export const PEEK_HOLD_MIN_MS = 4_000
export const PEEK_HOLD_MAX_MS = 8_000
export const PEEK_REVEAL_MS = 10_000
/** After the 10 s click-reveal, resume peeking promptly; the normal 20-45 s
 *  cadence applies between ordinary peeks and resumes after this one. */
export const PEEK_POST_REVEAL_DELAY_MS = 1_200

export const PEEK_ENTER_MS = 320
export const PEEK_LEAVE_MS = 260
export const PEEK_EDGE_MARGIN = 8
export const PEEK_HEAD_RADIUS_RATIO = 0.18
export const PEEK_MIN_HEAD_RADIUS = 18
export const PEEK_MAX_HEAD_RADIUS = 90

export interface Point {
  x: number
  y: number
}

export interface PeekPlacement {
  edge: PeekEdge
  /** Absolute screen position of the assumed head centre. */
  headCenter: Point
  /** Window bounds when the head is fully outside the display. */
  hidden: Bounds
  /** Window bounds when the head is fully inside the display with a margin. */
  revealed: Bounds
}

function unitRandom(random: () => number): number {
  const value = random()
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

function randomBetween(min: number, max: number, random: () => number): number {
  return min + (max - min) * unitRandom(random)
}

function roundBounds(bounds: Bounds): Bounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  }
}

export function isPeekEdge(value: unknown): value is PeekEdge {
  return value === 'left' || value === 'right' || value === 'bottom'
}

export function pickPeekEdge(random: () => number = Math.random): PeekEdge {
  const index = Math.min(PEEK_EDGES.length - 1, Math.floor(unitRandom(random) * PEEK_EDGES.length))
  return PEEK_EDGES[index] ?? 'bottom'
}

export function nextPeekIntervalMs(random: () => number = Math.random): number {
  return Math.round(randomBetween(PEEK_INTERVAL_MIN_MS, PEEK_INTERVAL_MAX_MS, random))
}

export function peekHoldMs(random: () => number = Math.random): number {
  return Math.round(randomBetween(PEEK_HOLD_MIN_MS, PEEK_HOLD_MAX_MS, random))
}

export function headRadiusForWindow(windowSize: number): number {
  const size = Number.isFinite(windowSize) ? Math.max(1, windowSize) : 1
  return Math.round(Math.min(PEEK_MAX_HEAD_RADIUS, Math.max(PEEK_MIN_HEAD_RADIUS, size * PEEK_HEAD_RADIUS_RATIO)))
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(1, progress))
}

/** Enter is a quick ease-out; leave is a slightly faster ease-in. */
export function enterProgress(elapsedMs: number): number {
  const t = clampProgress(elapsedMs / PEEK_ENTER_MS)
  return 1 - (1 - t) * (1 - t) * (1 - t)
}

export function leaveProgress(elapsedMs: number): number {
  const t = clampProgress(elapsedMs / PEEK_LEAVE_MS)
  return 1 - t * t
}

export function interpolateBounds(from: Bounds, to: Bounds, progress: number): Bounds {
  const t = clampProgress(progress)
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t
  }
}

/**
 * Place a square pet window so that only the centred head is clipped at one of
 * the three allowed edges. The body itself is hidden by the renderer; the
 * transparent window may extend beyond the screen freely.
 */
export function createPeekPlacement(
  edge: PeekEdge,
  display: Bounds,
  windowSize: number,
  random: () => number = Math.random,
  headRadius = headRadiusForWindow(windowSize),
  margin = PEEK_EDGE_MARGIN
): PeekPlacement {
  const size = Math.max(1, windowSize)
  const radius = Math.max(1, headRadius)
  const half = size / 2
  const minCenterX = display.x + margin + radius
  const maxCenterX = display.x + display.width - margin - radius
  const minCenterY = display.y + margin + radius
  const maxCenterY = display.y + display.height - margin - radius

  let hiddenCenter: Point
  let revealedCenter: Point

  if (edge === 'bottom') {
    const x = maxCenterX >= minCenterX
      ? randomBetween(minCenterX, maxCenterX, random)
      : display.x + display.width / 2
    hiddenCenter = { x, y: display.y + display.height + radius }
    revealedCenter = { x, y: display.y + display.height - margin - radius }
  } else {
    const y = maxCenterY >= minCenterY
      ? randomBetween(minCenterY, maxCenterY, random)
      : display.y + display.height / 2
    if (edge === 'left') {
      hiddenCenter = { x: display.x - radius, y }
      revealedCenter = { x: display.x + margin + radius, y }
    } else {
      hiddenCenter = { x: display.x + display.width + radius, y }
      revealedCenter = { x: display.x + display.width - margin - radius, y }
    }
  }

  const toWindow = (center: Point): Bounds => roundBounds({
    x: center.x - half,
    y: center.y - half,
    width: size,
    height: size
  })

  return {
    edge,
    headCenter: { x: Math.round(revealedCenter.x), y: Math.round(revealedCenter.y) },
    hidden: toWindow(hiddenCenter),
    revealed: toWindow(revealedCenter)
  }
}

/** Bounds at an arbitrary progress between hidden and revealed. */
export function peekBoundsAt(placement: PeekPlacement, progress: number): Bounds {
  return interpolateBounds(placement.hidden, placement.revealed, progress)
}

export function boundsEqual(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

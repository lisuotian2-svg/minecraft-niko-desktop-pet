export type WalkDirection = -1 | 1

export interface WalkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WalkPosition {
  x: number
  direction: WalkDirection
}

export interface DragPosition { x: number; y: number }
export interface DragFootprint { x: number; y: number; width: number; height: number }

/**
 * Electron's native window methods reject negative zero: setPosition(-0, y)
 * throws "conversion failure" even though it prints as 0. Math.round() creates
 * -0 for any value in (-0.5, 0], which happens when the pet walks or is dragged
 * exactly onto the left/top edge, so normalize it to a plain 0.
 */
export function roundWindowCoordinate(value: number): number {
  const rounded = Math.round(value)
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Let the empty canvas cross an edge while keeping the visible pet on screen. */
export function dragPadding(windowSize: number, visibleSize: number): number {
  return Math.max(0, Math.round((windowSize - Math.min(windowSize, visibleSize)) / 2))
}

export function clampDragPosition(
  x: number,
  y: number,
  area: WalkArea,
  windowSize: number,
  visible: number | DragFootprint
): DragPosition {
  const footprint = typeof visible === 'number'
    ? (() => {
      const padding = dragPadding(windowSize, visible)
      return { x: padding, y: padding, width: windowSize - 2 * padding, height: windowSize - 2 * padding }
    })()
    : visible
  const left = area.x - footprint.x
  const top = area.y - footprint.y
  const right = Math.max(left, area.x + area.width - footprint.x - footprint.width)
  const bottom = Math.max(top, area.y + area.height - footprint.y - footprint.height)
  return {
    x: roundWindowCoordinate(Math.min(right, Math.max(left, x))),
    y: roundWindowCoordinate(Math.min(bottom, Math.max(top, y)))
  }
}

export function clampWindowX(x: number, area: WalkArea, windowWidth: number): number {
  const left = area.x
  const right = Math.max(left, area.x + area.width - windowWidth)
  return Math.min(right, Math.max(left, x))
}

export function bottomWindowY(area: WalkArea, windowHeight: number): number {
  return roundWindowCoordinate(area.y + area.height - windowHeight)
}

/** Reflect a move at both work-area edges, including when a long frame crosses several edges. */
export function stepWalk(
  position: WalkPosition,
  dtSeconds: number,
  speedPxPerSecond: number,
  area: WalkArea,
  windowWidth: number
): WalkPosition {
  const left = area.x
  const span = Math.max(0, area.width - windowWidth)
  if (span === 0) return { x: left, direction: position.direction }

  const x = clampWindowX(position.x, area, windowWidth) - left
  const startPhase = position.direction === 1 ? x : 2 * span - x
  const distance = Math.max(0, dtSeconds) * Math.max(0, speedPxPerSecond)
  const period = 2 * span
  const phase = ((startPhase + distance) % period + period) % period
  return {
    x: left + (phase <= span ? phase : period - phase),
    direction: phase < span ? 1 : -1
  }
}

function unitRandom(random: () => number): number {
  const value = random()
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5
}

export function nextWalkDelayMs(random: () => number = Math.random, frequency: 'low' | 'normal' | 'high' = 'normal'): number {
  const [minimum, maximum] = frequency === 'low' ? [360_000, 720_000]
    : frequency === 'high' ? [60_000, 180_000] : [180_000, 480_000]
  return Math.round(minimum + unitRandom(random) * (maximum - minimum))
}

export function walkDurationMs(random: () => number = Math.random): number {
  return Math.round(10_000 + unitRandom(random) * 30_000)
}

export function walkSpeed(windowWidth = 420, multiplier = 1): number {
  return Math.max(30, Math.min(55, (40 * windowWidth) / 420)) * multiplier
}

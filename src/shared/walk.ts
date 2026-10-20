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

export function clampWindowX(x: number, area: WalkArea, windowWidth: number): number {
  const left = area.x
  const right = Math.max(left, area.x + area.width - windowWidth)
  return Math.min(right, Math.max(left, x))
}

export function bottomWindowY(area: WalkArea, windowHeight: number): number {
  return Math.round(area.y + area.height - windowHeight)
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

export function nextWalkDelayMs(random: () => number = Math.random): number {
  return Math.round(180_000 + unitRandom(random) * 300_000)
}

export function walkDurationMs(random: () => number = Math.random): number {
  return Math.round(10_000 + unitRandom(random) * 30_000)
}

export function walkSpeed(windowWidth = 420): number {
  return Math.max(30, Math.min(55, (40 * windowWidth) / 420))
}

/** Sample the CSS cubic-bezier(.34, 1.56, .64, 1) at elapsed time t. */
export function reboundEase(t: number): number {
  const target = Math.max(0, Math.min(1, t))
  if (target === 0 || target === 1) return target
  let low = 0
  let high = 1

  for (let i = 0; i < 16; i += 1) {
    const u = (low + high) / 2
    const x = cubic(u, 0.34, 0.64)
    if (x < target) low = u
    else high = u
  }

  return cubic((low + high) / 2, 1.56, 1)
}

function cubic(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first +
    3 * inverse * t * t * second + t * t * t
}

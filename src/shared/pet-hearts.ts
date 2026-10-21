/** Distributed around the projected character silhouette, in CSS pixels. */
export interface HeartArea { x: number; y: number; width: number; height: number }
export const PET_HEART_COUNT = 18
export function petHeartOffsets(area: HeartArea, rng: () => number = Math.random): { x: number; y: number }[] {
  // Keep the whole effect about the size of the visible character.
  const rx = Math.max(5, area.width * 0.48)
  const ry = Math.max(5, area.height * 0.43)
  const phase = rng() * Math.PI * 2
  return Array.from({ length: PET_HEART_COUNT }, (_, index) => {
    // One sample per angular sector avoids clumps while retaining organic jitter.
    const angle = phase + (index + rng() * 0.7) / PET_HEART_COUNT * Math.PI * 2
    const radius = 0.78 + rng() * 0.24
    return { x: Math.cos(angle) * rx * radius, y: Math.sin(angle) * ry * radius }
  })
}

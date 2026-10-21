import type { PeekFrequency } from '../shared/settings'
import { nextPeekIntervalMs } from '../shared/peek'

/** Low/high cadence from the G1 settings contract; standard retains the base 20–45 s range. */
export function nextPeekIntervalForFrequency(
  frequency: PeekFrequency,
  random: () => number = Math.random
): number {
  if (frequency === 'standard') return nextPeekIntervalMs(random)

  const min = frequency === 'low' ? 45_000 : 10_000
  const max = frequency === 'low' ? 90_000 : 25_000
  const sample = random()
  const unit = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5
  return Math.round(min + (max - min) * unit)
}

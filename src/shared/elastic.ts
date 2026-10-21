/**
 * Bounded damped spring for small visual offsets. The target can move every
 * frame; velocity carries through when it stops, giving a short soft rebound.
 */
export class ElasticValue {
  private position = 0
  private velocity = 0

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
    private readonly limit: number
  ) {}

  get value(): number { return this.position }

  kick(velocity: number): void {
    if (!Number.isFinite(velocity)) return
    this.velocity = Math.max(-this.limit * 30,
      Math.min(this.limit * 30, this.velocity + velocity))
  }

  step(target: number, deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return this.position
    const dt = Math.min(deltaSeconds, 0.05)
    const steps = Math.ceil(dt * 120)
    const h = dt / steps
    const goal = Math.max(-this.limit, Math.min(this.limit,
      Number.isFinite(target) ? target : 0))
    for (let index = 0; index < steps; index += 1) {
      this.velocity += (this.stiffness * (goal - this.position) -
        this.damping * this.velocity) * h
      this.position += this.velocity * h
      if (this.position > this.limit || this.position < -this.limit) {
        this.position = Math.max(-this.limit, Math.min(this.limit, this.position))
        this.velocity = 0
      }
    }
    return this.position
  }

  reset(): void {
    this.position = 0
    this.velocity = 0
  }
}

export type GesturePhase = 'idle' | 'pressed' | 'dragging' | 'torch' | 'gathering' | 'closing'

export type GestureAction =
  | 'press'
  | 'click'
  | 'dragStart'
  | 'dragEnd'
  | 'toggleTorch'
  | 'gatherStart'
  | 'gatherStop'
  | 'close'
  | 'release'

const DRAG_DELAY_MS = 250
const TORCH_DELAY_MS = 1500
const GATHER_DELAY_MS = 2400
const CLOSE_DELAY_MS = 3000
const DRAG_DISTANCE_PX = 5

/** Pure left-button gesture clock. DOM events and effects stay in the renderer. */
export class GestureMachine {
  private phaseValue: GesturePhase = 'idle'
  private pressedAt = 0
  private startX = 0
  private startY = 0
  private movedOutsideSlop = false

  get phase(): GesturePhase { return this.phaseValue }
  get isPressed(): boolean { return this.phaseValue !== 'idle' && this.phaseValue !== 'closing' }
  get isDragging(): boolean { return this.phaseValue === 'dragging' }
  get isClosing(): boolean { return this.phaseValue === 'closing' }

  press(now: number, x: number, y: number): GestureAction[] {
    if (this.phaseValue !== 'idle') return []
    this.phaseValue = 'pressed'
    this.pressedAt = now
    this.startX = x
    this.startY = y
    this.movedOutsideSlop = false
    return ['press']
  }

  move(now: number, x: number, y: number): GestureAction[] {
    const actions = this.tick(now)
    if (this.phaseValue !== 'pressed') return actions
    const distance = Math.hypot(x - this.startX, y - this.startY)
    if (distance <= DRAG_DISTANCE_PX) return actions
    this.movedOutsideSlop = true
    const elapsed = now - this.pressedAt
    if (elapsed >= DRAG_DELAY_MS && elapsed < TORCH_DELAY_MS) {
      this.phaseValue = 'dragging'
      actions.push('dragStart')
    }
    return actions
  }

  tick(now: number): GestureAction[] {
    const actions: GestureAction[] = []
    const elapsed = now - this.pressedAt
    // A move inside the 250 ms gate is ignored for dragging. It still means
    // the pointer was not held still, so it cannot later toggle the torch.
    if (this.phaseValue === 'pressed' && elapsed >= TORCH_DELAY_MS && !this.movedOutsideSlop) {
      this.phaseValue = 'torch'
      actions.push('toggleTorch')
    }
    if (this.phaseValue === 'torch' && elapsed >= GATHER_DELAY_MS) {
      this.phaseValue = 'gathering'
      actions.push('gatherStart')
    }
    if (this.phaseValue === 'gathering' && elapsed >= CLOSE_DELAY_MS) {
      this.phaseValue = 'closing'
      actions.push('close')
    }
    return actions
  }

  release(now: number): GestureAction[] {
    if (this.phaseValue === 'idle' || this.phaseValue === 'closing') return []
    const actions = this.tick(now)
    if (actions.includes('close')) return actions
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    else if (this.phaseValue === 'gathering') actions.push('gatherStop')
    else if (this.phaseValue === 'pressed' && now - this.pressedAt < TORCH_DELAY_MS) actions.push('click')
    actions.push('release')
    this.phaseValue = 'idle'
    return actions
  }

  cancel(): GestureAction[] {
    if (this.phaseValue === 'idle' || this.phaseValue === 'closing') return []
    const actions: GestureAction[] = []
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    if (this.phaseValue === 'gathering') actions.push('gatherStop')
    this.phaseValue = 'idle'
    return actions
  }

  forceClose(): GestureAction[] {
    if (this.phaseValue === 'closing') return []
    const actions: GestureAction[] = []
    if (this.phaseValue === 'dragging') actions.push('dragEnd')
    if (this.phaseValue === 'gathering') actions.push('gatherStop')
    this.phaseValue = 'closing'
    actions.push('close')
    return actions
  }

  reset(): void { this.phaseValue = 'idle' }
}

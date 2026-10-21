import type { PetApi } from '../preload/index'
import { DEFAULT_SETTINGS, type PetSettings } from '../shared/settings'

type SoundName = 'Ya1' | 'Ya2' | 'grass1' | 'grass2' | 'grass3' | 'grass4' | 'grass5' | 'grass6'
  | 'ignite' | 'extinguish' | 'portal' | 'travel' | 'purreow'
  | 'eat1' | 'eat2' | 'burp'
const STEP_NAMES: readonly SoundName[] = ['grass1', 'grass2', 'grass3', 'grass4', 'grass5', 'grass6']

export class PetAudio {
  private readonly context = new AudioContext()
  private readonly buffers = new Map<SoundName, AudioBuffer>()
  private settings: PetSettings = { ...DEFAULT_SETTINGS }
  private previousStep = -1

  constructor(private readonly api: PetApi) {
    void Promise.allSettled((['Ya1', 'Ya2', ...STEP_NAMES, 'ignite', 'extinguish', 'portal', 'travel', 'purreow',
      'eat1', 'eat2', 'burp'] as SoundName[])
      .map((name) => this.load(name)))
  }

  setSettings(settings: PetSettings): void { this.settings = settings }

  press(): void {
    if (this.settings.clickSounds) this.play('Ya1', 1)
  }

  release(): void {
    if (this.settings.clickSounds) this.play('Ya2', 1)
  }

  torch(on: boolean): void { this.play(on ? 'ignite' : 'extinguish', 0.55) }

  close(): void {
    this.play('portal', 0.45)
    this.play('travel', 0.35)
  }

  stretch(): void { this.play('purreow', 0.12) }

  chew(): void { this.play(Math.random() < 0.5 ? 'eat1' : 'eat2', 0.5) }

  burp(): void { this.play('burp', 0.55) }

  step(): void {
    if (STEP_NAMES.length === 0) return
    let index = Math.floor(Math.random() * STEP_NAMES.length)
    if (index === this.previousStep) index = (index + 1) % STEP_NAMES.length
    this.previousStep = index
    const name = STEP_NAMES[index]
    if (name) this.play(name, 0.35)
  }

  private async load(name: SoundName): Promise<void> {
    try {
      const bytes = await this.api.loadAsset(name)
      const buffer = await this.context.decodeAudioData(Uint8Array.from(bytes).buffer)
      this.buffers.set(name, buffer)
      this.api.log(`audio ${name} decoded`)
    } catch (error) {
      this.api.log(`audio error ${name}: ${String(error)}`)
    }
  }

  private play(name: SoundName, gainFactor: number): void {
    if (this.settings.muted || this.settings.volume <= 0) return
    const buffer = this.buffers.get(name)
    if (!buffer) return
    try {
      const source = this.context.createBufferSource()
      const gain = this.context.createGain()
      source.buffer = buffer
      gain.gain.value = this.settings.volume * gainFactor
      source.connect(gain).connect(this.context.destination)
      source.start()
      void this.context.resume().catch((error: unknown) => this.api.log(`audio resume error: ${String(error)}`))
    } catch (error) {
      this.api.log(`audio play error ${name}: ${String(error)}`)
    }
  }
}

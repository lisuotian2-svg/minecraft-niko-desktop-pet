import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, parseSettings, parseSettingsJson, type PetSettings } from '../shared/settings'
import type { Logger } from './logger'

export class SettingsStore {
  private readonly file: string
  private settings: PetSettings = { ...DEFAULT_SETTINGS }
  private pendingWrite: Promise<void> = Promise.resolve()
  private pendingUpdate: Promise<void> = Promise.resolve()

  constructor(userDataPath: string, private readonly logger: Logger) {
    this.file = join(userDataPath, 'settings.json')
  }

  async load(): Promise<PetSettings> {
    try {
      const parsed = parseSettingsJson(await readFile(this.file, 'utf8'))
      this.settings = parsed.settings
      if (parsed.corrupted) {
        const backup = this.file.slice(0, -'.json'.length) + `.corrupt-${Date.now()}-${process.pid}.json`
        await rename(this.file, backup)
        this.logger.warn(`settings damaged; backup: ${backup}`)
        await this.write(this.settings)
      }
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        this.settings = { ...DEFAULT_SETTINGS }
        await this.write(this.settings)
      } else {
        this.logger.error(`settings read failed: ${String(error)}`)
        this.settings = { ...DEFAULT_SETTINGS }
      }
    }
    return this.get()
  }

  get(): PetSettings {
    return { ...this.settings }
  }

  update(patch: Partial<PetSettings>): Promise<PetSettings> {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return Promise.reject(new Error('Invalid settings patch'))
    }
    const task = this.pendingUpdate.then(async () => {
      const updated = parseSettings({ ...this.settings, ...patch })
      await this.write(updated)
      this.settings = updated
      this.logger.info(`settings saved: size=${updated.size}, volume=${updated.volume}`)
      return this.get()
    })
    this.pendingUpdate = task.then(() => undefined, () => undefined)
    return task
  }

  private async write(settings: PetSettings): Promise<void> {
    const write = async (): Promise<void> => {
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', 'utf8')
      try {
        await rename(temporary, this.file)
      } catch (error: unknown) {
        this.logger.error(`settings atomic rename failed: ${String(error)}`)
        throw error
      }
    }
    this.pendingWrite = this.pendingWrite.then(write, write)
    return this.pendingWrite
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

import { app, ipcMain, screen, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'
import type { Logger } from './logger'
import type { PetWindowController } from './pet-window'
import type { SettingsStore } from './settings'
import type { SettingsWindowController } from './settings-window'

const ASSET_PATHS = {
  skin: join('assets', 'skin', 'niko.png'),
  Ya1: join('assets', 'whale', 'Ya1.mp3'),
  Ya2: join('assets', 'whale', 'Ya2.mp3'),
  grass1: join('assets', 'vanilla', 'sounds', 'step', 'grass1.ogg'),
  grass2: join('assets', 'vanilla', 'sounds', 'step', 'grass2.ogg'),
  grass3: join('assets', 'vanilla', 'sounds', 'step', 'grass3.ogg'),
  grass4: join('assets', 'vanilla', 'sounds', 'step', 'grass4.ogg'),
  grass5: join('assets', 'vanilla', 'sounds', 'step', 'grass5.ogg'),
  grass6: join('assets', 'vanilla', 'sounds', 'step', 'grass6.ogg')
} as const

export interface IpcDependencies {
  pet: PetWindowController
  settingsWindow: SettingsWindowController
  settings: SettingsStore
  logger: Logger
}

export function registerIpc({ pet, settingsWindow, settings, logger }: IpcDependencies): void {
  const isPet = (sender: WebContents): boolean => sender === pet.getWindow()?.webContents
  const isSettings = (sender: WebContents): boolean => sender === settingsWindow.getWindow()?.webContents
  const isKnown = (sender: WebContents): boolean => isPet(sender) || isSettings(sender)

  ipcMain.on('pet:interactive', (event, value: unknown) => {
    if (isPet(event.sender) && typeof value === 'boolean') pet.setInteractive(value)
  })

  ipcMain.on('pet:log', (event, message: unknown) => {
    if (isKnown(event.sender) && typeof message === 'string') logger.info(message.slice(0, 2000))
  })

  ipcMain.handle('pet:cursor-point', (event): { x: number; y: number } => {
    const win = pet.getWindow()
    if (!win || event.sender !== win.webContents) return { x: -1, y: -1 }
    const point = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    return { x: point.x - bounds.x, y: point.y - bounds.y }
  })

  ipcMain.handle('pet:asset', async (event, name: unknown): Promise<Uint8Array> => {
    if (!isPet(event.sender)) throw new Error('Asset request rejected')
    if (typeof name !== 'string' || !Object.hasOwn(ASSET_PATHS, name)) {
      throw new Error('Unknown asset')
    }
    const base = process.env.ELECTRON_RENDERER_URL
      ? join(app.getAppPath(), 'public')
      : join(__dirname, '../renderer')
    const path = join(base, ASSET_PATHS[name as keyof typeof ASSET_PATHS])
    try {
      return new Uint8Array(await readFile(path))
    } catch (error: unknown) {
      logger.error(`asset ${name} load failed: ${String(error)}`)
      throw new Error(`Failed to load ${name}`)
    }
  })

  ipcMain.handle('pet:settings:get', (event): PetSettings => {
    if (!isKnown(event.sender)) throw new Error('Settings request rejected')
    return settings.get()
  })

  ipcMain.handle('pet:settings:save', async (event, patch: unknown): Promise<PetSettings> => {
    if (!isKnown(event.sender)) throw new Error('Settings update rejected')
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new Error('Invalid settings patch')
    }
    const updated = await settings.update(patch as Partial<PetSettings>)
    pet.setPetSize(updated.size)
    pet.getWindow()?.webContents.send('pet:settings:changed', updated)
    settingsWindow.getWindow()?.webContents.send('pet:settings:changed', updated)
    return updated
  })

  ipcMain.handle('pet:version', (event): string => {
    if (!isKnown(event.sender)) throw new Error('Version request rejected')
    return app.getVersion()
  })

  ipcMain.handle('pet:walk:force', (event, direction: unknown): void => {
    if (!isPet(event.sender) || app.isPackaged) throw new Error('Debug walk is unavailable')
    if (direction !== undefined && direction !== -1 && direction !== 1) {
      throw new Error('Invalid walk direction')
    }
    pet.forceWalk(direction as WalkDirection | undefined)
  })

  ipcMain.handle('pet:walk:stop', (event): void => {
    if (!isPet(event.sender) || app.isPackaged) throw new Error('Debug walk is unavailable')
    pet.stopWalk()
  })
}

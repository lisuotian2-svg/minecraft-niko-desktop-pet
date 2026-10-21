import { app, ipcMain, screen, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'
import type { Logger } from './logger'
import type { CloseScene, PetWindowController } from './pet-window'
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
  grass6: join('assets', 'vanilla', 'sounds', 'step', 'grass6.ogg'),
  torchTexture: join('assets', 'vanilla', 'textures', 'block', 'torch.png'),
  flameTexture: join('assets', 'vanilla', 'textures', 'particle', 'flame.png'),
  breadTexture: join('assets', 'vanilla', 'textures', 'item', 'bread.png'),
  eat1: join('assets', 'vanilla', 'sounds', 'mob', 'cat', 'eat1.ogg'),
  eat2: join('assets', 'vanilla', 'sounds', 'mob', 'cat', 'eat2.ogg'),
  burp: join('assets', 'vanilla', 'sounds', 'random', 'burp.ogg'),
  effect0: join('assets', 'vanilla', 'textures', 'particle', 'effect_0.png'),
  effect1: join('assets', 'vanilla', 'textures', 'particle', 'effect_1.png'),
  effect2: join('assets', 'vanilla', 'textures', 'particle', 'effect_2.png'),
  effect3: join('assets', 'vanilla', 'textures', 'particle', 'effect_3.png'),
  effect4: join('assets', 'vanilla', 'textures', 'particle', 'effect_4.png'),
  effect5: join('assets', 'vanilla', 'textures', 'particle', 'effect_5.png'),
  effect6: join('assets', 'vanilla', 'textures', 'particle', 'effect_6.png'),
  effect7: join('assets', 'vanilla', 'textures', 'particle', 'effect_7.png'),
  glitter0: join('assets', 'vanilla', 'textures', 'particle', 'glitter_0.png'),
  glitter1: join('assets', 'vanilla', 'textures', 'particle', 'glitter_1.png'),
  glitter2: join('assets', 'vanilla', 'textures', 'particle', 'glitter_2.png'),
  glitter3: join('assets', 'vanilla', 'textures', 'particle', 'glitter_3.png'),
  glitter4: join('assets', 'vanilla', 'textures', 'particle', 'glitter_4.png'),
  glitter5: join('assets', 'vanilla', 'textures', 'particle', 'glitter_5.png'),
  glitter6: join('assets', 'vanilla', 'textures', 'particle', 'glitter_6.png'),
  glitter7: join('assets', 'vanilla', 'textures', 'particle', 'glitter_7.png'),
  ignite: join('assets', 'vanilla', 'sounds', 'fire', 'ignite.ogg'),
  extinguish: join('assets', 'vanilla', 'sounds', 'block', 'candle', 'extinguish1.ogg'),
  portal: join('assets', 'vanilla', 'sounds', 'mob', 'endermen', 'portal.ogg'),
  travel: join('assets', 'vanilla', 'sounds', 'portal', 'travel.ogg'),
  fireLoop: join('assets', 'vanilla', 'sounds', 'fire', 'fire.ogg'),
  purreow: join('assets', 'vanilla', 'sounds', 'mob', 'cat', 'purreow1.ogg')
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

  ipcMain.on('pet:drag:start', (event) => {
    if (isPet(event.sender)) pet.startDrag()
  })

  ipcMain.on('pet:drag:end', (event) => {
    if (isPet(event.sender)) pet.endDrag()
  })

  ipcMain.handle('pet:close:start', (event): CloseScene => {
    if (!isPet(event.sender)) throw new Error('Close request rejected')
    return pet.beginClose()
  })

  ipcMain.handle('pet:close:finish', (event): void => {
    if (!isPet(event.sender)) throw new Error('Close request rejected')
    pet.finishClose()
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

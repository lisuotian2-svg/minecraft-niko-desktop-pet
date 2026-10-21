import { contextBridge, ipcRenderer } from 'electron'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'

export interface CursorPoint {
  x: number
  y: number
}

type ParticleFrame = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export type AssetName =
  | 'skin' | 'Ya1' | 'Ya2'
  | 'grass1' | 'grass2' | 'grass3' | 'grass4' | 'grass5' | 'grass6'
  | 'torchTexture' | 'flameTexture' | 'breadTexture'
  | `effect${ParticleFrame}` | `glitter${ParticleFrame}`
  | 'ignite' | 'extinguish' | 'portal' | 'travel' | 'fireLoop' | 'purreow'
  | 'eat1' | 'eat2' | 'burp'

export interface CloseScene {
  width: number
  height: number
  originX: number
  originY: number
}

export interface PetApi {
  setInteractive(interactive: boolean): void
  startDrag(): void
  endDrag(): void
  beginClose(): Promise<CloseScene>
  finishClose(): Promise<void>
  onRestored(callback: () => void): () => void
  log(message: string): void
  getCursorPoint(): Promise<CursorPoint>
  loadAsset(name: AssetName): Promise<Uint8Array>
  getSettings(): Promise<PetSettings>
  saveSettings(patch: Partial<PetSettings>): Promise<PetSettings>
  onSettings(callback: (settings: PetSettings) => void): () => void
  onSettingsChanged(callback: (settings: PetSettings) => void): () => void
  onWalking(callback: (walking: boolean) => void): () => void
  onFacing(callback: (direction: WalkDirection) => void): () => void
  onBrightness(callback: (value: number | null) => void): () => void
  onPhotoFreeze(callback: (frozen: boolean) => void): () => void
  takePhoto(): Promise<string | null>
  forceWalk(direction?: WalkDirection): Promise<void>
  stopWalk(): Promise<void>
  getVersion(): Promise<string>
}

function onSettings(callback: (settings: PetSettings) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, settings: PetSettings): void => callback(settings)
  ipcRenderer.on('pet:settings:changed', listener)
  return () => ipcRenderer.removeListener('pet:settings:changed', listener)
}

const petApi: PetApi = {
  setInteractive(interactive) {
    ipcRenderer.send('pet:interactive', interactive)
  },
  startDrag() {
    ipcRenderer.send('pet:drag:start')
  },
  endDrag() {
    ipcRenderer.send('pet:drag:end')
  },
  beginClose() {
    return ipcRenderer.invoke('pet:close:start') as Promise<CloseScene>
  },
  finishClose() {
    return ipcRenderer.invoke('pet:close:finish') as Promise<void>
  },
  onRestored(callback) {
    const listener = (): void => callback()
    ipcRenderer.on('pet:restored', listener)
    return () => ipcRenderer.removeListener('pet:restored', listener)
  },
  log(message) {
    ipcRenderer.send('pet:log', message)
  },
  getCursorPoint() {
    return ipcRenderer.invoke('pet:cursor-point') as Promise<CursorPoint>
  },
  loadAsset(name) {
    return ipcRenderer.invoke('pet:asset', name) as Promise<Uint8Array>
  },
  getSettings() {
    return ipcRenderer.invoke('pet:settings:get') as Promise<PetSettings>
  },
  saveSettings(patch) {
    return ipcRenderer.invoke('pet:settings:save', patch) as Promise<PetSettings>
  },
  onSettings,
  onSettingsChanged: onSettings,
  onWalking(callback) {
    const listener = (_event: Electron.IpcRendererEvent, walking: unknown): void => {
      if (typeof walking === 'boolean') callback(walking)
    }
    ipcRenderer.on('pet:walking', listener)
    return () => ipcRenderer.removeListener('pet:walking', listener)
  },
  onFacing(callback) {
    const listener = (_event: Electron.IpcRendererEvent, direction: unknown): void => {
      if (direction === -1 || direction === 1) callback(direction)
    }
    ipcRenderer.on('pet:facing', listener)
    return () => ipcRenderer.removeListener('pet:facing', listener)
  },
  onBrightness(callback) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (value === null || (typeof value === 'number' && Number.isFinite(value))) callback(value as number | null)
    }
    ipcRenderer.on('pet:brightness', listener)
    return () => ipcRenderer.removeListener('pet:brightness', listener)
  },
  onPhotoFreeze(callback) {
    const freeze = (): void => callback(true)
    const unfreeze = (): void => callback(false)
    ipcRenderer.on('pet:photo:freeze', freeze)
    ipcRenderer.on('pet:photo:unfreeze', unfreeze)
    return () => {
      ipcRenderer.removeListener('pet:photo:freeze', freeze)
      ipcRenderer.removeListener('pet:photo:unfreeze', unfreeze)
    }
  },
  takePhoto() {
    return ipcRenderer.invoke('pet:photo') as Promise<string | null>
  },
  forceWalk(direction) {
    return ipcRenderer.invoke('pet:walk:force', direction) as Promise<void>
  },
  stopWalk() {
    return ipcRenderer.invoke('pet:walk:stop') as Promise<void>
  },
  getVersion() {
    return ipcRenderer.invoke('pet:version') as Promise<string>
  }
}

contextBridge.exposeInMainWorld('petApi', petApi)

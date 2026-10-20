import { contextBridge, ipcRenderer } from 'electron'
import type { PetSettings } from '../shared/settings'
import type { WalkDirection } from '../shared/walk'

export interface CursorPoint {
  x: number
  y: number
}

export type AssetName = 'skin' | 'Ya1' | 'Ya2' | 'grass1' | 'grass2' | 'grass3' | 'grass4' | 'grass5' | 'grass6'

export interface PetApi {
  setInteractive(interactive: boolean): void
  log(message: string): void
  getCursorPoint(): Promise<CursorPoint>
  loadAsset(name: AssetName): Promise<Uint8Array>
  getSettings(): Promise<PetSettings>
  saveSettings(patch: Partial<PetSettings>): Promise<PetSettings>
  onSettings(callback: (settings: PetSettings) => void): () => void
  onSettingsChanged(callback: (settings: PetSettings) => void): () => void
  onWalking(callback: (walking: boolean) => void): () => void
  onFacing(callback: (direction: WalkDirection) => void): () => void
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

import { contextBridge, ipcRenderer } from 'electron'

export interface CursorPoint {
  x: number
  y: number
}

export type AssetName = 'skin' | 'Ya1' | 'Ya2'

export interface PetApi {
  setInteractive(interactive: boolean): void
  quit(): void
  log(message: string): void
  getCursorPoint(): Promise<CursorPoint>
  loadAsset(name: AssetName): Promise<Uint8Array>
}

const petApi: PetApi = {
  setInteractive(interactive) {
    ipcRenderer.send('pet:interactive', interactive)
  },
  quit() {
    ipcRenderer.send('pet:quit')
  },
  log(message) {
    ipcRenderer.send('pet:log', message)
  },
  getCursorPoint() {
    return ipcRenderer.invoke('pet:cursor-point') as Promise<CursorPoint>
  },
  loadAsset(name) {
    return ipcRenderer.invoke('pet:asset', name) as Promise<Uint8Array>
  }
}

contextBridge.exposeInMainWorld('petApi', petApi)

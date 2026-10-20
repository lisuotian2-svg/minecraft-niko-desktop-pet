import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from './logger'

export interface TrayActions {
  isPetVisible(): boolean
  showPet(): void
  hidePet(): void
  openSettings(): void
  quit(): void
}

function trayImage(): Electron.NativeImage {
  const relative = join('assets', 'skin', 'niko.png')
  const candidates = [
    join(__dirname, '../renderer', relative),
    join(app.getAppPath(), 'public', relative),
    join(app.getAppPath(), 'out', 'renderer', relative),
    join(process.resourcesPath, relative)
  ]
  const skin = candidates.find((path) => existsSync(path))
  if (!skin) return nativeImage.createEmpty()
  const image = nativeImage.createFromPath(skin)
  if (image.isEmpty()) return image
  return image.crop({ x: 8, y: 8, width: 8, height: 8 }).resize({ width: 32, height: 32 })
}

export function createTray(actions: TrayActions, logger: Logger): Tray {
  const image = trayImage()
  if (image.isEmpty()) logger.warn('tray icon could not be loaded from skin')
  const tray = new Tray(image)
  tray.setToolTip('Niko Pet 3D')
  const updateMenu = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: actions.isPetVisible() ? '隐藏 Niko' : '显示 Niko',
        click: () => {
          if (actions.isPetVisible()) actions.hidePet()
          else actions.showPet()
          updateMenu()
        }
      },
      { label: '设置', click: () => actions.openSettings() },
      {
        label: '拍照（即将推出）',
        click: () => logger.info('photo requested from tray; M3 placeholder')
      },
      { type: 'separator' },
      { label: '退出', click: () => actions.quit() }
    ]))
  }
  updateMenu()
  tray.on('double-click', () => {
    actions.showPet()
    updateMenu()
  })
  tray.on('right-click', updateMenu)
  return tray
}

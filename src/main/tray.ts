import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from './logger'

export type TrayHotkeyAction = 'togglePet' | 'photo' | 'settings'

export interface TrayActions {
  isPetVisible(): boolean
  showPet(): void
  hidePet(): void
  openSettings(): void
  takePhoto(): void
  quit(): void
  /** Optional until the hotkey manager lands; keep the plain tooltip when absent. */
  getHotkeyHint?(): string | null
  /** Optional accelerator labels keyed by the action they trigger. */
  getHotkeyLabels?(): Partial<Record<TrayHotkeyAction, string | null>>
}

// 1x1 transparent PNG: a last-resort tray image. Creating a Tray with an empty
// NativeImage throws on Windows, which would otherwise abort app startup.
const FALLBACK_TRAY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function fallbackTrayImage(): Electron.NativeImage {
  return nativeImage.createFromDataURL(FALLBACK_TRAY_PNG)
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
  if (!skin) return fallbackTrayImage()
  const image = nativeImage.createFromPath(skin)
  if (image.isEmpty()) return fallbackTrayImage()
  return image.crop({ x: 8, y: 8, width: 8, height: 8 }).resize({ width: 32, height: 32 })
}

function withHotkey(label: string, accelerator: string | null | undefined): string {
  return accelerator ? `${label} (${accelerator})` : label
}

export function createTray(actions: TrayActions, logger: Logger): Tray {
  const image = trayImage()
  if (image.isEmpty()) logger.warn('tray icon could not be loaded; using fallback image')
  let tray: Tray
  try {
    tray = new Tray(image)
  } catch (error: unknown) {
    logger.error(`tray creation failed with skin image; trying fallback: ${String(error)}`)
    tray = new Tray(fallbackTrayImage())
  }

  const updateTooltip = (): void => {
    const hint = actions.getHotkeyHint?.() ?? null
    tray.setToolTip(hint ? `Niko Pet 3D · ${hint}` : 'Niko Pet 3D')
  }

  const updateMenu = (): void => {
    const hotkeys = actions.getHotkeyLabels?.() ?? {}
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: withHotkey(actions.isPetVisible() ? '隐藏 Niko' : '显示 Niko', hotkeys.togglePet),
        click: () => {
          if (actions.isPetVisible()) actions.hidePet()
          else actions.showPet()
          updateMenu()
          updateTooltip()
        }
      },
      { label: withHotkey('设置', hotkeys.settings), click: () => actions.openSettings() },
      {
        label: withHotkey('拍照', hotkeys.photo),
        click: () => actions.takePhoto()
      },
      { type: 'separator' },
      { label: '退出', click: () => actions.quit() }
    ]))
  }

  updateMenu()
  updateTooltip()

  // Single click only recovers a hidden pet; it never hides a visible one.
  // Double click opens settings (the previous double-click show behaviour is
  // superseded by P0-1). The short timer lets a double-click cancel the
  // implicit show so opening settings does not first unhide the pet.
  let clickTimer: ReturnType<typeof setTimeout> | null = null
  tray.on('click', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      clickTimer = null
      if (!actions.isPetVisible()) actions.showPet()
      updateMenu()
      updateTooltip()
    }, 280)
  })
  tray.on('double-click', () => {
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = null
    actions.openSettings()
    updateMenu()
    updateTooltip()
  })
  tray.on('right-click', () => {
    updateMenu()
    updateTooltip()
  })
  return tray
}

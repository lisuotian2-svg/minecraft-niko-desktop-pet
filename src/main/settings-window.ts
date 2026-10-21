import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { Logger } from './logger'

export class SettingsWindowController {
  private win: BrowserWindow | null = null

  constructor(private readonly logger: Logger) {}

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  open(): void {
    const current = this.getWindow()
    if (current) {
      if (current.isMinimized()) current.restore()
      current.show()
      current.moveTop()
      current.focus()
      return
    }
    const workArea = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      width: 580,
      height: Math.max(500, Math.min(620, workArea.height - 80)),
      minWidth: 520,
      minHeight: 500,
      title: 'Niko Pet 3D 设置',
      alwaysOnTop: true,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win
    win.setAlwaysOnTop(true, 'screen-saver')
    const showLoadedWindow = (): void => {
      if (win.isDestroyed()) return
      if (!win.isVisible()) win.show()
      win.moveTop()
      win.focus()
    }
    win.once('ready-to-show', showLoadedWindow)
    // Some Windows setups never emit ready-to-show for a page created hidden.
    // did-finish-load is the fallback so a right-click always presents it.
    win.webContents.once('did-finish-load', showLoadedWindow)
    win.on('closed', () => { this.win = null })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      this.logger.error(`settings renderer load failed (${code}): ${description}`)
    })
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (rendererUrl) void win.loadURL(new URL('settings.html', rendererUrl).href)
    else void win.loadFile(join(__dirname, '../renderer/settings.html'))
    this.logger.info('settings window opened')
  }
}

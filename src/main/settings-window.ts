import { BrowserWindow } from 'electron'
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
      current.show()
      current.focus()
      return
    }
    const win = new BrowserWindow({
      width: 420,
      height: 320,
      minWidth: 420,
      minHeight: 320,
      title: 'Niko Pet 3D 设置',
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
    win.once('ready-to-show', () => win.show())
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

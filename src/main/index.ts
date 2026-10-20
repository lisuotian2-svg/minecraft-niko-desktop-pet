import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const WINDOW_SIZE = 420
const ASSET_PATHS = {
  skin: join('assets', 'skin', 'niko.png'),
  Ya1: join('assets', 'whale', 'Ya1.mp3'),
  Ya2: join('assets', 'whale', 'Ya2.mp3')
} as const

let petWindow: BrowserWindow | null = null
let tray: Tray | null = null
let interactive = false
let captureScheduled = false

function captureM0Window(win: BrowserWindow): void {
  if (captureScheduled || process.env.NIKO_M0_CAPTURE !== '1') return
  captureScheduled = true
  setTimeout(() => {
    if (win.isDestroyed()) return
    void (async () => {
      const target = join(process.cwd(), 'artifacts', 'm0.png')
      await mkdir(join(process.cwd(), 'artifacts'), { recursive: true })
      const image = await win.webContents.capturePage()
      await writeFile(target, image.toPNG())
      console.info(`[pet] M0 window capture saved: ${target}`)
    })().catch((error: unknown) => console.error('[pet] M0 capture failed', error))
  }, 500)
}

function createPetWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    x: Math.round(area.x + (area.width - WINDOW_SIZE) / 2),
    y: Math.round(area.y + area.height - WINDOW_SIZE),
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  console.info('[pet] interactive -> false (initial)')

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[pet] renderer load failed (${errorCode}): ${errorDescription}`)
  })
  win.on('closed', () => {
    petWindow = null
    interactive = false
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createTray(): Tray {
  const skinRelativePath = join('assets', 'skin', 'niko.png')
  const candidates = [
    join(__dirname, '../renderer', skinRelativePath),
    join(app.getAppPath(), 'public', skinRelativePath),
    join(app.getAppPath(), 'out', 'renderer', skinRelativePath),
    join(process.resourcesPath, skinRelativePath)
  ]
  const skinPath = candidates.find((candidate) => existsSync(candidate))
  const image = skinPath
    ? nativeImage.createFromPath(skinPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  if (!skinPath || image.isEmpty()) {
    console.warn('[pet] tray icon could not be loaded from the skin asset')
  }

  const instance = new Tray(image)
  instance.setToolTip('Niko Pet M0')
  instance.setContextMenu(Menu.buildFromTemplate([
    {
      label: '退出 M0',
      click: () => {
        app.quit()
      }
    }
  ]))
  return instance
}

function registerIpc(): void {
  ipcMain.on('pet:interactive', (event, nextValue: unknown) => {
    const win = petWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents || typeof nextValue !== 'boolean') return
    if (nextValue === interactive) return

    interactive = nextValue
    win.setIgnoreMouseEvents(!interactive, { forward: true })
    console.info(`[pet] interactive -> ${interactive}`)
  })

  ipcMain.on('pet:log', (event, message: unknown) => {
    if (event.sender === petWindow?.webContents && typeof message === 'string') {
      console.info(`[pet] ${message}`)
      if (message.startsWith('skin loaded') && petWindow) captureM0Window(petWindow)
    }
  })

  ipcMain.on('pet:quit', (event) => {
    if (event.sender !== petWindow?.webContents) return
    app.quit()
  })

  ipcMain.handle('pet:cursor-point', (event): { x: number; y: number } => {
    const win = petWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return { x: -1, y: -1 }
    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    return { x: cursor.x - bounds.x, y: cursor.y - bounds.y }
  })

  ipcMain.handle('pet:asset', async (event, name: unknown): Promise<Uint8Array> => {
    if (event.sender !== petWindow?.webContents) {
      console.error('[pet] asset request rejected: unexpected sender')
      throw new Error('Asset request rejected')
    }
    if (typeof name !== 'string' || !Object.hasOwn(ASSET_PATHS, name)) {
      console.error(`[pet] asset request rejected: unknown name ${String(name)}`)
      throw new Error('Unknown asset')
    }

    const assetName = name as keyof typeof ASSET_PATHS
    const basePath = process.env.ELECTRON_RENDERER_URL
      ? join(app.getAppPath(), 'public')
      : join(__dirname, '../renderer')
    const assetPath = join(basePath, ASSET_PATHS[assetName])

    try {
      return new Uint8Array(await readFile(assetPath))
    } catch (error: unknown) {
      console.error(`[pet] asset load failed (${assetName}): ${String(error)}`)
      throw new Error(`Failed to load ${assetName}`)
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.showInactive()
  })

  app.on('window-all-closed', () => {
    // Keep the tray process alive if the pet window is closed.
  })

  app.whenReady().then(() => {
    registerIpc()
    tray = createTray()
    petWindow = createPetWindow()
  }).catch((error: unknown) => {
    console.error('[pet] startup failed', error)
    app.quit()
  })

  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
  })
}

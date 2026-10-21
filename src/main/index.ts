import { app, ipcMain, screen, type Tray } from 'electron'
import { IPC_CHANNELS, type ActionRequest } from '../shared/contracts'
import { BrightnessMonitor } from './brightness'
import { FullscreenDetector } from './fullscreen'
import { HotkeyManager } from './hotkeys'
import { registerIpc } from './ipc'
import { Logger } from './logger'
import { PeekController } from './peek'
import { PetWindowController } from './pet-window'
import { capturePhoto } from './photo'
import { SettingsStore } from './settings'
import { SettingsWindowController } from './settings-window'
import { createTray } from './tray'

let pet: PetWindowController | null = null
let settingsWindow: SettingsWindowController | null = null
let tray: Tray | null = null
let logger: Logger | null = null
let brightness: BrightnessMonitor | null = null
let peek: PeekController | null = null
let fullscreen: FullscreenDetector | null = null
let hotkeys: HotkeyManager | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    pet?.show()
    settingsWindow?.open()
  })

  app.on('window-all-closed', () => {
    // The tray owns the application lifetime.
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.nikopet.desktop')
    logger = new Logger(app.getPath('userData'))
    logger.info(`startup version=${app.getVersion()} electron=${process.versions.electron}`)

    const settings = new SettingsStore(app.getPath('userData'), logger)
    await settings.load()

    pet = new PetWindowController(logger, settings.get().size)
    settingsWindow = new SettingsWindowController(logger)
    registerIpc({ pet, settingsWindow, settings, logger })
    pet.create()

    peek = new PeekController({
      pet,
      logger,
      sendState: (state) => {
        const win = pet?.getWindow()
        if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
          win.webContents.send(IPC_CHANNELS.peekState, state)
        }
      }
    })
    fullscreen = new FullscreenDetector({
      logger,
      onState: (state) => peek?.setDetectorState(state)
    })
    const petWin = pet.getWindow()
    petWin?.webContents.on('did-finish-load', () => {
      if (petWin.isDestroyed() || !peek) return
      petWin.webContents.send(IPC_CHANNELS.peekState, peek.getState())
    })
    setTimeout(() => {
      const win = pet?.getWindow()
      if (win && !win.isDestroyed() && !win.webContents.isLoading() && peek) {
        win.webContents.send(IPC_CHANNELS.peekState, peek.getState())
      }
    }, 900)
    ipcMain.on(IPC_CHANNELS.peekReveal, (event) => {
      if (event.sender === pet?.getWindow()?.webContents) peek?.reveal()
    })
    fullscreen.start()

    const takePhoto = async (): Promise<string | null> => {
      const win = pet?.getWindow()
      if (!win || win.isDestroyed()) return null
      const display = screen.getDisplayMatching(win.getBounds())
      win.webContents.send('pet:photo:freeze')
      await new Promise<void>((resolve) => setTimeout(resolve, 160))
      try {
        const path = await capturePhoto(display, settings.get().nickname)
        logger?.info(`photo saved: ${path}`)
        return path
      } catch (error: unknown) {
        logger?.error(`photo failed: ${String(error)}`)
        return null
      } finally {
        if (!win.isDestroyed()) win.webContents.send('pet:photo:unfreeze')
      }
    }

    ipcMain.handle('pet:photo', async (event): Promise<string | null> => {
      if (event.sender !== pet?.getWindow()?.webContents) throw new Error('Photo request rejected')
      return takePhoto()
    })

    const sendAction = (request: ActionRequest): void => {
      if (request.id === 'photo') {
        void takePhoto()
        return
      }
      if (request.id === 'settings') {
        settingsWindow?.open()
        return
      }
      if (request.id === 'togglePet') {
        // Hide is intentionally only available through the long-press close gesture.
        pet?.show()
        return
      }
      const win = pet?.getWindow()
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return
      win.webContents.send(IPC_CHANNELS.action, request)
    }

    hotkeys = new HotkeyManager({
      logger,
      onAction: sendAction,
      bindings: settings.get().hotkeys
    })
    const hotkeyResult = hotkeys.apply(settings.get().hotkeys)
    if (!hotkeyResult.ok) {
      logger.warn(`hotkey registration incomplete: ${hotkeyResult.errors.map((error) => `${error.action}:${error.reason}`).join(', ')}`)
    }

    tray = createTray({
      isPetVisible: () => pet?.isVisible() ?? false,
      showPet: () => pet?.show(),
      hidePet: () => pet?.hide(),
      openSettings: () => settingsWindow?.open(),
      takePhoto: () => { void takePhoto() },
      quit: () => app.quit()
    }, logger)

    const reconcile = (): void => pet?.reconcileDisplay()
    screen.on('display-added', reconcile)
    screen.on('display-removed', reconcile)
    screen.on('display-metrics-changed', reconcile)

    brightness = new BrightnessMonitor((value) => {
      logger?.info(`screen brightness -> ${value === null ? 'unavailable' : value}`)
      pet?.getWindow()?.webContents.send('pet:brightness', value)
    })
    brightness.start()

    if (!app.isPackaged && process.argv.includes('--debug-walk')) {
      pet.forceWalk()
      logger.info('--debug-walk enabled')
    }
  }).catch((error: unknown) => {
    logger?.error(`startup failed: ${String(error)}`)
    console.error('[pet] startup failed', error)
    app.quit()
  })

  app.on('before-quit', () => {
    brightness?.stop()
    fullscreen?.stop()
    fullscreen = null
    peek?.dispose()
    peek = null
    hotkeys?.unregisterAll()
    hotkeys = null
    pet?.prepareToQuit()
  })
  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
    logger?.info('shutdown')
  })
}

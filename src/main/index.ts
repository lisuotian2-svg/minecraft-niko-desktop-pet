import { app, globalShortcut, ipcMain, screen, type Tray } from 'electron'
import { BrightnessMonitor } from './brightness'
import { registerIpc } from './ipc'
import { Logger } from './logger'
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

    tray = createTray({
      isPetVisible: () => pet?.isVisible() ?? false,
      showPet: () => pet?.show(),
      hidePet: () => pet?.hide(),
      openSettings: () => settingsWindow?.open(),
      takePhoto: () => { void takePhoto() },
      quit: () => app.quit()
    }, logger)

    if (!globalShortcut.register('Control+Alt+P', () => { void takePhoto() })) {
      logger.warn('failed to register Ctrl+Alt+P photo shortcut')
    }

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
    globalShortcut.unregisterAll()
    pet?.prepareToQuit()
  })
  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
    logger?.info('shutdown')
  })
}

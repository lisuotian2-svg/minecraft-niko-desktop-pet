import { app, screen, type Tray } from 'electron'
import { registerIpc } from './ipc'
import { Logger } from './logger'
import { PetWindowController } from './pet-window'
import { SettingsStore } from './settings'
import { SettingsWindowController } from './settings-window'
import { createTray } from './tray'

let pet: PetWindowController | null = null
let settingsWindow: SettingsWindowController | null = null
let tray: Tray | null = null
let logger: Logger | null = null

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
    tray = createTray({
      isPetVisible: () => pet?.isVisible() ?? false,
      showPet: () => pet?.show(),
      hidePet: () => pet?.hide(),
      openSettings: () => settingsWindow?.open(),
      quit: () => app.quit()
    }, logger)

    const reconcile = (): void => pet?.reconcileDisplay()
    screen.on('display-added', reconcile)
    screen.on('display-removed', reconcile)
    screen.on('display-metrics-changed', reconcile)

    if (!app.isPackaged && process.argv.includes('--debug-walk')) {
      pet.forceWalk()
      logger.info('--debug-walk enabled')
    }
  }).catch((error: unknown) => {
    logger?.error(`startup failed: ${String(error)}`)
    console.error('[pet] startup failed', error)
    app.quit()
  })

  app.on('before-quit', () => pet?.prepareToQuit())
  app.on('will-quit', () => {
    tray?.destroy()
    tray = null
    logger?.info('shutdown')
  })
}

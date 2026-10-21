import { app } from 'electron'

/** Keep the launch marker separate from manual starts so startHidden only affects login. */
export const LOGIN_MARKER = '--niko-autostart'

export function applyAutostart(enabled: boolean): void {
  const args = app.isPackaged
    ? [LOGIN_MARKER]
    : [`--user-data-dir=${app.getPath('userData')}`, app.getAppPath(), LOGIN_MARKER]
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args,
    name: 'Niko Pet 3D'
  })
}

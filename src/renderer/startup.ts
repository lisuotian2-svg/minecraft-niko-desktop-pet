import type { SkinViewer } from 'skinview3d'

export const STARTUP_ASSET_DIRECTORY = 'assets/animations/startup/'

/** Future animations may reveal/animate the existing Slim model or an overlay.
 * Resolve when the normal pet should become available. No second window needed. */
export type StartupAnimation = (context: {
  viewer: SkinViewer
  assetsBaseUrl: URL
}) => Promise<void>

export async function playStartupSequence(
  viewer: SkinViewer,
  log: (message: string) => void,
  animation: StartupAnimation | null = null
): Promise<void> {
  try {
    if (animation) {
      await animation({ viewer, assetsBaseUrl: new URL(STARTUP_ASSET_DIRECTORY, window.location.href) })
    } else {
      log('startup animation slot empty; showing pet immediately')
    }
  } catch (error: unknown) {
    log(`startup animation failed; showing pet: ${String(error)}`)
  } finally {
    viewer.playerObject.visible = true
  }
}

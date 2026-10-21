import { app, desktopCapturer, type Display } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function timestamp(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')
}

/** Capture the display containing the pet, including the desktop behind it. */
export async function capturePhoto(display: Display, nickname: string, customDirectory = '', prefix = '', suffix = ''): Promise<{ path: string; fallback: boolean }> {
  const width = Math.max(1, Math.round(display.size.width * display.scaleFactor))
  const height = Math.max(1, Math.round(display.size.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? (suffix ? undefined : sources[0])
  if (!source || source.thumbnail.isEmpty()) throw new Error('No screen source available')
  const defaultDirectory = join(app.getPath('pictures'), 'NikoPet')
  const safeName = (prefix || nickname).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '').slice(0, 24) || 'Niko'
  const filename = `${safeName}-${timestamp()}${suffix}.png`
  const bytes = source.thumbnail.toPNG()
  if (customDirectory) {
    try {
      await mkdir(customDirectory, { recursive: true })
      const path = join(customDirectory, filename)
      await writeFile(path, bytes)
      return { path, fallback: false }
    } catch {
      // A valid screenshot must still be saved when a selected drive disappears.
    }
  }
  await mkdir(defaultDirectory, { recursive: true })
  const path = join(defaultDirectory, filename)
  await writeFile(path, bytes)
  return { path, fallback: Boolean(customDirectory) }
}

export async function capturePhotos(displays: Display[], nickname: string, customDirectory = '', prefix = ''): Promise<{ paths: string[]; fallback: boolean }> {
  const paths: string[] = []
  let fallback = false
  for (const display of displays) {
    const suffix = displays.length > 1 ? `-display${display.id}` : ''
    const result = await capturePhoto(display, nickname, customDirectory, prefix, suffix)
    paths.push(result.path)
    fallback ||= result.fallback
  }
  return { paths, fallback }
}

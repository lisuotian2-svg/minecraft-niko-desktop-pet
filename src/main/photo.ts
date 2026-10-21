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
export async function capturePhoto(display: Display, nickname: string): Promise<string> {
  const width = Math.max(1, Math.round(display.size.width * display.scaleFactor))
  const height = Math.max(1, Math.round(display.size.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height },
    fetchWindowIcons: false
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('No screen source available')
  const directory = join(app.getPath('pictures'), 'NikoPet')
  await mkdir(directory, { recursive: true })
  const safeName = nickname.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '').slice(0, 16) || 'Niko'
  const file = join(directory, `${safeName}-${timestamp()}.png`)
  await writeFile(file, source.thumbnail.toPNG())
  return file
}

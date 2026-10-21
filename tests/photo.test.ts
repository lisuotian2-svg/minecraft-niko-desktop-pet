import { beforeEach, describe, expect, it, vi } from 'vitest'

const capture = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  getSources: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Pictures' },
  desktopCapturer: { getSources: capture.getSources }
}))
vi.mock('node:fs/promises', () => ({ mkdir: capture.mkdir, writeFile: capture.writeFile }))

import { capturePhoto, capturePhotos } from '../src/main/photo'
import type { Display } from 'electron'

const display = { id: 7, size: { width: 100, height: 80 }, scaleFactor: 1 } as Display

describe('photo directory fallback', () => {
  beforeEach(() => {
    capture.mkdir.mockReset().mockResolvedValue(undefined)
    capture.writeFile.mockReset().mockResolvedValue(undefined)
    capture.getSources.mockReset().mockResolvedValue([{
      display_id: '7', thumbnail: { isEmpty: () => false, toPNG: () => new Uint8Array([1, 2, 3]) }
    }])
  })

  it('saves in the selected directory when it is writable', async () => {
    const result = await capturePhoto(display, 'Niko', 'D:\\PetPhotos')
    expect(result).toMatchObject({ fallback: false })
    expect(result.path.startsWith('D:\\PetPhotos\\')).toBe(true)
    expect(capture.writeFile).toHaveBeenCalledTimes(1)
  })

  it('writes to Pictures/NikoPet when the selected directory rejects the photo', async () => {
    capture.writeFile.mockRejectedValueOnce(new Error('EACCES')).mockResolvedValueOnce(undefined)
    const result = await capturePhoto(display, 'Niko', 'D:\\PetPhotos')
    expect(result).toMatchObject({ fallback: true })
    expect(result.path.startsWith('C:\\Pictures\\NikoPet\\')).toBe(true)
    expect(capture.writeFile).toHaveBeenCalledTimes(2)
  })

  it('saves one distinctly named file per display without mixing screen sources', async () => {
    capture.getSources.mockResolvedValue([
      { display_id: '7', thumbnail: { isEmpty: () => false, toPNG: () => new Uint8Array([7]) } },
      { display_id: '8', thumbnail: { isEmpty: () => false, toPNG: () => new Uint8Array([8]) } }
    ])
    const other = { ...display, id: 8 } as Display
    const result = await capturePhotos([display, other], 'Niko', '', '旅行')
    expect(result.paths).toHaveLength(2)
    expect(result.paths[0]).toContain('旅行-')
    expect(result.paths[0]).toContain('-display7.png')
    expect(result.paths[1]).toContain('-display8.png')
    expect(capture.writeFile.mock.calls.map((call) => [...call[1] as Uint8Array])).toEqual([[7], [8]])
  })
})

import { afterEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Logger } from '../src/main/logger'
import { SettingsStore } from '../src/main/settings'

const directories: string[] = []
const temporaryParent = resolve(process.cwd(), 'artifacts')

async function temporaryStore(): Promise<{ path: string; store: SettingsStore }> {
  await mkdir(temporaryParent, { recursive: true })
  const path = await mkdtemp(join(temporaryParent, 'settings-test-'))
  directories.push(path)
  return { path, store: new SettingsStore(path, new Logger(path)) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => {
    const child = relative(temporaryParent, resolve(path))
    if (child === '' || child.startsWith('..') || isAbsolute(child)) {
      throw new Error(`Refusing to remove path outside test artifacts: ${path}`)
    }
    await rm(path, { recursive: true, force: true })
  }))
})

it('backs up malformed JSON and restores persisted defaults', async () => {
  const { path, store } = await temporaryStore()
  await writeFile(join(path, 'settings.json'), '{broken', 'utf8')

  const settings = await store.load()
  expect(settings.size).toBe(220)
  const names = await readdir(path)
  expect(names.some((name) => /^settings\.corrupt-\d+-\d+\.json$/.test(name))).toBe(true)
  expect(JSON.parse(await readFile(join(path, 'settings.json'), 'utf8'))).toEqual(settings)
})

it('clamps updates and serializes overlapping saves without losing fields', async () => {
  const { path, store } = await temporaryStore()
  await store.load()
  await Promise.all([
    store.update({ size: 999 }),
    store.update({ volume: -2 })
  ])

  const saved = JSON.parse(await readFile(join(path, 'settings.json'), 'utf8')) as { size: number; volume: number }
  expect(saved.size).toBe(500)
  expect(saved.volume).toBe(0)
  expect((await readdir(path)).some((name) => name.endsWith('.tmp'))).toBe(false)
})

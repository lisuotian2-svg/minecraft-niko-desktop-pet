import type { PetApi } from '../preload/index'
import type { PetSettings } from '../shared/settings'
import './settings.css'

declare global {
  interface Window { petApi: PetApi }
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing settings element: ${selector}`)
  return element
}

const size = required<HTMLInputElement>('#size')
const volume = required<HTMLInputElement>('#volume')
const sizeValue = required<HTMLOutputElement>('#size-value')
const volumeValue = required<HTMLOutputElement>('#volume-value')
const save = required<HTMLButtonElement>('#save')
const close = required<HTMLButtonElement>('#close')
const status = required<HTMLParagraphElement>('#status')
const version = required<HTMLSpanElement>('#version')

function renderValues(): void {
  sizeValue.value = `${size.value} px`
  volumeValue.value = `${volume.value}%`
}

function applySettings(settings: PetSettings): void {
  size.value = String(settings.size)
  volume.value = String(Math.round(settings.volume * 100))
  renderValues()
}

size.addEventListener('input', renderValues)
volume.addEventListener('input', renderValues)
close.addEventListener('click', () => window.close())
save.addEventListener('click', () => {
  save.disabled = true
  status.textContent = ''
  void window.petApi.saveSettings({
    size: Number(size.value),
    volume: Number(volume.value) / 100
  }).then((settings) => {
    applySettings(settings)
    status.textContent = '已保存'
  }).catch((error: unknown) => {
    status.textContent = '保存失败，请查看日志'
    window.petApi.log(`settings save error: ${String(error)}`)
  }).finally(() => { save.disabled = false })
})

window.petApi.onSettings(applySettings)
void window.petApi.getSettings()
  .then(applySettings)
  .catch((error: unknown) => {
    status.textContent = '读取设置失败，请查看日志'
    window.petApi.log(`settings load error: ${String(error)}`)
  })
void window.petApi.getVersion()
  .then((value) => { version.textContent = `版本 ${value}` })
  .catch((error: unknown) => window.petApi.log(`version load error: ${String(error)}`))

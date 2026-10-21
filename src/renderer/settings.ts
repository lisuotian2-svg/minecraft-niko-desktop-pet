import type { PetApi } from '../preload/index'
import { ACTION_LABELS, DEFAULT_HOTKEYS, type ActionId } from '../shared/contracts'
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

const form = required<HTMLFormElement>('#settings-form')
const size = required<HTMLInputElement>('#size')
const opacity = required<HTMLInputElement>('#opacity')
const nickname = required<HTMLInputElement>('#nickname')
const volume = required<HTMLInputElement>('#volume')
const muted = required<HTMLInputElement>('#muted')
const clickSounds = required<HTMLInputElement>('#click-sounds')
const actionSounds = required<HTMLInputElement>('#action-sounds')
const longPressMs = required<HTMLInputElement>('#long-press-ms')
const autoTorch = required<HTMLInputElement>('#auto-torch')
const darkThreshold = required<HTMLInputElement>('#dark-threshold')
const fullscreenPeek = required<HTMLInputElement>('#fullscreen-peek')
const peekFrequency = required<HTMLSelectElement>('#peek-frequency')
const activityLevel = required<HTMLSelectElement>('#activity-level')
const randomActions = required<HTMLInputElement>('#random-actions')
const sleepEnabled = required<HTMLInputElement>('#sleep-enabled')
const sleepMinutes = required<HTMLInputElement>('#sleep-minutes')
const walkEnabled = required<HTMLInputElement>('#walk-enabled')
const walkFrequency = required<HTMLSelectElement>('#walk-frequency')
const walkSpeed = required<HTMLInputElement>('#walk-speed')
const particles = required<HTMLInputElement>('#particles')
const performanceMode = required<HTMLSelectElement>('#performance-mode')
const shadowEnabled = required<HTMLInputElement>('#shadow-enabled')
const idleMicroMotion = required<HTMLInputElement>('#idle-micro-motion')
const autostart = required<HTMLInputElement>('#autostart')
const startHidden = required<HTMLInputElement>('#start-hidden')
const photoDir = required<HTMLInputElement>('#photo-dir')
const photoPrefix = required<HTMLInputElement>('#photo-prefix')
const photoScope = required<HTMLSelectElement>('#photo-scope')
const photoNotify = required<HTMLInputElement>('#photo-notify')
const choosePhotoDir = required<HTMLButtonElement>('#choose-photo-dir')
const resetPhotoDir = required<HTMLButtonElement>('#reset-photo-dir')
const sizeValue = required<HTMLOutputElement>('#size-value')
const opacityValue = required<HTMLOutputElement>('#opacity-value')
const sleepValue = required<HTMLOutputElement>('#sleep-value')
const walkSpeedValue = required<HTMLOutputElement>('#walk-speed-value')
const volumeValue = required<HTMLOutputElement>('#volume-value')
const longPressValue = required<HTMLOutputElement>('#long-press-value')
const thresholdValue = required<HTMLOutputElement>('#threshold-value')
const hotkeyContainer = required<HTMLDivElement>('#hotkeys')
const resetHotkeys = required<HTMLButtonElement>('#reset-hotkeys')
const save = required<HTMLButtonElement>('#save')
const close = required<HTMLButtonElement>('#close')
const status = required<HTMLParagraphElement>('#status')
const version = required<HTMLSpanElement>('#version')

const workingActions = new Set<ActionId>(['togglePet', 'photo', 'settings', 'feed', 'pet', 'torch', 'sleep', 'wake'])
const hotkeyInputs = new Map<ActionId, HTMLInputElement>()
let currentSettings: PetSettings | null = null

for (const action of Object.keys(DEFAULT_HOTKEYS) as ActionId[]) {
  const row = document.createElement('label')
  row.className = 'hotkey-row'
  const title = document.createElement('span')
  title.textContent = action === 'togglePet' ? '显示 Niko' : ACTION_LABELS[action]
  const input = document.createElement('input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.maxLength = 64
  input.placeholder = '清空即禁用'
  if (!workingActions.has(action)) {
    input.disabled = true
    input.title = '此动作尚未接入角色动画'
    title.textContent += '（待实现）'
  }
  row.append(title, input)
  hotkeyContainer.append(row)
  hotkeyInputs.set(action, input)
}

function renderValues(): void {
  sizeValue.value = `${size.value} px`
  opacityValue.value = `${opacity.value}%`
  sleepValue.value = `${sleepMinutes.value} 分钟`
  walkSpeedValue.value = `${walkSpeed.value}%`
  volumeValue.value = `${volume.value}%`
  longPressValue.value = `${(Number(longPressMs.value) / 1000).toFixed(1)} 秒`
  thresholdValue.value = `${darkThreshold.value}%`
  darkThreshold.disabled = !autoTorch.checked
  peekFrequency.disabled = !fullscreenPeek.checked
  sleepMinutes.disabled = !sleepEnabled.checked
  walkFrequency.disabled = !walkEnabled.checked
  walkSpeed.disabled = !walkEnabled.checked
  const simple = performanceMode.value === 'simple'
  shadowEnabled.disabled = simple
  idleMicroMotion.disabled = simple
}

function applySettings(settings: PetSettings): void {
  currentSettings = settings
  size.value = String(settings.size)
  opacity.value = String(Math.round(settings.opacity * 100))
  nickname.value = settings.nickname
  volume.value = String(Math.round(settings.volume * 100))
  muted.checked = settings.muted
  clickSounds.checked = settings.clickSounds
  actionSounds.checked = settings.actionSounds
  longPressMs.value = String(settings.longPressMs)
  autoTorch.checked = settings.autoTorch
  darkThreshold.value = String(settings.darkThreshold)
  fullscreenPeek.checked = settings.fullscreenPeek
  peekFrequency.value = settings.peekFrequency
  activityLevel.value = settings.activityLevel
  randomActions.checked = settings.randomActions
  sleepEnabled.checked = settings.sleepEnabled
  sleepMinutes.value = String(Math.round(settings.sleepAfterIdleSec / 60))
  walkEnabled.checked = settings.walkEnabled
  walkFrequency.value = settings.walkFrequency
  walkSpeed.value = String(Math.round(settings.walkSpeedMultiplier * 100))
  particles.checked = settings.particles
  performanceMode.value = settings.performanceMode
  shadowEnabled.checked = settings.shadowEnabled
  idleMicroMotion.checked = settings.idleMicroMotion
  autostart.checked = settings.autostart
  startHidden.checked = settings.startHidden
  photoDir.value = settings.photoDir
  photoPrefix.value = settings.photoPrefix
  photoScope.value = settings.photoScope
  photoNotify.checked = settings.photoNotify
  for (const [action, input] of hotkeyInputs) input.value = settings.hotkeys[action] ?? ''
  save.disabled = false
  resetHotkeys.disabled = false
  renderValues()
}

for (const slider of [size, opacity, volume, longPressMs, darkThreshold, sleepMinutes, walkSpeed]) {
  slider.addEventListener('input', renderValues)
}
autoTorch.addEventListener('change', renderValues)
fullscreenPeek.addEventListener('change', renderValues)
sleepEnabled.addEventListener('change', renderValues)
walkEnabled.addEventListener('change', renderValues)
performanceMode.addEventListener('change', renderValues)
close.addEventListener('click', () => window.close())
choosePhotoDir.addEventListener('click', () => {
  void window.petApi.choosePhotoDirectory().then((directory) => {
    if (directory !== null) photoDir.value = directory
  }).catch((error: unknown) => {
    status.textContent = `选择文件夹失败：${String(error)}`
  })
})
resetPhotoDir.addEventListener('click', () => { photoDir.value = '' })
resetHotkeys.addEventListener('click', () => {
  for (const [action, input] of hotkeyInputs) {
    if (!input.disabled) input.value = DEFAULT_HOTKEYS[action] ?? ''
  }
  status.textContent = '默认快捷键已填入，点击保存后生效'
})

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!currentSettings) return
  const hotkeys = { ...currentSettings.hotkeys }
  for (const [action, input] of hotkeyInputs) {
    if (!input.disabled) hotkeys[action] = input.value.trim() || null
  }
  save.disabled = true
  status.textContent = '正在保存…'
  void window.petApi.saveSettings({
    size: Number(size.value),
    opacity: Number(opacity.value) / 100,
    nickname: nickname.value.trim(),
    volume: Number(volume.value) / 100,
    muted: muted.checked,
    clickSounds: clickSounds.checked,
    actionSounds: actionSounds.checked,
    longPressMs: Number(longPressMs.value),
    autoTorch: autoTorch.checked,
    darkThreshold: Number(darkThreshold.value),
    fullscreenPeek: fullscreenPeek.checked,
    peekFrequency: peekFrequency.value as PetSettings['peekFrequency'],
    activityLevel: activityLevel.value as PetSettings['activityLevel'],
    randomActions: randomActions.checked,
    sleepEnabled: sleepEnabled.checked,
    sleepAfterIdleSec: Number(sleepMinutes.value) * 60,
    walkEnabled: walkEnabled.checked,
    walkFrequency: walkFrequency.value as PetSettings['walkFrequency'],
    walkSpeedMultiplier: Number(walkSpeed.value) / 100,
    particles: particles.checked,
    performanceMode: performanceMode.value as PetSettings['performanceMode'],
    shadowEnabled: shadowEnabled.checked,
    idleMicroMotion: idleMicroMotion.checked,
    autostart: autostart.checked,
    startHidden: startHidden.checked,
    photoDir: photoDir.value,
    photoPrefix: photoPrefix.value.trim(),
    photoScope: photoScope.value as PetSettings['photoScope'],
    photoNotify: photoNotify.checked,
    hotkeys
  }).then((settings) => {
    applySettings(settings)
    status.textContent = '已保存，设置立即生效'
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const hotkeyError = message.indexOf('快捷键未保存：')
    status.textContent = hotkeyError >= 0 ? message.slice(hotkeyError) : '保存失败，请查看日志'
    window.petApi.log(`settings save error: ${message}`)
  }).finally(() => { save.disabled = false })
})

save.disabled = true
resetHotkeys.disabled = true
renderValues()
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

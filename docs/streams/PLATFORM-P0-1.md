# PLATFORM-P0-1 — 托盘单击 + 全屏检测 + 边缘探头（platform 实现报告）

> 任务：task-5 / P0-1 平台侧（首个可见里程碑，G1）
> 日期：2026-10-21
> 执行：platform-dev
> 约束：未改 `src/main/index.ts` / `ipc.ts` / `settings` / `package.json` / `src/renderer`（preload 除外）；
> 未启动可见 GUI 自测；未杀/重启用户正在运行的实例；未安装新依赖；未改资产。

---

## 1. 结论

平台侧 P0-1 已完成，等待 Lead 接线后做实机验收：

- **PLT-01 resize-guard 自激循环已修**：容差 2 DIP + 自设 bounds 后 250 ms 抑制 + peek/drag/closing 模式跳过；不再出现 30–50 次/秒的 `setBounds` 风暴。
- **托盘**：单击只找回（已显示不隐藏）、双击打开设置、右键菜单保留“隐藏/显示 Niko”、tooltip/菜单支持快捷键提示（可选注入）。
- **全屏检测**：C# helper（`csc.exe` 本机构建）+ PowerShell 兜底；只检测前台全屏，排除最大化/桌面/任务栏/本应用/cloaked；输出 `active + Electron displayId`；失败回到 normal 并记录一次原因。
- **边缘探头**：`src/main/peek.ts` + `src/shared/peek.ts`，底部/左/右随机，20–45 s 间隔，4–8 s 停留；当前全屏显示器；窗口只做边缘定位，head-only 姿态由 behavior 负责；点击头部（`pet:peek-reveal`）回底部 10 s，然后恢复探头循环。
- **与拖拽/关闭/隐藏互斥**：pet-window 在 peek 时禁走、禁拖、resize guard 跳过；PeekController supervisor 检测拖拽/关闭/隐藏并暂停；关闭从 peek 时恢复到正常 compact bounds。
- **构建门禁**：`electron-vite build` 通过；`tsc --noEmit` 通过；`vitest run` **34/34 通过**（4 文件）。
- **未做的实机项**：全屏四边/托盘/恢复/多显示器必须由 Lead/QA 在真实桌面验收（见 §8）。

---

## 2. 改动文件

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/main/tray.ts` | 修改 | 单击找回、双击设置、右键菜单保留隐藏、tooltip/菜单快捷键提示、空图标 fallback |
| `src/main/pet-window.ts` | 修改 | `applyBounds()` 统一自设 bounds；resize guard 容差/抑制/模式门；peek 进入/移动/恢复/关闭保护；拖拽/走路/显示跳过 peek |
| `src/main/fullscreen.ts` | 新增 | `FullscreenDetector`：helper/PS 兜底、JSON 解析、显示映射、hysteresis、状态/日志 |
| `src/main/peek.ts` | 新增 | `PeekController`：全屏状态到窗口 placement、随机边缘、20–45/4–8s、点击 reveal 10s、互斥、screen 事件 |
| `src/shared/peek.ts` | 新增 | 纯几何/调度：`pickPeekEdge`、`nextPeekIntervalMs`、`peekHoldMs`、`createPeekPlacement`、`peekBoundsAt`、easing |
| `src/preload/index.ts` | 修改 | 新增 `onPeekState()`、`revealPeek()`；从 `contracts.IPC_CHANNELS` 取通道 |
| `native/fullscreen-watcher/Program.cs` | 新增 | Win32/DWM P/Invoke；输出单行 JSON；DPI-aware；`--once` 便于无 GUI 诊断 |
| `native/fullscreen-watcher/build.ps1` | 新增 | `csc.exe` 构建到 `bin/FullscreenWatcher.exe` |
| `native/fullscreen-watcher/fallback.ps1` | 新增 | PowerShell `Add-Type` 复用 `Program.cs`，helper 缺失/失败时轮询输出 |
| `native/fullscreen-watcher/bin/FullscreenWatcher.exe` | 生成（未纳入源码） | 本机构建产物；源包/打包应由 `build.ps1` 生成或作为 extraResources 显式携带 |
| `docs/streams/PLATFORM-P0-1.md` | 新增 | 本文件 |

> `src/shared/contracts.ts` 的 `peekReveal: 'pet:peek-reveal'` 由 Lead 补齐，本轮直接消费该常量。

---

## 3. 与冻结契约的关系

已读 `src/shared/contracts.ts`，使用以下冻结字段/类型，没有新增并行类型：

- `FullscreenState`：`active`、`displayId`、`edge`、`phase`、`windowBounds`、`headAnchor`、`revealUntil`。
- `PeekEdge = 'left' | 'right' | 'bottom'`；`PeekPhase = 'idle' | 'hidden' | 'peeking' | 'revealed' | 'returning'`。
- `IPC_CHANNELS.peekState` / `peekReveal`。
- `DisplaySnapshot`/`Bounds` 仅作为结构参考；main 内部使用 Electron 的 `Display` 后映射到 `Bounds`。

**head-only 语义约定**（需要 behavior 遵守，否则视觉不成立）：

- 进入 `active=true` 后，renderer 应保持 head-only 姿态，头中心对齐窗口中心；main 输出的 `headAnchor` 固定为 `(windowSize/2, windowSize/2)`。
- `phase='returning'` 有两种含义，必须由 `revealUntil` 区分：
  - `revealUntil === null`：从 peek 缩回屏幕外，继续 head-only；
  - `revealUntil !== null`：用户点击头部，恢复**正常全身**在底部，10 s 后再次头-only。
- `active=false`：退出全屏，恢复正常底部行为。
- `phase='hidden'`：窗口在屏幕外，renderer 保持头-only/隐藏；不要显示全身。
- 当前没有 `pet:head-anchor` 通道：P0-1 以窗口中心为头中心；如果 behavior 需要偏移锚点，请 Lead 扩展 contracts，而不是 platform 另造类型。

---

## 4. 实现细节

### 4.1 PLT-01：resize guard 修复

`src/main/pet-window.ts`：

```ts
// 只在 normal 模式守护；peek/drag/closing 直接跳过
win.on('resize', () => {
  if (this.closing || this.dragging || this.peeking) return
  const now = Date.now()
  if (now < this.resizeSuppressUntil) return
  const bounds = win.getBounds()
  const widthDelta = Math.abs(bounds.width - this.windowSize)
  const heightDelta = Math.abs(bounds.height - this.windowSize)
  if (widthDelta <= 2 && heightDelta <= 2) return
  if (now - this.lastResizeWarnAt >= 1000) { this.lastResizeWarnAt = now; logger.warn(...) }
  this.resizeSuppressUntil = now + 250
  win.setBounds({ ... }, false)
})
```

- 所有主动 `setBounds` 走 `applyBounds()`：设置 `resizeSuppressUntil = now + 250`，并抑制自身回灌。
- 容差覆盖 125%/150% DPI 的 1–2 DIP 舍入；日志最多 1 条/秒（避免 12k 行）。
- `reconcileDisplay()`/`beginPeek()`/`moveForPeek()`/`endPeek()`/拖拽落点/关闭恢复均使用 `applyBounds()`。
- 验收：实机日志中不再出现 `pet resize guard` 风暴（可对比修复前后 60 s 的行数）。

### 4.2 托盘

- `click`：宠物隐藏 → `showPet()`；已显示 → 不隐藏（只刷新菜单/tooltip）；280 ms 定时器让双击取消隐式显示，避免双击设置时先弹出宠物。
- `double-click`：`openSettings()`（不再用于显示宠物）。
- 右键菜单仍为：显示/隐藏、设置、拍照、退出；显示/隐藏后立即重建菜单。
- `TrayActions.getHotkeyHint?()` / `getHotkeyLabels?()` 可选：hotkey manager 落地后由 Lead 注入；未注入时 tooltip 只有 `Niko Pet 3D`，菜单没有虚假快捷键。
- 皮肤/托盘图缺失时用 1×1 PNG fallback，避免 `new Tray(empty)` 在 Windows 抛异常导致启动退出（`build/tray.ico` 由后续打包任务接管）。

### 4.3 全屏检测（`src/main/fullscreen.ts`）

- 来源：
  - dev：`<appPath>/native/fullscreen-watcher/bin/FullscreenWatcher.exe`；
  - packaged：`<resources>/native/FullscreenWatcher.exe`；
  - fallback：同目录 `fallback.ps1`（PowerShell 5.1 + `Add-Type`）。
- helper 进程参数：`--interval 500 --exclude-pid <main pid> --exclude-processes explorer.exe,... --exclude-classes Progman,...`。
- helper 单行 JSON（示例为本机 maximized DSH，故意 `active=false`）：

```json
{"kind":"state","ts":1792563181614,"active":false,"pid":15364,"process":"electron.exe",
 "className":"Chrome_WidgetWin_1","maximized":false,"minimized":false,"cloaked":false,"dpi":120,
 "windowBounds":{"x":234,"y":258,"width":883,"height":883},
 "monitor":{"device":"\\\\.\\DISPLAY1","bounds":{"x":0,"y":0,"width":1920,"height":1200},
 "workArea":{"x":0,"y":0,"width":1920,"height":1140}}}
```

- 判定：`visibleBounds` 覆盖 monitor `bounds` ≥98%，且不是 `WS_MAXIMIZE`、不是 minimized、不是 DWM cloaked；排除自身 pid/shell/桌面/taskbar class。
- 主进程把 helper 的物理 monitor 尺寸与 Electron display 的 `bounds × scaleFactor` 匹配；单屏直接返回 primary id；多屏用尺寸 + 相对位置近似匹配（混合 DPI 的精确映射留给实机验收）。
- `FullscreenDetector` 默认 500 ms 轮询，连续 2 次相同结果才切换（约 1 s hysteresis），只在 active/displayId 变化时 `onState`。
- 失败行为：helper 缺失 → PowerShell；都失败 → `source='unavailable'`，发出 `active:false`，只记录一次错误；PeekController 随后恢复正常底部。
- 不打印窗口标题；日志仅 pid/process/class/display/源。

### 4.4 边缘探头（`src/main/peek.ts` + `src/shared/peek.ts`）

- 几何（窗口为边长 `W` 的正方形，头中心在窗口中心，头半径 `r`）：
  - 底部：隐藏 `headCenterY = display.bottom + r`；露出 `headCenterY = display.bottom - margin - r`；
  - 左侧：隐藏 `headCenterX = display.left - r`；露出 `headCenterX = display.left + margin + r`；
  - 右侧：隐藏 `headCenterX = display.right + r`；露出 `headCenterX = display.right - margin - r`；
  - 沿边位置随机，窗口 `x/y = headCenter - W/2`；窗口可以透明地伸出屏幕。
- `headRadius = clamp(W * 0.18, 18, 90)`；`margin=8`。
- 时序：进入 320 ms ease-out → 停留 4–8 s → 退出 260 ms ease-in → 下一次 20–45 s。
- 状态：
  - `hidden`：窗口在屏外，head-only；
  - `peeking`：滑入；
  - `revealed`：停留；
  - `returning` + `revealUntil=null`：滑出；
  - `returning` + `revealUntil>now`：点击头部后正常全身底部 10 s；
  - `idle`：退出全屏。
- 点击头部：renderer 调 `window.petApi.revealPeek()` → Lead 的 IPC handler → `peek.reveal()`：
  - 取消当前 peek/停留；
  - 恢复当前全屏显示器的 taskbar 底部（`normalBoundsFor(display)`）；
  - `phase='returning'`、`revealUntil=now+10000`、`windowBounds=normal`；
  - 10 s 后若仍全屏：先藏到边缘，约 **1.2 s** 后开始下一次 peek（点击打断后的快速恢复；普通 peek 之间仍是 20–45 s）。
- 多显示器：进入时只使用 detector 指定的当前全屏 display；点击 reveal/退出全屏时底部目标也取当前 display（不是宠物进入全屏前的旧屏），符合用户“current fullscreen display only”。
- 互斥：
  - `pet.beginPeek()` 停走路、保存 normal bounds；`tick()`/`forceWalk()`/`startDrag()` 在 peeking 时直接 return；
  - peek 期间 `win.setFocusable(false)`（endPeek/beginClose 恢复 true），避免点击头部把 Electron 自己变成前台窗口、导致全屏检测误判为退出；这也让全屏游戏继续保有焦点，但**必须实机确认**非 focusable 窗口仍能收到点击/命中测试。
  - PeekController 200 ms supervisor：closing/dragging 时清 timer；隐藏时暂停；用户从托盘显示后先给 10 s 正常窗口，再恢复 peek；
  - `beginClose()` 从 peek 时把 compact bounds 设为进入全屏前的正常 bounds（不是屏外 peek bounds），关闭后托盘恢复仍是正常底部；
  - resize guard 在 peeking/dragging/closing 都跳过，避免把探头窗口拉回底部。
- 当前全屏为最大化窗口时不触发（helper `maximized=true`），普通浏览器/游戏 fullscreen 应触发。

### 4.5 Preload API

```ts
onPeekState(callback: (state: FullscreenState) => void): () => void
revealPeek(): void
```

- 只桥接 `IPC_CHANNELS.peekState` / `peekReveal`，不暴露任意 IPC。
- renderer 仍需 behavior 实现 head-only 姿态与点击检测；platform 不修改 `src/renderer`。

---

## 5. 需要 Lead 接线的清单（index.ts / ipc.ts）

> 以下为建议的最小接线；所有 channel 已在 `contracts.IPC_CHANNELS` 中。

### 5.1 `src/main/index.ts`

```ts
import { ipcMain } from 'electron'
import { FullscreenDetector } from './fullscreen'
import { PeekController } from './peek'
import { EMPTY_FULLSCREEN_STATE, IPC_CHANNELS, type FullscreenState } from '../shared/contracts'

let detector: FullscreenDetector | null = null
let peek: PeekController | null = null

// app.whenReady() -> pet = new PetWindowController(...); pet.create()
const sendPeekState = (state: FullscreenState): void => {
  const win = pet?.getWindow()
  if (!win || win.webContents.isLoading()) return
  win.webContents.send(IPC_CHANNELS.peekState, state)
}

peek = new PeekController({ pet, logger, sendState: sendPeekState })
detector = new FullscreenDetector({
  logger,
  onState: (state) => peek?.setDetectorState(state)
})
detector.start()

// 渲染器加载后补发初始状态（peek 可能在全屏检测前创建）
pet.getWindow()?.webContents.once('did-finish-load', () => {
  sendPeekState(peek?.getState() ?? { ...EMPTY_FULLSCREEN_STATE })
})

// 点击头部（pet:peek-reveal）——放在 index.ts 可避免改 registerIpc 依赖；
// 若你更愿意放 ipc.ts，请把 PeekController 加进 IpcDependencies。
ipcMain.on(IPC_CHANNELS.peekReveal, (event) => {
  if (event.sender === pet?.getWindow()?.webContents) peek?.reveal()
})

// before-quit：先停止检测/探头，再准备退出
app.on('before-quit', () => {
  detector?.stop()
  peek?.dispose()
  // 现有逻辑继续：brightness.stop(); globalShortcut.unregisterAll(); pet.prepareToQuit()
})
```

注意事项：

1. `peek` 必须在 `pet.create()` 之后创建（构造函数会记录当前窗口 bounds）；`sendPeekState` 对 `webContents.isLoading()` 做保护。
2. `PeekController` 自己注册 screen display 事件并内部 `refreshDisplays()`；index 不需要额外监听，但保留现有 `screen.on(..., reconcile)` 给 pet-window。
3. tray 的 hotkey 提示等 hotkey manager 落地后再注入：
   ```ts
   getHotkeyHint: () => '拍照 Ctrl+Alt+P', // 仅当 globalShortcut 注册成功
   getHotkeyLabels: () => ({ photo: 'Ctrl+Alt+P' })
   ```
   现在可不传，tooltip 保持 `Niko Pet 3D`。
4. `peek.setEnabled(false/true)` 留给后续 settings v2 的 `fullscreenPeek`；task-5 不接线设置。

### 5.2 `src/main/ipc.ts`（可选方案）

若不想在 index.ts 注册 `peekReveal`，可改为：

```ts
export interface IpcDependencies { /* ... */ peek: PeekController }

ipcMain.on(IPC_CHANNELS.peekReveal, (event) => {
  if (!isPet(event.sender)) return
  peek.reveal()
})
```

并在 `index.ts` 的 `registerIpc({ pet, settingsWindow, settings, logger, peek })` 传入。两种方案二选一，不要重复注册。

### 5.3 `src/preload/index.ts`（已完成，无需 Lead 改）

`onPeekState` / `revealPeek` 已暴露，Lead 只需保证 `ipc.ts` 在 pet sender 时调用 `peek.reveal()`。

---

## 6. 构建、类型、测试结果

本机（Windows 11 x64，Electron 44.7.0，Node 24.21.0）：

```powershell
cmd /c "node_modules\.bin\electron-vite.cmd build"
# 通过；main 12 modules / ~38.7 kB，preload 3 modules / ~5.0 kB，
# renderer 40 modules / ~926 kB；exit 0

cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
# 通过，无输出；exit 0

cmd /c "node_modules\.bin\vitest.cmd run"
# Test Files 4 passed (4)
# Tests 34 passed (34)
# exit 0
```

> 说明：首次整仓构建曾被 behavior 的 `src/renderer/animator.ts` 中间态重复 `centerX/centerY` 阻断（非 platform 文件）；behavior 修复后已重跑以上三项并全部通过。platform 独立类型检查（仅 main/preload/shared 本次文件）也已通过。

C# helper：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File native\fullscreen-watcher\build.ps1
# Built ...\native\fullscreen-watcher\bin\FullscreenWatcher.exe

native\fullscreen-watcher\bin\FullscreenWatcher.exe --once --exclude-pid <pid>
# 输出合法 JSON；本机 DSH 前台窗口为 maximized -> active:false（预期）

powershell.exe -NoProfile -ExecutionPolicy Bypass -File native\fullscreen-watcher\fallback.ps1 -Once -ExcludePid <pid>
# 输出同样结构的 JSON
```

纯逻辑快速校验（不写入源码树）：

- `PEEK_EDGES` = bottom/left/right；`nextPeekIntervalMs(0/1)` = 20000/45000；`peekHoldMs(0/1)` = 4000/8000。
- `createPeekPlacement` 四边（实际三边）隐藏/露出时头矩形边界符合公式；窗口中心随 `peekBoundsAt` 插值。
- `enterProgress`/`leaveProgress` 端点 0→1 和 1→0 正确。

> 该快速校验是临时 `tsc --outDir %TEMP%` + Node 断言，不新增 `tests/**`（task-5 write scope 不含 tests）。

---

## 7. 实机验收步骤（Lead/QA，必须真实桌面）

前置：不要杀当前用户实例；用 Lead 的 `cmd start` + 独立 `--user-data-dir`（如 `.scratch-userdata-p01`）启动；保持 Electron 44.7.0。

1. **构建/启动**：按 §5 接线后 `electron-vite build`/`tsc`；启动测试实例；托盘图标存在。
2. **resize guard 回归**：启动后 60 s 内检查日志，`pet resize guard` 应为 0 或至多几条；对比修复前 30–50 条/秒。窗口不应抖动。
3. **托盘**：手势关闭到托盘 → **单击**托盘 → 宠物恢复且不隐藏；已显示时单击不隐藏；**双击** → 设置窗口；右键菜单“隐藏 Niko”仍可用；菜单文案随显示状态刷新。
4. **全屏进入**：用浏览器 F11 / 视频播放器全屏（不要用最大化窗口，最大化应不触发）；日志出现 `fullscreen active display=<id>`、`peek fullscreen display=<id>`、`peek enter edge=...`；窗口在屏幕外隐藏，最多 1 s 内完成。
5. **探头**：等待 20–45 s；确认 bottom/left/right 至少各观察到一次（随机）；每次停留 4–8 s；只有 head（左/右边缘依赖 behavior 的 head-only；若 body 露出，先修 behavior 再验收）；不挡全屏主画面。
6. **点击头部**：在 peek 时点击头 → renderer 调 `revealPeek()`；日志 `peek revealed by click`；宠物回到当前全屏显示器任务栏底部，全身显示 10 s；随后约 1.2 s 从边缘再次探头（若仍全屏）。**重点验证**：peek 时窗口 `focusable=false`，点击后全屏检测仍为 active（helper 前台不应变成 electron.exe）；如果点击无反应，说明非 focusable 拦截了鼠标，需要改用其他去焦点方案并回报 Lead。
7. **全屏退出**：Alt+Tab/退出全屏 → 日志 `fullscreen inactive`、`peek fullscreen ended`；宠物回底部，继续走路。
8. **互斥**：peek 中隐藏到托盘 → 不再移动；重新单击托盘 → 先底部 10 s 再 peek；peek 中拖拽/关闭不应与窗口移动打架；关闭后托盘恢复为正常底部，不是屏外。
9. **检测失败**：临时把 `bin\FullscreenWatcher.exe` 改名 → 启动测试实例应使用 PowerShell fallback（日志 `fullscreen PowerShell fallback started`）；两者都不可用 → 宠物正常底部，日志一条 `fullscreen ... unavailable`，不崩。
10. **多显示器（用户配合）**：全屏在副屏时只跟当前全屏屏；退出后回底部；125%/150% DPI 下边缘位置正确；混合 DPI 若显示映射错误，记录 monitor 尺寸/display id 给 Lead 修 `resolveDisplayId()`。
11. **性能**：全屏隐藏时观察 CPU/GPU 是否接近 0；如果离屏窗口仍持续渲染，后续可改为 `hide()`/暂停 rAF（当前 P0 先保功能）。
12. **截图/录屏**：G1 证据需覆盖托盘单击、全屏四边（至少 bottom/left/right）、点击头部回底部、退出全屏、关闭后托盘恢复；附日志摘录与耗时。

---

## 8. 已知限制 / 依赖

1. **behavior 依赖**：左/右边缘必须由 behavior 隐藏身体、保持头中心；否则窗口裁切会露出身体。`revealUntil` 的语义必须由 behavior 消费（见 §3）。
2. **当前只支持前台全屏**：后台/非前台的全屏窗口不触发；用户决定“current fullscreen display only”，符合当前实现。
3. **多显示器/混合 DPI 映射**：helper 输出物理 monitor；当前用尺寸 + 相对位置匹配 Electron display。单屏已用 helper 实测（monitor 1920×1200 vs Electron 1536×960×1.25）；多屏需实机；如失败会回退 primary 并记录警告。
4. **托盘 click 事件**：Electron Windows 下 `tray.on('click')` 与 `setContextMenu` 的组合需在真实桌面确认一次；若单击被菜单拦截，需在 `click` 里显式 `popUpContextMenu`/改用 `right-click` 菜单策略。
5. **离屏窗口仍 visible**：当前 hidden 阶段窗口移到屏外但未 `hide()`，避免 Chromium 节流导致首次滑入卡顿；会有一点常驻渲染成本，后续按性能数据决定 `hide()` 或暂停 rAF。
6. **托盘快捷键提示**：接口已留，hotkey manager 未在 task-5 范围，当前不显示虚假组合键。
7. **打包**：task-5 不改 electron-builder；后续需把 `FullscreenWatcher.exe`、`fallback.ps1`、`Program.cs` 作为 extraResources/构建产物携带，并处理 `native/bin` 的 git/打包策略（当前 exe 是生成物，未纳入源码）。
8. **焦点**：正常窗口的 `focusable:true` 保持原样（task-5 不处理 PLT-02 的正常点击焦点）；peek 期间临时 `setFocusable(false)`，需实机确认鼠标命中仍工作、且全屏检测不会误判退出。正常点击是否抢焦点仍需后续 G1 验证。

---

## 9. 建议后续任务

- Lead 接线 §5 → G1 实机验收。
- behavior 实现 head-only + `revealUntil` 语义（阻塞左/右探头视觉验收）。
- QA 增加 `shared/peek` 纯函数测试（这次因 write scope 未写 `tests/**`）。
- 设置 v2：`fullscreenPeek` 接 `peek.setEnabled`；`hotkeys` 接 tray hint 与 `IPC_CHANNELS.action`。
- 打包：helper/fallback 路径、`extraResources`、`native/bin` 生成策略。

# PLATFORM-P0-2-PREP — settings v2 / walk pause / onAction / HotkeyManager

> 任务：task-11（G1 并行接口准备；不做设置 UI、不做安装包）
> 日期：2026-10-21
> 执行：platform-dev
> 约束：不改 `src/main/index.ts` / `ipc.ts` / `src/renderer` / 测试 / package；不装依赖；不启动可见 GUI；不杀/重启现有实例。

---

## 1. 结论

- **settings v2 已实现**：`version:2`、全部新字段、v1→v2 迁移、原子写/损坏备份保留；新装 `autostart=true`，已有 settings.json 的 `autostart` 原值保留。
- **walk pause 已实现**：`PetWindowController.setWalkPaused()/isWalkPaused()`；暂停自动走路/位置更新，保留窗口、peek、拖拽、关闭状态；Lead 已在 `ipc.ts` 接 `pet:walk:pause`/`resume` handlers。
- **preload 已加**：`onAction(cb)`（监听 `IPC_CHANNELS.action`）、`setWalkPaused(paused)`（invoke `IPC_CHANNELS.walkPause`/`walkResume`）。
- **HotkeyManager 骨架已加**：注册/注销/冲突/重复/回滚；未接 index。
- **需要 Lead 接线**：`IPC_CHANNELS.action` 发送点、HotkeyManager 实例化与旧 `Ctrl+Alt+P` 注册迁移（见 §6）；walk pause handlers 已由 Lead 接好。
- **测试现状**：build/tsc 通过；vitest **50/50 通过（5 文件）**。QA 已更新 `tests/settings.test.ts` 并新增 `tests/settings-v2.test.ts`（16 个迁移/夹紧用例）；platform 未改 tests。
- **不做**：设置 UI/向导、autostart 系统注册、安装包、hotkey 设置 UI。

---

## 2. 改动文件

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/shared/settings.ts` | 修改 | v2 schema、默认值、v1/v2 解析、字段校验/夹紧、hotkeys 规范化；`PeekFrequency` 类型 |
| `src/main/settings.ts` | 修改 | v1→v2 迁移落盘、默认深拷贝、hotkeys 深拷贝；保留原子写/损坏备份 |
| `src/main/pet-window.ts` | 修改 | `setWalkPaused()`/`isWalkPaused()`；tick/forceWalk 守卫；不改变 peek/drag/close |
| `src/main/hotkeys.ts` | 新增 | `HotkeyManager` 骨架 + injectable `HotkeyRegistrar` |
| `src/preload/index.ts` | 修改 | `onAction`、`setWalkPaused`；消费 `IPC_CHANNELS.walkPause/walkResume/action` |
| `docs/streams/PLATFORM-P0-2-PREP.md` | 新增 | 本文件 |
| `tests/**` | **未改（QA）** | 旧 settings 断言等待 QA 更新 |

`src/shared/contracts.ts` 的 walk channel 由 Lead 补齐：
`walkPause: 'pet:walk:pause'`、`walkResume: 'pet:walk:resume'`；本实现直接消费，无并行 channel 常量。

---

## 3. Settings v2

### 3.1 字段与默认值

| 字段 | 类型 | 默认 | 范围/枚举 | 说明 |
|---|---|---|---|---|
| `version` | `2` | `2` | — | schema 版本 |
| `firstRun` | boolean | `true` | — | 保留旧值；向导后续使用 |
| `size` | number | `220` | 80–500 int | 原字段，保留 |
| `nickname` | string | `Niko` | ≤24 字符 | 原字段，保留 |
| `volume` | number | `0.4` | 0–1 | 原字段，保留 |
| `muted` | boolean | `false` | — | 原字段，保留 |
| `autostart` | boolean | **`true`（仅新装）** | — | 已有 v1 文件保留原值；见 §4 |
| `longPressMs` | number | `1500` | 1000–2000 int | 原字段 |
| `darkThreshold` | number | `30` | 10–60 int | 原字段 |
| `autoTorch` | boolean | `true` | — | 原字段 |
| `clickSounds` | boolean | `true` | — | 原字段 |
| `particles` | boolean | `true` | — | 原字段 |
| `photoDir` | string | `''` | — | 原字段 |
| `lastDisplayId` | number? | 无 | — | 原字段 |
| `lastX` | number? | 无 | — | 原字段 |
| `activityLevel` | `'low'\|'normal'\|'high'` | `'low'` | contracts `ACTIVITY_LEVELS` | behavior 活跃度 |
| `performanceMode` | `'simple'\|'normal'\|'gorgeous'` | `'normal'` | contracts `PERFORMANCE_MODES` | behavior 性能/画质预设 |
| `randomActions` | boolean | `true` | — | 允许随机行为（面包/伸展/跳舞等） |
| `actionSounds` | boolean | `true` | — | 动作/环境音开关 |
| `fullscreenPeek` | boolean | `true` | — | 全屏探头开关 |
| `peekFrequency` | `'low'\|'standard'\|'high'` | `'standard'` | 本地 `PEEK_FREQUENCIES` | 后续接 PeekController 频率 |
| `sleepEnabled` | boolean | `true` | — | 坐下/睡觉总开关 |
| `sleepAfterIdleSec` | number | `1200` | 60–86400 int | 系统空闲多久睡 |
| `wakeLieInSec` | number | `3` | 1–60 int | 醒来赖床秒数 |
| `closeSignEnabled` | boolean | `true` | — | 关闭手势的手+牌子提示 |
| `startHidden` | boolean | `false` | — | 自启后是否静默到托盘 |
| `hotkeys` | `Record<ActionId,string\|null>` | `DEFAULT_HOTKEYS` | 每个 ActionId | 自定义快捷键 |

`PeekFrequency` 是 settings 层新增的联合类型（contracts 没有对应冻结类型）；`ACTIVITY_LEVELS`/`PERFORMANCE_MODES`/`DEFAULT_HOTKEYS` 直接来自 contracts，没有新增并行 Action 类型。

### 3.2 校验/夹紧

- 数值：`boundedNumber` 夹紧并取整（size/longPressMs/darkThreshold/sleepAfterIdleSec/wakeLieInSec）。
- 枚举：非法值回退默认（activity/performance/peekFrequency）。
- 布尔：非布尔回退默认。
- `hotkeys`：只认 `ActionId`；`null`/空字符串 = 禁用；字符串 trim、最长 64；缺失键用 `DEFAULT_HOTKEYS` 补齐；未知键忽略。
- `version`：1/2/undefined 接受；其他版本/坏 JSON/核心字段类型错误 → `corrupted:true`，由 store 备份并恢复默认（现有策略）。
- 原子写、`.corrupt-*` 备份、pending update 串行化保持原实现。

### 3.3 迁移语义（重点）

| 场景 | 结果 |
|---|---|
| 没有 settings.json（新装） | 写 v2 默认；`autostart=true` |
| 已有 v1 文件，含 `autostart:false` | 迁移 v2；`autostart` **保持 false**；size/volume/nickname/photoDir/firstRun 保留；新字段填默认；hotkeys 填默认 |
| 已有 v1 文件，含 `autostart:true` | 保持 true |
| 已有 v1 文件，缺 `autostart` 字段 | 按 v1 旧默认视为 false（不因升级突然开启） |
| 已有合法 v2 文件 | 原样读取；`autostart` 保持文件值 |
| 更高版本/坏 JSON/类型错误 | 备份 `.corrupt-<ts>-<pid>.json`，恢复 v2 默认（现有行为） |

> Lead 已确认：新装 true、已有配置 preserve；当前 live 配置（v1、autostart=false）升级后不会被强制改为 ON。

---

## 4. Walk pause

### 4.1 main 行为

`src/main/pet-window.ts`：

```ts
isWalkPaused(): boolean
setWalkPaused(paused: boolean): void
```

- `paused=true`：若正在走，调用 `stopWalk()`（renderer 收到 `pet:walking=false`）；`tick()` 不再启动新走路/更新位置；不会隐藏窗口、不会取消 drag/peek/close。
- `paused=false`：只把 `nextWalkAt` 设为随机 3–8 分钟后；不会强制立即恢复上一段走路。
- 暂停状态**不持久化**（纯运行时）；窗口隐藏/显示、peek 进出、设置变化都不清除该标志。
- `forceWalk`（debug）在 paused 时直接返回。

### 4.2 Lead 已接的 IPC handler 签名（ipc.ts:150-159）

preload 调用 `ipcRenderer.invoke(paused ? IPC_CHANNELS.walkPause : IPC_CHANNELS.walkResume)`；Lead 已在 `src/main/ipc.ts` 接好：

```ts
ipcMain.handle(IPC_CHANNELS.walkPause, (event): void => {
  if (!isPet(event.sender)) throw new Error('Walk pause rejected')
  pet.setWalkPaused(true)
})

ipcMain.handle(IPC_CHANNELS.walkResume, (event): void => {
  if (!isPet(event.sender)) throw new Error('Walk resume rejected')
  pet.setWalkPaused(false)
})
```

- 返回 `undefined`；preload 类型 `Promise<void>`。
- 只接受 pet renderer；不开放给 settings renderer。
- 若后续把 `isPet` 改成别的 sender 校验，需同步报告类型。
- `IPC_CHANNELS.walkPause/walkResume` 已由 Lead 加入 contracts；preload 已消费常量。

### 4.3 使用建议

- behavior 在进入 sleep/sit/peek/photo/performance-simple 等“位置不需要走”的状态时可调用 `window.petApi.setWalkPaused(true)`，退出时 `false`；platform 不替 behavior 决定状态。
- 暂停不停止 renderer 动画；只是 window 不自动移动。

---

## 5. Action 通道与 preload

### 5.1 `IPC_CHANNELS.action`（main→renderer）

payload 使用 contracts：

```ts
interface ActionRequest {
  id: ActionId
  source: 'hotkey' | 'tray' | 'ui' | 'gesture'
}
```

Lead 的发送点（建议放 index/ipc 能访问 pet 的位置）：

```ts
const sendAction = (request: ActionRequest): void => {
  const win = pet.getWindow()
  if (!win || win.webContents.isLoading()) return
  win.webContents.send(IPC_CHANNELS.action, request)
}
```

- 只在 renderer 已加载时发送；不要在 `peek-state` 前/关窗后 send。
- `onAction` 的 listener 在 preload 内校验 `isActionId` 与 `source`；renderer 收到的是已脱敏的 `{id, source}`。
- 动作执行方：`photo`/`togglePet`/`settings` 可由 main 处理；`pet/torch/dance/wave/feed/sleep/wake` 等转给 renderer（behavior/interaction 决定）。

### 5.2 preload 新增

```ts
onAction(callback: (request: ActionRequest) => void): () => void
setWalkPaused(paused: boolean): Promise<void>
```

renderer 使用：

```ts
const off = window.petApi.onAction((request) => {
  // behavior/interaction 按 request.id 执行；request.source 仅用于日志/优先级
})
window.petApi.setWalkPaused(true) // 例如 sleep 开始
```

---

## 6. HotkeyManager 骨架

`src/main/hotkeys.ts`：

```ts
interface HotkeyManagerOptions {
  logger: Logger
  onAction: (request: ActionRequest) => void
  bindings?: Partial<Record<ActionId, string | null>>
  shortcuts?: HotkeyRegistrar // 测试注入；默认 electron.globalShortcut
}

class HotkeyManager {
  apply(next: Partial<Record<ActionId, string | null>>): HotkeyApplyResult
  registerAll(next?: Partial<Record<ActionId, string | null>>): HotkeyApplyResult
  unregisterAll(): void
  getBindings(): Record<ActionId, string | null>
  getStatus(): Array<{ action; label; accelerator; registered }>
  validateAccelerator(accelerator: string | null): boolean
}
```

- 注册前检查语法与重复 accelerator；任一项 `globalShortcut.register` 返回 false/抛错 → 注销本次已注册项并恢复上一组 bindings；返回 `{ok:false, errors}`。
- 只注销自己注册的 accelerator，不调用 `globalShortcut.unregisterAll()`。
- `DEFAULT_HOTKEYS`/`ACTION_LABELS` 来自 contracts；不新增并行 ActionId。
- 测试注入 `shortcuts`，不依赖 Electron；已用临时脚本验证 initial/conflict rollback/duplicate/disable/syntax。

### 6.1 Lead 接线步骤

1. **移除 index.ts 现有硬编码** `globalShortcut.register('Control+Alt+P', ...)`；否则 HotkeyManager 再注册 `photo` 会因同应用占用失败/重复。
2. app ready、settings.load 后创建：
   ```ts
   const hotkeys = new HotkeyManager({
     logger,
     onAction: (request) => {
       // main-owned: togglePet/photo/settings；其余 sendAction(request)
     }
   })
   const hotkeyResult = hotkeys.registerAll(settings.get().hotkeys)
   if (!hotkeyResult.ok) logger.warn(`hotkeys not fully registered: ${...}`)
   ```
3. `before-quit`：`hotkeys.unregisterAll()`（platform 的 tray/peek cleanup 之后或之前均可；不要 `globalShortcut.unregisterAll` 覆盖其他模块）。
4. settings v2 保存 hotkeys 后（后续设置 UI）：`hotkeys.apply(updated.hotkeys)`；失败时回滚并给设置页错误状态。
5. 动作未实现前建议把对应 `hotkeys` 设为 null 或只注册已实现表，避免用户按键无反应；`DEFAULT_HOTKEYS` 当前全非空，接全量前先确认 behavior/interaction 的 ActionId 支持范围。

---

## 7. 验证结果

### 7.1 自动检查

```powershell
cmd /c "node_modules\.bin\electron-vite.cmd build"
# exit 0；main 12 modules / ~38.7 kB，preload 3 modules / ~5.0 kB，
# renderer 40 modules / 933.13 kB

cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
# exit 0

cmd /c "node_modules\.bin\vitest.cmd run"
# Test Files 5 passed (5)
# Tests 50 passed (50)
# exit 0
```

QA 已更新 `tests/settings.test.ts` 并新增 `tests/settings-v2.test.ts`（16 个迁移/夹紧用例）；platform 未改 tests。此前旧 v1 断言的 2 个临时失败已随 QA 更新消除。

### 7.2 临时脚本验证（不写入 tests）

- v1 fixture（size/volume/nickname/photoDir/autostart=false）→ version2、原字段保留、autostart 仍 false、hotkeys 默认；文件被写成 v2。
- v1 缺 autostart → false。
- 无文件新装 → autostart true、v2 默认。
- v2 显式 autostart=false → 保持 false。
- future version 3 / 坏 JSON → corrupted。
- HotkeyManager mock：initial 注册、occupied 冲突回滚、重复 accelerator 拒绝、全 null 注销、语法校验全部通过。

### 7.3 未做/需实机或后续

- 设置 UI/向导、autostart 系统注册、hotkeys 编辑器 UI、安装包：未做。
- 未启动 GUI；未重启用户实例；未安装依赖。
- `IPC_CHANNELS.action` 的 main→renderer 发送点/handler、walk pause handlers 需 Lead 接；接后需实机验证：
  1. behavior 调 `setWalkPaused(true)` 时宠物停走、窗口不移动，sleep/peek/拖拽/关闭仍正常；
  2. resume 后 3–8 分钟内恢复懒走路；
  3. `onAction` 收到 `{id, source}`，无效 id/source 被 preload 丢弃；
  4. HotkeyManager 注册默认快捷键后按 `Ctrl+Alt+P` 触发一次；旧硬编码注册已移除；冲突时设置页/日志能看到 rollback；
  5. 旧 settings v1 升级后 autostart 不被强制改 ON，size/volume/nickname/photoDir 保留。

---

## 8. 已知风险

1. **测试**：QA 已更新旧 settings 断言并新增 v2 迁移测试；当前 vitest 50/50 绿。后续再改 schema 需同步 QA。
2. **Hotkey 全量默认**：`DEFAULT_HOTKEYS` 10 个动作全非空；接 HotkeyManager 时若未实现 action，按键会无效果；建议先只注册已实现动作或空值。
3. **重复注册**：index.ts 旧 `Ctrl+Alt+P` 必须移除，否则 photo 注册失败。
4. **性能字段消费**：behavior 已用 `performanceMode` fallback；settings UI 尚未暴露；`activityLevel/randomActions/sleep*/actionSounds/closeSign/fullscreenPeek/peekFrequency` 需对应 behavior/interaction/platform 后续消费。
5. **walk pause 不持久化**：符合预期；不要把它当设置字段。
6. **preload API 必选**：behavior 的 `PetApiWithActions` 已同步修掉可选 `onAction`；其他自定义 PetApi 扩展需同样处理。

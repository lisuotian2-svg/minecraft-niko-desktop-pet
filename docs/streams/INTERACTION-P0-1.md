# INTERACTION-P0-1 — 手势竞态修复 + Renderer 动作总线

> 任务：task-6（P0-a）· interaction-dev · 2026-10-21
> 范围：只改 `src/shared/gesture.ts`、`src/renderer/gestures.ts`、`src/renderer/interaction-actions.ts`、`tests/gesture.test.ts`、本文件。
> 未改 `pet.ts`、`main/`、`preload`、`settings`、`animator.ts`、`audio.ts`；未启动可见 GUI，未杀/重启用户实例。

## 1. 完成项

| 项 | 状态 | 证据 |
|---|---|---|
| INT-P0-01 早期抖动不再永久取消长按 | ✅ 代码 + 测试 | `src/shared/gesture.ts`：去掉 `movedOutsideSlop`，在 250 ms 门用当前位置决策；`tests/gesture.test.ts` |
| INT-P0-02 `longPressMs` 真接线，派生 1.5/2.4/3.0 | ✅ 代码 + 测试 | `GestureTiming`、`longPressMs + 900ms`、`longPressMs + 1500ms`；renderer 单 timeout 链 |
| INT-P0-03 renderer 动作白名单/gate/bus | ✅ 代码 + 测试 | `src/renderer/interaction-actions.ts` |
| INT-P0-04 火把状态/定时器清理 | ⚠️ 控制器完成，**pet.ts 尚未接线**（不在我的写权限） | `TorchController` + 6 个测试；接线步骤见 §4 |
| 旧测试回归 | ✅ 34/34 通过（gesture 25，其余 9） | `node_modules\.bin\vitest.cmd run` |
| 构建/类型检查 | ✅ `electron-vite build` + `tsc --noEmit` 通过 | 见 §6 |

## 2. INT-P0-01：早期抖动

根因：旧 `GestureMachine.move()` 在 250 ms 内只要 >5 px 就永久置 `movedOutsideSlop=true`，`tick()` 因此在 1.5 s 不切火把，后续 gathering/close 全部不可达；1.5 s 后松手也不补 click。

新语义：

- 250 ms 门内移动只更新 `lastX/lastY`，不永久取消。
- 门到点（250 ms）时按**当前位置**决策：
  - 仍在 5 px 内 → 保持 pressed，1.5 s 切火把，继续 2.4 s / 3.0 s；
  - 已超过 5 px → 直接 `dragStart`，不必再等一次 pointermove。
- 1.5 s 后移动仍不进入拖拽（保持关闭计时），符合原 PRD。
- 用 `nextDeadline(now)` 返回 250 ms 门/火把/聚粒子/关闭的绝对时间，renderer 只维护一条 timeout 链；不再有第二份 `[1500,2400,3000]`。

测试覆盖：早期抖 8 px 后回到 2 px → 1.5 s 火把、2.4 s gather、3.0 s close；抖 8 px 不回 → 250 ms dragStart；旧边界/取消/1.5 s 后移动全部保留。

## 3. INT-P0-02：longPressMs

- `GestureTiming`：`longPressMs`（设置 1000–2000）、`dragDelayMs=250`、`gatherOffsetMs=900`、`closeOffsetMs=1500`、`slopPx=5`。
- `GestureMachine` 构造或 `setTiming()` 接受配置；`torchDelayMs = longPressMs`、`gatherDelayMs = longPressMs+900`、`closeDelayMs = longPressMs+1500`。
- `PetGestures` 现在会：
  - 在构造时 `api.getSettings()` 读取 `longPressMs`；
  - 订阅 `api.onSettings`（与 pet.ts 的订阅并存，幂等）；
  - 提供 `setLongPressMs()` / `setTiming()` 给 pet.ts 显式调用；
  - 若设置中的值在按住期间改变，会重排当前 timeout。
- 默认仍是 1500/2400/3000；设置改成 2000 → 2000/2900/3500。

## 4. INT-P0-04：火把状态/定时器

`src/renderer/interaction-actions.ts` 新增 `TorchController`：

- `lastAutoAt = -Infinity`，修复冷启动前 10 分钟不 auto。
- `darkEdge` 只在“亮→暗”时武装；手动关火把后不立刻重开，必须等亮度回阈值以上再变暗。
- `setHidden(true)`、`setClosing(true)`：清 auto timer、熄灭、手动/自动状态复位，**静音**；隐藏期间 `setBrightness()` 不触发 auto。
- `restore()`：隐藏/关闭后默认熄灭，等待新的亮度事件；不会把旧火把状态带回来。
- `toggleManual()` 与自动互斥；自动开始/结束有声音，隐藏/关闭无声音。
- 自动时长默认 12–18 s，冷却默认 10 min（`lastAutoAt` 只在真正触发后计时）。
- 注入 `TorchScheduler`，测试可在不启 GUI 的情况下验证定时器。

**重要**：该控制器还没有被 `pet.ts` 使用，因为 task-6 禁止改 `pet.ts`。当前线上/构建的 pet.ts 仍用旧模块级 `torchOn/manualTorch/autoTorchTimer/lastAutoTorchAt`，所以：

- 单测层 INT-P0-04 已完成；
- **端到端（G1）仍需要 Lead/behavior 在 pet.ts 接控制器**，否则隐藏/关闭后的火把残留仍在真实桌面上存在。

建议接线（behavior/Lead）：

```ts
const torchController = new TorchController({
  settings: { autoTorch: settings.autoTorch, darkThreshold: settings.darkThreshold },
  port: {
    applyVisual: (on) => { torch.setOn(on); animator.setTorchOn(on) },
    playSound: (on) => audio.torch(on),
    isBusy: () => gestures.isPressed || gestures.isClosing || eating || document.hidden
  }
})
// api.onBrightness -> torchController.setBrightness(value)
// api.onSettings   -> torchController.setSettings(settings)
// document.visibilitychange -> torchController.setHidden(document.hidden)
// closePet() 开头 -> torchController.setClosing(true)
// api.onRestored -> torchController.restore()
// 手势 toggleTorch / 动作 torch -> torchController.toggleManual()
// 删除 pet.ts 的 torchOn/manualTorch/autoTorchActive/autoTorchTimer/lastAutoTorchAt/maybeAutoTorch/clearAutoTorch
```

## 5. Renderer 动作总线

文件：`src/renderer/interaction-actions.ts`

- 白名单来自 frozen `contracts.ts`：`ActionId` 共 10 个，不自定义新 id。
- `RENDERER_ACTION_IDS`：`pet`、`feed`、`torch`、`dance`、`wave`、`sleep`、`wake`。
- `SYSTEM_ACTION_IDS`：`togglePet`、`photo`、`settings`，由 main 执行；`performAction()` 对它们返回 `{ok:false, reason:'system-action-delegated'}`，不会伪装成功。
- `performAction(request: ActionRequest): ActionResult`：
  - 校验 id/source；
  - gate：hidden / frozen / fullscreenPeek / gesture / closing / busy / sleep-wake / feed-social-torch 模式 / manual-torch；
  - 最后询问 behavior 的 `canRun()`；`perform()` 返回 false 时给 `behavior-rejected`，抛错给 `behavior-error`；
  - **每个分支都返回 ActionResult**，不靠日志表达拒绝，也不上屏文字。
- `ActionHostPort` 是 behavior 唯一需要实现的接口：
  - `getState()`（`BehaviorMode`、gesturePhase、activeAction、torch 状态等）；
  - `canRun(id)`（behavior lock）；
  - `perform(id)`（返回 `boolean | void`）；
  - `cancel(reason)`（手势/拍照/关闭抢占）。
- `isBusy()` 给自动行为/随机动作使用；`cancel('gesture')` 由 `PetGestures.onGestureStart` 调用。
- 导出 `ACTION_PRIORITY`（system/state/explicit）、`actionLabel()`（设置/托盘用的短标签，不画到桌宠画布）。
- 手势互斥钩子：`GestureEffects.onGestureStart?()` 在 pointerdown 生效时调用，pet.ts 可接 `actions.cancel('gesture')`。

### 5.1 动作 → animator/behavior 映射（接线建议）

| ActionId | 执行 |
|---|---|
| `pet` | `animator.pet()`（已返回 boolean） |
| `feed` | `pet.ts` 的 `eat()`（已返回 boolean） |
| `torch` | `torchController.toggleManual()` |
| `dance` / `wave` | behavior 新增方法；当前 `BehaviorMode` 没有 dance/wave，需 behavior/Lead 决定用 `activeAction` 或扩展 frozen 契约 |
| `sleep` / `wake` | behavior 的 sit/doze/sleep/wake 状态机；`sleep` toggle，`wake` 只从 sleep/doze 唤醒 |
| `photo` / `settings` / `togglePet` | main；**按用户决定，`togglePet` 只负责找回/显示，隐藏只走长按关闭** |

## 6. 验证

```powershell
cmd /c "node_modules\.bin\vitest.cmd run"          # 34/34 tests passed
cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"  # pass
cmd /c "node_modules\.bin\electron-vite.cmd build && node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"  # pass
```

测试文件：`tests/gesture.test.ts`（25 项）覆盖：
- 旧 8 项手势时序（其中 1 项原先固定“抖动即取消”的 bug，已替换为两个 INT-P0-01 用例）；
- 配置化 1000/2000 ms、`nextDeadline`；
- 动作 gate（system 委派、hidden/frozen/peek/gesture/closing、sleep/wake/feed、manual-torch、canRun、behavior-rejected/error）；
- `TorchController`（冷启动、隐藏、手动关后新暗边沿、关闭定时器清理、忙时重试、手动开关）。

## 7. 需要 Lead / behavior 接线（G1 前）

1. **pet.ts**：
   - 接 `TorchController`（见 §4），替换旧火把状态/定时器；
   - 创建 `InteractionActions`，实现 `ActionHostPort`（animator/behavior 状态、`eat()`、`torchController.toggleManual()`、可用的 dance/wave/sleep/wake）；
   - 在 `GestureEffects` 加 `onGestureStart: () => actions.cancel('gesture')`；
   - 把 `performAction` 暴露给 `pet:action` 监听/调试 API。
2. **behavior**：
   - 补 `dance`/`wave`/`sleep`/`wake` 动作（或明确复用现有 mode）；
   - 补 `isFrozen`/`activeAction`/`mode` 的公开读取（animator 已有 `behaviorMode`、`isExclusiveAction`，但 `isFrozen` 仍是私有）；
   - 决定 `canRun` 的细粒度锁（feed 需站立、sleep 需空闲等）。
3. **Lead/main**：
   - `pet:action` 发 `ActionRequest`；system actions（photo/settings/togglePet）不要下发给 renderer；
   - `togglePet` 按用户决定只显示/找回；隐藏只保留长按关闭（现有托盘“隐藏 Niko”菜单是否保留需 Lead 定）；
   - 生产可用的 walk pause（当前 `stopWalk` 是 debug-only）；hotkey `feed` 若希望在走路时自动停下，需要它；
   - 全局快捷键注册/冲突反馈不在本任务范围。
4. **QA**：真机验证手抖后长按、250 ms 拖动、配置 2.0 s、关闭/托盘隐藏后的火把、隐藏期间 auto 不出声、hotkey 动作与手势互斥；本任务无 GUI 验收。

## 8. 已知缺口/风险

- **INT-P0-04 尚未端到端**：`TorchController` 未被 pet.ts 引用，真实桌面上旧的 pet.ts 逻辑仍在；这是本任务最大剩余项。
- `BehaviorMode` 没有 `dance`/`wave`；动作总线支持 id，但 behavior 需要决定 `activeAction` 表示法或由 Lead 扩展契约。
- 当前 pet.ts 由 behavior 并行改动，`interaction-actions.ts` 未接入构建入口；G1 集成后需重跑 build。
- 未改 settings 页：`longPressMs` 已由 `PetGestures` 自动读取/订阅，设置 UI 归 platform/Lead。
- 未做全局快捷键注册、托盘菜单 action、walk pause；按任务边界留给 Lead/platform。
- 桌面无文字：动作拒绝只返回 ActionResult / 日志，没有 UI 文案。

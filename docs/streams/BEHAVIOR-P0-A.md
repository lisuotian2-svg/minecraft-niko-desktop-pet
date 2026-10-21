# BEHAVIOR-P0-A — 行为视觉 P0-a 实现报告

> 任务：task-7（P0-a）· behavior-dev · 2026-10-21
> 范围：只改 `src/renderer/animator.ts`、`src/renderer/pet.ts`、`src/renderer/snacks.ts`、`src/renderer/audio.ts`、本文件。
> 未改 `src/main/**`、`src/preload/index.ts`、`src/shared/settings.ts`、`gestures.ts`、`torch.ts`、`particles.ts`；未启动可见 GUI，未杀/重启用户实例。
> 前置：`docs/COMMANDER-BRIEF.md`、`docs/streams/BEHAVIOR-AUDIT.md`、`docs/streams/INTERACTION-P0-1.md`、`src/shared/contracts.ts`。
> 最新用户决定（优先于旧审计“连续看鼠标”）：**只有点击宠物后的 2s 内看鼠标**；其余时间自由待机；走路不看鼠标；全屏探头同规则（task-10 设计，不在本任务实现）。

---

## 1. 完成摘要

| 项 | 状态 | 说明 |
|---|---|---|
| 单一 action lock / `BehaviorMode` | ✅ | `animator` 内单一 `mode`；eat/stretch/pet/drag/close 互斥；点击、随机面包、随机伸懒腰不再叠加 |
| 禁止边吃/边伸懒腰滑行 | ✅ | walk 开始时取消 eat/stretch；随机动作只在非行走时启动；不再依赖 debug `stopWalk` |
| 走路同步（去 6x 滑步） | ✅ | 腿摆 0.52→0.18 rad；步频按窗口速度/像素比例动态计算；默认约 1.35 步/s，脚相对步长约 29.5px，匹配 40px/s |
| 头部 pitch 符号 + 安全钳制 | ✅（数学确认，CDP 待 Lead） | 修正为“光标在上→抬头”；保留 ±60° 输入范围，渲染头 pitch 限制 0.72 rad（约 41°），加 0.35·|sin| 抬升 |
| 2s click-look | ✅ | 点击/`pet` 起始设置 `cursorLookUntil = now + 2000`；2s 内头先看鼠标，必要时 360° 最短路径转体 + 脚 shuffle；2s 后自由待机 |
| 自由待机 | ✅ | 随机 glances/呼吸/眨眼；偶发 ±20° 小转体（约 10–20s 一次，35%），不做连续 360 |
| 走路不追鼠标 | ✅ | walking 时 head local yaw/pitch 目标为 0；body 保留 0.28/-0.45 yaw |
| 非 idle 状态不追鼠标 | ✅ | eat/stretch/drag/pet 的 action pose 优先；walking 也不追 |
| 摸头反馈 | ✅ | 程序化 purr（无新资产）、3 hearts、身体侧倾/下沉、慢摆、1.5s 冷却；不吃/不睡/不拖拽 |
| 接触阴影 | ✅ | 独立 2D canvas 在 WebGL 之下；随压扁/跳跃/拖拽缩放；normal/gorgeous 默认开，simple 关（performanceMode 由 platform 后补） |
| TorchController 接线 | ✅ | 删除旧 `torchOn/manualTorch/autoTorchTimer/lastAutoTorchAt/maybeAutoTorch`；隐藏/关闭静音熄火、恢复不残留 |
| InteractionActions 接线 | ✅ | `ActionHostPort`、`onGestureStart` cancel、`pet`/`feed`/`torch` 动作；system actions 留给 main；dance/wave/sleep/wake 明确 P0-b |
| 生产 walk pause 接口 | ⚠️ renderer 半实现 | `animator.setWalkPosePaused()` + task-11 preload `setWalkPaused()`；main handler 仍待接，见 §6 |
| 测试/构建 | ✅（集成期） | build 0、tsc 0；vitest 32/34（2 个 `settings.test.ts` 期望值落后于 task-11 settings v2，归 platform/QA，不是 renderer）；未跑 GUI/CDP |

---

## 2. 行为仲裁（single action lock）

### 2.1 设计

- `PetAnimator` 持有唯一 `mode: BehaviorMode`（来自 `shared/contracts.ts`）。
- 可启动动作：`idle`/`walk`；`eat`、`stretch`、`pet` 为 exclusive；`drag`、`close` 由手势/关闭路径强制写入。
- 优先级：`close > drag > photo freeze > action`；eat/stretch/pet 互相拒绝；点击在 eat/stretch 期间不再叠加。
- `animator.pet()`、`stretch()`、`eat()` 返回 `boolean`；调用方必须检查。`activeAction` 暴露 `pet`/`feed`，`isFrozen` 暴露 photo freeze，`isExclusiveAction` 暴露给 torch/action gate。
- 事件：`onEvent({type:'pet'})`（触发 purr/hearts）、`onEvent({type:'cancelled', action})`（pet.ts 隐藏面包等道具）。
- **walk 开始的安全策略**：main 没有生产 pause IPC 时，若 eat/stretch 正在播放，`setWalking(true)` 取消该动作，避免窗口移动而角色滑行。随机 eat/stretch 只在 `!walking` 且 `canStartScheduled()` 时启动。
- **点击语义**：单击（gesture 的 click，长按不算）触发 `pet()`；2s look window 仅在 `pet()` 成功时设置。hotkey 的 `pet` action 也走同一路径（但不冒充鼠标点击；Q4 入口仍由 action bus 决定）。

### 2.2 关键代码点

- `animator.ts`：`behaviorMode`、`isFrozen`、`activeAction`、`isExclusiveAction`、`canStartScheduled()`、`cancelAction()`、`setClosing()`、`resetBehavior()`。
- `pet.ts`：`actionPort` + `InteractionActions`；`onGestureStart: actions.cancel('gesture')`；旧 torch 状态已由 `TorchController` 接管。
- 随机调度：`scheduleSnack/scheduleStretch` 检查 `walking`、`torchController.isOn()`、gesture pressed/closing、`animator.canStartScheduled()`。
- 关闭/恢复：`closePet` → `animator.setClosing(true)` + `torchController.setClosing(true)`；`onRestored` → `torchController.restore()` + `animator.resetBehavior()`。

---

## 3. 走路同步（去 6x 滑步）

### 3.1 参数与公式

旧实现：腿摆 ±0.52 rad、步频固定 3.1 步/s；窗口 40px/s。按 220px 宠物/32 model units ≈ 6.875 px/unit：

- 旧脚相对步长 ≈ `2 × 12 × sin(0.52) × 6.875 ≈ 82px/半步`；
- 窗口每半步只走 `40 × 0.3226 ≈ 12.9px`；
- 滑步约 6 倍。

新实现：

- `WALK_LEG_SWING = 0.18 rad`；`WALK_ARM_SWING = 0.30`；
- `pixelsPerUnit` 从 camera 投影实时算；
- `stepFrequency = walkSpeed(viewer.width) / (2 × 12 × sin(0.18) × pixelsPerUnit)`；
- 420px 默认：步长约 **29.5px**，步频约 **1.35 step/s**，窗口每步 40/1.35≈29.6px，基本 1:1；
- clamp 0.8–3.2 step/s，适配 80/220/500px；`walkSpeedOverride` 可供未来 `pet:walk:speed` 更新。
- 脚 shuffle（idle 转体）**不触发 footstep**；只有 walking 的 gait 跨 π 才触发脚步音。

### 3.2 仍存在的平台限制

- main 行走仍 30fps；默认 40px/s 时约 1.33px/帧，肉眼可接受；若 future 提速到 80–110px/s，建议 main walking tick 60fps（见 §6 IPC 请求）。
- 本次没有改 main，保留现有 `walkSpeed()`；如果 Lead 改成 60fps/更高速度，renderer 用同一 `walkSpeed` 会自动重算，但最好同时加 `pet:walk:speed` 或更新 `shared/walk.ts`。

---

## 4. 头部安全 + pitch 符号

### 4.1 符号数学确认（无 GUI）

使用项目内 `three` 做 `Euler(x,0,0)`：

```
+20°  front.y=-0.34  bottom corner y=-1.37
+40°  front.y=-0.64  bottom corner y=-2.57
+60°  front.y=-0.87  bottom corner y=-3.46
-40°  front.y=+0.64  bottom corner y=+2.57
```

结论：**+rotation.x = 低头（front 朝下）**；旧代码把“光标在上”映射为正 pitch，方向是反的。现已改为：

```ts
cursorPitch = clamp((cursorY - centerY) / gazeRangeY, -1, 1) * MAX_GAZE_PITCH
```

光标在上 → 负 → 抬头；光标在下 → 正 → 低头。

### 4.2 安全范围

- 输入/目标仍保留 `MAX_GAZE_PITCH = 60°`；
- 实际渲染 `HEAD_PITCH_LIMIT = 0.72 rad ≈ 41.3°`，并 `head.position.y += 0.35·|sin(pitch)|`；
- 41.3° 时头底角仍会下探约 2.6 units（完全消除需要 gap 或 neck mesh，见 §9）；当前目的是把极端 60° 的 3.46 units 插胸降到安全可接受，并保留 60° 输入/后续调试空间。**Lead/QA 必须用 CDP 截 head 上/下极限各一张确认没有明显下巴穿胸。**
- Head local yaw ±55°；pitch 输入 ±60°；head yaw 仍是 3/4 视角基础。

### 4.3 CDP 验证步骤

```js
window.__niko.getState().headRotationX   // 光标在窗口上/下各截一帧：应为负/正
window.__niko.getState().headRotationY
window.__niko.getState().headPitch       // 内部目标，可到 ±60
```

---

## 5. 2s click-look + 360° 最短路径转体（最新用户决定）

### 5.1 语义

- **只有** `animator.pet()` 成功（单击宠物 / pet action）时设置 `cursorLookUntil = now + 2000ms`。
- 2s 内且 `!walking`、mode 为 `idle`/`pet`（即不在 eat/stretch/drag/close）：
  - 头先快速转向鼠标：`HEAD_TURN_TAU=0.10s`；
  - 若光标方向超出 head local ±55°，body 以最短角路径转向光标：`BODY_TURN_TAU=0.34s`（180° 95%≈1.0s，落在 0.8–1.2s）；
  - body 转向时脚交替 shuffle（±0.06 rad）与身体侧倾（0.035），**不触发 footstep 音效**；
  - 允许 360°（back/side-back 短暂出现）。
- 2s 后：
  - 不再看鼠标；`cursorLookUntil` 过期；
  - body 缓慢回到默认 3/4 yaw（`IDLE_YAW=-22.5°`）；
  - head 回到自由 idle 的随机 glance（±0.18 rad，3.5–6.5s）+ 呼吸/眨眼；
  - 自由 idle 只做偶发小转体：±20°（0.35 rad），10–20s 间隔、35% 概率，持续 2.5–5.5s；不做连续 360。
- 走路：
  - `headRotationY/Pitch` 目标 0（head neutral）；
  - body 仍用 0.28/-0.45 yaw；完全不看鼠标。
- eat/stretch/drag/close/sleep/doze/peek/wake：
  - 不追鼠标；action pose 优先；回到 idle 后（下一次 click 才重新 2s 窗口）才可能看鼠标。
- 长按不是 click；不会设置 2s 窗口。
- 全屏探头（task-10）：**点击头部后同样只 2s 看鼠标**；未实现，接口见 §7。

### 5.2 最短路径实现

```ts
normalizeAngle(a) = atan2(sin a, cos a)
shortestAngle(from, to) = normalizeAngle(to - from)
```

- 所有 bodyYaw 每帧 normalize 到 (-π,π]，不会越转越大；
- 正后方 ±π 用 `bodyTurnSign` latch（| |delta|-π | < 0.12 时保持原转向），避免正后方抖动/反向；
- head 目标 `clamp(bodyDelta, ±55°)`；body 目标只在头不够时启用，body 朝向光标，head 先达到极限、body 跟随；
- Node 验证：

```
front 0°       shortest 0.0°
right +90°     shortest 90.0°
back +180°     shortest 180.0°
left -90°      shortest -90.0°
wrap 179→-179  shortest 2.0°
body 95% 180°  1.02s
```

### 5.3 调试字段

`window.__niko.getState()` 新增/保留：

- `bodyYaw`、`bodyTurning`、`cursorLooking`；
- `headYaw`、`headPitch`（内部目标）、`headRotationX/Y`（实际渲染）；
- `walkStepFrequency`、`behaviorMode`。

CDP 验收剧本见 §8。

---

## 6. 摸头反馈、接触阴影、TorchController、InteractionActions

### 6.1 摸头反馈

- `PetAnimator.pet()`：2500ms，eyes closed 850ms，1.5s 冷却；慢摆 0.76Hz（旧 1.9Hz 过快）；body side lean/down；head y 抬 0.16。
- 事件 `pet` → `PetAudio.purr()` + `SnackParticles.hearts(headOrigin())`（头部 3D 投影，不是固定 52%）。
- `purr()` 是 **程序化 WebAudio**（低频 brown noise + 23Hz tremolo）；不新增资产。真实 MC `purr1–3` 已在磁盘，但不在冻结 `AssetName` 白名单；Lead/platform 接入后可替换。
- 不吃/伸/拖时点击被 lock 拒绝；walking 时可 pet overlay（走路继续），不造成滑行。

### 6.2 接触阴影

- `snacks.ts` 新增 `ContactShadow`：独立 canvas，插入 `#pet` 之前，`z-index:0`；`#pet` 在 pet.ts 里设为 `position:relative;z-index:1`；snack 粒子仍 z-index 9。
- 每帧由 `animator.onFrame` 更新；脚底位置用 3D 投影 x + 窗口 88.5% ground line；5 条硬边像素带，深色低透明度；随 `playerObject.scale`、`wrapper.position.y`（跳跃/落地）、drag 缩放/淡化。
- photo freeze 时 animator 停止发帧 → 阴影保持冻结；关闭/隐藏时隐藏。
- performanceMode（platform 后续字段）通过 `PERFORMANCE_PRESETS` 读取：`simple` 关，`normal`/`gorgeous` 开；未提供字段时默认 normal。
- 不启用 3D shadow map，避免透明窗黑矩形与性能成本。

### 6.3 TorchController（INT-P0-04 端到端）

`pet.ts` 已删除旧 `torchOn/manualTorch/autoTorchTimer/lastAutoTorchAt/maybeAutoTorch/clearAutoTorch`，使用 `interaction-actions.ts` 的 `TorchController`：

- `applyVisual`：`torch.setOn` + `animator.setTorchOn`；
- `playSound`：`audio.torch`；
- `api.onBrightness` → `setBrightness`；
- `api.onSettings` → `setSettings`；
- `document.visibilitychange` → `setHidden(document.hidden)`；
- `closePet` → `setClosing(true)`；`onRestored` → `restore()`；
- 手势/action `toggleTorch` → `toggleManual()`；
- `isBusy`: gesture pressed/closing、eating、document.hidden、animator exclusive → auto 不触发。
- 保留行为：暗处自动 12–18s、10min 冷却、手动优先、隐藏/关闭静音熄火、restore 不残留。
- `getTorchController()` debug 暴露 `{on,manual,auto,hidden,closing,dark,lastAutoAt}`。

### 6.4 InteractionActions（task-6 总线）

`pet.ts` 创建 `InteractionActions`，实现 `ActionHostPort`：

- `getState`: `hidden/frozen/fullscreenPeek/gesturePhase/closing/mode/activeAction/torchOn/torchManual`；`fullscreenPeek` 暂 false，task-10 接。
- `canRun`:
  - `pet`: mode idle/walk/pet；
  - `feed`: !walking、mode idle/walk、torch off；**当前复用现有面包 eat()**，正式 hand-feed 是 P0-b；
  - `torch`: 非 exclusive；
  - `dance`/`wave`/`sleep`/`wake`: 明确返回 false（P0-b，不伪造成功）。
- `perform`: `pet`→`animator.pet()`；`feed`→`eat()`；`torch`→`toggleManual()`；其他 false。
- `cancel('gesture'|'close')` → `animator.cancelAction()` + `hideEat()`；`onGestureStart` 已接。
- system actions（`photo`/`settings`/`togglePet`）由 main 执行，bus 返回 `system-action-delegated`；`togglePet` 只找回/显示，绝不隐藏。
- **监听**：task-11 已把 `PetApi.onAction(cb)` 设为必选并桥接 `pet:action`；`pet.ts` 直接注册并转发 `actions.performAction(request)`，生产已生效（system actions 不应下发）。

### 6.5 生产 walk pause（renderer 半）

- `animator.setWalkPosePaused(paused)`：暂停 walkBlend/gait；`pet.ts` 的 `setProductionWalkPaused()` 调用 task-11 已提供的 `PetApi.setWalkPaused(paused)`，后者 invoke `pet:walk:pause` / `pet:walk:resume`；main handler 仍需 Lead 接线。
- 由于 main 仍拥有窗口移动，**只用 renderer pause 会滑行**；所以在 main IPC 落地前：
  - 随机 eat/stretch 禁止在 walking 时开始；
  - walking 突然开始会取消正在进行的 eat/stretch；
  - pet overlay 允许 walking，保持步态，不滑行。
- exact main IPC 见 §7。

---

## 7. 需要 Lead/platform 的接口（精确请求）

### 7.1 生产 action bus

task-11 preload 已提供：

```ts
// PetApi（必选）
onAction(callback: (request: ActionRequest) => void): () => void
```

- 主进程 → renderer 使用 `IPC_CHANNELS.action`（`pet:action`），payload 必须是 `ActionRequest`；
- system actions（photo/settings/togglePet）由 main 自己执行，**不要发给 renderer**；
- renderer 端已直接注册，生产生效；如 main 尚未发送，先不要宣称快捷键已验收。

### 7.2 生产 walk pause

task-11 preload 已提供：

```ts
setWalkPaused(paused: boolean): Promise<void>
```

主进程建议通道：

```text
pet:walk:pause   (renderer -> main)  // 或 pet:walk:set-paused(true)
pet:walk:resume  (renderer -> main)  // 或 pet:walk:set-paused(false)
```

`PetWindowController` 需要：

- `pauseWalk()`：停止 auto walk / 当前走路 timer，记录暂停起点；
- `resumeWalk()`：恢复原计时（加 pausedFor），不立刻走；
- 与 `stopWalk()` 区别：`stopWalk` 是 debug-only，生产不可用；
- 若 walking tick 提速，顺便提升到 60fps。

renderer 已接 `setWalkPaused` 的调用点（debug `setWalkPaused` / 未来 action 流程）；main handler 仍未实现，因此当前 `canRun` 仍会在 walking 时拒绝 feed，以保证 G1 不滑行。

### 7.3 其他

- `performanceMode` 字段并入 settings/schema v2，广播到 renderer；`normal` 默认。当前 `pet.ts` 用可选 cast 读取，没有字段时 normal。
- `purr1–3` / `meow1` 可加入 IPC/preload/audio 白名单；当前程序化 purr 可独立演示。
- 主进程 walking tick 60fps（若行走进度提速）。
- 全屏 peek/告示牌接口（task-10）见 §9。

---

## 8. 验证

### 8.1 自动检查（本机 direct binaries）

```text
electron-vite build   exit 0
  main 74.02 kB / preload 5.90 kB / renderer 926.29 kB, 375ms
tsc --noEmit          exit 0
vitest run            exit 1, 4 files / 32 passed, 2 failed
```

> `vitest` 的 2 个失败来自 `tests/settings.test.ts` 仍按 v1 默认值断言（期望 `version:1/autostart:false`；task-11 已改为 v2/autostart:true，并迁移 v2 size=300）。这是 schema v2 迁移的测试更新项，归 platform/QA，不是 renderer 代码失败；其余 32 项通过。

### 8.2 已做的静态验证

- 3D Euler 数学：pitch 符号与 head 底角下探量（§4.1）；
- shortest-angle 数学：0/±90/180/wrap 及 95% 时间（§5.2）；
- 步长/步频：420px 默认约 29.5px/step、1.35 step/s（§3.1）。

### 8.3 Lead/QA CDP 验收剧本

1. **pitch**：窗口内鼠标移到宠物上方/下方，`getState().headRotationX` 应为负/正；各截图一张。
2. **2s look**：单击宠物 → 立刻记录 `cursorLooking=true`；移动鼠标绕宠物 8 个方位；1s 内 `bodyYaw` 走最短路径，`headRotationY` 不超 ±55°；2.2s 后 `cursorLooking=false`、body 回默认/小转体、head 随机 glance。
3. **360/夹缝**：鼠标置于正后方，记录 body 转向方向保持同一 sign，不来回抖；跨 ±180° 时 `bodyYaw` 归一化无 >360 累积。
4. **walking**：`forceWalk(1)`；移动鼠标，`headRotationY≈0`、`behaviorMode='walk'`、bodyYaw≈0.28；`forceWalk(-1)` bodyYaw≈-0.45；`stopWalk()` 后 2s 内不自动追鼠标（除非再点击）。
5. **arbitration**：`stretch()` 期间 `pet()` 返回 false；`eat()` 期间 `stretch()` 返回 false；walking 时 `eat()` 返回 false；`drag` 可取消 action。
6. **pet feedback**：单击，检查 purr 音、3 hearts、body 侧倾、1.5s 冷却；截图。
7. **torch**：手动 `toggleTorch`；隐藏到托盘再显示 → 火把不残留、无音；关闭再恢复同样；暗处自动火把 12–18s。
8. **action bus**（Lead 接入 preload 后）：`__niko.performAction({id:'pet',source:'hotkey'})` 返回 ok；`feed` 在 walking 时返回 behavior-lock；`dance/sleep/wake` 返回 behavior-lock（P0-b）。
9. **shadow**：浅/深壁纸、80/220/500px、压扁/跳跃/拖拽/close/photo freeze；simple 模式需 platform 字段后复测。

### 8.4 本任务未做的实机验收

- 未启动可见 GUI、未跑 CDP；以上 1–9 需 Lead/QA 在真实桌面执行。
- 未验证 125% DPI 下的阴影/像素对齐（建议 QA）。

---

## 9. Task-10 设计（只接口，不实现）

### 9.1 全屏探头 head-only

- 消费 contracts 的 `FullscreenState`（`active/displayId/edge/phase/windowBounds/headAnchor/revealUntil`）。
- 建议 preload：

```ts
onPeekState(cb: (state: FullscreenState) => void): () => void
revealPeek(): Promise<void>          // 点击头部 -> main 回底部，10s 后允许再 peek
```

- behavior 收到 `phase='peeking'|'revealed'|'hidden'|'returning'`：
  - 取消随机调度、睡眠/动作、音效；`ActionHostState.fullscreenPeek=true`（bus 全部拒绝）；
  - 只显示 head（隐藏 body/arms/legs/props/shadow），头中心对窗口中心；
  - **点击头部后 2s 内看鼠标**（与主界面同规则），其余时间自由头动；点击后调用 `revealPeek()`；
  - `returning`/`normal` 恢复全身与随机计时；不自动进入 sleep。
- 与 platform 的 `pet:display-mode` / `FullscreenState` 对齐；task-5 已有窗口侧，behavior 只做姿态。

### 9.2 关闭告示牌

- 消费 `CloseSignState`（`visible/edge/phase/windowBounds`），建议 preload：

```ts
onCloseSign(cb: (state: CloseSignState) => void): () => void
revealFromCloseSign(): Promise<void> // 点击手/牌 -> 显示宠物
```

- 关闭流程：紫色粒子 3.0s 后（用户决定 2.5s 后）由 main 发 sign；renderer 隐藏身体，只露 hand + English sign `I'M IN THE TRAY`，从 left/right/bottom 边缘进入；不显示 body；点击牌/finish -> 显示宠物。
- 这是用户明确批准的桌面文字例外（英文告示牌）；除此之外桌宠画布仍无文字/气泡。
- 渲染方式建议 2D overlay（canvas 或 Three sprite）在关闭全屏窗口内；需要 main 在粒子结束后才发 state，并保持窗口 click-through 直到 sign 可点。

---

## 10. 性能影响

| 项 | 成本 | 备注 |
|---|---|---|
| 接触阴影 | 5 个 fillRect/帧，仅 2D canvas | 简单模式直接关闭；无 3D shadow map |
| 3D 投影 | walking 时 2 次 `localToWorld/project` 算 px/unit；shadow 每帧 1 次投影 | 可忽略；无几何/纹理重建 |
| 2s 转体 / foot shuffle | 纯 sin/角度运算 | 无粒子/音效新增 |
| purr | 每次 pet 创建几个 WebAudio 节点，1.6s 结束 | 不循环、不常驻；muted 时直接返回 |
| 动作锁/事件 | Set 回调每帧最多几个 | 无额外 rAF |
| 旧 auto torch timers | 删除 | 只保留 TorchController 一个 timer |
| 渲染帧率 | 仍 rAF 60fps；main 30fps | 若 walking 提速需 main 60fps |

---

## 11. 已知未完成 / P0-b

- **不实现** sit/doze/sleep/wake 姿态、告示牌、fullscreen peek pose、dance/wave（这些是 P0-b/task-10）。action bus 对这些返回明确 behavior-lock，不伪造成功。
- **手喂面包**（hand_feed）未做；`feed` 暂时复用现有 `eat()` 面包动画。
- **生产 walk pause** 只完成 renderer 半；main/preload IPC 未接（§7.2）。当前通过拒绝 walking 时 eat/stretch 避免滑行。
- **真实 GUI/CDP** 未做；pitch 极限/360 转体/2s 窗口需 Lead/QA 截图验收。
- **真实 purr 资产** 未接；程序化 purr 可演示。
- head pitch 安全 clamp 只能减少、不能数学上完全消除头底角入胸；如 CDP 仍看到明显穿模，下一步是 neck mesh 或把 `HEAD_PITCH_LIMIT` 再降到 ~0.6 rad（P0-b）。
- 自由 idle 小转体是本次新增；尚未经过真机观感验收，若频繁可调低 `IDLE_BODY_TURN_ANGLE`/概率。

---

## 12. 给 Lead 的简报

- **P0-a 完成**：行为仲裁、walk sync、pitch sign/safety、2s click-look + 360 body turn、pet purr/hearts/body feedback、contact shadow、TorchController 端到端、InteractionActions 接线。
- **最新用户语义已落实**：只有点击宠物后的 2s 看鼠标；walking 完全不看鼠标；其余时间自由待机（随机 glances + 偶发 ±20° 小转体，不做持续 360）；fullscreen peek 也预留同样 2s 规则（task-10）。
- **验证**：build 0、tsc 0、vitest 32/34（2 个 settings v2 测试更新项在 platform/QA）；pitch 符号/shortest-angle/步频有数学输出；CDP 剧本在 §8.3。
- **需要 Lead/platform**：`onAction`/`setWalkPaused` preload 已由 task-11 提供；仍需 main 的 `pet:walk:pause/resume` handler、performanceMode 字段、walking tick 60fps、可选 purr1–3 白名单；task-10 的 peek/sign channels。
- **明确 P0-b**：sit/doze/sleep/wake、dance/wave、hand_feed、peek head-only、关闭告示牌、真实资产 purr、pitch 穿模进一步处理。
- **阻塞**：没有代码阻塞；只有接口未冻结和真机验收未做。G1 可以先接 action bus/torch 与当前 renderer；walk pause 在 main IPC 落地前保持“walking 时拒绝吃/伸”的安全兜底。

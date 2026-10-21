# INTERACTION-AUDIT — 互动流只读审计（手势 / 关闭 / 火把 / 拖拽 / 动作快捷键）

> 审计者：interaction-dev（互动流 owner）
> 时间：2026-10-21
> 范围：只读审计现有实现；本文件是唯一写入。没有修改 `src/`、`tests/`、`assets/`、`package.json`，没有启动/重启可见 GUI，没有影响用户正在运行的实例。
> 结论先行：**时序主链能跑通，但有一个可复现的 P0 手势缺陷会让“长按切火把 / 长按关闭”完全失效；`longPressMs` 设置从未被消费；拖拽期间的压扁不回弹；火把状态在关闭/隐藏后残留；自动火把冷启动被错误抑制 10 分钟且手动关闭后没有“新暗边沿”；`particles` 设置没有接线；自定义动作快捷键目前完全没有 renderer 动作接口。** 建议先修手势状态机 + 计时配置（I-1），再落动作接口（I-2/I-4）。按 COMMANDER-BRIEF 的 P0 顺序，当前先做 I-0 探头冲突预研，不抢 P0-1。

---

## 1. 审计方法与本轮基线

### 1.1 已读材料

- `docs/TEAM-HANDOFF.md`、`docs/SKILLS.md`、`docs/PRD.md`、`docs/M2-TASK.md`、`M1-REPORT.md`、`docs/DECISIONS.md`、`docs/ASSETS.md`、AGENTS.md。
- `docs/COMMANDER-BRIEF.md`：**审计开始时不存在的；审计中途出现，已在提交前读取并对齐**。本审计按它校正：动作类型统一用 Lead 冻结的 `ActionId`；不写 `pet.ts`/`main`/设置页；首批动作集合与 Brief 的 Q14 对齐；快捷键默认策略与 Q15 对齐；P0 顺序按 Brief 的 P0-0/P0-1 优先（本审计是接口与缺陷准备，不是抢 P0-1 的实现）。
- 源码：`src/shared/gesture.ts`、`src/renderer/gestures.ts`、`particles.ts`、`torch.ts`、`pet.ts`、`animator.ts`、`audio.ts`、`hit-test.ts`、`viewer.ts`、`src/main/pet-window.ts`、`ipc.ts`、`index.ts`、`tray.ts`、`brightness.ts`、`photo.ts`、`src/preload/index.ts`、`src/shared/settings.ts`、`tests/gesture.test.ts`。

### 1.2 本轮执行的验证（read-only / 不改源）

| 命令 | 结果 |
|---|---|
| `node_modules\.bin\vitest.cmd run` | **17/17 通过**（4 个文件；gesture 8 个） |
| `node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` | 通过，退出码 0 |
| `node --experimental-strip-types` 直接驱动 `GestureMachine` | 复现 P0-1（见 §3.2） |
| `electron-vite build` | 未执行；避免与 QA 流同时写 `out/` 造成竞争。构建验收由 QA 流负责 |

> **基线定位（按 COMMANDER-BRIEF）**：Git `0c8cb8c`（M1）是可回滚锚点；当前未提交的 M2/M3 是**候选基线**，不等于产品验收通过。本审计只描述候选基线代码，不触碰 live `userData`、`settings.json`、照片或正在运行的实例；真实桌面证据由 Lead/QA 提供。

> 所有“实际观感”结论均为代码路径审计，不是桌面目视验收；真实桌面时序、透明窗口、拖拽跟手、DPI 需要 QA/Lead 用 CDP 或真机补测。

### 1.3 关键调用链

```
pointerdown (canvas)
  -> CharacterHitTest.hit()                       // 皮肤 alpha + Raycaster
  -> GestureMachine.press()
  -> PetGestures.apply(['press'])                 // squash + Ya1 + 3 个 clock timer
pointermove / timer tick
  -> GestureMachine.move()/tick()
  -> dragStart | toggleTorch | gatherStart | close
  -> api.startDrag/endDrag | toggleTorch() | particles | closePet()
main
  -> PetWindowController.startDrag() 60 fps screen.getCursorScreenPoint()
  -> endDrag() 落回 workArea 底部
  -> beginClose() 扩到 display.bounds，1.2 s 后 finishClose() hide
```

---

## 2. 时序符合性审计（PRD §3.1 / M2-TASK）

### 2.1 对照表

| 规定 | 代码现状 | 结论 |
|---|---|---|
| 按下：压扁 1.05/0.88、脚底 pivot、Ya1 | `gestures.ts:141-145`，`setScale` 在 `93-97` | ✅ 符合 |
| 250 ms 前移动不进入拖拽；250–1500 ms 内移动 >5 px 可拖 | `gesture.ts:50-53` 只在 250–1500 ms 的 move 事件里进入 | ⚠️ 逻辑可用，但“250 ms 到点且已经移出 slop”不会自动进入拖拽，必须再收到一次 move |
| 原地 1.5 s 切火把 | `gesture.ts:62-65`，但前提是前 250 ms 内从未超过 5 px | ❌ 有 P0 条件缺陷 |
| 继续按住 2.4 s 聚粒子 | `gesture.ts:66-69`；renderer timer `gestures.ts:125` | ⚠️ 仅当火把阶段可达；且固定 2.4 s，不跟 `longPressMs` |
| 继续按住 3.0 s 关闭 | `gesture.ts:70-73`；renderer timer `gestures.ts:125` | ⚠️ 仅当 gathering 可达；且固定 3.0 s |
| 未拖拽/未到 1.5 s 松开 = 单击摸头 + Ya2 | `gesture.ts:81-85` | ✅ 单击本身不受 P0-1 影响（`<1.5 s` 仍会 click）；但摸头缺呼噜/爱心 |
| 拖拽松手 = 落回任务栏 + 落地缓冲 + Ya2 | `pet-window.ts:239-255`，`gestures.ts:157-162` | ⚠️ 窗口瞬间落到屏幕底部，不是“落下”动画；有 land 挤压 |
| 1.5 s 后松开 (<3 s) = 只切火把 + Ya2，不关闭 | `gesture.ts:81-86`，`apply` 中 release | ✅ 符合 |
| 移动发生在 1.5 s 后 = 不进入拖拽，保持关闭计时 | `gesture.ts:44-45, 62-65`；`move()` 先 `tick()` 再判断 | ✅ 符合（但同样受 P0-1 影响：若前面被取消，就无关闭可保持） |
| 关闭后约 1.2 s 隐藏到托盘，托盘可恢复 | `pet.ts:169-188`、`pet-window.ts:257-302` | ✅ 主路径可用；恢复不完整（见 §4） |

### 2.2 P0-1：前 250 ms 的轻微抖动会永久取消长按（可复现）

**证据**：`src/shared/gesture.ts:43-55` 在 `move()` 里只要距离 >5 px 就设置 `movedOutsideSlop = true`，而 `tick()` 只在 `!movedOutsideSlop` 时才进入 `torch`；一旦进入 `pressed` 后移动过 5 px，**整个后续 `torch → gathering → closing` 链都不会发生**。`release()` 在超过 1.5 s 时也不会补 `click`（`gesture.ts:83`），所以松手只剩一个 `release`。

**复现（本轮实际运行）**：

```ts
const g = new GestureMachine()
g.press(0, 0, 0)
g.move(100, 8, 0)        // 按下后 100 ms，鼠标/手抖了 8 px
g.tick(1500)             // []
g.tick(2400)             // []
g.tick(3000)             // []
g.release(3200)          // ['release']
```

**影响**：

1. 长按 1.5 s 切火把不可达；长按 3.0 s 关闭不可达（关闭必须先从 `torch` 进入 `gathering`）。
2. 用户按下后手抖 6 px、然后老老实实按住 3 秒，宠物完全没反应；这是办公室/触控板/125% DPI 下很容易出现的操作。
3. 同一段文字与测试把该行为当成“规范”固定下来：`tests/gesture.test.ts:65-71` 明确断言 `move(100, 20, 0)` 后 `tick(3000) === []`。建议改测试，而不是保留该行为。
4. 如果用户在 250 ms 后继续移动，反而能进入拖拽（`move(300, …)`），造成“手一直动 = 拖拽，手停下 = 什么都不是”的割裂手感。
5. 同一段位移在 1.5 s 前松手仍算单击（`release` 的 `click` 分支不检查 slop），超过 1.5 s 松手却什么都不发生；手势语义不自洽。
6. 关闭手势必须经过 `torch` phase，因此在 slop 被取消后连“长按关闭”这条独立保底路径也没有。

**建议修复（无新文件，I-1）**：

- 删除永久 `movedOutsideSlop` 标志；改为记录 `lastX/lastY`。
- 在 250 ms 的 drag gate 到点时做一次决策：
  - 当前点仍在 5 px 内 → 保留 `pressed`，继续 1.5 s 火把计时；
  - 已超过 5 px → 直接 `dragStart`（不必等下一次 pointermove）。
- 1.5 s 到点时仍处于 `pressed` → 切火把（若已拖拽则 phase 不是 `pressed`，不会误触）。
- 1.5 s 后移动仍不进入拖拽，保留关闭计时（符合 PRD）。
- 在 `GestureMachine` 暴露 `nextDeadline(now)`，renderer 用一条 timeout 链（250/长按时长/聚粒子/关闭）而不是手写 `[1500, 2400, 3000]`。

**用户选择**：见问题 Q1；在用户拍板前不要把现有行为直接改掉。

### 2.3 P0-2：`longPressMs` 设置完全无效，计时被硬编码

**证据**：

- `src/shared/settings.ts:10` 定义 `longPressMs`，默认 `1500`（`:28`），范围 1000–2000（`:72`）。
- `src/shared/gesture.ts:14-17` 使用私有常量 `1500/2400/3000`；`src/renderer/gestures.ts:125` 再次硬编码 `[1500, 2400, 3000]`。
- 搜索 `longPressMs` 全仓只有 `shared/settings.ts` 和测试，没有 renderer/main 消费。
- 设置页 `src/renderer/settings.ts` 当前只有 size/volume；向导/完整设置还没做。

**影响**：一旦平台流把“长按切换火把时长”做进设置页，用户改 2.0 s 后宠物仍按 1.5/2.4/3.0 执行，是“假设置”，会直接破坏验收。另外两处常量可能漂移。

**建议**：`GestureMachine` 接收配置（`longPressMs`，可选 `dragGateMs`/`slopPx` 作为内部常量）；派生 `gatherAt = longPressMs + 900`、`closeAt = longPressMs + 1500`；renderer 从同一 `nextDeadline` 取时间，不重复写常量。默认 1.5/2.4/3.0 与 PRD 一致；设置变更时只在 idle 生效（避免按到一半改配置）。

### 2.4 其他时序/竞态发现

| ID | 级别 | 发现 | 证据/说明 |
|---|---|---|---|
| INT-03 | P2 | 250 ms 到点没有定时器，只靠 move 事件 | 用户 240 ms 时已经移出 50 px 后停住 → 不拖拽也不火把；修复见 P0-1 |
| INT-04 | P2 | 1.5 s 之后的第一次 move 会先 `tick()` 切火把，再因 phase 不是 pressed 忽略拖拽 | `gesture.ts:43-55`；符合“移动不拖拽”，但事件顺序依赖 timer 是否已跑 |
| INT-05 | P2 | 三个 clock timer 分开设置，主线程卡顿后可能一次 `tick()` 连跳多个阶段 | `gestures.ts:122-131`：例如卡到 3.1 s 才跑 1.5 s 的回调，会出现 `toggleTorch + gatherStart + close` 同帧，聚粒子预览被跳过 |
| INT-06 | P2 | renderer 在 `release()` 里先清 timer 再 `machine.release(now)`，`release` 会补 `tick(now)` | 这是好设计（边界正确），但和 `scheduleClock` 的绝对时间重复，需要测试锁住 |
| INT-07 | ✅ | 丢失 pointerup 的常规路径已覆盖 | `pointercancel`、`lostpointercapture`、`window.blur` 都调用 `release(false)`；pointer capture 在 `onPointerDown` 设置（`gestures.ts:198-199`） |
| INT-08 | P2 | 隐藏到托盘（非 close）时没有 `visibilitychange` 清理 | 按住时托盘隐藏：blur 通常能取消；但后台 timer 节流、auto torch、粒子仍可能残留（见 §5） |
| INT-09 | ✅ | 32 ms 最短按压 + 220 ms 回弹 + 序号防旧 timer | `gestures.ts:225-238`；`pressSequence` 防串台，逻辑正确 |
| INT-10 | P2 | 长按期间 main 仍在走路（`tick()` 不检查 pressed） | `pet-window.ts:311-344`；宠物可能从光标下滑走，长按期间窗口移动，真实手感需 QA 目视。若不想，可在 pressed 时暂停 walk |

---

## 3. 关闭 / 恢复 / 托盘 / 全屏窗口审计

### 3.1 主路径（代码上成立）

1. 3.0 s：`apply('close')` → `setInteractive(false)` → `effects.close()` → `closePet()`（`gestures.ts:175-183`，`pet.ts:169-188`）。
2. `particles.burst(petOrigin())` 先按紧凑窗口坐标换算屏幕坐标；`viewer.playerObject.visible = false`；播放 portal + travel。
3. `await api.beginClose()`：main 记录 compactBounds，扩到 `display.bounds`，`closing=true`，`setIgnoreMouseEvents(true)`，1.2 s closeTimer（`pet-window.ts:257-281`）。
4. renderer 等 1.2 s 再 `finishClose()`；main 的 timer 也会兜底 hide；隐藏后恢复 compact bounds（`:283-302`）。
5. 托盘 show → `show()` 若 closing 先 finishClose → reconcile → showInactive；`show` 事件发 `pet:restored`；renderer 的 `onRestored` 复位。

### 3.2 发现的缺陷

| ID | 级别 | 发现 | 影响/证据 |
|---|---|---|---|
| INT-11 | **P0** | **火把状态跨 close/hide 残留**：`closePet()` 清 auto timer、吃、粒子，但没有 `toggleTorch(false)`；`torchOn/manualTorch` 仍是 true。`onRestored` 也没有复位火把 | 关闭时手里举着火把 → 粒子爆发 → 托盘恢复后火把仍亮；`viewer.playerObject.visible` 在 close 时 false，但 `torchOn` 逻辑状态是真。`pet.ts:169-207` |
| INT-12 | P1 | 普通托盘隐藏（非 close）不会发 `pet:restored`，隐藏期间 auto torch 仍可能触发 | `maybeAutoTorch` 只检查 `viewer.playerObject.visible`，而 plain hide 不改它；main 的 brightness 仍在推送（`index.ts:83-87`）。隐藏时可能听到点燃音；setTimeout 被后台节流后 auto torch 状态可能保持异常久 |
| INT-13 | P1 | 关闭动画期间 `closeScene` 返回值未被使用 | `api.beginClose(): Promise<CloseScene>` 的 origin 是 main 算的，renderer 完全忽略、自己用 `petOrigin()` 再算一遍；两处 `0.52` 是重复约定，改一处会错位。`preload/index.ts:67-69`，`pet.ts:173` |
| INT-14 | P1 | 照片“冻结”只冻结 animator，不冻结紫粒子/零食粒子/火把 rAF | PRD §9 要求冻结当前姿态和粒子；`pet.ts:242` 只调 `animator.setFrozen`，`particles.ts`/`snacks.ts`/`torch.ts` 各跑自己的 rAF。这是跨流（behavior + platform/Lead）缺陷 |
| INT-15 | P2 | close 失败回退只恢复 renderer，不清理 main 的 closing 状态 | `closePet` catch 里 `particles.clear()` + visible + reset；若 `beginClose` 已设置 closing 但 `finishClose` 失败，main 仍会在 1.2 s 后 hide。实际 IPC 失败概率低，但恢复语义不完整 |
| INT-16 | P2 | 关闭期间 pointer 仍按下时的 pointerup 可能落到桌面 | `beginClose` 在 pointer 仍按下时设 `setIgnoreMouseEvents(true)`（`pet-window.ts:274-277`）；renderer 已在 closing 不再处理，属可接受，但 QA 应验证不会误触发桌面操作 |
| INT-17 | ✅ | resize guard 在 closing 时跳过 | `pet-window.ts:116-128`，与 TEAM-HANDOFF 的已知坑一致 |
| INT-18 | P2 | 关闭期间窗口全屏，但 `#pet` WebGL canvas 被 CSS 拉伸（viewer 不 resize） | 角色已 visible=false，视觉只依赖 2D 粒子 canvas（每帧 resize），当前可接受；若未来关闭动画里保留角色则要注意 |
| INT-19 | P2 | 普通隐藏后 `setInteractive` 仍可能被 33 ms 轮询改成 false/true | 隐藏窗口调用 `setIgnoreMouseEvents` 无意义，恢复瞬间可能短暂改变穿透状态；轮询应加 `document.hidden`/`closing` 守卫 |

### 3.3 恢复路径的正确部分

- `resetAfterRestore` 清 clock timer、machine、pointer、closePromise、tween，scale 复位 1，`animator.setDragging(false)`，`setInteractive(false)`：`gestures.ts:58-67`。
- `onRestored` 清粒子/零食/auto/吃，visible 恢复：`pet.ts:199-207`。
- 若用户在 close 的 1.2 s 内托盘 show：`PetWindowController.show()` 先 `finishClose()`，再 show → `pet:restored`；renderer 的 1.2 s await 之后 `finishClose()` 变成 no-op。这条竞态代码上是闭合的，但建议 QA 真机覆盖。

---

## 4. 火把 / 自动火把审计

### 4.1 当前状态机（`pet.ts:63-68, 118-161`）

状态：`torchOn`、`manualTorch`、`autoTorchActive`、`autoTorchTimer`、`lastAutoTorchAt`、`brightnessValue`。

- 手动长按 → `toggleTorch()`（默认 `manual=true`）→ 写 `manualTorch`，打开时清 auto timer。
- 自动：亮度 ≤ `darkThreshold`，且 `autoTorch` 开启，且非 manual/auto/on/eating/pressed/closing/不可见，且距上次 ≥10 min → 开 12–18 s；定时器到点关。
- **冷启动坑**：`lastAutoTorchAt` 初始化为 `0`，而 `performance.now()` 在应用启动后的前 10 分钟都小于 10 min，因此冷启动即使全暗也不会触发 auto torch（COMMANDER-BRIEF 已点名 A07）。
- **暗边沿缺失**：没有 `wasDark`/`darkEdgeArmed` 状态；手动关火把后只要 `lastAutoTorchAt` 已超过 10 min，下一次亮度轮询就可能立刻再 auto 点亮，不符合 PRD “手动关闭后，下一次变暗事件才再自动触发”。
- 亮度回到阈值以上：auto 到点则关；manual 保持。

### 4.2 冲突矩阵

| 场景 | 现状 | 结论/风险 |
|---|---|---|
| 手动 on + 亮度暗 | `manualTorch` 阻止 auto | ✅ 手动优先 |
| 手动 on + 亮度变亮 | 不关 | ✅ PRD “手动一直保持” |
| auto 到点 + 仍暗 | 关；10 min 后才可能再开 | ✅ 符合 PRD “12–18 s / 最多 10 min” |
| **冷启动暗处** | `lastAutoTorchAt = 0`，而条件是 `performance.now() - lastAutoTorchAt < 10 min`，因此应用启动后前约 10 分钟完全不触发 auto torch | ❌ **A07 冷启动不可用**；COMMANDER-BRIEF §1/§5 已点名。修复：用 `null`/`-Infinity` 初始化，或用 `wasDark` 边沿触发，冷却只在真正触发后计时 |
| auto on 时手动长按 | 实际是“关火把”，不是“保持 on” | 符合 toggle 语义，但用户可能以为长按只是确认火把；QA 观察 |
| 手动关掉 auto / 手动关火把后仍暗 | auto timer 不取消，但到点检查 `torchOn && !manualTorch`，不会重开；**但没有“新暗边沿”状态**：若 `lastAutoTorchAt` 已超过 10 min，下一次亮度轮询（≤20 s）就可能再次 auto 点亮 | ❌ 与 PRD §5.1 “手动关闭后，下一次变暗事件才再自动触发”不符；COMMANDER-BRIEF 已点名。修复：记录 `wasDark`，只在“亮→暗”边沿 auto；手动关闭时解除当前暗状态，直到亮度回阈值以上再重新武装 |
| 隐藏/关闭时火把 | **不熄灭、不复位** | ❌ INT-11；手动火把按 PRD 应在“隐藏宠物”时收起 |
| 隐藏期间 auto | **可能触发** | ❌ INT-12；会后台放点燃音，恢复后可能亮着 |
| 火把 + 走路 | 允许，animator 保留走路；`torchWeight` 降低摆臂 | ✅ PRD 允许 |
| 火把 + 拖拽 | 允许，mesh 仍在手里，光仍亮；animator 用 `dragBlend` 降低抬臂 | ⚠️ 可能穿模/怪异；建议动作接口把拖拽视为优先级最高，可临时隐藏/收火把（需用户确认，未单列问题，默认不动） |
| 火把 + 伸懒腰 | 允许；`stretchWeight` 抑制火把抬臂，但 mesh/light 仍在 | ⚠️ 穿模风险；动作接口需把 `manualTorch` 视为互斥（见 §8） |
| 火把 + 吃面包 | `eat()` 在 `torchOn` 时直接 return | ✅ 互斥（但用户无反馈，只能看日志） |
| 火把 + 关闭 | 关闭前不熄灭；关闭音效只有 portal/travel | ❌ INT-11 |
| 自动火把 + 未来的动作快捷键 | 无动作接口可判断 | ❌ 动作接口必须把 `autoTorchActive` 纳入 gate，并让自动火把为显式动作让路 |

### 4.3 缺失的 PRD 表现

- **燃烧循环音** `fire/fire.ogg`：`ASSET_PATHS` 有 `fireLoop`（`ipc.ts:47`），`AssetName` 有 `fireLoop`（preload），但 `audio.ts` 的 `SoundName` 没有它、从未加载/循环播放。
- **火星粒子**：PRD §5.2 要求少量上升火星；当前只有 sprite 火焰 + PointLight 摇曳（`torch.ts:160-169`），没有火星。
- **火把只照角色**：PointLight 在右手挂点，场景只有角色，方向正确；但真实观感（光强 2.6/距离 22/decay 2）需 QA 目视。
- **熄灭音**：手动 toggle 有；关闭/隐藏没有。修复 INT-11 时一并做。

### 4.4 结论

火把视觉对象本身可用；**问题在状态所有权**：它散落在 `pet.ts` 的模块级变量里，手势、自动亮度、关闭/恢复、未来的动作快捷键四个入口同时改它，没有单一策略层。建议抽 `TorchController`（或至少把 `manual/auto/on` 策略集中）作为 I-3 的一部分；放在 `src/renderer/torch.ts`（我 ownership），不新增 shared 文件；`pet.ts` 的接线由 behavior 做。

---

## 5. 拖拽 / 跨屏 / 落点 / 压扁回弹审计

### 5.1 跟手

- renderer 只在 250–1500 ms 的 move 事件发 `dragStart`；main 在 `startDrag()` 用当前光标与窗口 bounds 算 offset（`pet-window.ts:226-237`），不会在开始拖时跳一下。
- main 60 fps `screen.getCursorScreenPoint()` → `setPosition`（`:383-400`）；renderer 不参与窗口移动，只做姿态。设计正确。
- **但**：如果 `startDrag()` 时窗口不可见/正在 closing，main 直接 return；renderer 已经进入 `dragging` 并 `animator.setDragging(true)`。窗口不会跟手，但松手仍会 `dragEnd` + land。概率低，建议 main 给 renderer 一个 ack（可选）。

### 5.2 clamp / 跨屏

- 拖拽期间 clamp 到所有显示器 bounds 的并集（`pet-window.ts:389-398`），允许窗口停在显示器之间的“空洞”区域（如果多显示器不是无缝排列），松手才按 `screen.getDisplayNearestPoint(cursor)` 落回 workArea。P2。
- 跨不同 DPI/尺寸显示器时，拖拽期间窗口尺寸不变；松手 `endDrag` 才 `sizeForArea()` 重算 `nextSize` 并 `setBounds`（`:247-252`）。**但 renderer 的 viewer 只在加载和设置变更时 resize**（`pet.ts:209-230`），拖拽跨屏/主进程 resize 后 WebGL 画布仍按旧尺寸渲染，被 CSS 拉满新窗口 → 角色可能被横向/纵向拉伸。**P1 回归风险**，建议 main 在 drag end / reconcileDisplay 后发一次 `pet:viewport` 事件，renderer 只在该事件里 `resizeViewer()`（不要监听每次 `resize`，避免 M0 的透明窗放大循环）。
- `setPetSize`/`reconcileDisplay` 也会改窗口尺寸但不发 viewport 事件（`pet-window.ts:204-224`）；同样风险，尤其多显示器分辨率差异大时。
- 落点：`endDrag` 直接 `setBounds` 到 workArea 底部（含任务栏上方），x 用 `cursor.x - dragOffset.x` 再 clamp，符合 PRD 的“落回目标显示器任务栏上方”；**但窗口是瞬移**，随后 `animator.land()` 播放 720 ms 落地挤压（`animator.ts:92-95, 218-233`）。PRD 只要求落地缓冲，未要求下落轨迹；当前可接受，但观感是“啪一下出现在底部”，建议 QA 判定是否需要下落 tween（P2，不阻塞）。

### 5.3 按压压扁与回弹

| 检查 | 结论 |
|---|---|
| pivot 在脚底 | `gestures.ts:93-97`，`playerObject.position.y = -16.25*(1-scaleY)`；M0 验证过 ✅ |
| 回弹 220 ms + `reboundEase` | `gestures.ts:105-120`，`easing.ts`；✅ |
| 最短 32 ms 压扁 | `gestures.ts:233-237`；✅ |
| 序号防旧回弹 | `pressSequence`；✅ |
| **拖拽期间压扁** | ❌ `apply('dragStart')` 只 setDragging/startDrag，没有复位 scale；从按下到松手一直保持 0.88/1.05。拖拽中角色是“被压扁地吊着”，不符合“拖拽挣扎/落地”的预期 |
| **长按期间压扁** | 1.5 s 火把、2.4 s 聚粒子、3.0 s 关闭期间也一直压扁；是否要在 1.5 s 回弹需要用户拍板（Q3） |
| 关闭期间压扁 | 角色 3 s 立即隐藏，影响小；恢复 reset 到 1 |
| 压扁与 animator 冲突 | animator 只改 `playerObject.skin.body` 和 `playerWrapper.position`，gesture 改 `playerObject.scale/position`，无叠加冲突 ✅ |

### 5.4 其他拖拽风险

- **走路被长按打断**：按住的 3 s 内 main 仍可能继续走（`pet-window.ts:311-344` 没有 pressed 判断），长按点可能在移动的窗口上；pointer capture 保证事件不丢，但“原地长按”的语义会漂移。P2。
- **`focusable: true`**（`pet-window.ts:67`）：PRD §3.2 要求“不抢当前窗口焦点”。点击桌宠很可能激活该 Electron 窗口；这不是互动流所有权，但建议 platform/QA 复核（可测试 `focusable:false` 是否仍能收到 pointer 事件）。标记为跨流观察，未计入手势缺陷。
- **33 ms 光标轮询**（`gestures.ts:38, 84-91`）决定点击穿透开关；快速“移入并立即点击”可能有一次轮询的延迟，点击落到桌面。M1 实测基本可用，但 125% DPI/高刷屏建议 QA 补测。P2。

---

## 6. 粒子审计

### 6.1 当前实现

- `PurpleParticles`：2D canvas `position:fixed; inset:0; z-index:10; pointer-events:none`（`particles.ts:78-87`），每帧 `resizeCanvas()`，屏幕坐标用 `window.screenX/screenY`（`:159-161, 234-246`）。
- gather：2.4 s 起，`startGathering(origin)` 立即 4 个 + 每 65 ms 补到 16 个，向心加速度（`:89-98, 167-184, 205-230`）。
- burst：3.0 s，144 个（上限 168），径向 + 向上，重力 260 px/s²，寿命 0.9–1.6 s，拖尾（`:111-134, 248-274`）。
- `stopGathering` 把 preview 寿命截到 age+0.22 s，松手后快速淡出（`:100-109`）。
- close 时 `burst(petOrigin())` 在窗口扩到全屏之前算屏幕坐标；扩窗后 `x - window.screenX` 仍正确（TEAM-HANDOFF 已验证过同类做法）。✅

### 6.2 缺陷/缺口

| ID | 级别 | 发现 | 说明 |
|---|---|---|---|
| INT-20 | P1 | **`settings.particles` 从未被消费** | 用户关掉粒子的设置对 gather/burst 完全无效；`pet.ts` 只把 settings 交给 audio，没有传给 `PurpleParticles`/gestures。`shared/settings.ts:14`，`pet.ts:219-227` |
| INT-21 | P2 | 释放时“聚粒子预览”只是先 start 再 stop | release 在 2.4–3.0 s 之间会先 `gatherStart` 再 `gatherStop`（`gesture.release` 先 tick）；最多闪 0.22 s，肉眼几乎不可见。符合“取消预览”的容忍度，但可优化为 release 前不启动 |
| INT-22 | P2 | 关闭粒子 origin 双重计算 | main 的 `CloseScene.origin` 与 renderer 的 `petOrigin()` 两套；见 INT-13 |
| INT-23 | P2 | 关闭后粒子在隐藏窗口里冻结 | 1.2 s 后窗口 hide，rAF 暂停；`onRestored` 会 clear，不会泄漏到下次显示。可接受 |
| INT-24 | P2 | `dispose()` 没有调用点 | 只有页面关闭才需要；资源泄漏半径小 |
| INT-25 | ✅ | 不遮挡点击 | `pointer-events:none`；canvas z-index 10 在 pet 之上，但只影响绘制 |
| INT-26 | P2 | 关闭粒子不受 `document.hidden`/全屏探头影响 | 全屏探头实现后如果窗口只露头，粒子仍按整个窗口坐标画；动作/全屏状态需要加入 gate |

### 6.3 修改建议（particles.ts，我 ownership）

- 增加 `setEffectsEnabled(enabled: boolean)`；`startGathering/burst` 在关闭时 no-op。
- close 在 `particles=false` 时走“0.2 s 淡出 + 直接隐藏”分支（具体语义待 Q5）。
- 可选：把 `burst` 数量参数化（120–160），并预留 `spark` hook 给火把火星（跨流，非必须）。
- 与 `document.hidden` / fullscreen peek 联动：只在可见且非探头时播放。

---

## 7. 缺陷汇总（按优先级）

> P0 = 破坏 PRD 承诺/需要先修才能验收；P1 = 明显手感/视觉回归或已声明设置失效；P2 = 边界/可维护性/待 QA。

| ID | 级别 | 缺陷 | 证据 | 建议 owner |
|---|---|---|---|---|
| **INT-P0-01** | P0 | 前 250 ms 移动 >5 px 永久取消长按，火把/关闭不可达；松手只剩 release | `shared/gesture.ts:43-55, 62-73, 77-87`；已用 Node 复现 | interaction-dev（I-1） |
| **INT-P0-02** | P0 | `longPressMs` 设置从未消费；`1500/2400/3000` 在 shared/renderer 两处硬编码 | `shared/settings.ts:10,28,72`；`shared/gesture.ts:14-17`；`renderer/gestures.ts:125` | interaction-dev（I-1） |
| **INT-P0-03** | P0-GAP | 自定义动作快捷键完全没有 renderer 动作接口；main 只有 Ctrl+Alt+P；preload 无 action 通道；settings 无 shortcuts 字段 | `main/index.ts:74`；`preload/index.ts:27-49`；`shared/settings.ts:2-18` | interaction-dev + Lead/platform（I-2/I-4） |
| **INT-P0-04** | P0 | 关闭/隐藏后火把状态残留；手动火把不按“隐藏宠物即收起”处理；恢复后仍亮 | `pet.ts:124-161, 169-207` | interaction-dev 策略 + behavior 接线 |
| **INT-P1-01** | P1 | 拖拽全程保持 press 压扁，不回弹 | `gestures.ts:141-143, 151-156, 225-238` | interaction-dev（I-1） |
| **INT-P1-02** | P1 | 拖拽/跨屏导致窗口 resize，但 viewer 不 resize → 画布拉伸 | `pet-window.ts:239-255, 204-224`；`pet.ts:209-230` | interaction + Lead/platform |
| **INT-P1-03** | P1 | 触摸反馈不完整：单击只有 animator.pet，无呼噜/喵/爱心；purr/meow 资产未进 allowlist | `gestures.ts:147-149`；`audio.ts`；`preload/index.ts:12-18`；`main/ipc.ts:11-49` | behavior（audio）+ Lead（ASSET_PATHS）+ platform（AssetName） |
| **INT-P1-04** | P1 | 火把缺燃烧循环、火星；关闭/隐藏时不熄灭 | `audio.ts`；`torch.ts:160-169`；`pet.ts:169-188` | behavior（audio）+ interaction（torch）+ Lead 接线 |
| **INT-P1-05** | P1 | `particles` 设置未接线；关闭粒子始终播放 | `shared/settings.ts:14`；`particles.ts` 无 settings | interaction-dev（I-3）+ behavior 接线 |
| **INT-P1-06** | P1 | 自动火把可在托盘隐藏期间触发/播放音效；隐藏期间 timer 节流 | `pet.ts:138-161`；`main/index.ts:83-87`；无 `document.hidden` 检查 | interaction-dev 策略 + behavior 接线 |
| **INT-P1-07** | P1 | 照片冻结不冻结粒子/火把（PRD §9） | `pet.ts:242`；三个独立 rAF | behavior + platform/Lead |
| **INT-P1-08** | P1 | **冷启动暗处 10 分钟不 auto**；**手动关火把后没有“新暗边沿”判定** | `pet.ts:67`（`lastAutoTorchAt=0`）+ `:149`；`pet.ts:138-160` 无 `wasDark` | behavior（pet.ts）+ interaction（TorchController 策略） |
| **INT-P1-09** | P1 | 全屏探头期间长按关闭/拖拽的冲突未定义：窗口只露头、身体在屏外，长按可能在全屏游戏上方爆紫粒子 | 平台全屏探头未实现；本审计只做接口准备（COMMANDER-BRIEF T4–12 指定 interaction 检查） | interaction + platform + behavior |
| **INT-P2-01** | P2 | 250 ms gate 到点不自动拖拽；卡顿后跳阶段 | 见 §2.4 INT-03/05 | interaction-dev（I-1） |
| **INT-P2-02** | P2 | 拖拽 clamp 到虚拟 bounds 并集，可停在显示器空隙 | `pet-window.ts:383-400` | Lead/platform |
| **INT-P2-03** | P2 | 落点瞬移，无下落轨迹；land 挤压仍在 | `pet-window.ts:239-255`；`animator.ts:92-95` | 用户可决定，暂不改 |
| **INT-P2-04** | P2 | `closeScene` origin 未被 renderer 使用，双重约定 | `preload/index.ts:67-69`；`pet.ts:173` | interaction + Lead |
| **INT-P2-05** | P2 | 隐藏时 `setInteractive` 轮询仍工作；恢复瞬间穿透状态可能闪 | `gestures.ts:84-91`；`pet-window.ts:174-181` | interaction-dev |
| **INT-P2-06** | P2 | 长按期间 main 继续走路；`focusable:true` 可能抢焦点 | `pet-window.ts:67, 311-344` | platform/QA 复核 |
| **INT-P2-07** | P2 | 关闭期间 pointer 仍按下时的 pointerup 可能落到桌面 | `pet-window.ts:274-277` | QA 验证 |

---

## 8. 自定义动作快捷键：renderer 动作接口设计

### 8.1 设计目标

> **与 COMMANDER-BRIEF 对齐**：动作类型/优先级由 Lead 在 `src/shared/contracts.ts` 冻结（`ActionId`、`ActionPriority`、`ActionRequest`、`FullscreenState`、`BehaviorMode`）；interaction 只实现 renderer 侧白名单/gate/bus（`src/renderer/interaction-actions.ts`），不碰 `pet.ts`/`main`/设置页；`photo`、`toggleVisible` 属于 system action，由 main 执行。本节的字段是给 Lead 冻结接口的提案，不是已冻结契约。

1. 用户可在设置里给“桌宠做某个动作”绑定全局快捷键；动作只能来自白名单，不能传任意函数/动画名。
2. 显式用户动作优先级高于自动行为（自动火把/随机伸懒腰/随机面包），但低于手势（按下、拖拽、关闭）和拍照冻结；冲突时**拒绝并写日志**，不排队、不弹桌面文字（PRD：桌面零文字）。
3. 默认低打扰：默认无绑定；每个动作有冷却/互斥；不因快捷键打断正在进行的关闭/拖拽/拍照。
4. 复用现有动效/音效/粒子资产；没有的动效由 behavior 提供固定方法，不在运行时动态查找。
5. 全链路可测：renderer 白名单/gate/bus 的纯逻辑集中在一个文件，DOM/animator 只通过注入 hooks；system action 由 main 的注册器直接执行。
6. 首批集合按 COMMANDER-BRIEF Q14 的推荐项：拍照、显隐、喂食、玩具、坐/睡、伸展、火把；挥手/转圈/摸头/跳舞留后续批次。

### 8.2 新增文件与所有权

| 文件 | 内容 | owner |
|---|---|---|
| `src/shared/contracts.ts` | `ActionId`、`ActionPriority`、`ActionRequest/Result`、`FullscreenState`、`BehaviorMode` | **Lead**（不归我；我只提字段建议） |
| `src/renderer/interaction-actions.ts` | renderer 动作白名单、参数校验、`canRunAction` gate、`InteractionActionBus`：串行执行/计时/取消/hooks | **interaction-dev**（COMMANDER-BRIEF 已列入我的 ownership；不需要额外新文件 grant） |
| `tests/interaction-actions.test.ts` | 白名单/参数/gate/cooldown/重复策略的纯测试 | **interaction-dev**（新的 interaction 专属测试） |
| `src/renderer/gestures.ts` | 增加 `interruptAction()` 钩子；`setConfig(longPressMs)`；修正压扁/时序 | interaction-dev（已有） |
| `src/shared/gesture.ts` | 配置化、`nextDeadline`、去掉永久 slop 标志 | interaction-dev（已有） |
| `src/renderer/particles.ts` | `setEffectsEnabled`、无粒子关闭、可选 spark hook | interaction-dev（已有） |
| `src/renderer/torch.ts` | 把 `manual/auto/on` 策略抽成 `TorchController` | interaction-dev（已有；`pet.ts` 接线由 behavior） |
| `tests/gesture.test.ts` | 补 P0-1/P0-2/边界/恢复测试 | interaction-dev（已有） |

> 按 COMMANDER-BRIEF 的 ownership，只使用 `src/renderer/interaction-actions.ts`（不创建 `src/shared/actions.ts` / `src/renderer/actions.ts`）；不改 `pet.ts`、`audio.ts`、`main/**`、`preload`、`settings`、`shared/settings.ts`。`photo`/`toggleVisible` 的 main 侧执行由 Lead/platform 在 `contracts.ts` + 快捷键注册器里接。

### 8.3 共享契约（建议，Lead 冻结）

```ts
// src/shared/contracts.ts —— Lead 冻结；interaction 只读引用
export type ActionId =
  | 'photo' | 'toggleVisible'                 // system：main 执行
  | 'feedBread' | 'toy' | 'sit' | 'sleep' | 'stretch' | 'toggleTorch' // renderer

export type ActionKind = 'system' | 'renderer'
export type ActionPriority = 'gesture' | 'drag' | 'photo' | 'explicit' | 'ambient'
export type ActionSource = 'hotkey' | 'tray' | 'debug'

export type ActionRejectReason =
  | 'invalid' | 'unknownAction' | 'notReady' | 'notVisible'
  | 'hidden' | 'gesture' | 'dragging' | 'closing'
  | 'frozen' | 'eating' | 'posture'
  | 'manualTorch' | 'fullscreenPeek' | 'cooldown' | 'busy'

export interface ActionRequest {
  id: ActionId
  params?: Readonly<Record<string, string | number | boolean>>
  source: ActionSource
  requestId?: string
}

// renderer 侧（src/renderer/interaction-actions.ts）
export interface RendererActionSpec {
  id: Extract<ActionId, 'feedBread' | 'toy' | 'sit' | 'sleep' | 'stretch' | 'toggleTorch'>
  label: string                       // 仅设置页/托盘用；桌面不显示
  kind: 'timed' | 'toggle'
  exclusive: boolean                  // 需要先 stopWalk + 独占动作槽
  repeat: 'ignore' | 'toggle' | 'restart'
  cooldownMs: number
  interruptible: boolean              // 手势/拖拽/关闭可打断
  params: readonly ActionParamSpec[]  // 参数 schema，未知字段丢弃
  sound: readonly ActionSoundHook[]
  particles: readonly ActionParticleHook[]
}

export interface ActionHostState {
  visible: boolean
  skinReady: boolean
  gesture: 'idle' | 'pressed' | 'dragging' | 'torch' | 'gathering' | 'closing'
  eating: boolean
  frozen: boolean
  posture: 'stand' | 'sit' | 'sleep'
  torch: { on: boolean; manual: boolean; auto: boolean }
  fullscreenPeek: boolean
  activeAction: ActionId | null
  lastFiredAt: Partial<Record<ActionId, number>>
}

export function parseActionRequest(input: unknown): ActionRequest | null
export function canRunAction(
  request: ActionRequest,
  state: ActionHostState,
  now: number
): { ok: true } | { ok: false; reason: ActionRejectReason }
```

关键约束：

- **白名单是唯一入口**：renderer 的 `RENDERER_ACTION_SPECS`（6 个）与 main 的 system action 表（`photo`、`toggleVisible`）共同覆盖 `ActionId`；未知 id 直接 `unknownAction`。`ActionId`/priority 由 Lead 冻结，本表只是提议。
- **参数白名单**：每个动作只接受声明的字段/枚举/数值范围；其余丢弃或判 `invalid`；不把 raw string 当方法名。
- **单一动作槽**：同一时间最多一个 renderer action；`activeAction` 非空时，只有同 id 的 `toggle`/`restart` 类允许。
- **手势优先**：任何 pointerdown 进入 press 时，`PetGestures` 调 `effects.interruptAction()`；bus 在 150–300 ms 内平滑取消，随后手势接管。
- **关闭优先**：`close` 取消一切 renderer action、停止 auto torch；`closing` 期间所有 action 拒绝。
- **system action**：`photo`/`toggleVisible` 由 main 直接执行，仍要遵守 `closing`/全屏探头/拖拽的拒绝规则；`photo` 复用现有冻结链路，`toggleVisible` 隐藏时取消 renderer 动作（由 behavior 的 `pet.ts` 接线）。

### 8.4 建议动作清单（8 个，按 COMMANDER-BRIEF Q14 推荐项）

| id | 中文 | kind / 执行方 | 时长/状态 | 动作/动画 hook（owner） | 音效 | 粒子 | 互斥/备注 |
|---|---|---|---|---|---|---|---|
| `photo` | 拍照 | system / main（Lead/platform） | 一次性 | 现有 `takePhoto()`；冻结链路 | 现有/可选快门 | 无 | 关闭中/全屏探头中拒绝；隐藏时按平台规则临时显示再恢复 |
| `toggleVisible` | 显示/隐藏 | system / main（Lead/platform） | 一次性 | 现有 `pet.show()/hide()` | 无 | 无 | 关闭中/拖拽中拒绝；隐藏时取消 renderer 动作；显示后按 Q4 复位火把 |
| `feedBread` | 喂面包 | renderer / behavior | 3.9 s | `pet.ts` 的 `eat()` 提取为可调用 `runEat(bites)` | `eat1/eat2` + `burp` | 面包屑 + 爱心 | exclusive（先 stopWalk）；manualTorch 拒绝；手动冷却 60 s；不改变随机面包计时 |
| `toy` | 玩具（首个：雪球） | renderer / behavior | 3–5 s | behavior 的新玩具动作（Brief Q11 推荐雪球追逐） | 视 behavior 设计（雪球/poof） | 可选雪屑 | exclusive；冷却 10 s；与喂食/坐睡互斥；先做 1 个玩具 |
| `sit` | 坐下/起身 | renderer / behavior | toggle，过渡 0.35 s | `animator.requestPosture('sit'/'stand')` | 可选 `purr1-3` | 无 | 与 `sleep` 互斥；点击/拖拽/关闭可打断；低打扰 |
| `sleep` | 睡觉/起床 | renderer / behavior | toggle，过渡 0.4 s | `animator.requestPosture('sleep'/'stand')`；再按=醒 | 可选呼噜/呼吸 | 无 | 与 `sit` 互斥；点击可叫醒；低打扰 |
| `stretch` | 伸懒腰 | renderer / behavior 动画 | 2.5 s | 现有 `animator.stretch()` | `purreow` 0.12 | 无 | exclusive（先 stopWalk）；manualTorch 拒绝 |
| `toggleTorch` | 火把开关 | renderer / interaction | toggle/持续 | 现有 `toggleTorch()`，改走 `TorchController` | `ignite`/`extinguish` + `fireLoop` | 火星（可选） | 手动优先；auto 让路；走路可；关闭/隐藏时强制熄灭 |

> “坐/睡/醒”里的 **醒** 由 `sleep` 再按一次（toggle）覆盖，不单独占第 9 个动作；如果用户坚持要独立“叫醒”键，可在契约里加第 9 个 id，但本轮建议 8 个封顶。
> 挥手/转圈/摸头/跳舞**不在首批快捷键集合**：摸头仍由单击提供；其余留给 P0-3/P1 的互动批次。这样与 COMMANDER-BRIEF Q14 的推荐集合一致。

### 8.5 参数建议

| 动作 | 参数 | 约束 | 默认 |
|---|---|---|---|
| `photo` | 无 | — | — |
| `toggleVisible` | `visible?: boolean` | true/false；缺省 toggle | toggle |
| `feedBread` | `bites?: number` | 3 或 4 | `4` |
| `toy` | `kind?: 'snowball'` | 首批只允许 `snowball` | `snowball` |
| `sit` / `sleep` | 无 | — | toggle |
| `stretch` | 无 | — | — |
| `toggleTorch` | `on?: boolean` | true/false；缺省 toggle | toggle |

所有时长不由快捷键参数覆盖；只允许动作内部规格，避免用户/外部输入拉长动画或卡住动作槽。`photo`/`toggleVisible` 的参数在 main 侧校验，renderer 不接收 system action 的任意参数。

### 8.6 互斥矩阵（建议默认）

图例：✅ 允许；❌ 拒绝；T = 同 id 再按切换/退出；S = 允许但先 `stopWalk()`；A = 自动火把先让路（熄灭/抑制，不改变 manual）；W = 先唤醒/回到站姿再执行。

| 当前状态 \ 动作 | feedBread | toy | sit | sleep | stretch | toggleTorch |
|---|---|---|---|---|---|---|
| idle / stand | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| walking | S | S | S | S | S | ✅ |
| gesture pressed/torch hold | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| dragging | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| gathering/closing | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| autoTorch on | A + S | A + S | A + S | A + S | A + S | ✅（转手动优先） |
| manualTorch on | ❌ | ❌ | ❌ | ❌ | ❌ | ✅（关） |
| eating | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| sit | ❌ | ❌ | T（起身） | ✅（切换） | W | ✅ |
| sleep | ❌ | ❌ | W（醒后坐） | T（起床） | W（醒后伸） | ❌ |
| photo frozen | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| fullscreen peek | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| hidden | 按 Q7 | 按 Q7 | 按 Q7 | 按 Q7 | 按 Q7 | 按 Q7 |
| 同一动作进行中 | ignore | ignore | T | T | ignore | T |
| 冷却中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

system action（不走 renderer bus，由 main 执行；仍受 Lead 冻结的优先级约束）：

| 状态 | `photo` | `toggleVisible` |
|---|---|---|
| idle / walking / 坐睡 | ✅（冻结当前姿态） | ✅（显示↔隐藏） |
| renderer timed action 进行中 | ✅（冻结当前帧；action 计时继续，见 INT-14） | ✅（隐藏会取消当前动作） |
| gesture pressed/dragging | ❌（避免拍到半截按压/拖拽） | ❌（拖拽中隐藏会中断落点） |
| closing | ❌ | ❌ |
| fullscreen peek | 按平台探头规则（推荐拒绝） | ✅（可用于找回） |
| hidden | 平台临时显示到底部中央再拍（PRD §9） | ✅（显示） |
| 正在拍照 | ❌（不重入） | ❌ |

补充：

- `repeatPolicy`：`feedBread/toy/stretch = ignore`（重复按无效果）；`sit/sleep/toggleTorch = toggle`；所有动作都 300 ms 去抖，防 Windows 键重复。
- 手势优先级高于动作：pointerdown 时 `PetGestures` 调 `effects.interruptAction()`；关闭时 `cancelAll('close')`。
- 照片冻结期间不做任何 renderer 动作；照片结束恢复。
- 全屏探头期间默认全部 renderer 动作拒绝（不要挡游戏画面），且建议暂停长按关闭/拖拽（窗口只露头时误触风险高；见 INT-P1-09）；退出全屏恢复。
- 隐藏/忙碌策略由 Q7 决定；`toggleVisible` 的隐藏动作取消 renderer 动作，`photo` 隐藏时按平台规则处理。

### 8.7 音效 / 粒子 hooks

| Hook | 现有能力 / owner | 需要补的 |
|---|---|---|
| `audio.press/release` | behavior 的 `PetAudio`；`Ya1/Ya2`，受 `clickSounds` 控制 | 无 |
| `audio.torch(on)` | behavior 的 `PetAudio`；ignite/extinguish | 燃烧循环 `fireLoop` 的 start/stop；隐藏/关闭时 stop |
| `audio.pet`（摸头反馈） | behavior 的 `PetAudio`；无 | `purr1..3`、偶尔 `meow1`；资产已在 `public/assets/vanilla/sounds/mob/cat/`，但需 **Lead 的 `ASSET_PATHS` + platform 的 `AssetName`** 放行 |
| `audio.toy` | behavior 的 `PetAudio`；无 | 雪球/poof 音（若 behavior 选）；需走同一资产白名单 |
| `particles.closeBurst` | interaction 的 `PurpleParticles.burst` | 受 `particles` 设置/可见性控制 |
| `particles.gather` | interaction 的 `startGathering/stopGathering` | 受 `particles` 设置控制 |
| `particles.hearts` | behavior 的 `SnackParticles.hearts` | 动作 bus 通过 hooks 调用 |
| `particles.crumbs` | behavior 的 `SnackParticles.crumbs` | 同上 |
| `particles.snow` | 无 | 可选：雪球玩具的雪屑；由 behavior 决定 |
| `particles.spark` | 无 | 可选：火把火星；复用 `effect_*` 纹理或新 mode |

**hook 不是字符串反射**：`InteractionActionBus` 内部用固定的 `switch (id)` 调已知方法；`RendererActionSpec` 只描述“需要哪些 hook”，不携带可执行字符串。

### 8.8 IPC / preload 建议（与 Lead 的 `contracts.ts` 对齐）

```ts
// preload（platform 实现；Lead 冻结协议）
onAction(callback: (request: ActionRequest) => void): () => void
reportActionResult(result: ActionResult): void
onPeekState(callback: (state: FullscreenState) => void): () => void

// main -> renderer（仅 renderer action）
win.webContents.send('pet:action', request)
// renderer -> main
ipcRenderer.send('pet:action:result', result)
// main -> renderer（全屏探头状态，用于 gate）
win.webContents.send('pet:peek-state', state)
```

- main 是唯一发起者：快捷键/托盘/调试入口 → 校验 id/params → 生成 `requestId` → renderer action 发 `pet:action`；system action（`photo`/`toggleVisible`）由 main 直接执行，不发 `pet:action`。
- main 不能在 renderer 拒绝后重试；日志记录 `reason`，桌面无提示。
- 调试 API：`window.__niko.action(id, params?)`、`window.__niko.getActions()`；仍只在 dev/`--debug-walk` 下暴露。
- **`stopWalk` 目前是 debug-only**（`main/ipc.ts:144-147` 有 `app.isPackaged` 拒绝）。打包版动作要暂停走路，必须新增生产可用的暂停/恢复接口（Lead 在 `contracts.ts` 冻结；platform/Lead 实现），不能复用 debug 通道。
- 全屏探头期间 `PetGestures` 需要 `setSuspended(true)`（或等价 gate）；`FullscreenState` 从 `pet:peek-state` 来，`interaction-actions` 只看 `active/edge/phase`，不自己检测全屏。

### 8.9 设置与全局快捷键注册（platform 实现，Lead 冻结 schema）

建议 `PetSettings` 增加（platform 的 `src/shared/settings.ts`）：

```ts
shortcuts: Partial<Record<ActionId, string>> // Electron accelerator，如 'Alt+1'
```

- 默认 `{}`；**保留 `Ctrl+Alt+P` 拍照**，其余留空（Q8 推荐，对应 COMMANDER-BRIEF Q15A）；只接受 `ActionId` 白名单；非法 key 丢弃。
- `parseSettings` 要扩展（当前 `hasValidFieldTypes` 只认平铺字段，`shared/settings.ts:50-57`）；可保持 `version: 1` 加可选字段，或升 v2 做迁移，由 platform/Lead 定。
- `shortcuts.ts`（platform 的 main）：注册/注销/冲突检测；`globalShortcut.register` 返回 false 时不保存并回显“该快捷键被占用”；重复绑定拒绝。
- 设置页：每个动作一行“录制快捷键/清除”，显示“已注册/冲突/不可用”；不把动作名显示在桌面。
- 注册时机：app ready 后、settings load 后；settings 变更时重建；before-quit `unregisterAll`。
- 动作触发：300 ms 去抖；隐藏时按 Q7；全屏探头/关闭时拒绝并日志；不因注册失败崩溃。
- system action（`photo`/`toggleVisible`）也走同一注册器，但由 main 直接执行，不经过 renderer bus；`toggleVisible` 隐藏时取消 renderer 动作，`photo` 复用现有冻结链路。

### 8.10 安全/健壮性清单

- 不接受渲染进程发起的“执行任意动作”请求；`pet:action` 只由 main → renderer。
- 白名单/参数在 main 与 renderer 各校验一次；未知字段丢弃，长度/范围 clamp。
- 禁止动作 id：`close`、`quit`、`settings`、`shell` 等不进入白名单；`photo`/`toggleVisible` 只作为 **system action** 在 main 白名单里，不能从 renderer 发起。
- 所有拒绝只写日志（`api.log`/main logger），不显示桌面文字（PRD）。
- 动作槽有超时兜底（例如 `duration + 1000ms` 强制释放），防止 animator 异常导致永久 busy；超时写日志。
- 关闭/隐藏/恢复时 `cancelAll`；恢复后 `manualTorch`/auto 状态要回到明确默认（Q4）。
- 自动行为（随机伸懒腰/吃面包）要检查 `actionBus.isBusy()`，否则会在用户动作中插播；`pet.ts:245-259` 需要加 gate。
- 全屏探头期间 `PetGestures` 的 press/long-press/drag/close 需要 suspend（INT-P1-09）；否则会在全屏游戏上弹出关闭粒子。

### 8.11 测试建议

**gesture.test.ts（我 ownership，I-1）**

1. 抖动：press → move(100, 8px) → 指针停在 8 px → tick(250) 应有 `dragStart`（按 Q1 推荐语义）；若 Q1 选择保留长按，则 tick(1500) 应 `toggleTorch`，绝不能两边都没有。
2. 抖动后回到 5 px 内：tick(250) 不拖拽；tick(1500) 火把；tick(2400) 聚；tick(3000) 关闭。
3. 250 ms 前移动、250 ms 后继续移动：`dragStart`；取消后续 timer；release → `dragEnd/release`。
4. 250 ms 到点已在 slop 外、无后续 move：也 `dragStart`（新逻辑）。
5. `release(1499)=click`、`release(1500)=toggleTorch`（边界）。
6. 1.5 s 后移动不拖拽、不取消关闭（已有，保留）。
7. 配置 `longPressMs=1000/2000`：1000/1900/2500 与 2000/2900/3500 三阶段边界。
8. `forceClose` 从 idle/dragging；`cancel`/`reset` 后无残留。
9. 丢失 pointerup 的 renderer 层：这是 DOM 集成，需 QA/CDP；纯逻辑至少测 `cancel()` 幂等。

**interaction-actions.test.ts（我 ownership 的新 interaction 测试）**

1. 未知 id、非法参数、超范围参数；system action 不允许 renderer 直接执行。
2. `canRunAction` 对每个 gate（gesture/dragging/closing/frozen/eating/posture/manualTorch/fullscreen/hidden）返回预期 reason。
3. cooldown、300 ms 去抖、repeat policy（ignore/toggle）。
4. auto torch 让路、manual torch 拒绝非 torch 动作；自动火把冷启动/暗边沿策略（若放进 TorchController 纯逻辑则在此测）。
5. `cancelAll` 后 `activeAction` 清理、可立即接手势。
6. `ActionId` 白名单完整性：`photo`/`toggleVisible` 属 system，不在 renderer spec；6 个 renderer 动作全部有 spec。

**真实桌面（QA）**

- 1.5 s/2.4 s/3.0 s 用 CDP 精确验证；手抖 6–10 px 后长按；拖拽 250 ms 边界；拖到另一显示器松手；关闭→托盘→恢复；关火把/自动火把/隐藏；8 个快捷键的动作/冲突/锁屏/全屏；长按期间按快捷键；关闭期间按快捷键；录音/截图确认无桌面文字。
- 性能：关闭 168 粒子、连续快捷键、隐藏时 CPU；QA 记录。

---

## 9. 文件级实现拆分（与我的 ownership 兼容）

### 9.1 我的任务（按 COMMANDER-BRIEF ownership）

| 任务 | 文件 | 内容 | 依赖 | 预估 |
|---|---|---|---|---|
| **I-0 探头冲突预研（T4–12）** | 只读 + 接口单（无源码写入） | 在 `pet:peek-state`/`FullscreenState` 协议下，列出全屏探头期间 press/long-press/drag/close 的冲突与建议 gate；给 behavior/platform/Lead 一页接口单 | Lead 的 `FullscreenState` 草案；不依赖用户回答 | 1–2 h |
| **I-1 手势 P0 修复** | `src/shared/gesture.ts`、`src/renderer/gestures.ts`、`tests/gesture.test.ts` | 去掉永久 slop 取消；250 ms gate 定时决策；`longPressMs` 配置化 + `nextDeadline`；拖拽开始时回弹（按 Q3）；补 P0-1/P0-2 测试 | 用户 Q1/Q2/Q3；无跨流代码依赖 | 2–3 h |
| **I-2 动作白名单/gate** | `src/renderer/interaction-actions.ts`、`tests/interaction-actions.test.ts` | `RENDERER_ACTION_SPECS`、参数校验、`canRunAction`、状态/reason、单测 | Lead 冻结 `ActionId`/priority；用户 Q6/Q7/Q8；接口评审 | 2–3 h |
| **I-3 粒子/火把生命周期** | `src/renderer/particles.ts`、`src/renderer/torch.ts` | `setEffectsEnabled`、无粒子关闭、`TorchController`（manual/auto/on、隐藏/关闭熄灭、自动让路、冷启动/暗边沿策略）；**pet.ts 接线不由我改** | 用户 Q4/Q5；behavior 把 `pet.ts` 接到 TorchController；Lead 冻结 torch 策略边界 | 2–3 h |
| **I-4 动作 bus** | `src/renderer/interaction-actions.ts`；`src/renderer/gestures.ts` 加 `interruptAction` | bus 编排、计时/取消/超时、hooks、与手势互斥、调试 API；**pet.ts wiring 由 behavior 做** | behavior 的 animator 方法；Lead 的 IPC/preload；I-2 契约 | 3–4 h |
| **I-tests** | `tests/gesture.test.ts`；`tests/interaction-actions.test.ts` | 回归 + 边界 + gate | 与 I-1/I-2 同步 | 1–2 h |

**interaction-dev 合计约 11–16 h（约 1.5–2 个工作日）**，不含跨流集成、用户等待和真机验收。

### 9.2 需要 Lead / behavior / platform 的集成改动

| 依赖方 | 需要的改动 | 原因 |
|---|---|---|
| **behavior**（`animator.ts`、`pet.ts`、`audio.ts`） | 1) animator 新增 `toy/sit/sleep/wake/cancelAction` 与 `isBusy/isFrozen`；2) `pet.ts` 暴露 `runEat(bites)` / `runToy()` / `getActionHostState()`；3) `pet.ts` 接入 `InteractionActionBus`，用 `interruptAction`、`cancelAll`；4) 把 torch 变量迁到 `TorchController`，并在 hide/close/restore 调用统一复位；5) 随机面包/伸懒腰加 `actionBus.isBusy()` gate；6) 恢复时明确火把默认（Q4）；7) `audio.ts` 加 `fireLoop/purr/meow` 循环与资产解码；8) 修 `lastAutoTorchAt=0` 冷启动/新暗边沿（INT-P1-08） | behavior 是 `pet.ts`/`audio.ts`/姿态 layer 的唯一 owner；interaction 只提供协议/策略 |
| **platform**（preload、`shared/settings.ts`、settings UI、`main/**` 除 `index/ipc`） | 1) `settings.shortcuts` 字段 + 校验；2) `shortcuts.ts` 注册/注销/冲突（含 system actions）；3) 托盘动作子菜单（可选）；4) 托盘单击显示（P0-1）；5) `pet:peek-state` 暴露给 renderer；6) 隐藏时“显示后执行动作”的 main 流程；7) `preload` 的 `onAction/reportActionResult/onPeekState`；8) `AssetName` 放行新音效 | 这些文件按 COMMANDER-BRIEF 归 platform |
| **Lead**（`main/index.ts`、`ipc.ts`、`src/shared/contracts.ts`、`ASSET_PATHS`） | 1) 冻结 `ActionId`/priority/`FullscreenState`/`BehaviorMode`；2) `pet:action` 通道 + `requestId` + 结果日志；3) `pet:peek-state` 接线；4) `ASSET_PATHS` 放行 purr/meow/click（与 platform 的 `AssetName`、behavior 的 audio 三处一致）；5) 生产可用的 walk pause；6) `closeScene` origin 统一或删除；7) 合并/build 最终评审 | Lead 独占的跨进程/协议文件和 `ASSET_PATHS` |
| **qa-visual** | 真机时序/手抖/pointerup/跨屏/DPI/关闭恢复/快捷键矩阵/探头期间手势/性能；截图/录屏；A05/A08/A09/A13 回归 | 我无法启动可见 GUI |
| **Codex 指挥部** | 评审本接口、确认白名单/优先级；`COMMANDER-BRIEF` 已覆盖 Q14/Q15，若后续评审改变以新意见为准 | 规划/评审 |

### 9.3 建议实施顺序（按 COMMANDER-BRIEF 的 P0 顺序）

1. **Lead T0–4**：冻结 `ActionId`/`FullscreenState`/设置迁移接口；用户答复 Q1–Q8（尤其 Q1/Q2/Q3 决定 I-1，Q6/Q7/Q8 决定 I-2/I-4）。
2. **T4–12**：我做 **I-0 只读探头冲突预研**（不写 src）；platform 做托盘单击/全屏 watcher，behavior 做只露头姿态；QA 准备 CDP。**先交付 G1（全屏探头 + 托盘找回），用户确认后才进入 P0-2/P0-3。**
3. **G1 后 T24–36**：Lead 集成；我做 I-1（手势阻断修复/长按配置）、I-2/I-3/I-4；behavior 接 pet.ts/audio，platform 接设置/快捷键。I-1 也可被 Lead 提前作为 P0-0 的阻断修复候选（如果 baseline smoke 认为“长按不可达”必须先修）。
4. **T36–48**：第一个“快捷键伸展/火把/喂食”端到端 demo，Lead 接线；QA 矩阵；G2。
5. 所有用户可见功能仍按 Brief 要求先给选项/预览，再实现。

### 9.4 时间盒建议

- I-1：半天内可交付（含测试）。
- I-2 + I-4：1–1.5 天（含评审/接线）。
- I-3：0.5–1 天（跨流）。
- 团队首个可演示的动作快捷键：**2–3 个工作日**（不含 G1、用户等待和 QA 排期；按 Brief 在 G1 确认后才进入 P0-3）。

---

## 10. 需要用户拍板的功能问题（8 个）

> 每个问题都给了 2–4 个选项，推荐项标 ✅。未确认前不写实现；默认值按推荐项。

### Q1. 按下最初的轻微抖动，怎样处理？

- **A（推荐）250 ms 到点按“当前位置”决策**：还在 5 px 内 → 继续长按（1.5 s 火把、3 s 关闭）；已经离开 5 px → 直接进入拖拽。前 250 ms 内的移动**不会永久取消**长按。
- B 保持现状：前 250 ms 内超过 5 px 就永久取消长按（手抖一次，火把/关闭全失效）。
- C 放宽 slop 到 12 px，但仍永久取消（治标）。
- D 只有在 250 ms 后真正进入拖拽才取消长按；无论移多远，只要没拖拽就保留长按。

> 推荐 A：同时解决“手抖就废”和“250 ms 后停住无法拖拽”两个问题；D 会让“移开很远后按住”误触火把，不推荐。

### Q2. 设置里的“长按切换火把时长”要不要真的生效？

- **A（推荐）全链路生效**：`longPressMs`（1000–2000 ms，默认 1500）驱动三阶段；聚粒子 = 长按 + 0.9 s；关闭 = 长按 + 1.5 s；renderer 不再写死 1500/2400/3000。
- B 只让火把时长可调，聚粒子固定 2.4 s、关闭固定 3.0 s。
- C 去掉这个设置项，永远 1.5/2.4/3.0。

### Q3. 按住/拖拽时的“压扁”什么时候回弹？

- **A（推荐）拖拽开始就回弹；长按到设定时长（默认 1.5 s）切火把时也回弹**，让拖拽、火把、关闭阶段宠物是正常站姿。
- B 只在拖拽开始时回弹；长按保持压扁到松手。
- C 整个按住期间都压扁，松手/关闭才恢复（当前实现）。

### Q4. 关闭/隐藏后的火把状态？

- **A（推荐）全部熄灭并停循环音**：关闭到托盘、托盘隐藏、全屏藏身都收起；重新显示默认熄灭（手动再长按/快捷键点）。
- B 记住状态：重新显示时恢复火把；隐藏期间静音/停光照。
- C 只有“关闭到托盘”熄灭；普通隐藏保留。

### Q5. “关闭粒子”设置关掉时，长按关闭应该怎样？

- **A（推荐）关闭手势仍生效，但不聚粒子、不爆发**：角色约 0.2 s 淡出直接隐藏；关闭音效保留；托盘可恢复。
- B 开关只影响日常粒子（火星/爱心），长按关闭永远保留紫色爆发，因为它是关闭的核心反馈。
- C 关闭时改为极简 0.5 s、小范围紫色粒子，保证仍有反馈。

### Q6. 第一批“自定义快捷键”动作做哪些？（与 COMMANDER-BRIEF Q14 对齐，不重问细节）

- **A（推荐，等同 Brief Q14A）8 个**：拍照、显示/隐藏、喂面包、玩具（雪球）、坐下/起身、睡觉/起床（再按=醒）、伸懒腰、火把开关。
- B 6 个纯互动动作：喂面包、玩具、坐下/起身、睡觉/起床、伸懒腰、火把开关（不含拍照/显隐）。
- C 4 个最小集：拍照、显示/隐藏、喂面包、伸懒腰。
- D 在 A 上加挥手/转圈/摸头/跳舞，超过 8 个；需要扩大首批范围并接受更多互斥测试。

> 推荐 A：与 COMMANDER-BRIEF Q14 的推荐集合一致；拍照/显隐是 system action，喂食/玩具是 behavior 动作，坐睡/伸展/火把是已有或近期动作。“醒”用 `sleep` 再按覆盖，不单独占第 9 个；喂食/玩具/摸头的表现细节按 Brief Q10–Q12 的回答执行，本审计不重复定义。

### Q7. 快捷键在“宠物隐藏/正忙”时怎么处理？

- **A（推荐）隐藏 → 先无焦点显示宠物再执行；正忙 → 拒绝并写日志**（不排队、不弹桌面文字）。
- B 隐藏和正忙都拒绝；只在可见且空闲时执行。
- C 隐藏 → 先显示并执行；正忙 → 排队，空闲后补演一次。
- D 隐藏 → 执行但不高亮（只出声/不显示）；正忙 → 拒绝。

> 推荐 A：符合“随叫随到”，又不会让排队动作在 10 秒后突然出现（低打扰）。

### Q8. 快捷键的作用范围和默认绑定？（与 COMMANDER-BRIEF Q15 对齐）

- **A（推荐，等同 Brief Q15A）全局快捷键 + 只保留 `Ctrl+Alt+P` 拍照，其余默认留空**；设置页录制，冲突/注册失败当场解释并拒绝保存。
- B 全局 + 每个动作预置默认组合键（如 `Alt+1..8`），可改。
- C 冲突时自动改用相邻组合键。
- D 只在鼠标悬停宠物时生效（不是全局），默认不绑定。

> 推荐 A：避免与用户已有软件冲突，也避免“注册不上还悄悄换键”的不可预期行为。若用户想要“开箱即用”，B 是折中，但必须显示所有默认键位。

---

## 11. 验收/回归清单（建议 QA 使用）

### 11.1 手势/拖拽

- [ ] 单击：压扁 → 松开 220 ms 回弹 + Ya2 + 摸头（歪头/闭眼/爱心/呼噜）。
- [ ] 手抖 6–10 px 后按住 1.5 s：仍能切火把（Q1 修复后）。
- [ ] 手抖后按住 2.4/3.0 s：聚粒子/关闭可达。
- [ ] 按下后 249 ms 移动 8 px → 不拖；250 ms 后移动 → 拖。
- [ ] 250 ms 到点时已移出 5 px、之后不再移动 → 进入拖拽（新逻辑）。
- [ ] 1.5 s 后移动 → 不拖拽，关闭计时继续。
- [ ] 1.5 s 后松开 → 只切火把 + Ya2，不关闭。
- [ ] 拖拽中松手 → 落到当前显示器任务栏上方 + 落地挤压 + Ya2；按压期间不再压扁（Q3 后）。
- [ ] 拖到第二台显示器 → 跟手、clamp、松手落点正确；角色不变形（P1-02 修复后）。
- [ ] pointerup 丢失/窗口 blur/托盘隐藏：手势复位，不残留 dragging。
- [ ] 长按期间 main 走路是否符合预期（如需暂停 walk 要确认）。

### 11.2 关闭/火把/粒子

- [ ] 关闭：默认 2.4 s 聚粒子、3.0 s 爆发 120–160 个、约 1.2 s 后托盘；Q2 配置后按“长按 + 0.9/1.5 s”相对时长；点穿透；托盘恢复。
- [ ] 关闭时手上有火把：先熄灭/收起再爆发；恢复后默认不亮（Q4）。
- [ ] 托盘隐藏时自动火把不触发、不响；恢复不残留。
- [ ] 自动火把只在暗处触发、12–18 s、10 min 冷却；手动优先；亮度变亮关闭。
- [ ] **冷启动即暗**（应用启动 ≤10 min）能立即触发 auto torch；**手动关火把后**，亮度仍暗时不立刻重开，需先回到阈值以上再变暗（INT-P1-08）。
- [ ] 火把循环音/火星（若本轮做）。
- [ ] `particles=false`：gather/burst 不出现；关闭仍能隐藏（Q5）。
- [ ] 关闭/恢复期间按快捷键：拒绝；无桌面文字。

### 11.3 动作快捷键

- [ ] 8 个首批动作逐个触发：拍照、显示/隐藏、喂面包、玩具（雪球）、坐下/起身、睡觉/起床、伸懒腰、火把开关；动作完整、无穿模/无桌面文字。
- [ ] 隐藏时按（Q7）→ 显示并执行，或按用户选择。
- [ ] 手势按下/拖拽/关闭时按 → 拒绝；关闭优先。
- [ ] 喂食/玩具/坐睡/自动火把/照片冻结时的互斥符合矩阵；system action（拍照/显隐）由 main 正确执行。
- [ ] 同 id 再按：toggle 动作退出/切换；timed 动作忽略。
- [ ] 快捷键冲突/非法键：设置页提示，不保存、不崩溃；`Ctrl+Alt+P` 保留。
- [ ] 键重复/长按不会连发（300 ms 去抖）。
- [ ] 动作结束/取消后 150–300 ms 平滑回到 idle，不瞬移。
- [ ] 关闭→恢复后动作槽为空、火把状态符合 Q4。
- [ ] **全屏探头期间**：长按/拖拽/关闭被 suspend（INT-P1-09），不弹出全屏紫粒子；退出全屏恢复正常。

### 11.4 系统/性能

- [ ] 125% DPI、双屏不同分辨率：点击命中、拖拽尺寸、落点。
- [ ] 关闭粒子全屏时 CPU/GPU；待机 CPU <3%、走路 <8%（A13）。
- [ ] 隐藏时停止渲染/轮询（A13）。
- [ ] 点击桌宠不抢焦点（PRD §3.2；platform/QA 复核）。
- [ ] 透明区域点击穿透仍然正常。

---

## 12. 风险与未覆盖

- **未做 GUI 验收**：真实时序（1.5/2.4/3.0 s）、拖拽跟手、125% DPI、跨屏、托盘单击、焦点、音频、粒子观感均需 QA/Lead 补测；代码路径成立不代表观感/性能达标。
- **用户正在运行的实例未触碰**：没有重启/杀进程；当前工作区的 M2/M3 改动与运行实例可能不同步，验收基线以构建产物为准。
- **COMMANDER-BRIEF 已出现并对齐**：本审计按它的 ownership、`ActionId`/`FullscreenState` 冻结、P0-0/P0-1 优先和 Q14/Q15 修正了动作集合/文件命名/顺序。若后续评审改变，以新版 Brief 为准。
- **P0 顺序**：按 Brief，先 P0-0 保全 + P0-1 全屏探头/托盘单击；本审计的 I-1（长按不可达）是阻断修复候选，是否在 G1 前插入由 Lead 决定。用户未答 Q1–Q8 前，我不写实现。
- **所有权**：`src/renderer/interaction-actions.ts` 已由 COMMANDER-BRIEF 列入我的 ownership；`pet.ts`、`audio.ts`、`main/**`、`preload`、`settings`、`shared/settings.ts` 不归我，必须由 Lead/behavior/platform 接。未经授权我不会改这些文件。
- **动作接口与 behavior 的 sit/sleep 状态机有重叠**：建议 behavior 的 posture 状态机是唯一真相，action bus 只发“请求坐/睡/起”；否则会出现两套状态互抢。
- **system action 的归属**：`photo`/`toggleVisible` 由 main 执行，renderer 只负责“当前是否冻结/忙”的状态上报；如果 Lead 决定统一走 renderer，需要新增 `pet:visible` 类通道并重新评估优先级。
- **Electron 44.7.0 锁定**：所有快捷键/窗口改动不得升级 Electron；`globalShortcut` 在打包版的行为要真机验证。
- **autostart/fullscreen/tray**：属于 platform 流，本审计只指出与互动交叉的接口（隐藏、全屏、动作），不判断其实现质量。

---

## 13. 给 Lead 的结论

**Top P0**：

1. **INT-P0-01** 前 250 ms 抖动永久取消长按 → 火把/关闭不可达（已复现，必须最先修）。
2. **INT-P0-02** `longPressMs` 设置无效、计时双处硬编码（Lead 的 P0-2 验收条件）。
3. **INT-P0-03** 自定义动作快捷键没有 renderer 动作接口；但 COMMANDER-BRIEF 已把 `interaction-actions.ts` 列入我的 ownership，按 P0-2/P0-3 实现，不是新文件 scope 请求。
4. **INT-P0-04** 火把状态在关闭/隐藏/恢复后残留；自动火把隐藏期间可能触发/出声。
5. **INT-P1-08**（紧邻 P0）冷启动暗处 10 分钟不 auto；手动关火把后没有新暗边沿判定，A07 需要一起修。

**接口建议**：Lead 在 `src/shared/contracts.ts` 冻结 `ActionId`/priority/`FullscreenState`；我在 `src/renderer/interaction-actions.ts` 实现 6 个 renderer 动作的白名单/gate/bus，`photo`/`toggleVisible` 作为 system action 由 main 执行；IPC 走 `pet:action` + `pet:peek-state`；首批 8 个动作按 Brief Q14A（拍照、显隐、喂食、玩具、坐、睡、伸展、火把），细节按 Brief Q10–Q12。手势优先、显式动作优先于自动火把/随机行为；默认仅保留 `Ctrl+Alt+P`，其余留空；拒绝只写日志；需要生产可用的 walk pause（现有 `stopWalk` 是 debug-only）。

**问题**：8 个（Q1–Q8，§10）。Q1/Q2/Q3 阻塞 I-1；Q4/Q5 影响 I-3；Q6/Q7/Q8 阻塞 I-2/I-4；Q6/Q8 与 COMMANDER-BRIEF Q14/Q15 对齐，不重复定义细节。

**工作量**：interaction 约 **11–16 h**（I-0 1–2 h、I-1 2–3 h、I-2 2–3 h、I-3 2–3 h、I-4 3–4 h、测试 1–2 h）；团队首个可演示动作快捷键约 **2–3 个工作日**（G1 之后，含 behavior/platform/Lead 接线与 QA）。

**状态**：**Ready for implementation**，但按 COMMANDER-BRIEF 顺序：先做 T4–12 的 **I-0 只读探头冲突预研/接口单**；I-1 等 Lead 的写任务（可作为 P0-0 阻断修复候选或 G1 后 P0-3）；不抢 P0-1 的托盘/全屏实现。**在 Lead 分配带 write scope 的实现任务前，我不写任何源码。**

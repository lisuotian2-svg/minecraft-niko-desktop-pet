# BEHAVIOR-P0-B — Head-only 全屏探头 + 关闭手举告示牌

> 任务：task-10（P0-1b behavior）· behavior-dev · 2026-10-21
> 范围：`src/renderer/animator.ts`、`src/renderer/pet.ts`、`src/renderer/sign.ts`（新）、`src/renderer/snacks.ts`、本文件。
> 未改 `src/main/**`、`src/preload/**`、`settings`、`gestures`、`torch`、`particles`；未启动 GUI，未杀/重启用户实例。
> 前置：task-7 / `BEHAVIOR-P0-A.md`、`src/shared/contracts.ts`、`src/main/peek.ts`、`PLATFORM-AUDIT.md`。
> G1 结论：**head-only pose 的 renderer 侧已完成并构建通过；close sign 的 renderer overlay 已完成，但 main/preload 的 close-sign 通道尚未存在，G1 若要求 sign 需 Lead/platform 补 §4 的通道。**

---

## 1. 完成摘要

| 项 | 状态 | 说明 |
|---|---|---|
| 消费 `FullscreenState` | ✅ | `api.onPeekState` 必选已接入；`pet.ts` 保存 state |
| Head-only 姿态 | ✅ | `animator.setFullscreenPeek(state)`；隐藏 body/arms/legs 并移出 raycast layer；只留 head+hat |
| 头中心对齐 `headAnchor` | ✅ | 2-pass 相机投影修正 wrapper x/y；锚点来自 contracts（main 当前给窗口中心） |
| 边缘滑入/滑出 | ✅（renderer） | `hidden/peeking/revealed/returning` 状态处理；窗口位置由 main 负责 |
| 点击头部 reveal | ✅ | click 命中 head → `animator` emit `peekReveal` → `api.revealPeek()`；main 回底部 10s |
| 2s cursor rule in peek | ✅ | 点击头部设置 `cursorLookUntil=+2000ms`；在 peek 的剩余帧/回到底部后只在这 2s 内看鼠标，否则随机头动 |
| 不追鼠标常态 | ✅ | 保持 task-7 规则；peek 不启用身体 360，只做头部 random glance |
| 与动作互斥 | ✅ | peek active 时 `ActionHostState.fullscreenPeek=true`；随机 eat/stretch 暂停；torch 静音隐藏；eat 取消 |
| 退出全屏恢复 | ✅ | `active=false/phase idle` → 全身/zoom/默认 3/4 yaw 恢复 |
| 关闭手+木牌 overlay | ✅ renderer-only | `sign.ts` 绘制 hand+wood sign，英文 `I'M IN THE TRAY`，left/right/bottom，entering/holding/leaving；点击回调 |
| close-sign main 通道 | ❌ 未接 | preload/main 没有 `onCloseSign` / `revealFromCloseSign`；main 仍在粒子后 1.2s hide，需 Lead/platform |
| 构建/类型/测试 | ✅ | build 0、tsc 0；vitest 50/50（QA 已更新 settings v2 测试） |

---

## 2. Head-only 探头实现

### 2.1 状态映射

`PetAnimator.setFullscreenPeek(state: FullscreenState)`：

| `phase` | 是否 head-only | 说明 |
|---|---|---|
| `hidden` | ✅ | 窗口完全藏在边缘外；body 隐藏，head 保留（不可见） |
| `peeking` | ✅ | 窗口从边缘滑入；head 中心对齐 `headAnchor` |
| `revealed` | ✅ | 停留 4–8s；只有头，随机 glances |
| `returning` + `revealUntil === null` | ✅ | 自动缩回边缘；保持 head-only，避免 body 闪出 |
| `returning` + `revealUntil !== null` | ❌ | 点击头部后 main 把窗口移回底部 10s；恢复全身 |
| `idle` / `active=false` | ❌ | 恢复正常 3/4 姿态 |

### 2.2 只露头的实现

- `skin.body/rightArm/leftArm/rightLeg/leftLeg`：`visible=false` 且 `layers.set(1)`， raycast 默认 layer 0 不会再命中不可见身体（避免透明区域误点 reveal）。
- `skin.head` + outer hat 保持 layer 0 / visible。
- `viewer.zoom` 从 0.55 → **0.9**；退出恢复 `savedZoom`。
- `playerWrapper.rotation = 0`，body 不再做 360/头部 yaw；head 只在 local ±55° / pitch 安全范围内动。
- 头中心：`centerPeekHead()` 用 `head.localToWorld(0,4,0)` + 2-pass 投影，把 head centre 放到 `FullscreenState.headAnchor`（main 当前发窗口中心）；不依赖窗口屏幕坐标。
- 隐藏阴影：`pet.ts`/`animator` 的 frame info `mode='peek'` → `ContactShadow` 隐藏；不产生 body 阴影。
- 随机调度：`peekActive` 时 `scheduleSnack/scheduleStretch` 直接跳过；`canStartScheduled()` 也因 mode peek 拒绝。

### 2.3 点击头部

- head-only 状态下，`PetGestures` 的 hit test 只命中 head（body layer 1）。
- `animator.pet()` 在 `peekMode` 下有特殊分支：
  - 设置 `cursorLookUntil = now + 2000ms`；
  - emit `{type:'peekReveal'}`；
  - **不**设置普通 2.5s pet 模式/purr/hearts（避免把 reveal 当普通摸头）。
- `pet.ts` 监听 `peekReveal` → `api.revealPeek()`；main 将窗口回到底部。
- 回到 normal 后 `peekMode` 关闭，`mode='idle'`；2s cursor look 仍有效（task-7 规则），所以用户能在回到底部后看到 2s 看鼠标，然后自由待机。
- `revealPeek` 通道已由 preload 提供；`IPC_CHANNELS.peekReveal` 在 contracts。

### 2.4 2s cursor rule in peek

- 只有 click head 才设置 look window；peek 的其他时间 head 随机 glance（±0.18/±0.16）。
- 不启用 body 360；head-only 不转体。
- 与 task-7 一致：walking/吃/伸/拖/睡/peek 期间不连续看鼠标。

---

## 3. Close sign renderer overlay

### 3.1 `src/renderer/sign.ts`

- `CloseSignOverlay` 独立 2D canvas，`position:fixed;inset:0;z-index:12;pointer-events:none`；只在 close sign 可见时绘制。
- 消费 `CloseSignState`（`visible/edge/phase/windowBounds`）：
  - `entering` 350ms、`holding` 保持、`leaving` 300ms 滑入/滑出；
  - `edge: left/right/bottom`，木牌从对应边缘进入；
  - 只画 **右手 + Minecraft 木牌**，不画身体；
  - 木牌使用像素字 `I'M IN THE TRAY`（5×7 自绘字体，Canvas 2D），不使用受保护资产；
  - `phase='hidden'` 或不 visible 时清空。
- `onReveal`：点击 sign 区域（`signRect` ±16px）回调；`pet.ts` 把它接到可选 `revealFromCloseSign`，缺失时只日志。
- 主进程未发 state 时无任何视觉；不会在普通待机/探头时出现。

### 3.2 需要的 main/preload 通道（当前缺失）

contracts 已有 `IPC_CHANNELS.closeSign: 'pet:close-sign'`，但没有 reveal 通道；建议：

```ts
// preload
onCloseSign(callback: (state: CloseSignState) => void): () => void
revealFromCloseSign(): void

// IPC
main -> renderer: pet:close-sign          // CloseSignState
renderer -> main: pet:close-sign-reveal    // 点击 sign；需加入 contracts.IPC_CHANNELS
```

main 关闭时序需要改（Lead/platform，不属于 behavior 写权限）：

- 紫色粒子 3.0s 结束后（用户要求 2.5s）**不要立刻 hide**；
- 保持全屏透明窗口，发送 `CloseSignState`：
  - `entering` 从左/右/下随机边缘（手+牌）进入；
  - `holding` 2.5s；
  - `leaving` 缩回；
- 窗口此时应允许点击 sign（`setIgnoreMouseEvents`/hit test 要覆盖 sign 区域），点击后 `pet:close-sign-reveal` → main `show()` 宠物并隐藏 sign；
- 关闭窗口若在 sign 期间被 tray/quit 取消，需要清 state；renderer `onCloseSign({visible:false,...})` 清理。
- 现有 main `beginClose` 1.2s 后 `finishClose` hide，**无法显示 sign**；这是 sign 的唯一阻塞项。

### 3.3 当前状态

- Renderer overlay 已完成、可接收 state；但 preload 没有 `onCloseSign`，main 也没有发送/点击链路，所以 G1 的“关闭手举牌”目前**不可端到端**。
- G1 最小交付是 head-only（Lead 已明确）；sign 可在 main 时序接好后立即启用，无需再改 renderer 结构。

---

## 4. 接口 / 权限清单

| 项 | 状态 | 需要谁 |
|---|---|---|
| `PetApi.onPeekState` | ✅ preload 已有 | platform |
| `PetApi.revealPeek` | ✅ preload/main 已有 | platform |
| peek `FullscreenState` 发 state | ✅ main 已有 | — |
| `PetApi.onCloseSign` | ❌ | platform/preload |
| `PetApi.revealFromCloseSign` | ❌ | platform/preload |
| `IPC_CHANNELS.closeSignReveal` | ❌ contracts 未定义 | Lead |
| main 粒子后保持窗口/发送 sign/点击 show | ❌ | Lead/platform |
| `performanceMode`/walking 60fps | task-11/后续 | platform |

---

## 5. 构建/测试

```text
electron-vite build  exit 0
  main 80.06 kB / preload 5.90 kB / renderer 942.01 kB, 349ms
tsc --noEmit         exit 0
vitest run           exit 0: 5 files / 50 tests passed
```

> 说明：build 的 main 80.06 kB 来自 platform 当前集成；renderer 942.01 kB 含 `sign.ts`。QA 已把 settings v2 测试补齐，50/50 通过。

---

## 6. 实机验收步骤（Lead/QA）

### 6.1 Head-only

1. 进入一个全屏应用（F11/视频全屏），等待 20–45s 首次 peek。
2. 观察窗口边缘：**只出现头+帽子，无 body/arms/legs/道具/地面阴影**。
3. `window.__niko.getState()`：
   - `peeking: true`（或 `mode: 'peek'`）；
   - `bodyYaw`/normal walk 不更新；
   - `headRotationY` 在 ±55° 内；
   - `headRotationX` 在安全范围；
   - `getPeekState()` 返回 main 的 phase/edge/headAnchor。
4. 移动鼠标到头部：不连续追鼠标；观察 random glance。
5. 点击头部：main 回底部；`revealPeek()` 生效；`peekActive` 仍为 true 时 action bus 被 gate；2s 内 head 看鼠标（回到 normal 后），之后自由待机。
6. 10s 后再次 peek；退出全屏后 body 恢复、zoom 0.55、无残留 head-only。
7. 四边：bottom/left/right 各至少一次；检查 head 中心贴边、无 body 露出、点击头可 reveal。

### 6.2 Close sign（main 通道接好后）

1. 长按 3s 关闭；粒子结束后 2.5s，从 left/right/bottom 之一出现 **hand + wood sign**；画面无身体。
2. 木牌文本 `I'M IN THE TRAY` 清晰、无其他文字。
3. 2.5s 后缩回；关闭完成，托盘保留。
4. 点击 sign → 宠物从托盘/底部显示；屏幕无残留 sign。
5. 检查 `setIgnoreMouseEvents`/hit test：sign 可点，桌面其余区域仍穿透。

---

## 7. 已知限制

- 未运行真实 CDP/GUI；head-only 的头中心/缩放/命中区域需要 QA 真机确认。
- Head-only 的 zoom 0.9 与 `savedZoom` 恢复是 renderer 常量；如果用户设置尺寸/DPI 特殊，需 QA 检查是否有裁切。
- `centerPeekHead` 用窗口内投影；如果 platform 后续改变 `headAnchor` 或窗口非方形，需要复测。
- close sign 无 main/preload 通道，当前不会出现；renderer `onCloseSign` 为 optional，preload 加入后自动生效。
- close sign 点击依赖窗口可交互；main 需要在 sign holding 阶段设置 interactive / hit test，否则点击穿透。
- 未实现 sit/sleep/wake/dance/wave、hand-feed（P0-b）。
- task-7 的 2s/360/接触阴影规则保持不变；peek 不启用 body 360。
- 未创建 task-10 的 `sign` 受保护资产；像素手/木牌/文字全部由 canvas 绘制。

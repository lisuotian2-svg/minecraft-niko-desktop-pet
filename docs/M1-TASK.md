# M1 — 工程骨架 + 基础动作（给 Codex）

> 前置：先读 `AGENTS.md`、`docs/PRD.md`、`docs/TECH-PLAN.md`、`docs/DECISIONS.md`、`M0-REPORT.md`。
>
> **不要启动可见 GUI 自测**；本环境 Electron 窗口会被 Job/UI 限制卡住。只需 `pnpm build`、`pnpm test`、类型检查。真实桌面由 Lead 用 scheduled task + CDP 验收。
>
> **Electron 锁定 44.7.0**，不要升级。官方 44.7.0 已在 `node_modules/electron/dist`。

## 目标

把 M0 的单文件 spike 拆成可维护模块，并完成 M1：透明桌宠在任务栏上方左右走、待机、眨眼、看鼠标、点击压扁/摸头、托盘、设置骨架、点击穿透不回归。

## 非目标（留给 M2/M3/M4）

- 长按 1.5s 火把、3s 关闭、拖拽、紫色粒子
- 伸懒腰、坐下/睡觉、吃面包、火把、全屏探头
- 拍照、完整向导、安装包
- 任何桌面文字/气泡/名字

## 交付结构（建议，允许等价拆分）

```
src/main/
  index.ts           # 生命周期、单实例、协调
  pet-window.ts      # BrowserWindow、透明/置顶、底部定位、移动循环
  settings.ts        # JSON + zod 校验 + 原子写
  tray.ts            # 托盘
  ipc.ts             # 类型化 IPC
  logger.ts          # 文件日志（userData/logs 或 artifacts）
src/preload/index.ts # contextBridge API
src/shared/
  settings.ts        # schema/defaults/types
  walk.ts            # 纯行走/边界/节奏数学
  constants.ts
src/renderer/
  index.html
  pet.css
  pet.ts             # 入口：组装 viewer/animator/gestures/audio
  viewer.ts          # SkinViewer + 相机/灯光/阴影
  animator.ts        # 姿态状态机（idle/walk/pet）
  gestures.ts        # pointerdown/up、压扁回弹、命中
  hit-test.ts        # Raycaster + 皮肤 alpha
  audio.ts           # Ya1/Ya2 + 脚步（可选，M1 先接点击音）
tests/
  walk.test.ts
  settings.test.ts
```

## 功能要求

### 1. 窗口

- 420×420，透明、无边框、无阴影、skipTaskbar、alwaysOnTop。
- 底部居中：`workArea.bottom` 为窗口底边；`workArea` 左右为行走边界。
- 初始 `focusable` 保持 M0 的 `true`（M1 先保证输入；非抢焦点在后续实测再调）。
- `showInactive()` 显示；不要主动抢焦点。
- 单实例。
- 托盘：显示/隐藏、设置、拍照（占位，只写日志/提示）、退出。
- 关闭窗口不退出进程；托盘退出才退出。

### 2. 行走 / 待机（main + renderer 协作）

- main 用 30fps 定时器移动窗口：
  - 每 3–8 分钟开始一次行走，持续 10–40 秒（慵懒）。
  - 速度约 40px/s，随窗口宽度微调；到 `workArea` 边缘反弹。
  - 每次开始/停止/转向通过 IPC 通知 renderer（`pet:walking`、`pet:facing`）。
  - 隐藏窗口时暂停移动；显示后恢复。
- renderer：
  - 行走：手臂/腿反相摆动、身体轻微上下、头微晃；转向用 200–300ms 平滑旋转。
  - 待机：呼吸（身体轻微起伏）、随机眨眼、偶尔左右看；头看向屏幕光标（限制 ±30°）。
  - 状态切换平滑，不瞬移。
- 提供调试入口（仅 dev）：
  - `--debug-walk`：启动后立即开始走，方便截图。
  - `window.__niko`：暴露 `{ viewer, getState(), forceWalk(direction?), stopWalk() }`，供 CDP 验收。
- 纯行走/节奏逻辑放 `src/shared/walk.ts`，可测试（边界反弹、clamp、方向、延迟范围）。

### 3. 点击 / 压扁 / 音效

- 保留 M0 行为：射线命中 + 皮肤 alpha 才能交互；点击角色才响应。
- 按下：`scale (1.05, 0.88, 1)`，脚底 pivot；播放 Ya1。
- 松开：220ms 鲸鱼娘缓动回弹；播放 Ya2；角色做摸头反应（歪头/闭眼/轻微开心摆动，2–3 秒）。
- 不能误触：透明区域不响应；点击穿透不回归。
- 单击反应与走路可叠加，但不要破坏走路姿态。

### 4. 眨眼

- 实现真正的眨眼：建议生成一张“闭眼”皮肤纹理变体，在 100–140ms 内切换 head/face 贴图；或等价的小遮片方案。
- 不要用整体缩放头来假装眨眼。
- 频率 3–7 秒，偶尔双眨。
- 如果方案有风险，先做可回退的简单版本并在报告说明。

### 5. 设置骨架

- `settings.json` 存 `app.getPath('userData')`，zod 校验，损坏文件改名备份并恢复默认，原子写。
- 字段至少：`size`（默认 220）、`volume`（0.4）、`muted`、`autostart`（默认 false）、`longPressMs`（1500）、`darkThreshold`（30）、`autoTorch`（true）、`clickSounds`（true）、`particles`（true）、`nickname`、`firstRun`。
- M1 只要求一个最小设置窗口：显示版本、size/volume 两个滑块 + 保存/关闭；托盘能打开。完整向导 M4。
- 渲染器/主进程通过 IPC 读设置；改音量立即生效（点击音）。
- 不引入 React/Vue。

### 6. 日志

- main 写 `userData/logs/main.log`（或项目 `artifacts` 当 dev），记录：启动、窗口创建、加载、穿透切换、skin loaded、手势、错误。
- renderer 现有 `pet:log` 转发到该日志；方便 Lead 用 CDP/文件排查。

### 7. 测试

- 安装 vitest（用 `pnpm add -D vitest --store-dir .pnpm-store/v11`，避免 store 报错）。
- `pnpm test` 至少覆盖：
  - walk：左右边界反弹、direction、dt、clamp、下一个行走区间在 3–8 分钟。
  - settings：默认值、范围 clamp、坏 JSON 回退。
  - 可选：压扁 easing 的端点/单调性。
- `pnpm build` 必须通过（electron-vite build + tsc strict）。
- 不要求 Playwright/E2E。

## 约束

- 只改本项目；不要改 `docs/`、`public/assets/skin/niko.png`、`public/assets/whale/*`。
- 可以新增 `M1-REPORT.md`。
- 不要提交 `node_modules`/`out`/`artifacts`。
- 不要发布、不要改全局配置。
- 时间盒约 30–40 分钟；优先保证 M1 可运行、可验收，不要提前做 M2 功能。

## 完成时报告

`M1-REPORT.md`：

```md
# M1 报告
## 完成
## 文件结构
## 验证命令与结果（build/test）
## 已知问题
## 给 Lead 的验收步骤（含 `window.__niko` 调试方法）
```

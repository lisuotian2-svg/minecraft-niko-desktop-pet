# Niko Pet 3D — 技术方案（v0.1）

> 配套 `PRD.md`。目标是让 Codex 能按模块直接实现，并让 Lead 能在真实桌面上验收。
>
> 技术选型：**Electron 44 + Three.js 0.186 + skinview3d 3.4.2 + TypeScript + electron-vite**。
>
> 平台：Windows 11 x64；当前机器 1536×960 逻辑像素、125% DPI、单屏、RTX 5060 + Intel UHD。

---

## 1. 为什么这样选

| 选择 | 理由 |
|---|---|
| Electron | 透明窗口、始终置顶、托盘、全局快捷键、截图、打包都成熟；Three.js 直接在 Chromium 里跑 |
| skinview3d | 专门解析 64×64 Minecraft 皮肤：Slim/Classic 自动识别、内层/外层、正确 UV；省掉最容易出错的建模 |
| Three.js 自定义动画 | skinview3d 只提供基础动画；伸懒腰/吃面包/火把需要直接控制 `PlayerObject` 骨骼 |
| 原生 TS + Vite | 无前端框架负担；设置页和桌宠页分开构建 |
| electron-builder | 同时出 portable exe 和 NSIS 安装包 |

**不采用**：Tauri（透明窗+穿透坑多）、Unity/Godot（体积大、桌面集成复杂）、Python Qt（3D 动画生态弱）。

---

## 2. 运行时架构

```
┌───────────────────────────── Electron main ─────────────────────────────┐
│ app.ts              生命周期、单实例、退出清理                            │
│ pet-window.ts       BrowserWindow、透明/置顶/穿透、窗口移动、尺寸          │
│ gesture-bridge.ts   接收 renderer 手势 → 移动窗口 / 隐藏 / 关闭            │
│ settings.ts         JSON 校验、原子写、默认值、迁移                       │
│ tray.ts             托盘菜单、显示/隐藏、拍照、退出                       │
│ brightness.ts       WMI 亮度轮询（20s 缓存）                              │
│ fullscreen.ts       get-windows 前台全屏检测（1s 轮询）+ 探头调度          │
│ photo.ts            desktopCapturer 截图、保存、目录                      │
│ shortcuts.ts        Ctrl+Alt+P                                           │
│ autostart.ts        HKCU Run 登录项                                       │
│ ipc.ts              类型化 IPC 注册                                       │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ contextBridge (preload)
┌───────────────▼────────────────────── renderer/pet ──────────────────────┐
│ viewer.ts       SkinViewer 初始化、相机、灯光、透明背景                    │
│ animator.ts     PetAnimation(PlayerAnimation) + 状态机 + 姿态插值          │
│ gestures.ts     指针状态机、压扁/回弹、拖拽、长按                         │
│ props.ts        bread / torch 模型、手部挂点、火焰                       │
│ particles.ts    爱心/面包屑/火星/关闭紫粒子                               │
│ audio.ts        WebAudio 预解码、音量、循环火声                           │
│ hit-test.ts     Raycaster 命中 → 通知 main 开关鼠标穿透                    │
│ close-overlay.ts 全屏紫色粒子场景（正交相机）                             │
└──────────────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────── renderer/settings ─────────────────┐
│ 首次向导 + 设置页；滑块实时预览；保存后广播 settings:changed               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 进程职责边界

- **main 拥有**：窗口位置/尺寸、显示器、亮度、全屏状态、托盘、全局快捷键、文件保存、自启。
- **renderer 拥有**：3D 渲染、动画、手势识别、音效、粒子、点击命中、拍照时冻结。
- **shared**：IPC 通道名、设置类型、常量、默认值、纯函数（手势/行走/粒子数学）。

---

## 3. 目录结构

```
niko-pet-3d/
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json
├─ AGENTS.md                    # 给 Codex 的项目规则
├─ README.md
├─ docs/
│  ├─ PRD.md
│  ├─ TECH-PLAN.md
│  ├─ DECISIONS.md
│  └─ ASSETS.md
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ pet-window.ts
│  │  ├─ gesture-bridge.ts
│  │  ├─ settings.ts
│  │  ├─ tray.ts
│  │  ├─ brightness.ts
│  │  ├─ fullscreen.ts
│  │  ├─ photo.ts
│  │  ├─ shortcuts.ts
│  │  ├─ autostart.ts
│  │  ├─ ipc.ts
│  │  └─ paths.ts
│  ├─ preload/
│  │  └─ index.ts
│  ├─ shared/
│  │  ├─ ipc.ts
│  │  ├─ types.ts
│  │  ├─ constants.ts
│  │  ├─ settings-schema.ts
│  │  ├─ gesture.ts             # 纯状态机
│  │  ├─ walk.ts                # 纯边界/转向
│  │  └─ particles.ts           # 纯粒子物理
│  └─ renderer/
│     ├─ pet/
│     │  ├─ index.html
│     │  ├─ main.ts
│     │  ├─ viewer.ts
│     │  ├─ animator.ts
│     │  ├─ poses.ts
│     │  ├─ props.ts
│     │  ├─ particles.ts
│     │  ├─ audio.ts
│     │  ├─ gestures.ts
│     │  ├─ hit-test.ts
│     │  └─ close-overlay.ts
│     └─ settings/
│        ├─ index.html
│        ├─ main.ts
│        ├─ wizard.ts
│        └─ styles.css
├─ public/assets/              # Vite 原样复制到构建产物
│  ├─ skin/niko.png
│  ├─ vanilla/...
│  ├─ whale/Ya1.mp3 Ya2.mp3
│  └─ icon.png
├─ resources/
│  └─ icon.ico
├─ tools/
│  ├─ extract-assets.mjs
│  ├─ make-icon.py
│  ├─ screenshot.ps1
│  └─ fullscreen-watcher/      # 仅当 get-windows 在 Electron 下不可用
├─ tests/
│  ├─ gesture.test.ts
│  ├─ walk.test.ts
│  ├─ settings.test.ts
│  ├─ particles.test.ts
│  └─ assets.test.ts
└─ artifacts/                  # 截图、构建日志（gitignore）
```

---

## 4. 依赖

```json
{
  "dependencies": {
    "three": "^0.186.1",
    "skinview3d": "^3.4.2",
    "skinview-utils": "^0.7.1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "electron": "^44.9.1",
    "electron-vite": "^4.0.0",
    "electron-builder": "^26.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0",
    "get-windows": "^9.3.0"
  }
}
```

> 版本以 `pnpm install` 实际解析为准；`skinview3d` 的 peer dependency 要检查，必要时锁 `three` 到它支持的版本。若 `get-windows` 在 Electron 44 下原生模块 ABI 不兼容，立即切到 `tools/fullscreen-watcher`（见 §8）。

---

## 5. 窗口与鼠标

### 5.1 BrowserWindow 参数（桌宠）

```ts
new BrowserWindow({
  width: petWindowWidth,
  height: petWindowHeight,
  transparent: true,
  frame: false,
  resizable: false,
  movable: false,
  hasShadow: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  focusable: false,          // M0 验证；若点击失效改 true + showInactive
  show: false,
  fullscreenable: false,
  webPreferences: {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    autoplayPolicy: 'no-user-gesture-required',
    backgroundThrottling: false
  }
});
win.setAlwaysOnTop(true, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.setIgnoreMouseEvents(true, { forward: true });
```

- `transparent: true` + `backgroundColor: '#00000000'`，不能有 `hasShadow`。
- `skipTaskbar: true`；不抢焦点。
- `setAlwaysOnTop(true, 'screen-saver')` 在 Windows 上保证在普通窗口之上；M0 确认不遮挡全屏游戏（我们靠探头逻辑避免挡）。
- `webContents.setBackgroundThrottling(false)` 保证走路/动画流畅；隐藏时主动暂停。

### 5.2 点击穿透

1. 初始：`setIgnoreMouseEvents(true, { forward: true })`。
2. renderer 监听 `pointermove`；用 `THREE.Raycaster` 对 `playerObject` 做命中（含头部球形膨胀 6px，方便摸头）。
3. 命中 → IPC `pet:interactive(true)` → main `setIgnoreMouseEvents(false)`。
4. 离开 → `pet:interactive(false)` → main 恢复 ignore。
5. `pointerdown` 后直到 `pointerup`，main 强制保持 interactive，避免拖拽中丢事件。
6. 窗口移动/缩放/探头时重新计算命中；透明区域始终不拦截。

> 风险：`focusable: false` 在 Windows 上是否仍能收到鼠标事件需要 M0 实测。若不行，方案 B：`focusable: true` + `showInactive()` + 点击后 `win.blur()` 把焦点还给前台窗口；方案 C：`setShape()` 按角色矩形做窗口形状（动画时更新）。

### 5.3 尺寸与位置

- 设计基准：角色高 220px 时，窗口约 **360×340**（留出头顶、光晕、粒子空间）。
- `windowWidth = round(petHeight * 1.64)`；`windowHeight = round(petHeight * 1.55)`。
- 脚底位于窗口高度约 **88%**，底部留阴影/落地空间；窗口底边 = 当前显示器 `workArea.bottom`。
- 脚贴任务栏上沿；水平位置为上次位置或屏幕中央。
- 尺寸变化时以底边中心为锚点重排，避免角色跳动。

### 5.4 行走

- main 以 30fps 定时器移动窗口；renderer 以 60fps 播放走路动画。
- 速度 35–55px/s（随尺寸缩放）；到 `workArea` 左右边界后掉头。
- 每次开始走/停下/转向，main 通知 renderer `pet:facing` / `pet:walk-state`。
- 走路脚步音在 renderer 按相位触发；离屏/隐藏时停止。
- 拖拽松手：main 找窗口中心所在 display，`animate` 落到底部（180–260ms 缓动），通知 renderer 播放落地缓冲/涟漪。

### 5.5 尺寸/DPI

- 全部使用 Electron 逻辑像素；窗口尺寸/位置用 `DIP`。
- renderer `devicePixelRatio` 上限 2；纹理 `NearestFilter`；关闭 CSS 缩放模糊。
- 监听 `display-metrics-changed`、`display-added/removed`，重新 clamp；当前机器 125% DPI 必测。

---

## 6. 3D 渲染

### 6.1 初始化

```ts
const viewer = new SkinViewer({
  canvas,
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  skin: '/assets/skin/niko.png',
  model: 'slim',
  ears: false,          // 皮肤自带猫耳在第二层；不要 deadmau5 耳朵
  background: null,
  pixelRatio: Math.min(devicePixelRatio, 2)
});
viewer.controls.enabled = false;
viewer.autoRotate = false;
viewer.animation = petAnimator; // 单个自定义 PlayerAnimation
```

- `background = null` 得到透明画布（M0 验证；如不行改 `renderer.setClearAlpha(0)` / 自建 renderer）。
- 相机：透视，FOV 35–40；模型旋转约 **-30° / +30°**（3/4 视角）；保持脚底在画面下方。
- 光照：环境光/相机光适中；火把加一盏暖色 `PointLight`，`distance` 小，只覆盖角色；不照桌面。
- 地面阴影：半透明径向渐变 Sprite 贴在脚下，随压扁缩放。

### 6.2 骨骼与姿态

`skinview3d` 暴露：

```
viewer.playerObject.skin.head/body/leftArm/rightArm/leftLeg/rightLeg
```

每个 `BodyPart` 是 `Group`；直接设置 `.rotation`。`PlayerObject` 有 `resetJoints()`，启动时先记录基准姿态。

- `playerWrapper.rotation.y`：朝向（3/4 基准 ± 转身）。
- `playerObject.scale`：压扁/回弹（以脚底为轴；必要时用外层 Group 保证 pivot）。
- `head.rotation.x/y/z`：抬头/低头、左右看、歪头。
- `leftArm/rightArm.rotation.x`：前后摆；`.z`：侧举（伸懒腰）。
- `leftLeg/rightLeg.rotation.x`：走路/坐下。
- `body.rotation.x`：前倾/后仰。

### 6.3 动画状态机

```ts
type PetState =
  | 'idle' | 'walk' | 'sit' | 'sleep' | 'stretch'
  | 'eat' | 'torch' | 'look' | 'pet' | 'wave' | 'dance'
  | 'drag' | 'drop' | 'peek' | 'photo' | 'closing';
```

- 每个状态实现 `targetPose(t, ctx)`，返回各关节旋转/位置。
- 状态切换用 180–280ms smoothstep 插值；打断时从当前实际姿态继续，不重置。
- `walk` 是循环相位；`idle` 用低频噪声；`stretch/eat/wave` 是一次性时间轴；`closing` 由 main 主导。
- 站立/走路/坐下时脚底 Y 固定；`playerWrapper.position.y` 只做呼吸/落地的小偏移。
- 眨眼：眼睑遮片（两片 6×2 像素面）挂在头前侧；随机 3–7s，双击眨眼 10%。
- 看向鼠标：renderer 接收 `pet:cursor`（屏幕坐标）；计算头部 yaw/pitch，clamp ±0.5/±0.35 rad。

### 6.4 压扁/回弹（鲸鱼娘同款）

- 按下：`scale.set(1.05, 0.88, 1.0)`，以脚底为 pivot。
- 松开：220ms，`cubic-bezier(.34,1.56,.64,1)`；在 Three.js 中采样贝塞尔或用力导向目标 `(1,1,1)` 的弹簧，保留轻微过冲。
- 长按期间保持压扁；松开/关闭时回弹或随消失结束。
- 压扁只作用于视觉，不改变窗口尺寸/命中框；命中框用未压扁的包围盒略膨胀。

### 6.5 面包/火把挂点

- 右手 `rightArm` 的 Group 原点在肩；手部约在局部 `y=-10.5`。
- 面包：6×6×1 的薄盒，六面贴 `item/bread.png`；放在手掌前，面向相机；每咬一口缩小 20%。
- 火把：2×2×10 的盒，贴 `block/torch.png`；顶部加火焰 Sprite + PointLight；挂在右手，举到胸前/头侧。
- 两个道具默认 `visible=false`；进入 eat/torch 状态时淡入/挂上，退出时淡出/隐藏。

---

## 7. 粒子

### 7.1 正常粒子（3D 场景）

- 对象池 `Sprite`，最多 96 个；`SpriteMaterial`：透明、`depthWrite:false`。
- 爱心：`particle/heart.png`，普通混合，粉红色，向上飘 + 轻微摆动，0.9s。
- 面包屑：`particle/generic_*.png` 或 2×2 棕色像素贴图，向下落 + 小弹跳，0.8s。
- 火星/余烬：`particle/flame.png` 或 `glow.png`，加色混合，橙黄色，向上飘，0.6–1.2s。
- 每个粒子：位置、速度、重力、阻力、寿命、缩放、颜色、透明度；`update(dt)` 纯函数可测。

### 7.2 关闭紫粒子（全屏）

- 窗口在关闭时扩到当前 `display.bounds`；renderer 切到独立 `closeOverlay` 场景（正交相机，屏幕像素坐标）。
- 3.0s 时从角色最后屏幕位置爆发 **120–160** 个粒子：
  - 纹理：`particle/effect_*.png` + `glitter_*.png`（本机 1.20.1 资源），紫色 tint（#A855F7 / #C084FC / #7C3AED / #4C1D95）。
  - 初速：径向 + 向上 40–180px/s；重力 260px/s²；阻力 0.98；寿命 0.9–1.6s；尺寸 3–9px。
  - 拖尾：前 0.35s 每 40ms 生成小残影，或把 sprite 拉长；先做残影，简单可靠。
  - 透明度前 20% 淡入，后 40% 淡出；加色混合。
- 角色在 3.0s 隐藏；粒子继续 1.2s；窗口隐藏，托盘保留。
- 关闭音效：`mob/endermen/portal.ogg` + `portal/travel.ogg`，重叠 100ms。

---

## 8. 全屏检测与探头

### 8.1 检测

优先 `get-windows`（ESM）：

```ts
const w = await activeWindow();
if (w && !IGNORED_OWNERS.has(w.owner.name)) {
  const display = screen.getDisplayMatching(w.bounds);
  const covers = w.bounds.width >= display.bounds.width * 0.95
              && w.bounds.height >= display.bounds.height * 0.95;
  // bounds 与 display.bounds 对齐；排除任务栏可见的普通最大化窗口
}
```

- 1s 轮询；只在状态变化时派发。
- 排除 `explorer.exe`、`ShellExperienceHost.exe`、`SearchHost.exe`、本应用；窗口标题为空/桌面不算。
- `get-windows` 在 Electron 44 下若原生模块报 ABI/`NODE_MODULE_VERSION` 错误，**立即切备用**：
  - `tools/fullscreen-watcher/` 一个 20KB C# 控制台程序：`GetForegroundWindow` + `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` + `GetMonitorInfo`，每秒输出 `1`/`0` 和显示器矩形。
  - 源文件 + `build.ps1`（`csc.exe`）一起提交；构建时复制到 `resources/`。
- 无法检测 → 禁用探头，正常底部行为；日志写明。

### 8.2 探头窗口位置

- 使用窗口部分移出屏幕实现“身体在屏幕外”：
  - 底边：`win.y = display.bottom - headBottomInWindow`，窗口底部沉到屏幕外。
  - 顶边：`win.y = display.top - headTopInWindow`（负值）。
  - 左边：`win.x = display.left - headLeftInWindow`。
  - 右边：`win.x = display.right - headRightInWindow`。
- 头部锚点在窗口中的坐标由 renderer 按当前尺寸/姿态上报（`pet:head-anchor`），main 缓存。
- 探头动画：窗口从“完全藏起”滑到“露头”位置，300ms ease-out；停留 4–8s；再滑回。
- 全屏时 20–45s 随机一次；随机边；同一时间只探一次。
- 全屏结束：恢复到底部，继续走路。

---

## 9. 亮度

```ts
powershell -NoProfile -NonInteractive -Command
  "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness |
    Select-Object -First 1).CurrentBrightness"
```

- `execFile`，`windowsHide:true`，5s 超时；每 20s 轮询；缓存。
- 解析 0–100；失败返回 `null`，设置页显示“不可用”，自动火把关闭，手动可用。
- 当前机器亮度 16%、深色主题；默认阈值 30% → 启动即可能自动举火把（符合“屏幕暗了”的设定）。
- 自动火把：`dark` 边沿触发，12–18s；同一暗状态下 10 分钟冷却。
- 手动火把：长按 1.5s 切换；手动开 = 常亮；手动关后等待下一次暗边沿。

---

## 10. 音频

- WebAudio：启动时 `fetch` 所有 ogg/mp3 → `decodeAudioData`；建立 `GainNode` 主音量。
- 点击 Ya1/Ya2 必须预解码，`pointerdown` 同任务 `start()`，避免延迟。
- 走路：每 2 步播一次随机 grass1–6，音量 0.35×。
- 火把循环：`fire/fire.ogg` 低音量 loop，点燃时 0.3s 淡入，熄灭 0.4s 淡出。
- 同时最多 3 个短音效；脚步声 30ms 内去重。
- 静音时主 Gain 0；设置即时生效。
- 缺少某个音频文件：启动时警告 + 静默跳过，不影响其它功能。

---

## 11. 拍照

1. `Ctrl+Alt+P` → main 发 `photo:freeze`；renderer 暂停动画/粒子更新，仅渲染。
2. main 隐藏设置窗口（若开着）；等待 120ms。
3. `desktopCapturer.getSources({ types:['screen'], thumbnailSize: physicalSize })`。
4. 取与宠物所在 `display.id` 匹配的 source；`source.thumbnail.toPNG()`。
5. 保存到 `Pictures/NikoPet/Niko-YYYYMMDD-HHmmss.png`；`shell.showItemInFolder` 可选（不自动弹）。
6. 发 `photo:unfreeze`；恢复设置窗口。
7. 如果宠物处于隐藏/探头：先临时 `showAtBottom()`，截图后恢复。
8. 失败：写日志，静默恢复，不弹窗（或托盘气泡提示一次）。

---

## 12. 设置与持久化

```ts
const Settings = z.object({
  version: z.literal(1),
  firstRun: z.boolean().default(true),
  size: z.number().int().min(80).max(500).default(220),
  nickname: z.string().max(24).default('Niko'),
  volume: z.number().min(0).max(1).default(0.4),
  muted: z.boolean().default(false),
  autostart: z.boolean().default(false),
  longPressMs: z.number().int().min(1000).max(2000).default(1500),
  darkThreshold: z.number().int().min(10).max(60).default(30),
  autoTorch: z.boolean().default(true),
  clickSounds: z.boolean().default(true),
  particles: z.boolean().default(true),
  photoDir: z.string().default(''),
  lastDisplayId: z.number().optional(),
  lastX: z.number().optional()
});
```

- 路径：`app.getPath('userData')/settings.json`。
- 原子写：写 `settings.json.tmp` → `fs.rename`。
- 坏文件：改名 `settings.bad-<timestamp>.json`，用默认值继续。
- 保存防抖 300ms；退出前强制 flush。
- IPC：`settings:get` / `settings:set` / `settings:reset` / `settings:changed`。
- 向导首次启动：`firstRun=true` 时打开设置窗口 `?wizard=1`；滑块实时 `settings:preview`（不立即落盘），完成后保存。

---

## 13. 系统集成

| 功能 | 实现 |
|---|---|
| 单实例 | `app.requestSingleInstanceLock()`；第二个实例 → 显示宠物 + 打开设置 |
| 托盘 | `Tray(icon)`；菜单四项；tooltip 用昵称；仅 Windows |
| 自启 | `app.setLoginItemSettings({ openAtLogin, path: process.execPath })`；dev 下禁用并提示 |
| 全局快捷键 | `globalShortcut.register('Control+Alt+P', takePhoto)`；退出时 `unregisterAll` |
| 显示变化 | `screen.on('display-added'/'display-removed'/'display-metrics-changed')` → clamp |
| 隐藏 | `win.hide()`；停止走路/亮度/全屏轮询；托盘保留 |
| 退出 | 托盘“退出” → 保存设置 → 销毁窗口/托盘 → `app.quit()` |
| 全屏 | 见 §8；全屏时不走路，只探头 |
| 开机 | 不自动显示设置窗口；宠物在底部出现 |

---

## 14. 资产管线

### 14.1 Minecraft 1.20.1

- 音效：`%APPDATA%\.minecraft\assets\indexes\5.json` → `objects/<hash前2>/<hash>`。
- 贴图：`%APPDATA%\.minecraft\versions\1.20.1-Fabric 0.19.5\1.20.1-Fabric 0.19.5.jar` 内 `assets/minecraft/textures/...`。
- 提取脚本 `tools/extract-assets.mjs` 一次性复制到 `public/assets/vanilla/`；生成 `ASSETS.json`（源 key、hash、大小）。
- 需要的文件：

```
textures/item/bread.png
textures/block/torch.png
textures/particle/heart.png
textures/particle/flame.png
textures/particle/effect_0..7.png
textures/particle/glitter_0..7.png
textures/particle/generic_0..7.png
sounds/step/grass1..6.ogg
sounds/mob/cat/purr1..3.ogg
sounds/mob/cat/purreow1.ogg
sounds/mob/cat/meow1.ogg
sounds/mob/cat/eat1..2.ogg
sounds/random/burp.ogg
sounds/fire/ignite.ogg
sounds/fire/fire.ogg
sounds/block/candle/extinguish1.ogg
sounds/mob/endermen/portal.ogg
sounds/portal/travel.ogg
sounds/random/click.ogg
```

### 14.2 鲸鱼娘点击音

- 源：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-whale-widget\assets\Ya1.mp3` / `Ya2.mp3`
- 复制到 `public/assets/whale/`；README/ASSETS 注明来源和“仅本地自用、不再许可”。
- 当前设置组是 `duck` → Ya1/Ya2；不要打包 D1/D2（除非以后加切换）。

### 14.3 皮肤

- `niko.png`：64×64、RGBA、Slim（3px 手臂）、双层；SHA256 `715B4826…DF705C`。
- 校验脚本：尺寸、alpha、手臂区域 192 个不透明像素、外层非空；失败则启动时警告并退回 2D 占位（不阻塞）。
- 不生成 `preview.png` 作为运行时资源。

### 14.4 图标

- 从皮肤头部正面放大 32×（256×256），最近邻，生成 `resources/icon.ico`（16/32/48/256 多尺寸）。
- 用 Python/Pillow 或 `png-to-ico`；构建时自动检查 icon 存在。

---

## 15. 构建与打包

```bash
pnpm install
pnpm dev           # electron-vite dev
pnpm build         # typecheck + build
pnpm test          # vitest
pnpm dist          # electron-builder --win portable nsis
```

`electron-builder.yml`：

```yaml
appId: com.nikopet.desktop
productName: Niko Pet 3D
directories:
  output: release
files:
  - out/**
  - public/assets/**
  - resources/**
win:
  icon: resources/icon.ico
  target:
    - target: portable
      arch: x64
    - target: nsis
      arch: x64
portable:
  artifactName: NikoPet3D-${version}-portable.exe
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  artifactName: NikoPet3D-${version}-setup.exe
asar: true
```

- 产物：`release/NikoPet3D-0.1.0-portable.exe`、`release/NikoPet3D-0.1.0-setup.exe`。
- 不做代码签名；Windows SmartScreen 可能提示。
- 首次运行写 `%APPDATA%\NikoPet3D\settings.json`；卸载不删用户设置（安装包选项）。
- `public/assets` 在 asar 内通过相对 URL 加载；动态音频路径用 `new URL()` 或 base path，避免 `app.asar` 路径问题。

---

## 16. 测试与验收

### 16.1 自动测试

| 文件 | 覆盖 |
|---|---|
| `gesture.test.ts` | 单击/250ms 拖拽/1.5s 火把/3s 关闭/拖动后不关闭/松开取消 |
| `walk.test.ts` | 边界转身、底部 y、多显示器 clamp、拖拽落点 |
| `settings.test.ts` | 默认值、范围校验、坏 JSON、原子写 |
| `particles.test.ts` | 生命周期、重力、数量上限、关闭时序 |
| `assets.test.ts` | 皮肤尺寸/手臂像素/外层；声音文件存在；图标存在 |

### 16.2 真实桌面验收

- 启动 `pnpm dev`；用 `tools/screenshot.ps1` 截全屏 → `artifacts/`。
- 逐项触发：待机、走路、伸懒腰、吃面包、火把（调低亮度/等待自动或长按）、单击/压扁、长按 1.5s、长按 3s、关闭粒子、托盘恢复、全屏探头、Ctrl+Alt+P 拍照。
- 开发调试：`--debug-state=stretch|eat|torch|close|peek` 直接进入状态；仅在 `!app.isPackaged` 生效。
- 性能：任务管理器记录待机/走路 CPU；隐藏后确认 0% 渲染。
- 125% DPI、100%/150% 缩放各看一次；多显示器（如有）拖拽/拔插。

### 16.3 验收阻断项

- 透明窗有黑底/白底 → 不通过。
- 点击穿透失效或挡住桌面 → 不通过。
- 皮肤 UV 错位/手臂 4px → 不通过。
- 长按 1.5s 误关闭、或 3s 关不掉 → 不通过。
- 火把照亮整块桌面 → 与需求不符。
- 关闭后进程退出/托盘消失 → 不通过。

---

## 17. 主要风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Electron 透明窗 + 点击穿透在 Win11 有兼容问题 | 核心体验 | M0 先做最小 demo；备选 `setShape` / 全屏透明窗 + 命中区域 |
| `focusable:false` 收不到鼠标 | 无法交互 | M0 验证；备选 `focusable:true` + `showInactive` + 失焦归还 |
| skinview3d 背景不透明/相机不可控 | 无法做桌宠 | M0 验证；备选自建 Three.js 模型（用 skinview-utils 的 UV 数据） |
| `get-windows` 原生模块与 Electron ABI 不匹配 | 全屏探头不可用 | 切 C# watcher；再不行禁用探头并记录 |
| WMI 亮度读取慢/不支持 | 自动火把失效 | 20s 缓存；失败则手动；设置页明示 |
| 3D 动画不够自然 | 核心观感 | 关键姿态手调 + 截图/录屏验收；先做走路/伸懒腰两个基准 |
| 窗口移动 30fps 抖动 | 观感 | 30fps 位置 + 60fps 动画；必要时 60fps 移动，测 CPU |
| 打包后资源路径/音频失效 | 交付失败 | 构建后真实安装/便携运行；加载失败有日志 |
| 素材版权 | 不能公开发布 | 仅本地自用；ASSETS 注明；不创建公开 Release |

---

## 18. Codex 执行方式

- 项目根 `AGENTS.md` 写明：Windows、pnpm、TypeScript strict、不要改全局配置、不要发布、每步跑 `pnpm test`/`pnpm build`。
- 每个里程碑用一条 `codex exec` 提示，包含：目标、文件范围、验收命令、禁止项、截图要求。
- 示例：

```powershell
codex exec -s workspace-write --skip-git-repo-check -C niko-pet-3d `
  "实现 M1：Electron 透明桌宠窗口 + skinview3d Slim 模型 + 待机/走路 + 托盘 + 单击压扁。验收：pnpm test、pnpm build 通过；给出启动命令。不要改全局配置，不要发布。"
```

- Lead 每阶段：读 diff → 跑测试/构建 → 启动 → 截图 → 记录问题 → 再让 Codex 修。
- 里程碑提交：`git add -A && git commit -m "M1: ..."`；便于回滚。
- 不用 Codex 做素材提取/发布；这两件事由 Lead 完成或脚本完成。

---

## 19. 里程碑任务拆分（给 Codex）

### M0 — 技术验证（0.5–1 天）

1. `pnpm create @quick-start/electron` 或手写最小 electron-vite 工程。
2. 透明、置顶、无边框、skipTaskbar 窗口；加载一个透明 HTML + 一个红色方块。
3. `setIgnoreMouseEvents(true,{forward:true})` + mousemove 命中切换 interactive。
4. skinview3d 加载 niko.png，Slim + 双层，透明背景；截一张图。
5. WebAudio 播放 Ya1/Ya2；验证延迟。
6. 压扁/回弹（scale 1.05/0.88 + 220ms 贝塞尔）。
7. 输出 `artifacts/m0.png` + 结论。

### M1 — 骨架 + 基础动作

- 工程结构、shared 类型、settings store、preload API。
- 模型/相机/灯光/阴影；idle、walk、turn、look、blink。
- 底部定位、30fps 移动、边缘转身、脚步音。
- 托盘四项、单实例、显示/隐藏。
- 单击摸头 + 压扁/回弹 + 鲸鱼音；点击穿透。
- 设置窗口骨架 + 尺寸滑块（先不接向导）。
- 验收：A01–A04、A08（点击/压扁）、设置持久化。

### M2 — 手势 + 情绪动作 + 全屏

- 手势状态机：250ms 拖拽、1.5s 火把、3s 关闭、松开回弹、拖动落点。
- 伸懒腰、坐、睡、看鼠标、挥手/跳舞/转圈。
- 拖动四肢下垂、落地缓冲；跨显示器。
- 全屏检测 + 随机边缘探头 + 退出恢复。
- 验收：A05、A08（长按/拖拽）、A10。

### M3 — 面包 + 火把 + 粒子 + 拍照

- 面包模型/咀嚼/掉屑/打嗝/爱心。
- 火把模型/点光/火焰/火星/点燃熄灭音/循环火声。
- 亮度轮询、阈值、自动 12–18s、手动长按切换、10 分钟冷却。
- 关闭：2.4s 聚粒子、3s 爆发、全屏 overlay、1.2s 停留、隐藏托盘。
- Ctrl+Alt+P 截图、保存目录、冻结。
- 验收：A06、A07、A09、A11。

### M4 — 向导/设置/性能/打包

- 首次向导六项；设置页全部项；自启默认关；重置/恢复默认。
- 性能优化：隐藏暂停、纹理/几何复用、粒子池、DPR cap。
- 测试补齐；README/ASSETS/使用说明；构建 portable + NSIS；真实安装/卸载。
- 验收：A12–A14。

---

## 20. 完成定义（DoD）

- `pnpm test` 全绿，`pnpm build` 无 TS 错误。
- 真实桌面截图：待机、走路、伸懒腰、吃面包、火把、关闭粒子、全屏探头、拍照各一张。
- 便携 exe 双击可运行；安装包安装/卸载可运行。
- README 有：启动方式、手势表、设置说明、素材来源、已知限制。
- 用户确认 M1–M4 的验收项。

# M0 — 技术验证任务（给 Codex）

> 只做最小验证，不做完整桌宠。完成后写 `M0-REPORT.md`。

## 目标

在真实 Windows 11 桌面上验证 5 件事：

1. **透明窗口**：无边框、始终置顶、无任务栏图标；角色背后能看到桌面，没有黑底/白底矩形。
2. **3D 皮肤**：用 `skinview3d` 加载 `public/assets/skin/niko.png`（64×64、Slim、双层），3/4 视角，完整可见；3px 手臂和第二层正确。
3. **点击穿透**：透明区域点击能到桌面；鼠标移到角色身上时窗口可交互；移开恢复穿透。
4. **点击音**：`pointerdown` 播 `Ya1.mp3`，`pointerup` 播 `Ya2.mp3`，无明显延迟。
5. **压扁/回弹**：按下以脚底为轴 `scaleX 1.05 / scaleY 0.88`；松开 220ms `cubic-bezier(.34,1.56,.64,1)` 回弹；视觉上像鲸鱼娘。

## 交付

- 可运行的 electron-vite + TypeScript 工程。
- `pnpm install && pnpm build` 通过；`pnpm dev` 能启动。
- 窗口 420×420，底部居中（任务栏上方），加载宠物页。
- 托盘菜单至少有一项「退出 M0」，否则关不掉（窗口没有任务栏）。
- 代码结构尽量按 `TECH-PLAN.md` §3，但 M0 不必实现所有模块。
- `M0-REPORT.md`：做了什么、怎么运行、验证结果、已知问题、下一步。

## 实现要点

### main

- `BrowserWindow`：420×420，`transparent: true`、`frame: false`、`hasShadow: false`、`skipTaskbar: true`、`alwaysOnTop: true`、`resizable: false`、`show: false`、`backgroundColor: '#00000000'`。
- M0 先用 `focusable: true`（保证鼠标事件）；在报告中注明这是待验证项，后续再测 `false`。
- `win.setAlwaysOnTop(true, 'screen-saver')`。
- 位置：`screen.getPrimaryDisplay().workArea`，窗口底边贴 `workArea.bottom`，水平居中。
- `win.setIgnoreMouseEvents(true, { forward: true })` 初始穿透。
- IPC：
  - `pet:interactive` (boolean) → `setIgnoreMouseEvents(!interactive, { forward: true })`。
  - `pet:quit` → `app.quit()`。
  - `pet:log` → main console 输出，便于抓日志。
- `win.showInactive()` 显示，不抢焦点。
- 托盘：用 `nativeImage.createFromPath(public/assets/skin/niko.png)` 先临时当图标；菜单「退出 M0」。
- 单实例锁；`window-all-closed` 不退出（托盘常驻），托盘退出才退。

### preload

- `contextBridge` 暴露：
  - `setInteractive(boolean)`
  - `quit()`
  - `log(message: string)`
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。

### renderer/pet

- 全屏 canvas；`html,body { background: transparent; overflow: hidden; }`。
- `new SkinViewer({ canvas, width, height, skin: '/assets/skin/niko.png', model: 'slim', background: null, pixelRatio: Math.min(devicePixelRatio, 2) })`。
- 关闭 controls / autoRotate。
- 相机/缩放调到角色完整可见，脚底在画面下方约 88%，3/4 视角（旋转 playerWrapper 或相机）。
- 如果 `background: null` 仍有黑底，检查 `SkinViewer` 的 renderer 是否 `alpha: true`；必要时访问 `viewer.renderer.setClearAlpha(0)` 或改用自带 WebGLRenderer。必须做到透明。
- 待机：加一个非常轻的呼吸浮动（不要求完整动画）。
- 点击：
  - `pointerdown`：播 `Ya1.mp3`；`viewer.playerObject.scale.set(1.05, 0.88, 1.0)`；记录时间。
  - `pointerup`：播 `Ya2.mp3`；220ms 回弹到 `(1,1,1)`，用 `cubic-bezier(.34,1.56,.64,1)` 采样或等价弹簧；下一帧继续渲染。
  - 用 WebAudio 预解码两个 mp3；首次 `pointerdown` 时 `resume()`。
- 点击穿透：
  - `pointermove` 时用 `THREE.Raycaster` 对 `viewer.playerObject` 做命中；命中 → `setInteractive(true)`；否则 false。只在状态变化时发 IPC。
  - 注意：`setIgnoreMouseEvents(true,{forward:true})` 下，mousemove 是否还能到 renderer 是 M0 的核心验证项。如果收不到，记录现象并实现备选方案（例如先保持窗口 interactive，仅当鼠标在角色外时用 `setIgnoreMouseEvents`；或改用窗口形状）。在报告中写明最终方案。
  - `pointerdown` 后到 `pointerup` 期间强制保持 `setInteractive(true)`，防止拖拽/按压丢事件。
- 不要画任何文字/HUD/边框；背景必须透明。
- 在控制台输出关键日志（通过 `petApi.log`）：viewer ready、skin loaded、interactive change、press/release、audio error。

### 资源

- 皮肤：`public/assets/skin/niko.png`（已放好，不要改）。
- 音频：`public/assets/whale/Ya1.mp3`、`Ya2.mp3`（已放好，不要改）。
- 不要在本阶段接 Minecraft 音效/贴图。

## 验收命令

```bash
pnpm install
pnpm build
pnpm dev
```

`pnpm dev` 后：

- 窗口出现在任务栏上方居中。
- 能看到 Niko，桌面透过窗口可见；没有矩形底色。
- 点角色有压扁/回弹和音效（耳朵听不到就检查控制台无音频错误）。
- 控制台有 interactive 切换日志。
- 托盘能退出。

## 报告模板

```md
# M0 报告
## 完成
## 运行方式
## 验证结果（透明/模型/穿透/音频/压扁）
## 已知问题 / 风险
## 建议的 M1 起点
```

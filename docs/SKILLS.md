# SKILLS — Niko Pet 3D 可复用技能包

> 给后续工作对话复用。每条都是本机验证过或从踩坑中总结的，不要照搬未验证的结论。

## 1. Windows Electron 桌宠启动

- **版本锁定 44.7.0**。44.9.1 在本机 `app.whenReady()` 不触发（退出码 0x80000003）。
- 启动前：
  ```powershell
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  foreach ($n in 'no_proxy','http_proxy','https_proxy','all_proxy') { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
  ```
- Agent shell 直接 `Start-Process` 可能挂起；用 `cmd start` 脱离启动：
  ```powershell
  cmd /c 'set "ELECTRON_RUN_AS_NODE=" && cd /d "<project>" && start "" "<project>\node_modules\electron\dist\electron.exe" --no-sandbox --user-data-dir="<project>\.scratch-userdata-live" --debug-walk .'
  ```
- 计划任务有时 `Queued`（交互式会话/调度器）；`cmd start` 更可靠。
- 单实例锁按 `--user-data-dir` 区分；旧进程/僵尸会占锁。用独立 userData 做测试实例。
- 远程调试：`--remote-debugging-port=9223` 后用 `/json/list` 找 `index.html?nikoDebug=1`。

## 2. CDP 验收

```js
const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const page = targets.find(t => t.url.includes('index.html'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
// Runtime.evaluate: window.__niko.getState()
// Page.captureScreenshot: { format:'png', fromSurface:true }
```
- `window.__niko` 只在 dev 或 URL `?nikoDebug=1` 暴露；`--debug-walk` 会加参数。
- 常用：`getState()`、`forceWalk()`、`stopWalk()`、`stretch()`、`eat()`、`toggleTorch()`、`forceClose()`、`getTorch()`、`getParticles()`、`photo()`。
- 页面被遮挡/窗口异常时 `Page.captureScreenshot` 可能超时；先 `Page.bringToFront`，或重启到可见实例。

## 3. 透明桌宠窗口

```ts
new BrowserWindow({
  transparent: true, frame: false, resizable: false, hasShadow: false,
  alwaysOnTop: true, skipTaskbar: true, focusable: true,
  webPreferences: { preload, contextIsolation: true, sandbox: true }
})
win.setAlwaysOnTop(true, 'screen-saver')
win.setIgnoreMouseEvents(true, { forward: true })
```
- 命中测试：Raycaster + 33ms 轮询 `screen.getCursorScreenPoint()`；命中时 `setIgnoreMouseEvents(false)`，离开恢复 true。
- 透明窗口 resize 反馈：**不要**在每次 `resize` 把 `innerWidth` 回灌 viewer；只在加载/设置变化时 `viewer.setSize`。
- 关闭全屏粒子时，窗口会扩到 `display.bounds`；resize guard 必须 `if (this.closing) return`，否则被拉回小窗。
- 拖拽由 main 用 `screen.getCursorScreenPoint()` 60fps 跟随，renderer 只做姿态；跨屏 clamp 到 virtual bounds。

## 4. skinview3d / Three.js

- `viewer.zoom = 0.55`，`viewer.background = null`，renderer clear alpha 0；canvas 尺寸跟随窗口（只在加载/设置变化时）。
- 皮肤 64×64 Slim 双层；`viewer.playerObject.skin` 下 `head/body/rightArm/leftArm/rightLeg/leftLeg`。
- 头部：`head.rotation.x = pitch`，`rotation.y = yaw`；俯仰 ±60°、左右 ±55° 比较自然；加随机小幅 glance，避免僵硬。
- 走路朝向：`playerWrapper.rotation.y` 用 0.28 / -0.45，不要背对镜头；走路时头 yaw 乘 `(1 - 0.65*walkBlend)`。
- 压扁：`scaleX 1.05, scaleY 0.88`，脚底 pivot；回弹 220ms `cubic-bezier(.34,1.56,.64,1)`；`position.y = -16.25*(1-scaleY)` 保持脚底。
- 道具挂点：`skin.rightArm.add(root)`，根位置约 `(0,-10,0.75)`；火把用 `BoxGeometry(2,10,2)` + `torch.png` UV；面包用 Box + `bread.png`。
- 性能：30fps 逻辑更新，渲染 rAF；避免每帧重建几何/纹理；透明窗口避免阴影/大后处理。

## 5. 手势状态机（已验证时序）

- 纯逻辑在 `src/shared/gesture.ts`，renderer 只做 DOM/动画。
- `pointerdown` → 压扁 + Ya1；250ms 拖拽门；1.5s 火把；2.4s 聚粒子；3.0s 关闭。
- 移动 >5px 且 250–1500ms → 拖拽，取消后续计时；1.5s 后移动不拖拽。
- 1.5s 火把后松手不关闭；3s 关闭；关闭时松手忽略。
- 计时器用 `performance.now()` + 1500/2400/3000 三个 timeout；拖拽/关闭时清空。
- 点击（<1.5s 未拖拽）→ 摸头；拖拽松手 → 落回任务栏 + Ya2。

## 6. 画布粒子

- 全屏 `position:fixed; inset:0; pointer-events:none` 2D canvas；每帧 `resizeCanvas()`，坐标用 `window.screenX/screenY` 换算。
- 紫粒子：`effect_*.png` / `glitter_*.png`，加色混合，`#A855F7/#C084FC/#7C3AED/#4C1D95`；2.4s 聚拢、3.0s 144 个爆发、1.2s 尾巴。
- 面包碎屑/爱心：独立 z-index 9 canvas，像素方块，简单重力；不要阻塞主线。
- 关闭时窗口扩到全屏；粒子 origin 用屏幕坐标，扩窗后 `x - window.screenX` 仍正确。

## 7. 系统集成

- **亮度**：`powershell -NoProfile -Command "(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness"`，20s 轮询，`execFile` + `windowsHide`；无传感器返回 null。
- **拍照**：`desktopCapturer.getSources({types:['screen'], thumbnailSize:{width: display.size.width*scaleFactor, ...}})`；取匹配 `display_id` 的 source，`thumbnail.toPNG()` 写 `app.getPath('pictures')/NikoPet/<nickname>-<timestamp>.png`；拍照前 renderer 冻结 160ms。
- **托盘**：`tray.on('click')` 显示；`double-click` 也显示；右键菜单更新显示/隐藏文案；关闭到托盘时给用户提示。
- **自启**：`app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: [...] })`；安装版和便携版路径不同，打包后要验证。
- **全屏检测**：优先级 `get-windows`（需 native 模块）→ C# 小helper（GetForegroundWindow + GetWindowRect + MonitorFromWindow）→ 轮询 PowerShell（慢，仅兜底）。检测到全屏时停止走路、把窗口移到屏幕边缘只露头，20–45s 间隔、4–8s 一次。

## 8. 资产

- MC 1.20.1 资产：`public/assets/vanilla/{sounds,textures}`，`ASSETS.json`；本地自用，不发布。
- 皮肤/鲸鱼音效是用户私有资产，不要改、不要上传。
- 新增资产走 `src/main/ipc.ts` 的 `ASSET_PATHS` 白名单 + `src/preload/index.ts` 的 `AssetName` union；不要开放任意路径 IPC。

## 9. 构建/测试/打包

```powershell
cmd /c "node_modules\.bin\electron-vite.cmd build && node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
cmd /c "node_modules\.bin\vitest.cmd run"
```
- `pnpm build` 偶尔触发 deps status 自动 install 卡住；直接用二进制。
- 打包建议：`electron-builder`；Windows target `portable` + `nsis`；`files: out/**, public/**, package.json`；`asar: true`；图标用 niko 头部生成的 256 PNG/ICO；额外资源放 `extraResources` 或 `files` 里确保 `public/assets` 可用。
- 打包后必须在干净目录/另一用户配置下验证：资产路径、托盘图标、自启、单实例、相机/截图。

## 10. QA/验收

- 每个里程碑：`vitest` + `tsc` + build + 真实桌面截图/录屏 + 用户确认。
- 视觉检查：模型是否被裁切、脚底是否贴任务栏、透明边缘是否有黑底、文字/气泡是否出现、动作过渡是否卡顿、粒子是否遮挡点击。
- 行为检查：长按 1.5s/3s、拖拽、单击、关闭后托盘找回、全屏探头、暗处火把、拍照、多显示器/DPI、开机自启。
- 记录到 `docs/QA-*.md`；不要只口头说“应该可以”。

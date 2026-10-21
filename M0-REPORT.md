# M0 技术验证报告

## 完成内容

- 新建 electron-vite + TypeScript strict 工程。主进程建立 420×420、透明、无边框、无阴影、不可缩放、始终置顶且不显示任务栏图标的窗口，放在主显示器工作区底部中央；托盘提供「退出 M0」。
- `skinview3d` 以 Slim 模型加载 `public/assets/skin/niko.png`，显示双层皮肤，固定 3/4 视角。页面和 WebGL 清除色均为透明，没有文字、HUD 或边框。皮肤和音频由主进程通过白名单 IPC 读取，避免构建后 `file://` 页面读取素材失败。
- 初始调用 `setIgnoreMouseEvents(true, { forward: true })`。渲染进程对模型做射线检测，并核对皮肤像素 alpha；交互状态变化时经 IPC 切换穿透并记录日志。额外每 33 ms 查询一次系统光标位置，以应对某些 Windows/Electron 组合不转发鼠标移动事件；按压期间保持可交互。
- 预解码 Ya1/Ya2 音频；左键按下和松开分别播放，音量 40%。按下以脚底为轴缩放到 `(1.05, 0.88, 1)`，松开经过至少 32 ms 的按压展示后，以 220 ms `cubic-bezier(.34,1.56,.64,1)` 回弹。
- `skinview3d 3.4.2` 实际依赖 Three `0.156.x`。M0 将直接依赖对齐到 `three 0.156.1` 和 `@types/three 0.156.0`，避免两套 Three 导致射线检测类型与运行时对象不一致。这与 PRD 中预期的 Three 0.186 不同，M1 升级时须重新核对兼容性。

## 运行方式

在 PowerShell 7 中从项目根目录执行：

```powershell
cd '<repo>'
$env:electron_config_cache = Join-Path (Get-Location) '.electron-cache'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm install
pnpm build
pnpm dev
```

首次运行时 Electron 会下载可执行文件。项目内的 `.electron-cache` 避免向受限的用户级缓存目录写入；以上环境变量只影响当前 PowerShell 会话。右键托盘图标，点「退出 M0」可结束应用。若要保存窗口截图，运行 `pnpm dev` 前设置 `$env:NIKO_M0_CAPTURE = '1'`；皮肤加载后会写入 `artifacts/m0.png`。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| `pnpm install` | 通过，依赖和锁文件已生成。 |
| `pnpm build` | 通过，包括 electron-vite 三端构建和 TypeScript strict 类型检查；已检查输出包含原样皮肤和两段 MP3。 |
| `pnpm dev` | Vite 主进程、预加载和渲染服务均构建并启动；Electron 可执行文件在显示窗口前退出，代码 `0x80000003`。日志见 `artifacts/m0-dev.stdout.log` 和 `artifacts/m0-dev.stderr.log`。 |
| 透明窗口、模型、点击穿透、音频和回弹的实机验收 | **未完成**：Electron 在进入应用主进程前退出，无法观察窗口或操作。`artifacts/m0.png` 未生成。 |
| Electron 独立诊断 | 在清除 `ELECTRON_RUN_AS_NODE` 后，`pnpm exec electron --version` 同样以 `0x80000003` 退出；加 `--no-sandbox --disable-gpu` 仍相同。说明当前阻塞发生在 Electron 可执行文件启动阶段，不是模型或窗口脚本抛错。 |
| 无残留进程 | 已确认无 Electron 进程、无 `pnpm dev` 启动进程、5173 端口无监听。 |

`skinview3d` 所依赖的 Three 0.156 源码创建 WebGL 上下文时请求 `alpha: true`，`skinview3d` 将清除 alpha 设为 0；渲染端启动时还检查实际上下文 alpha 和清除 alpha，并将失败写入主进程日志。这是源码和构建级确认，尚不能代替桌面合成截图。

## 已知问题与下一步

当前环境阻止 Electron 44.9.1 可执行文件启动，需在可运行 Electron 的 Windows 桌面重新执行上述命令，检查 `artifacts/m0.png`、桌面背景是否透出、Slim 手臂和外层、鼠标穿透、音频与回弹。若窗口透明测试失败，应先修正 WebGL/Electron alpha 再进入 M1；若仅鼠标事件转发失败，现有光标轮询应能维持射线检测，需从交互日志和桌面点击实测确认。

## 2026-10-20 后续实机验证（Lead）

### 版本阻塞已定位

- 本机 Electron **44.9.1 在 Windows 11 26200 上启动即挂起**：`app.whenReady()` 不触发，JS 事件循环停住；`--no-sandbox`、`--disable-gpu`、`--single-process`、Electron 33.4.11 均复现。
- 本机 DSH 桌面版自带 **Electron 44.7.0**，同一台机器、同一会话运行正常。
- 使用 DSH 的 44.7.0 runtime 承载本项目构建产物后，窗口、透明、WebGL、皮肤和事件全部正常。
- **决定：项目锁定 Electron 44.7.0**；不要使用 44.9.1。`docs/TECH-PLAN.md` 里的 44 仍成立，但具体版本以 44.7.0 为准。

### 已验证（44.7.0 runtime）

- 透明无边框置顶窗口在 1536×960、125% DPI 下可见；宠物背后直接看到桌面/DSH 界面，没有黑底/白底矩形。
- `skinview3d` 正确加载 `niko.png`：Slim 3px 手臂、外层帽子/外套、64×64；3/4 视角。
- WebGL 上下文 `alpha: true`，`body` 背景为 `rgba(0,0,0,0)`。
- 用 CDP 发送真实鼠标事件验证压扁：`scale (1.05, 0.88, 1)`，`position.y` 补偿脚底；松开后 220ms 回弹，80ms 时约 `(0.999, 1.001, 1)`，380ms 回到 1。
- 相机已从默认 0.9 调到 **0.55**，420px 画布中宠物约 220px 高、脚底约 85%；见 `artifacts/m0-final.png`。
- 桌面截图见 `artifacts/pet-live-now.png` / `artifacts/pet-topmost.png`。

### 尚未完成

- 用**官方 Electron 44.7.0** 替换 44.9.1，并在真实桌面复跑（正在下载）。
- 点击穿透的“点到桌面/底层窗口”实测；目前实现了 IPC + 射线 + 光标轮询，但还没有在底层窗口上验证。
- 点击音效的听感确认（代码已预解码并播放，控制台无报错；Agent 无法听音）。
- 托盘图标/菜单在 44.7.0 下的完整验证。
- 相机/窗口的最终构图（M1 会按 M2+ 的行为再做一次统一）。

### 下一步

M1 用官方 44.7.0 继续：拆分模块、走路/待机、托盘、手势状态机、设置骨架；M1 验收通过后再进入 M2。

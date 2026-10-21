# PLATFORM-AUDIT — 平台/发布流只读审计

> 审计对象：Niko Pet 3D（项目根 `<repo>`）
> 审计者：platform-dev（DeepSeek worker）
> 日期：2026-10-21
> 阶段：**只读审计**。本轮未编辑 `src/**`、`package.json`、资产、测试，未安装依赖，未启动第二个 GUI 实例，未重启用户正在运行的桌宠。唯一写入文件：本文件。
> 输出约定：正文中文；文件、模块、字段、状态、缺陷编号等技术标识用 English。
> 对齐依据：`docs/COMMANDER-BRIEF.md`（审计后期出现并补读）的接口命名、G1 顺序、用户问题推荐项；若冲突，以 Brief/用户最新回答为准。

---

## 0. 结论摘要

1. **P0 缺陷已确认 6 个**：`PLT-01` resize guard 在 125% DPI 下自激循环（真实日志 12,035→12,090 条，审计期间仍在增长；历史实例 2,218 条）；`PLT-09` 托盘只有 `double-click`，没有单击找回；`PLT-14` 设置页只有 size/volume，首启向导/自启/全屏/快捷键全部缺失；`PLT-15` 自启默认 `false` 且完全未实现；`PLT-25` 没有任何 electron-builder 配置、图标、可执行产物脚本；`PLT-26` `pnpm-workspace.yaml` 被写入了 pnpm 交互提示占位符，source zip/干净安装会踩坑。
2. **另有一个“缺失的 P0 能力”**：全屏检测与只露头探头完全未实现（PRD A10），而桌宠窗口当前是 `alwaysOnTop(true, 'screen-saver')`，全屏游戏时会被它直接压在上面。全屏探头应作为独立 P0 任务，而不是设置页附属项。
3. **全屏探头设计的关键纠正**：TECH-PLAN §8.2 的“只把窗口移出屏幕边缘”只在**下边缘**天然成立；上/左/右边缘如果只做窗口裁切，头下方的身体仍会留在屏幕内。推荐 **head-only render mode**（同一窗口、隐藏身体、把头部框到窗口中心、窗口透明）+ 窗口部分移出屏幕裁切头部，四边统一，不新增第二个窗口。
4. **设置/向导设计完成**：schema v2、字段/默认值/校验/保存时机、开机自启“全新安装默认 ON、已有配置保留原值（可关）”、自定义快捷键编辑器、多显示器/DPI 方案均已给出；需要先修正 PRD/DECISIONS/TECH-PLAN 中“自启默认关”的旧结论。
5. **打包方案完成**：electron-builder `26.x` + `electronDist: node_modules/electron/dist` 锁死 Electron 44.7.0，portable + NSIS per-user + source zip；图标用皮肤头部生成多尺寸 ICO；必须做干净用户配置验收。
6. **就绪度**：写完本文后**可以进入 write-scoped 实现任务**，但需要 Lead 先冻结 `src/shared/contracts.ts`（`FullscreenState`/`BehaviorMode`/`ActionId`）与设置迁移策略，并明确 `src/main/index.ts` 与 `ipc.ts`（含 `ASSET_PATHS`）的写入归属。另需用户回答第 7 节 8 个问题（或授权按推荐项执行）。

---

## 1. 审计范围、环境与证据

### 1.1 已读文件

| 范围 | 文件 |
|---|---|
| 交接/决策 | `docs/TEAM-HANDOFF.md`、`docs/SKILLS.md`、`docs/PRD.md`、`docs/DECISIONS.md`、`docs/TECH-PLAN.md`、`docs/COMMANDER-BRIEF.md` |
| 主进程 | `src/main/index.ts`、`pet-window.ts`、`ipc.ts`、`tray.ts`、`settings.ts`、`settings-window.ts`、`brightness.ts`、`photo.ts`、`logger.ts` |
| 设置渲染层 | `src/renderer/settings.ts`、`settings.html`、`settings.css`、`src/shared/settings.ts` |
| 桥接/构建 | `src/preload/index.ts`、`package.json`、`electron.vite.config.ts`、`tsconfig.json`、`pnpm-workspace.yaml`、`.gitignore` |
| 交叉阅读 | `src/renderer/pet.ts`、`gestures.ts`、`viewer.ts`、`audio.ts`、`src/shared/walk.ts`、`src/shared/gesture.ts`、`tests/settings*.test.ts`、`tests/walk.test.ts` |

`docs/COMMANDER-BRIEF.md` 在审计开始时尚未出现，完成前已出现并补读；本文已按其接口命名（`FullscreenState`、`pet:peek-state`、`pet:head-anchor`、`ActionId`、`BehaviorMode`）、G1 优先顺序和“Lead 冻结 `src/shared/contracts.ts`”约定对齐。若有与本文件冲突之处，以 Commander Brief 和用户最新回答为准。

### 1.2 环境事实（本机，只读采集）

- Windows 11 x64；Node `24.21.0`；pnpm `11.7.0`；Electron `44.7.0`（`node_modules/electron` 实测）。
- 显示：单屏 `1536×960` DIP，`125%` 缩放，`workArea=1536×912`（任务栏 48 DIP）。当前机器**没有第二台显示器**，多显示器只能先做纯逻辑测试，真机验收需要用户配合。
- C# 工具：`csc.exe` 4.8.9221 可用（`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319`），.NET Framework 4.8.1（Release 533509）；`dotnet 10.0.401` 也可用。→ C# helper 方案在本机可构建。
- `powershell.exe` 实际为 Windows PowerShell 5.1；Python 3.12 可用（Pillow 需用 DSH bundled env 或安装，见 §5.3）。
- 当前运行实例：PID `15364` 等，命令行使用 `--user-data-dir="...\.scratch-userdata"`、`--debug-walk`，**不是** handoff 所写的 `.scratch-userdata-live`；未杀/未重启。日志中当前实例的 `settings.json` 为 `size=500, volume=0.55, autostart=false, firstRun=true`；实际窗口被 `workArea.height=912` 限制为 912×912 DIP。
- 当前实例日志：`.scratch-userdata/logs/main.log` 审计开始时 **12,035** 条 WARN/ERROR，结束时 **12,091** 条；其中 **12,090** 条是 `pet resize guard`，另有 1 条 `failed to register Ctrl+Alt+P photo shortcut`（见 `PLT-01`/`PLT-30`）。历史实例 `.scratch-userdata-live/logs/main.log` 共 **2,218** 条同类告警。
- 已安装的 `pnpm-workspace.yaml` 内容异常（见 `PLT-26`）。
- 构建门禁（引用 QA 基线，非本审计执行）：`electron-vite build`、`tsc --noEmit`、`vitest run` 17/17 通过；本审计为只读，未重复启动构建/安装依赖。
- 当前实例窗口自 13:39:14 起隐藏到托盘（QA 基线观察），桌面无宠物；托盘单击缺失（`PLT-09`）是当前最直接的可用性阻断。
- 当前没有 electron-builder（`node_modules/.bin/electron-builder.cmd` 不存在），也没有 `get-windows`、`release/`、`resources/`、`build/`、`scripts/`。

### 1.3 审计方法与限制

- 只做静态阅读 + 只读日志/进程/显示信息采集；**没有启动可见 GUI 做自我验收**（遵守 AGENTS.md）。
- 涉及“点击是否抢焦点、透明窗口是否闪烁、全屏游戏是否被遮挡”等结论，标注为**待真机验证的假设/风险**，不当作已证实结论。
- 本文中的“建议文件路径”是后续实现建议，本轮不创建。

---

## 2. 真实缺陷与风险清单

严重度定义：

- **P0**：阻塞用户已拍板的 P0 里程碑或交付物，必须最先修。
- **P1**：发布前必须修，影响稳定性/可用性/验收。
- **P2**：技术债、体验细节或后续增强，可排到 P1 之后。

### 2.1 窗口 / 焦点 / DPI / 多显示器

| ID | 级别 | 位置 | 事实/证据 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| `PLT-01` | **P0** | `src/main/pet-window.ts:116-128` | `resize` 监听严格比较 `bounds.width/height !== windowSize`，不一致就 `setBounds`；在 125% DPI 下 Windows 把 DIP 764/912 舍入为 765/913，触发下一次 `resize`，形成自激循环。日志 `.scratch-userdata/logs/main.log` 中 `pet resize guard` 从审计开始的 12,035 条增长到 12,090 条（QA 基线独立统计为 12,034 条，说明仍在持续写入），`.scratch-userdata-live/logs/main.log` 中 2,218 条；时间分布 16:16:28–16:17:22 每秒 32–50 条，之后在 16:17:37/16:17:48 与 16:18:28 反复出现；`size=420` 时为 `421x420 -> 420`，`size=764` 时 `765x764 -> 764`，`size=912` 时 `913x913 -> 912`。 | 日志被灌满（12k+ 行、仍在增长）、主进程每秒 30–50 次 `setBounds`、透明窗口可能抖动/闪烁；未来探头移动窗口时会与该守卫互相拉扯；掩盖真正 resize 问题。 | ① 容差：宽高与目标差 ≤ 2 DIP 时不动；② 自卫抑制：自己调用 `setBounds` 后 150–250 ms 内忽略 `resize`；③ 只在 `mode === 'normal'` 时执行守护，`peek/closing/dragging/photo` 跳过；④ 不再无条件重设 y；⑤ 日志同一秒最多 1 条并带计数。 |
| `PLT-02` | **P1** | `src/main/pet-window.ts:67` | `focusable: true`；`showInactive()` 只影响显示时不激活，**点击**窗口仍会激活 Electron 窗口。PRD §3.2 要求“不抢当前窗口焦点”；Commander Brief §5 的期望是 `focusable:true + showInactive()` 不应抢焦点，但这是**期望而非已实测结论**。 | 用户在全屏游戏/编辑器里点一下桌宠，键盘焦点可能被桌宠拿走，游戏输入中断；属于必须真机验证的高风险点。 | 先做 focus 实验：保持 `focusable:true`，用编辑器/游戏验证点击后焦点是否丢失；若丢失，再试 `focusable:false` + 现有 pointer 事件/命中轮询是否仍工作，或 `pointerup` 后 `win.blur()`；`WS_EX_NOACTIVATE` 是最后手段。验收：点击角色时前台编辑器光标不丢。 |
| `PLT-03` | **P1** | `src/main/pet-window.ts:78`、`src/main/index.ts:83-92` | `setAlwaysOnTop(true, 'screen-saver')` 使宠物始终压在全屏应用之上；没有任何全屏检测/探头代码。PRD A10 未实现。 | 玩全屏游戏/看视频时桌宠直接挡画面，用户会立刻认为“坏了”；这是 P0 缺失能力，和 `PLT-01` 一起决定全屏体验。 | 见 §3：检测 + head-only 探头 + 用户开关；全屏检测不可用时回退“正常底部”，并在设置里明示。 |
| `PLT-04` | **P1** | `src/main/pet-window.ts:55-75` | pet 窗口 `webPreferences` 没有 `backgroundThrottling:false`；TECH-PLAN §5.1 明确计划过该项。窗口 `hide()`/完全移出屏幕期间 Chromium 会节流 rAF，探头滑动动画可能延迟或丢首帧；隐藏时也没有显式暂停 renderer 动画循环的协议。 | 探头“探出/缩回”可能卡顿；隐藏时 CPU/GPU 行为不可控。 | 增加 `backgroundThrottling:false`；main→renderer 增加 `pet:visibility`/`pet:peek` 状态，隐藏时由 behavior 暂停 rAF；探头前先 `showInactive()` 并等 1–2 帧再滑动。真机测量隐藏时 GPU/CPU。 |
| `PLT-05` | **P2** | `src/main/pet-window.ts:52-54,204-219,413-416`；`src/shared/settings.ts:16-17` | 创建时只用主屏；`sizeForArea` 把窗口限制在 `workArea.height`，125% 下 `size=500` 实际窗口 912 DIP（约等于 478px 角色），设置仍显示 500；`lastDisplayId`/`lastX` 在 schema 中存在但 `reconcileDisplay()` 不读取、不保存；`x += (oldSize-newSize)/2` 每次 metrics 变化可能整数漂移。 | 设置值和实际大小不符；重启后位置/显示器不恢复；多屏/DPI 变化反复漂移。 | 设置页显示“有效尺寸”或允许窗口高于 workArea；恢复 `lastDisplayId/lastX` 并按 workArea clamp；尺寸变化以底边中心为锚点、用浮点累计再取整；显示器/DPI 变化后写入 lastDisplayId/lastX（防抖）。 |
| `PLT-06` | **P2** | `src/main/pet-window.ts:116-128` | resize guard 不区分拖拽/探头/拍照/关闭收尾；关闭流程 `finishClose()` 里先 `hide()`、再 `setBounds(compact)`、最后才把 `closing=false`，延迟到达的 resize 事件仍会被捕获（16:18:44 就有一条 `765x764 -> 764`）。 | 探头移动/拖拽时若有 1–2 DIP OS 舍入，窗口会被拉回底部；关闭收尾可能再闪一下。 | 引入 `WindowMode`（normal/peek/closing/dragging/photo）并在 guard 中跳过非 normal；自卫抑制覆盖 `finishClose`。 |
| `PLT-07` | **P2** | `src/main/pet-window.ts:383-399`；`src/main/index.ts:78-81` | 拖拽时用所有显示器 `bounds` 的并集 min/max 做 clamp，可把窗口拖进两块高度不同显示器之间的“空洞”区域；`endDrag()` 才按 cursor 吸回某块屏。显示移除/DPI 变化只调 `reconcileDisplay`，拖拽中直接 return。 | 拖拽过程中宠物可能消失/卡在不可见区域；拔插显示器时位置异常。 | 拖拽 clamp 用“光标所在/最近显示器”的 available rect 并集，或逐屏判断；`display-removed` 时若正在拖拽，取消拖拽并落到最近屏；加纯函数测试。 |
| `PLT-08` | **P2** | `src/renderer/viewer.ts:15` | `pixelRatio = min(devicePixelRatio, 2)` 只在创建时算一次；跨不同 DPI 显示器时不变；main 没有向 renderer 发送 `display scaleFactor`。 | 125%↔150%/100% 跨屏后画面发虚或过采样；125% DPI 验收项 A02 不完整。 | main 在 `display-metrics-changed`/窗口跨屏时发 `pet:display`（displayId、scaleFactor、bounds、workArea）；behavior 更新 `viewer.setPixelRatio` 并 resize；平台负责事件。 |

### 2.2 托盘 / 单实例

| ID | 级别 | 位置 | 事实/证据 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| `PLT-09` | **P0** | `src/main/tray.ts:55-58` | 只有 `tray.on('double-click', ...)`，没有 `click`。用户明确要求“托盘单击找回”。QA 基线还观察到当前实例窗口自 2026-10-21 13:39:14 起隐藏，桌面截图无宠物，单击托盘无效——这是当前真实可用性阻断。 | 用户关闭宠物后单击托盘无反应，只能双击；直接违背最新决策，并让当前实例处于“看不见”状态。 | 加 `tray.on('click', ...)`；语义见 Q2（推荐：隐藏时显示/找回，已显示不隐藏）；同时 `updateMenu()`；保留双击作为兼容。 |
| `PLT-10` | **P1** | `src/main/tray.ts:15-33` | `trayImage()` 找不到皮肤时返回 `nativeImage.createEmpty()`，随后 `new Tray(image)`；Windows 上空图标可能直接抛异常，`whenReady` 的 catch 会 `app.quit()`。候选路径中 `join(app.getAppPath(),'public',...)` 在打包后通常不存在（electron-vite 把 `public` 复制到 `out/renderer`）。没有独立托盘 ICO。 | 打包/换机器后托盘图标缺失 → 启动即退出，宠物完全不可用。 | 生成专用 `build/tray.ico`（16/32/48），打包进 `extraResources`；开发态从 `build/` 读；读取失败用内置 1×1 PNG fallback，`try/catch new Tray` 失败时记录并继续无托盘运行（至少不崩）。 |
| `PLT-11` | **P1** | `src/main/index.ts:17-23` | `second-instance` 在 `pet`/`settingsWindow` 为 null 时被调用会静默丢失（启动早期第二次启动的情况）；每次都 `settingsWindow.open()`，用户可能只想要宠物；没有解析 `--startup-hidden`/`--autostart`；`app.setAppUserModelId` 在 ready 后设置（Windows 通知/快捷方式一般够用，但可提前）。 | 重复启动偶尔“没反应”；自启参数无法区分静默启动；第二次启动总是弹设置窗，可能打断用户。 | 加 `pendingShow` 标志，ready 后处理；`second-instance` 只显示宠物（可配置）；解析启动参数；`app.setAppUserModelId` 尽量在 ready 前；记录 argv 但不打印敏感内容。 |
| `PLT-12` | **P2** | `src/main/tray.ts:35-54` | 菜单 label 只在 `right-click` 时刷新；用 `setContextMenu()` 后菜单打开顺序取决于平台；显示/隐藏由手势关闭触发时，菜单 label 直到下次右键前都是旧值；tooltip 固定 `'Niko Pet 3D'`，没有使用 nickname；没有托盘“显示/隐藏”的互斥状态事件。 | 菜单偶尔显示“隐藏 Niko”但宠物已隐藏；tooltip 不个性化。 | 在 PetWindowController 的 show/hide/close/restore 统一调用 `tray.refreshMenu()`；tooltip 用 nickname（仅托盘，桌面无文字）；菜单打开前强制重建（Windows 下可在 `right-click` 里 `setContextMenu`，保留兜底）。 |
| `PLT-13` | **P2** | `src/main/index.ts:17-19` | 单实例锁按 userData 区分；当前 dev 用 `.scratch-userdata`，安装版用默认 `%APPDATA%\<app name>`；若 `productName` 引入导致 userData 变化，旧设置/日志/照片路径会“消失”。 | 安装版与便携版/开发版可能互不识别；用户升级后设置丢失。 | main 在 `requestSingleInstanceLock()` 前固定 userData 名称（`app.setName('niko-pet-3d')` 或显式 `app.setPath('userData', ...)`）；若 productName 改名，做一次性迁移；写进打包验收。 |

### 2.3 设置 / 首启 / 自启 / 持久化

| ID | 级别 | 位置 | 事实/证据 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| `PLT-14` | **P0** | `src/renderer/settings.html`、`settings.ts` | 设置页只有 `size` 和 `volume` 两个滑块 + 保存/关闭；`nickname`、`autostart`、`longPressMs`、`darkThreshold`、`autoTorch`、`clickSounds`、`particles`、`photoDir`、`lastDisplayId`、`lastX`、`firstRun` 均未暴露；无首启向导、无自启、无全屏开关、无快捷键。 | P0 用户决策（完整设置/向导/自启/快捷键/全屏开关）全部未落地；用户实际上无法管理桌宠。 | 按 §4 重做 settings 窗口 + 向导（同一 renderer，`?wizard=1`），一次覆盖所有字段；保留现有原生 TS+CSS，不引入框架。 |
| `PLT-15` | **P0** | `src/shared/settings.ts:20-34`；`src/main/index.ts:29-97` | `DEFAULT_SETTINGS.autostart = false`，PRD/DECISIONS/TECH-PLAN 也写“默认关”；用户 2026-10-21 明确改为“开机默认自启（设置里可关）”。代码中没有任何 `setLoginItemSettings` 调用。 | 用户最新决策未实现；而且 **portable exe 的 `process.execPath` 是临时解压目录**，直接照 TECH-PLAN 写法会把自启指向临时路径，重启后失效。 | `DEFAULT_SETTINGS.autostart = true` 仅用于全新安装；已有 settings.json 的 v1→v2 迁移保留原值（Brief 要求：不覆盖既有选择，当前 live 的 false 不被强制改）。新增 `src/main/autostart.ts`：portable 用 `process.env.PORTABLE_EXECUTABLE_FILE`，安装版用 `process.execPath`；dev 跳过；设置页显示真实注册状态并提示“建议开启”；同步更新 PRD/DECISIONS/TECH-PLAN（由 Codex/Lead 写，platform 仅提交建议）。 |
| `PLT-16` | **P1** | `src/renderer/settings.ts:38-51`；`src/main/settings.ts:42-55`；`src/main/ipc.ts:114-129` | 只有点“保存”才写盘，且只提交 size/volume；没有字段级校验提示、没有保存防抖、没有退出前 flush、没有 `settings:reset`；外部/宠物侧更新时 `onSettings` 会把滑块值直接覆盖，用户正在拖动时可能被拉走。 | 设置界面一扩展就容易丢字段/丢最后一次修改；坏输入靠 store 静默 clamp，用户不知道被改了。 | 字段级校验 + 明确中文错误；保存策略见 Q6；store 增加 `flush()` 并在 `before-quit` 等待；保存后广播，UI 只在非编辑状态应用；新增 reset/pickDir/openDir/status IPC。 |
| `PLT-17` | **P1** | `src/shared/settings.ts:94-103` | `version !== 1` 或任一字段类型不对 → 视为 corrupted，直接备份并恢复默认；没有 v1→v2 迁移，也没有“保留可解析字段”的策略；新增字段会改变默认行为但版本号不变。 | 将来加 schema v2 时，老用户升级会被整体重置（包括自启/音量/昵称）。 | 引入 `version:2` + `migrateV1toV2()`：保留可解析字段，新增字段填默认；future version 不直接重置，先备份再只读加载/提示；测试覆盖 v1→v2、坏字段、未知版本。 |
| `PLT-18` | **P2** | `src/main/settings-window.ts:21-35` | 固定 `420×320`，无导航/分区；无 `will-navigate`/`setWindowOpenHandler` 防护；窗口已存在时只 `show/focus`，不会刷新显示期间被外部改掉的设置；关闭窗口不 flush（当前无防抖，扩展后需要）。 | 完整设置内容放不下；长期运行可能显示旧值；本地应用安全风险低但应加防护。 | 改为约 `760×620`（可缩放，左右导航）；`webContents.setWindowOpenHandler(() => ({action:'deny'}))`、`will-navigate` 阻止外部导航；`show` 时重新 `getSettings()`；关闭时 flush。 |
| `PLT-19` | **P2** | 全域 grep | `particles` 字段从未被 renderer 读取；`longPressMs` 从未生效（`src/shared/gesture.ts:15` 硬编码 `TORCH_DELAY_MS=1500`）；`lastDisplayId/lastX` 未被使用；`photoDir` 未被 `photo.ts` 使用；`nickname` 只用于照片文件名；`firstRun` 无人消费。 | 如果设置页直接暴露这些字段，会变成“假开关”；用户改长按/粒子/照片目录却没有效果。 | 要么接线（longPressMs 由 interaction 接入；photoDir 由 photo 接入；particles 由 interaction/behavior 判断；lastX/lastDisplayId 由 pet-window 接入），要么从 UI/schema 删除；P0 先接 `longPressMs`/`photoDir`，`particles` 由互动流决定。 |

### 2.4 亮度 / 拍照 / 关闭恢复

| ID | 级别 | 位置 | 事实/证据 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| `PLT-20` | **P1** | `src/main/brightness.ts:18-54`；`src/main/index.ts:83-87` | 固定每 20 s 启动一次 `powershell.exe` + WMI，无论 `autoTorch` 是否开启、宠物是否隐藏；结果相同也每 20 s 往日志写一行（当前实例日志 05:42:23–05:50:23 每 20.0 s 一条 `screen brightness -> 16`）；失败与“设备不支持”都变成 `null`，没有错误原因、没有 unsupported 缓存、没有 backoff。 | 长期空转（每 20 s 一个进程）；日志噪音；台式机/外接屏用户永远无法从设置里知道“不支持”；主进程在电池/游戏场景浪费资源。 | 仅在 `autoTorch && petVisible && !closing` 时轮询；间隔 30–60 s；连续 3 次失败/无 WMI 类 → 标记 `supported=false` 并停止到手动“重新检测”；只在值变化时通知/记录；用完整路径 `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`；设置页显示 `value/supported/lastChecked`。 |
| `PLT-21` | **P1** | `src/main/photo.ts:28`；`src/main/index.ts:42-63` | `sources.find(display_id)` 找不到时直接 `sources[0]`，多屏可能拍错显示器；拍照前不隐藏设置窗口（设置窗口可能盖住宠物）；宠物隐藏/探头时没有“临时显示”逻辑；`photoDir` 未使用；文件名只到秒，1 秒内连拍会覆盖；失败只写日志，无用户反馈。 | 多屏用户照片拍错屏；设置窗挡住宠物；关闭后托盘拍照返回 null；照片路径不可配置；连拍覆盖。 | 抽出 `PhotoController`：隐藏设置窗口→等待→截图→恢复；隐藏/探头时临时 `showAtBottom()` 再拍；`photoDir` 接入；文件名加毫秒或冲突后缀；source 匹配失败用 display 索引兜底并记录；失败给托盘/设置状态（不在桌宠上显示文字）。 |
| `PLT-22` | **P2** | `src/main/photo.ts:20-35`；`src/main/index.ts:47` | `thumbnailSize` 按 `display.size * scaleFactor` 全屏物理像素，4K 截图内存峰值几十 MB；`setTimeout 160ms` 后截图，renderer 冻结/粒子是否真正停下没有确认；没有 `photoBusy` 互斥，连按热键会并发。 | 偶发大内存/拍糊；并发截图互相覆盖。 | `photoBusy` 锁；用 `requestAnimationFrame`/`pet:photo:frozen` ack 代替固定 160ms；thumbnail 设上限（如 3840×2160）；保存后 `shell.showItemInFolder` 仅由设置按钮触发。 |
| `PLT-30` | **P1** | `src/main/index.ts:74-76` | `globalShortcut.register('Control+Alt+P', ...)` 失败时只 `logger.warn`；当前实例日志有 1 条 `2026-10-20T16:19:25.780Z [WARN] failed to register Ctrl+Alt+P photo shortcut`（QA 基线也记录旧会话注册失败一次）。设置页无状态、托盘仍有拍照入口，用户只会觉得“按了没反应”。 | 拍照热键静默失效；自定义快捷键若沿用同一模式，失败也不可见。 | 抽 `src/main/hotkeys.ts` 统一注册/回滚；把每个 `ActionId` 的注册状态（registered/conflict/invalid/disabled）发给设置页；失败时托盘气泡/设置状态提示一次；拍照仍可从托盘触发；测试系统占用冲突。 |
| `PLT-23` | **P1** | `src/main/pet-window.ts:257-301`；`src/main/index.ts:20-22` | 关闭/恢复主流程基本可用（2.4s/3.0s 由 renderer 控，main 在 `beginClose` 后 1200ms 隐藏；`finishClose` 恢复 compact bounds 并置 `restorationPending`），但 `pet:restored` 只在 `show` 且 `restorationPending` 时发；关闭中第二次启动/托盘点击会 `finishClose()`→`hide()`→立刻 `showInactive()`，可能闪一下；关闭完成后延迟 resize 事件仍触发 guard（见 PLT-06）。 | 关闭/恢复偶发闪烁、恢复动作丢失；与探头/托盘交互时状态更复杂。 | 把关闭/恢复并入统一 `WindowMode` 状态机；`finishClose` 完成后才允许 show；`show()` 触发 restored 用一次性 flag；关闭期间禁止 peek/schedule；恢复后 300ms 内不做窗口重排。 |
| `PLT-24` | **P2** | `src/main/index.ts:78-81`；`screen` 事件 | 只监听 display-add/remove/metrics-change，没有 `display-metrics-changed` 的 `changedMetrics` 区分（scale/rotation/workArea）；没有窗口 `moved` 时更新 lastDisplay；任务栏自动隐藏/位置变化也只是 workArea 变化，未特殊处理。 | DPI/任务栏变化后宠物位置/大小可能不对；全屏探测的目标显示器和照片显示器需要同一套 display 快照。 | 统一 `display-snapshot.ts` 纯函数（选显示器、clamp、DST/scale），main 在 screen 事件 + 窗口 moved + peek 开始时刷新；把 displayId/scaleFactor/bounds/workArea 发给 renderer/peek/photo。 |

> 跨流提醒：Commander Brief §1 指出的 `pet.ts` `lastAutoTorchAt=0`（冷启动前 10 分钟可能不自动举火把）、手动关火把后未等待新暗边沿，属于 interaction/behavior 的修复范围；平台只保证 brightness 状态/设置/IPC 正确，不重复改 renderer。`audio.ts` 的 `actionSounds` 消费也由 interaction 接。

### 2.5 构建 / 发布 / 配置（当前完全缺失）

| ID | 级别 | 位置 | 事实/证据 | 影响 | 修复方向 |
|---|---|---|---|---|---|
| `PLT-25` | **P0** | `package.json`、根目录 | 没有任何 electron-builder 配置/依赖/scripts；没有 `build/`、`resources/`、`release/`、图标；`version=0.0.0`，无 `productName/description/author`；只有 `dev/build/test`。 | P0 交付物（portable exe + NSIS + source zip）无法产出；A14 无法验收。 | 见 §5：新增 `electron-builder.yml`、`build/icon.ico`、`build/tray.ico`、`scripts/` 打包与 source zip；`package.json` 加 dist scripts/元数据；不改 Electron 版本。 |
| `PLT-26` | **P0** | `pnpm-workspace.yaml:1-2` | 当前文件把 pnpm 的交互提示写成了配置：`allowBuilds:` 下 `get-windows: set this to true or false`（不是合法布尔值）；`pnpm-lock.yaml` 中也没有 `get-windows`。这是 pnpm 11 对 `get-windows` 安装脚本（`node-pre-gyp install --fallback-to-build`）的交互提示被写入配置的占位符。 | 干净环境 `pnpm install` 可能在解析该字段时失败/无法完成构建脚本审批，source zip 无法复现；也证明之前确实尝试过 `get-windows` 但没完成。 | 立即修复：要么删除该块（如果不引入 get-windows），要么写合法布尔并同时把依赖加入 lock；source zip 验收必须包含干净 `pnpm install --frozen-lockfile`。如果选择 C# helper（推荐），直接删除该块。 |
| `PLT-27` | **P1** | `package.json`；`src/main/index.ts:30`；TECH-PLAN §15 | `app.setAppUserModelId('com.nikopet.desktop')` 与未来 `appId` 可对齐；但应用名/userData 路径没有锁定，`productName` 一旦加入会改变 `%APPDATA%` 目录；TECH-PLAN 写 `%APPDATA%\NikoPet3D`，实际默认是 `%APPDATA%\niko-pet-3d`；TECH-PLAN 的 files 配置 `public/assets/**`、`resources/**` 与当前 electron-vite 输出布局不符。 | 打包后设置/日志路径变化；TECH-PLAN 照抄会得到“资源缺失/找不到图标”。 | 固定 `app.setName('niko-pet-3d')`（或显式 userData）；`electron-builder.yml` 只打包 `out/**` + `package.json`（+ helper/图标 extraResources），不要重复打 `public/**`；图标/helper 用 `extraResources`。 |
| `PLT-28` | **P1** | 打包/签名 | 没有代码签名证书；portable 是 electron-builder 的 NSIS 自解压包装，运行时 `process.execPath` 指向临时目录；NSIS 卸载不会自动清理自启 Run 项；Windows SmartScreen/杀软可能提示未知发布者。 | 用户首次运行需要点“更多信息→仍要运行”；自启若路径写错重启失效；卸载残留 Run 项。 | 不签名（本地自用；Q7）；自启写 `PORTABLE_EXECUTABLE_FILE`；NSIS 加 `installer.nsh` 的 `customUnInstall` 删除 Run 值；干净配置验收包含 SmartScreen 说明。 |
| `PLT-29` | **P2** | 验收资产 | 没有干净 profile 验收清单；没有 source zip 生成/复现验证；没有图标存在性测试；没有多显示器/DPI 真机矩阵。 | 打包可能“在我机器上能跑”；交付不可复现。 | 见 §5.6 验收矩阵；QA 增加 assets/icon 测试；Lead 做真实安装/便携/源码复现。 |

### 2.6 P0 缺陷的额外证据（摘要）

**PLT-01 自激循环（最重要）**

```
2026-10-20T16:16:28.151Z [WARN] pet resize guard: 770x768 -> 764
2026-10-20T16:16:28.159Z [WARN] pet resize guard: 765x764 -> 764
2026-10-20T16:16:28.162Z [WARN] pet resize guard: 765x764 -> 764
... 每秒 30–50 条，持续到 16:17:22 ...
2026-10-21T05:39:07.564Z [WARN] pet resize guard: 913x913 -> 912
```

- 当前屏 `1536×960` DIP，`--device-scale-factor=1.25`（进程命令行证据）。
- 窗口目标 764/912 DIP，Windows 报告 765/913，严格比较 + 立即 `setBounds` → 自反馈。
- 该循环在 `size=420`（421/420）、`size=764`、`size=912` 都出现，说明不是单次设置错误，而是必现的 DPI 舍入问题。
- **影响评级**：P0，因为它会与即将实现的探头窗口移动直接冲突；而且已经造成 12k 行日志/持续 30–50 次/秒主进程调用。

**PLT-26 pnpm 配置**

- `pnpm-workspace.yaml` 的 `allowBuilds` 值不是布尔；pnpm 11 在安装 `get-windows` 时需要批准其 `node-pre-gyp` install script，非交互环境把提示文本写进去了。
- 如果后续决定使用 `get-windows`，必须同时修这个文件、加入依赖、确认 NAPI 预编译包能装在 Electron 44 下；否则优先 C# helper（见 §3）。

---

## 3. 全屏检测与“只露头”探头设计

### 3.1 需求与语义

PRD §6 / A10 的硬要求：

- 前台窗口覆盖某个显示器（边框/无边框全屏；排除桌面、任务栏、本应用）时进入全屏模式；
- 全屏时**不走路**，身体藏起来，只偶尔露头；
- 每隔 **20–45 s** 从**随机边缘**（上/下/左/右）探出一次，停留 **4–8 s**，再缩回；
- 退出全屏后回到任务栏上方，继续正常走动；
- 检测失败/无权限：不探头，保持正常底部行为，日志记录原因；
- 用户可关闭全屏探头（设置项，默认 ON）；
- 多显示器：以全屏窗口所在显示器为准，宠物临时移动到该显示器边缘；
- **不能挡游戏主画面**：即使 `alwaysOnTop`，探头时也只有头部可见。

补充产品规则（本轮建议，需用户确认，见 Q3）：

- 默认对“所有全屏”生效（浏览器 F11、视频播放器、游戏都算）；不做进程白名单的 P0 版本。
- 本应用自己的窗口（pet/settings）不算全屏；托盘菜单、开始菜单、UAC、锁屏不算。
- 用户手动隐藏到托盘时停止检测；托盘恢复后重新检测。
- 全屏中若用户点/拖/关闭宠物，交互优先于探头时序；处理完再回到全屏模式。

### 3.2 检测方案对比（get-windows / C# helper / PowerShell 兜底）

| 维度 | A. C# helper（推荐） | B. `get-windows` npm | C. PowerShell 兜底 |
|---|---|---|---|
| 依赖/构建 | 无 npm 依赖；`csc.exe` 4.8 本机已验证可用，源码 + `build.ps1` 可复现；产物 ~20–40 KB 框架依赖 exe | 需新增 ESM 依赖 `get-windows@9.3.0`；有 `node-pre-gyp install --fallback-to-build` 安装脚本，pnpm 11 需 `allowBuilds` 布尔；失败会尝试本机 node-gyp/VS 编译 | 无依赖；`Add-Type` 现场编译 P/Invoke，或每次 `powershell -Command` |
| 启动/轮询开销 | 常驻子进程，启动 50–150 ms；500 ms–1 s 轮询，CPU 极低 | 每次 `activeWindow()` 调原生模块，开销低；ESM 动态 import | 启动 300–1000 ms；常驻 PS 30–60 MB，轮询有明显开销；一次性每次约 1–2 s |
| Electron 44 / 打包 | 无 ABI 问题；exe 放 `extraResources`，`child_process.spawn` 路径稳定 | NAPI v9 理论兼容；但 main 目前是 CJS、electron-vite 默认未 externalize；ESM-only + `.node` 需要 externalize/asarUnpack/`allowBuilds` 四处配合，风险面大 | 无 ABI 问题；但杀软/日志噪音、启动慢，不适合 1 s 轮询 |
| 判定能力 | 完整：`GetForegroundWindow`、`GetWindowRect`、`DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS/CLOAKED)`、`GetWindowLong(WS_MAXIMIZE)`、`GetMonitorInfo`、进程名/类名；能排除最大化、桌面、任务栏、cloaked | `bounds` + Windows-only `contentBounds`、owner；**没有 WS_MAXIMIZE**；任务栏自动隐藏时最大化窗口与全屏无法区分（可能误判） | 可写完整 P/Invoke，判定能力同 A，但每次/常驻成本高 |
| 安全/AV | 本地小 exe；未签名可能被杀软误报，概率低；无网络 | 原生模块 + 安装脚本；供应链/构建脚本审批 | PowerShell 执行策略/AV 日志；企业策略可能禁用 |
| 维护性 | 一份 `.cs`，逻辑清晰；多一个构建步骤 | 依赖版本/ABI/ESM 打包，升级 Electron 要复测 | 内嵌 C# 字符串难维护，只适合诊断 |
| 失败模式 | exe 缺失/被杀 → 启用 C 兜底；父进程退出时子进程要自退 | 安装脚本失败/NAPI 加载失败 → 探头直接不可用 | 慢/被策略拦截 → 仅诊断 |

**推荐**：

- **主方案 A（C# helper）**：本机编译工具链已验证；避免 npm 原生模块与 ESM/CJS 打包风险；能正确区分最大化/全屏/自动隐藏任务栏。
- **兜底 C（PowerShell）**：helper 缺失/被杀/编译失败时，用持久 PowerShell 进程（`Add-Type` P/Invoke，1–2 s 轮询）或设置页“检测一次”诊断；不作为日常高频轮询。
- **B（get-windows）仅作为 spike/备选**：如果 Lead 认为不想引入 C# 构建步骤，先在隔离目录验证 `get-windows` 在 Electron 44 下能加载、打包后能读 `.node`、且接受“任务栏自动隐藏时误判”的限制；验证通过再替换 A。不要先改生产依赖再试。
- 补充：也有 `koffi` 这类 N-API FFI 可直接调 user32（无需子进程），但仍属原生模块打包问题；本轮不作为 P0。

### 3.3 检测算法（建议实现）

伪代码（`src/main/fullscreen.ts`）：

```ts
interface ForegroundInfo {
  pid: number
  processName: string
  className: string
  bounds: Rect        // DIP
  contentBounds?: Rect
  maximized: boolean
  cloaked: boolean
}

const IGNORED_PROCESSES = new Set([
  'explorer.exe', 'ShellExperienceHost.exe', 'SearchHost.exe',
  'StartMenuExperienceHost.exe', 'TextInputHost.exe', 'LockApp.exe'
])
const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'TrayNotifyWnd'])

async function pollOnce(): Promise<FullscreenState> {
  if (!enabled || !petVisible || closing || photoBusy || locked) return { active: false }
  const info = await probe()                      // helper → PowerShell fallback
  if (!info) { failureCount++; after3 => unsupported; return last }
  if (info.pid === process.pid) return { active: false }
  if (IGNORED_PROCESSES.has(info.processName) || IGNORED_CLASSES.has(info.className)) return { active: false }
  if (info.cloaked || info.maximized) return { active: false }
  const rect = info.contentBounds ?? info.bounds
  const display = pickDisplay(rect)               // screen.getDisplayMatching
  // Commander Brief Q1 推荐：覆盖目标屏 ≥98%，普通最大化不触发
  const covers = rect.width >= display.bounds.width * 0.98
              && rect.height >= display.bounds.height * 0.98
              && rect.x <= display.bounds.x + 2
              && rect.y <= display.bounds.y + 2
  return { active: covers, displayId: display.id, processName: info.processName }
}
```

- `FullscreenState` 的完整字段由 Lead 在 `src/shared/contracts.ts` 冻结：`active`、`displayId`、`edge`、`windowBounds`、`phase`；`fullscreen.ts` 只产出检测部分（`active/displayId/processName`），`edge/windowBounds/phase` 由 `peek.ts` 填。

- 轮询 1 s；连续 2 次相同结论才切换（debounce/hysteresis），避免 alt-tab、托盘/开始菜单造成的抖动。
- 错误退避 2 s/4 s/8 s，连续 3 次失败 → `unsupported`；状态变化才发 IPC。
- 日志只记 `processName`/pid/display/原因，**不记录窗口标题**（隐私）；同一原因每分钟最多一条。
- UWP/商店游戏可能由 `ApplicationFrameHost.exe` 承载：helper 里用 `GetAncestor(GA_ROOT)` + `GetWindowThreadProcessId` 解析真实进程；解析不到时按前台窗口 bounds 判定但仍排除 shell。
- 锁屏/安全桌面：`powerMonitor` 的 `lock-screen`/`unlock-screen`（Windows 支持）暂停检测；检测不到前台窗口时视为非全屏。
- 设置窗口获得焦点时：暂停检测但保留当前模式 2–3 s，避免打开设置瞬间退出全屏模式；关闭设置后重新检测。

### 3.4 关键设计纠正：不能只靠“把窗口移出屏幕边缘”

TECH-PLAN §8.2 给出的四个公式假设“窗口部分移出屏幕后，露出的部分恰好是头”。这个假设只在**下边缘**成立：

- 角色在窗口中的自然布局是：头在上（约 `y=0.18W~0.33W`），身体在其下，腿在最下。
- **下边缘**：窗口向下移出屏幕，屏幕内只保留窗口上半部分 → 头+少量肩部可见，身体在屏幕外 → 成立。
- **上边缘**：窗口向上移出屏幕，屏幕内只保留窗口下半部分 → 腿/身体可见，头在屏幕外 → **不成立**。
- **左/右边缘**：窗口向侧面移出，屏幕内的竖条仍然包含头以及其下方的身体 → 会露出身体 → **不成立**。
- 即使调整 `y = display.top - headTop`，也只是把头顶贴在屏幕顶部，身体仍在屏幕内。

**推荐解法：head-only render mode（同一窗口，不新建窗口）**

1. 进入 `peeking`/`peek-hidden` 时，main 发 `pet:peek-state`（Lead 冻结的 `FullscreenState`）；behavior-dev 在 `pet.ts/animator.ts` 里：
   - 隐藏 `body/leftArm/rightArm/leftLeg/rightLeg`（以及火把/面包等挂件），只保留 `head`；
   - 把相机/模型调整到“头部中心 = 窗口中心”，头部在窗口坐标系中的半径固定/可报告；
   - 保持透明背景与像素风；不显示名字/文字。
2. 窗口仍是原来的正方形（例如 420 DIP），但**窗口主体透明**，只有头可见；main 把窗口移到边缘，使“头部中心”位于屏幕边缘外/内之间的目标位置，利用屏幕边界裁切头部的一部分。
3. 因为身体根本没渲染，四边公式统一，不需要窗口 resize、不需要第二个 BrowserWindow、不需要把身体真的放到屏幕外。
4. 探头时窗口大部分在屏幕外，透明区域不会挡游戏；可点击区域只有头部像素（现有 hit-test 仍按像素判断）。
5. 相比“新建 head-only 小窗口”：不增加一个 renderer/WebGL 上下文，不改 hit-test 架构，不重复加载皮肤；比“窗口裁切 + 身体可见”正确。
6. 代价：behavior 需要实现 head-only 姿态/相机 framing；平台需要把 mode/edge/progress 传过去，并在进入/退出时等待 renderer ack（避免第一帧还是全身）。

> 如果 behavior 不愿做 head-only framing，备选是“只允许下边缘探头”；但这违背 PRD “随机边缘”，不推荐。

### 3.5 探头几何与动画时序

令 `W` 为窗口边长（DIP），头部中心在窗口坐标中为 `(cx, cy) = (W/2, W/2)`（head-only framing 后固定）；头部半径 `r`（含耳朵/帽子）由 behavior 在 `pet:head-anchor` 上报，P0 可先取 `r = clamp(petSize * 0.18, 18, 90)`，再以真机微调。

定义 `reveal ∈ [0,1]`：0 = 头完全在屏幕外，1 = 头完全在屏幕内并留 `m=8 DIP` 边距。对每块显示器 `d`：

```
T = d.bounds.y
B = d.bounds.y + d.bounds.height
L = d.bounds.x
R = d.bounds.x + d.bounds.width

bottom（贴下边）:
  y_hidden = B - cy + r          // 头顶刚好在 B 以下
  y_shown  = B - cy - r - m      // 头完全在屏幕内
  y = lerp(y_hidden, y_shown, ease(reveal))
  x = 随机在 [L + cx + m, R - cx - m] 内（按头半径留边）

top（贴上边）:
  y_hidden = T - cy - r          // 头底刚好在 T 以上
  y_shown  = T - cy + r + m
  y = lerp(y_hidden, y_shown, ease(reveal))

left（贴左边）:
  x_hidden = L - cx - r
  x_shown  = L - cx + r + m
  x = lerp(x_hidden, x_shown, ease(reveal))
  y 随机在 [T + cy + m, B - cy - m]

right（贴右边）:
  x_hidden = R - cx + r
  x_shown  = R - cx - r - m
  x = lerp(x_hidden, x_shown, ease(reveal))
  y 随机同上
```

- 进：320 ms `cubic-bezier(0.22, 1, 0.36, 1)`；停 4–8 s；退：260 ms `cubic-bezier(0.4, 0, 1, 1)`。
- 边缘随机四边等概率；同一条边位置随机，左右/上下留至少 10% 内缩，避免总在角落。
- 每次只探一次，不会多个探头并行；间隔从上一次“完全缩回”开始计时，20–45 s（`peekFrequency=standard`）。
- `reveal` 由 main 用 16 ms 定时器（或 rAF 不依赖 renderer）推进；窗口 `setBounds(x,y,W,W,false)`，不要 `animate:true`（Windows 透明窗口动画不可靠）。
- 多显示器：目标 `displayId` 取全屏窗口所在屏；进入全屏时若宠物原在其他屏，先把窗口**完全隐藏/移到目标屏外**再开始，避免跨屏可见飞行；退出全屏后回到进入前的 `lastDisplayId/lastX`（若该屏已移除则回主屏）。
- DPI：全部用 DIP；`setBounds` 用整数 DIP，允许 1 DIP 取整误差；探头期间 resize guard 必须禁用（见 PLT-01/06）。
- `peek-hidden` 时窗口可以 `hide()`（省 GPU），探头前 `showInactive()`；因为 `backgroundThrottling:false` + 先等 1–2 帧，首帧不会卡。若实测 show 有闪烁，改为“窗口保持显示但完全移到屏幕外”，用 A/B 测试决定。

### 3.6 状态机与互斥

```ts
type PetRuntimeMode =
  | 'normal'        // 正常底部走动/待机
  | 'peek-hidden'   // 全屏中，头完全藏起，等待下一次探头
  | 'peeking'       // 探头动画/停留/缩回
  | 'interacting'   // 探头时被点击/拖拽/长按，交互优先
  | 'closing'       // 长按关闭粒子阶段
  | 'tray-hidden'   // 用户隐藏/关闭到托盘
  | 'photo'         // 拍照临时冻结/临时显示
```

| 事件 \ 当前模式 | normal | peek-hidden | peeking | interacting | closing | tray-hidden | photo |
|---|---|---|---|---|---|---|---|
| 全屏检测为真（连续 2 次） | 停止走路→peek-hidden；取消下一次 walk；隐藏窗口/移到屏外 | 保持 | 保持 | 结束后重新评估 | 忽略 | 忽略（已隐藏） | 结束后评估 |
| 全屏检测为假 | 保持 | 回 normal（底部、随机 2–5 s 后恢复走路） | 立即缩回→normal | 交互结束→normal | 忽略 | 忽略 | 结束后评估 |
| walk timer 到点 | 正常走路 | 禁止 | 禁止 | 禁止 | 禁止 | — | 暂停 |
| pointerdown | 单击/长按/拖拽 | 暂停探头计时；显示头（可交互）→interacting | 暂停；interacting | 处理 | 忽略 | — | 冻结 |
| dragStart | 拖拽 | 退出 peek→normal、显示全身；拖拽结束后落回任务栏 | 同左 | 同左 | 忽略 | — | 忽略 |
| 长按 3 s close | 关闭 | 允许；先退出 peek、显示全身/全屏粒子→closing | 同左 | 同左 | 幂等 | — | 禁止（等拍照结束） |
| 拍照（热键/托盘） | 正常拍 | 临时 `showAtBottom()`；拍完回 peek-hidden | 临时显示；拍完回 peek-hidden | 拍完回原状态 | 忽略 | 临时显示拍完回 tray-hidden | 幂等锁 |
| 托盘显示/隐藏 | — | 隐藏→tray-hidden；显示→normal 后重新检测 | 同左 | 同左 | finishClose→显示 | 显示→normal | 暂停 |
| 设置窗口打开 | 保持 | 暂停检测 2–3 s、保持 peek-hidden | 保持当前；不退出 | 保持 | 忽略 | — | 暂停 |
| 锁屏/解锁 | 暂停检测 | 暂停，保持隐藏 | 缩回并暂停 | 暂停 | — | — | — |
| 显示器拔插/DPI 变化 | reconcile | 重新选屏/重新计算 | 取消当前探头→重算 | 取消→重算 | 按关闭逻辑 | — | 延后 |
| 用户关闭全屏探头 | 停止检测；若正在 peek 立即恢复 normal | 立即回 normal 底部 | 立即回 normal | 交互结束回 normal | — | — | — |
| 退出应用 | 清理 timer/probe/helper | 同左 | 同左 | 同左 | 允许退出 | 同左 | 等待/超时 |

补充规则：

- **交互优先**：探头过程中用户按下鼠标，立即暂停自动缩回计时；单击摸头/长按火把照常；拖拽会把全身显示出来并退出全屏模式（因为用户主动交互）；松手后如果仍全屏，重新进入 peek-hidden（下一次探头 5–10 s 后）。
- **关闭优先**：关闭粒子必须能打断探头；`beginClose()` 从探头位置直接扩到目标显示器 `display.bounds`；关闭完成隐藏到托盘；托盘恢复后先回 normal 再检测。
- **走路互斥**：`peek-hidden/peeking/interacting` 禁止 `tick()` 启动走路；退出全屏后 `nextWalkAt = now + nextWalkDelayMs()`，不要立刻走。
- **设置/托盘菜单不应导致模式抖动**：hysteresis + 设置窗口焦点暂停；开始菜单/托盘菜单通常 1–2 s 关闭，2 次轮询可过滤。
- **用户开关**：`fullscreenPeek=false` 时检测器仍可运行用于状态显示，但不进入 peek；也可直接停止轮询省资源。

### 3.7 接口与文件拆分（与 behavior/interaction/Lead）

新增/修改（platform 写，Lead 集成）：

- `src/main/fullscreen.ts`：`FullscreenProbe` 接口 + `HelperProbe`/`PowerShellProbe`/`UnsupportedProbe` 选择、退避、状态、日志。
- `src/main/peek.ts`：`PeekController`（状态机、随机边缘/间隔/时长、placement 调用、窗口移动）。
- `src/shared/peek.ts`：纯函数（`edgeTarget`, `revealPosition`, `nextPeekDelay`, `pickEdge`, `pickAlongEdge`, `shouldEnter/Exit`），可单测，不依赖 Electron。
- `src/main/pet-window.ts`：暴露 `setPeekState()`, `moveForPeek()`, `getBounds()`, `isVisible()`, `restoreNormal()`；`WindowMode` + resize guard 修正；`backgroundThrottling:false`。
- `src/main/pet-window.ts` 的 walk timer 与 `beginClose()` 增加 mode 检查。
- `src/shared/contracts.ts`（**Lead 独占**）：冻结 `FullscreenState`（`active`、`displayId`、`edge`、`windowBounds`、`phase`）、`BehaviorMode`、`ActionId`、动作优先级和错误处理；platform 只消费类型，不抢写。
- `src/shared/peek.ts`（platform 纯函数）：`edgeTarget`, `revealPosition`, `nextPeekDelay`, `pickEdge`, `pickAlongEdge`, `shouldEnter/Exit`；可单测，不依赖 Electron。
- `src/preload/index.ts`（platform）：`onPeekState(cb)`、`onAction(cb)`、`reportHeadAnchor(anchor)`、`getFullscreenStatus()`；只做白名单桥接。
- `src/main/ipc.ts`（**Lead 写**）：`pet:peek-state`（main→renderer）、`pet:action`（main→renderer）、`pet:head-anchor`（renderer→main）、`settings` 保存后重新调度、`peek:status`；platform 提供类型/发送点，Lead 接线。
- `src/main/index.ts`（**Lead 写**）：创建 probe/peek controller；screen/powerMonitor 事件；托盘/设置回调；退出清理；**不要由 platform 直接改**。
- 新资产/新动作登记：Lead 在 `ipc.ts` 的 `ASSET_PATHS` 与 preload `AssetName` 同步登记；platform 的打包清单必须包含同一组资产（Commander Brief §4）。

behavior-dev 合同（不写 main）：

```ts
// Lead 在 src/shared/contracts.ts 冻结后，preload 暴露给 renderer
interface FullscreenState {
  active: boolean
  displayId: number
  edge: 'top' | 'right' | 'bottom' | 'left' | null
  windowBounds: { x: number; y: number; width: number; height: number } | null
  phase: 'hidden' | 'enter' | 'hold' | 'exit' | 'restore'
}

type BehaviorMode = 'normal' | 'peek' | 'interacting' | 'closing' | 'photo'
type ActionId = 'photo' | 'togglePet' | 'torch' | 'stretch' // + behavior 后续的 feed/toy/sitSleep/wake

onPeekState(cb: (state: FullscreenState) => void): () => void
onAction(cb: (action: ActionId) => void): () => void
reportHeadAnchor(anchor: { x: number; y: number; radius: number }): void
```

- behavior 在收到 `FullscreenState.active=true` 且 `phase='hidden'`：切 head-only pose（隐藏身体/四肢/道具），头中心对准窗口中心，调 `reportHeadAnchor`；走路动画停止；随机小吃/伸懒腰暂停。
- 收到 `phase='enter'/'hold'`：保持 head-only，按 `edge` 做轻微看向屏幕内/歪头；不要自己移动窗口。
- 收到 `active=false`/`restore`：恢复全身、恢复相机 zoom/controls、允许走路；平滑过渡 200–300 ms。
- 收到 `BehaviorMode='closing'`：恢复全身（或按关闭动画处理），交回 interaction。
- 点击/拖拽在 head-only 状态下仍需命中头；hit-test 由 behavior 更新。
- interaction 合同：`longPressMs` 从 settings 读；`ActionId` 白名单/优先级由 Lead 在 contracts 冻结、interaction 提供手势/动作入口；探头时 `pin` 不抢现有手势状态。


### 3.8 检测/探头验收

- 纯逻辑测试（QA 写）：
  - 四边 `reveal=0/1` 时头矩形完全在屏外/屏内；
  - 随机 edge 分布、沿边位置不越界；
  - `nextPeekDelay` 20–45 s、`hold` 4–8 s；
  - 全屏判定 fixtures（普通窗口/最大化/全屏/任务栏自动隐藏/本应用/桌面/cloaked）；
  - 状态机：walk 禁止、拖拽退出、关闭打断、照片恢复、显示器移除。
- 真机验收（Lead/QA，必须由用户确认）：
  1. 用浏览器 F11 或视频全屏：进入后 5–15 s 内首次探头；上/下/左/右各至少观察到一次；只有头，身体不出现；
  2. 间隔 20–45 s、停留 4–8 s（录屏计时）；
  3. 全屏中单击/长按/拖拽/关闭都可用；拖拽后全身出现、落回任务栏；
  4. 关闭到托盘后，托盘单击恢复；恢复后仍能重新进入全屏模式；
  5. 退出全屏 1–2 s 内回到底部走路；
  6. 设置关闭全屏探头后不再探、不挡画面；
  7. 125% DPI 下边缘位置正确，无 1px 抖动；
  8. 多显示器（用户配合）时探头出现在全屏窗口所在屏，退出后回原屏；
  9. 检测失败（临时把 helper 改名）：宠物回到底部正常行为，日志一条原因，设置页显示“检测不可用”；
  10. 日志中不出现窗口标题。

---

## 4. 完整设置 + 首启向导设计

### 4.1 信息架构（设置窗口）

- 窗口约 **760×620 DIP**（min 680×520），可缩放，居中于宠物所在显示器；默认浅色，跟随系统 `prefers-color-scheme`；原生 TS + CSS，无框架。
- 左侧导航（或顶部 tabs）：**通用 / 声音 / 交互 / 环境与全屏 / 快捷键 / 拍照 / 启动与关于**。
- 首次向导复用同一个 renderer：`settings.html?wizard=1`（或 `firstRun=true` 时由 main 打开该 query），不新增 rollup entry，避免改 electron.vite.config。
- 所有设置只影响桌宠/托盘；桌宠画布上仍然**零文字**。

### 4.2 字段、默认值、校验、保存时机

> 默认值已按用户最新决策调整：**全新安装开机自启默认 ON**（已有配置迁移保留原值，可关）、低打扰、自动火把 ON、音量 40%、全屏探头 ON。表内 `save` 是设置窗口的保存时机；向导统一在 Finish/Skip 时一次保存。

#### 通用

| 字段 ID | 控件 | 默认 | 范围/枚举 | 校验/行为 | save |
|---|---|---|---|---|---|
| `size` | slider + `output` | `220` | 80–500，step 10，int | clamp；保存时以底边中心重排；显示“有效尺寸”提示（受 workArea 限制） | 拖动 120 ms 预览，`change`/松手后 400 ms debounce 落盘 |
| `nickname` | text | `Niko` | 1–24 字符 | trim；去掉控制字符；空则回退 `Niko`；只用于托盘 tooltip/照片文件名，桌面不显示 | 失焦/回车保存 |
| `activityLevel` | select | `low` | `low/normal/high` | 由 behavior 消费：低频动作间隔；low 默认 | 立即保存 |
| `resetPosition` | button | — | — | 清除 `lastX/lastDisplayId`，宠物回主屏底部中央 | 立即执行 |

#### 声音

| 字段 ID | 控件 | 默认 | 范围 | 校验/行为 | save |
|---|---|---|---|---|---|
| `volume` | slider | `0.4`（显示 40%） | 0–100 int | 0 时等同静音但仍保留 muted 状态 | 预览 + 400 ms debounce |
| `muted` | switch | `false` | bool | 主 Gain 0；设置即时生效 | 立即 |
| `clickSounds` | switch | `true` | bool | Ya1/Ya2 开关 | 立即 |
| `actionSounds` | switch | `true` | bool | 动作/环境音（脚步、火把、吃、关闭）总开关；对应 Brief Q7 的“主音量、总静音、点击音、动作/环境音”颗粒度；具体音效分类由 interaction/audio 实现 | 立即 |
| `testSound` | button | — | — | 播放点击音/测试音 | 不持久化 |

#### 交互

| 字段 ID | 控件 | 默认 | 范围 | 校验/行为 | save |
|---|---|---|---|---|---|
| `longPressMs` | slider | `1500` | 1000–2000，step 100 | 传给 interaction；关闭阶段固定再 +1500 ms（PRD 两段式）；UI 显示“按住 1.5 s 切火把，再 1.5 s 关闭” | 400 ms debounce |
| `randomActions` | switch | `true` | bool | 关闭随机面包/伸懒腰/跳舞/追鼠标等主动行为，保留用户触发；对应 Brief Q8 的“可分别关随机动作”；由 behavior 消费 | 立即 |
| `particles` | switch | `true` | bool | 由 interaction/behavior 决定是否生成紫粒子/爱心/碎屑；若本轮不接线就**不放进 UI**（避免假开关） | 立即 |

#### 环境与全屏

| 字段 ID | 控件 | 默认 | 范围 | 校验/行为 | save |
|---|---|---|---|---|---|
| `autoTorch` | switch | `true` | bool | 关闭时 renderer 不再自动举火把，手动长按仍可用 | 立即 |
| `darkThreshold` | slider | `30` | 10–60 int | `brightness <= threshold` 为暗；`autoTorch=false` 时置灰 | 400 ms debounce |
| `brightnessStatus` | readonly | — | — | 显示 `当前亮度 16%` / `当前设备不支持亮度读取` / `检测中`；含“重新检测”按钮 | 不持久化 |
| `fullscreenPeek` | switch | `true` | bool | 关闭时停止探头/恢复 normal；检测器可保留用于状态显示 | 立即 |
| `peekFrequency` | select | `standard` | `low/standard/high` | low=45–90 s；standard=20–45 s；high=10–25 s；停留均 4–8 s | 立即 |
| `detectorStatus` | readonly | — | — | `检测方式：C# helper / PowerShell 兜底 / 不可用`、`当前全屏：是/否`；含“检测一次”按钮 | 不持久化 |

#### 快捷键

见 §4.5。字段内部结构：`hotkeys: Record<ActionId, string | null>`（`ActionId` 由 Lead 在 `contracts.ts` 冻结）。

| 字段 ID | 默认 | 说明 |
|---|---|---|
| `hotkeys.photo` | `Control+Alt+P` | 拍照；允许清空（关闭热键） |
| `hotkeys.togglePet` | `null` | 显示/隐藏宠物；默认留空（Commander Brief Q15 推荐“保留拍照，其余留空”） |
| `hotkeys.torch` | `null` | 手动切换火把 |
| `hotkeys.stretch` | `null` | 伸懒腰 |

#### 拍照

| 字段 ID | 控件 | 默认 | 校验/行为 | save |
|---|---|---|---|---|
| `photoDir` | path + 选择/打开/恢复默认 | `''` → `图片\NikoPet` | 必须绝对路径或空；可创建；写测试；路径长度 ≤ 240；不存在时提示创建 | 选择后立即保存 |
| `takePhoto` | button | — | 抓拍一张并显示保存路径/失败原因（设置窗内文字，桌宠无文字） | 不持久化 |

#### 启动与关于

| 字段 ID | 控件 | 默认 | 说明 | save |
|---|---|---|---|---|
| `autostart` | switch | **`true`** | 写入当前用户 Run 项（无管理员）；portable 用 `PORTABLE_EXECUTABLE_FILE`；dev 显示“开发模式不自启” | 切换后立即 apply；失败回显真实状态 |
| `startHidden` | switch | `false` | 自启时是否静默到托盘（Q4）；仅 autostart 开时可用 | 立即 |
| `version` | readonly | — | app version + Electron 44.7.0 | — |
| `openLogs` | button | — | `shell.openPath(userData/logs)` | — |
| `resetSettings` | button | — | 二次确认；恢复默认（`firstRun` 保持 false） | 立即 |
| `runWizard` | button | — | 打开向导（不重置设置，只走一遍） | — |
| `assetNotice` | readonly | — | MC 素材/鲸鱼音效仅本地自用、不再分发 | — |

内部字段（不暴露 UI，但 schema 保留）：`lastDisplayId`、`lastX`、`settingsRev`、`firstRun`。

### 4.3 首启向导

- 触发：
  - **全新安装**（没有 settings.json）→ 自动打开向导；默认值含 `autostart=true`。
  - **已有 settings.json**（含当前 live 配置里遗留的 `firstRun=true`）→ **不自动弹向导**，迁移时置 `firstRun=false`；用户可在设置里点“运行向导”补填。这符合 Commander Brief Q5 推荐 A（老配置不强弹）。
  - settings 损坏/无法解析 → 备份后按全新安装处理，可弹向导。
- 形式：同一个设置窗口，`settings.html?wizard=1`；720×560，步骤条，底部“上一步/下一步/跳过，使用默认值/完成”。
- 步骤：
  1. **欢迎 + 昵称 + 大小**：昵称默认 Niko；size 滑块，显示 skin 头部静态预览（不启动 3D 预览，避免额外 WebGL 窗口）。
  2. **声音**：volume 40%、muted、clickSounds、actionSounds；可试听。
  3. **交互与启动**：longPressMs 1.5 s；autostart **ON**（仅全新安装默认；已有配置保持原值）；startHidden（默认 OFF）；说明“之后可在设置里关闭”。
  4. **环境与全屏**：autoTorch ON、darkThreshold 30、当前亮度状态、fullscreenPeek ON、频率 standard；说明全屏探头行为。
  5. **快捷键 + 完成**：photo 默认 `Control+Alt+P`；togglePet/torch/stretch 默认留空（Brief Q15）；完成时一次性保存并 `firstRun=false`，然后打开宠物。
- **跳过**：全新安装写入默认值（含 autostart ON）、`firstRun=false`；手动打开的向导“跳过”只关闭，不改已有设置。
- **关闭窗口（X）**：全新安装不写盘，宠物使用内存默认值运行，`firstRun` 仍为 true，下次启动再次弹出；手动向导关闭不改任何设置。
- 向导期间宠物可以已显示；不做模态锁；设置窗口获得焦点时暂停全屏检测（见 §3.6）。
- 验收：删除 userData → 启动 → 向导出现；走完 → 宠物/托盘正常；重启 → 不弹向导；设置值保持；autostart 实际生效（打包版）；已有配置启动不弹向导，设置里可重开。

### 4.4 保存时机与持久化

- **向导**：全部改动先走 `settings:preview`（内存），Finish/Skip 时一次 `settings:save` 落盘；关闭 X 不落盘。
- **设置窗口**：
  - 开关/下拉/快捷键：操作后立即保存（快捷键在注册成功后才保存）。
  - 滑块（size/volume/longPressMs/darkThreshold）：拖动时 120 ms 节流 preview，松手/`change` 后 400 ms debounce 落盘；`size` 预览会临时改窗口大小，但不写盘。
  - 路径：选择后立即保存（先创建/写测试失败则回滚并显示错误）。
  - 状态提示：`正在保存… / 已保存 HH:mm:ss / 保存失败：<中文原因>`；不使用全局“保存”按钮（Q6 可改）。
- **flush**：SettingsStore 增加 `flush(): Promise<void>`；`before-quit` 里 `event.preventDefault()` 一次、等待 flush 后 `app.quit()`；设置窗口关闭时先 flush；写盘仍用临时文件 + rename 原子写。
- **冲突**：设置窗口保存时只提交 dirty 字段（或带 `settingsRev`），避免把宠物侧/其他模块刚改的字段覆盖；保存后 main 广播 `pet:settings:changed`，UI 仅在非编辑状态应用。
- **迁移**：`version:2`；`parseSettings` 接受 v1 并按字段迁移；v1→v2 时新增字段用默认，**已有 settings.json 的 `autostart` 保留原值**（Commander Brief：迁移保留既有选择；当前 live 的 false 不会因升级被强制改为 ON）；全新安装（无文件）才使用 `autostart=true`；已有文件迁移时 `firstRun=false`，不自动弹向导。未知更高版本 → 备份 + 只读默认，不直接覆盖。
- **坏文件**：保留现有备份策略；备份名用 `.corrupt-*`；日志写清楚；首次启动若 settings 损坏 → 向导（firstRun 视为 true）。

### 4.5 自定义快捷键编辑器

- 动作白名单：由 Lead 在 `ActionId` 中冻结；设置页只展示**已经实现且已注册**的动作，避免给用户假快捷键。P0 先接已有四个：`photo`、`togglePet`、`torch`、`stretch`；behavior/interaction 交付喂食/玩具/坐睡/起床后再加入 `feed`、`toy`、`sitSleep`、`wake`，与 Commander Brief Q14 推荐集合一致。
- 默认：photo `Control+Alt+P`；togglePet/torch/stretch 默认空（Commander Brief Q15 推荐“保留拍照，其余留空”）；后续动作也默认空，避免抢占系统/游戏快捷键。
- 交互：
  - 每行“动作 / 当前快捷键 / 修改 / 清除”；点“修改”后进入捕获态，显示“请按下快捷键…（Esc 取消）”。
  - 捕获 `keydown`：`preventDefault`；至少 1 个非修饰键；修饰键组合最多 3 个；显示 `Ctrl+Alt+P` 风格；`Backspace/Delete` 清空。
  - 规则：至少含 `Ctrl`/`Alt`/`Win` 之一（仅 Shift 拒绝；F13–F24 可例外）；拒绝 `Alt+F4`、`Win+L`、`Ctrl+Alt+Del`、`Ctrl+Shift+Esc` 等系统保留组合；同一应用内不得重复。
  - 保存流程：main 先 unregister 该动作旧 accelerator → `globalShortcut.register` 新值 → 失败则重新注册旧值并返回 `{ok:false, reason:'occupied'|'invalid'}`；成功后持久化并广播。多个动作批量修改时，先全部 unregister，再逐个 register，任一失败全部回滚。
  - 失败文案中文：“该快捷键已被系统或其他程序占用，请换一个”。
  - 设置页显示当前是否注册成功；程序退出 `globalShortcut.unregisterAll()`（已有）。
- 动作执行：平台只负责注册/捕获，收到快捷键后发 `pet:action`（photo 由 main 自己执行，togglePet 由 main 显示/隐藏，torch/stretch 转给 renderer，由 interaction/behavior 执行）。renderer 动作白名单、互斥、音效由 interaction 定。

### 4.6 开机自启（全新安装默认 ON，可关）

- `src/main/autostart.ts`：
  ```ts
  interface AutostartStatus {
    supported: boolean
    enabled: boolean          // 用户设置
    actual: boolean           // getLoginItemSettings().openAtLogin
    path: string | null
    error?: string
  }
  ```
- 路径解析：
  - electron-builder **portable**：`process.env.PORTABLE_EXECUTABLE_FILE`（真实便携 exe）；若为空才用 `process.execPath`。
  - NSIS 安装版：`process.execPath`。
  - dev（`!app.isPackaged`）：不写注册表；设置页显示“开发模式不自启”；可用 `NIKO_FORCE_AUTOSTART=1` 做本机实验（需显式）。
- 参数：自启时加 `--startup-hidden`（若 startHidden=true）；app 解析 argv，启动后 `pet.hide()`；若用户选择显示则不加。
- 注册：`app.setLoginItemSettings({ name: 'Niko Pet 3D', openAtLogin: enabled, path, args })`；用稳定的 `name`（改名会残留重复项）；写 HKCU，无管理员。
- 状态回读：`app.getLoginItemSettings({ path })` → `openAtLogin` / `executableWillLaunchAtLogin`；设置页显示“已开启/未开启/写入失败”；如果用户在任务管理器禁用，显示“系统启动项已被禁用”（可读 `StartupApproved`，P2）。
- 时机：首次向导 Finish/Skip、设置切换、app ready 后（`autostart===true` 时幂等 apply，修正便携版换路径/升级路径）。避免每次启动重新开启用户手动关掉的项：以设置值为准；任务管理器禁用属于用户操作，下次启动会重新 apply（在设置页说明）。若不想覆盖，改为只在设置变化时 apply（可调，默认按前者）。
- NSIS 卸载：`build/installer.nsh` 的 `customUnInstall` 删除 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `Niko Pet 3D` 值；portable 不写卸载逻辑（用户删除 exe + 设置里关自启）。
- 验收：打包版开启 → 注销/重启 → 宠物出现（或静默到托盘）；关闭 → Run 项消失；portable 重启后路径仍指向便携 exe；dev 不写。

### 4.7 多显示器 / DPI 设计

- 所有窗口坐标/尺寸用 DIP；显示器信息来自 `screen.getAllDisplays()`/`getDisplayMatching()`。
- 单一来源 `display-snapshot.ts`（或 shared 纯函数）：
  - `pickDisplayForRect(rect)`：取交叠面积最大者；
  - `clampToDisplay(x, size, display)`：不越界；
  - `bottomY(display, size)`；
  - `restorePosition(lastDisplayId, lastX)`：找不到屏则主屏中央；
  - `scaleFactorFor(display)`。
- 窗口移动/拖拽结束/DPI 变化时保存 `lastDisplayId/lastX`（500 ms 防抖）；启动时恢复。
- `display-added/removed/metrics-changed`：重新 clamp；若宠物在当前屏 → 回主屏；若在探头 → 取消探头并重算；若正在拖拽 → 取消拖拽并落到最近屏。
- DPI：
  - 窗口尺寸按 DIP 保持逻辑大小（Windows UI 一致）；125%/150% 下物理像素变大，属预期；
  - renderer `pixelRatio = min(devicePixelRatio, 2)` 需要在跨屏后更新（`pet:display` 事件）；
  - 皮肤纹理 `NearestFilter`，避免 CSS 缩放；
  - 照片按物理像素（`display.size * scaleFactor`）。
- 全屏检测：按全屏窗口所在显示器选择目标屏；退出回到进入前的显示器/位置。
- 当前机器单屏 → 多屏只能做纯函数测试；需用户配合真机验收（Q8）。

### 4.8 设置 UI 实现注意

- 复用 `settings.html/css/ts`，无 React/Vue；可拆 `settings/` 子模块但不要新增 rollup entry；用 URL query 切换 wizard。
- 键盘可达：label/for、focus ring、Esc 关闭；错误用 `aria-live`。
- 不在设置页显示窗口标题以外的个人信息；日志路径/版本只读。
- 设置窗口不能遮挡宠物拍照（PhotoController 会临时隐藏）。
- 不修改 `public/assets/skin/niko.png`、`public/assets/whale/*.mp3`；图标由它们派生。

---

## 5. electron-builder 打包方案

### 5.1 当前缺口

- `package.json` 无 `dist` scripts、无 electron-builder devDependency、无 `productName/description/author`、`version=0.0.0`。
- 无 `build/icon.ico` / `build/tray.ico`；托盘还在用皮肤裁剪 + 空图 fallback。
- 无 `electron-builder.yml`；TECH-PLAN §15 的 files 列表和当前 electron-vite 输出不匹配。
- `pnpm-workspace.yaml` 被占位符污染（PLT-26）。
- Electron 44.7.0 已安装在 `node_modules/electron/dist`；打包必须用它，不能让 electron-builder 下载其他版本。
- 没有 source zip 脚本/验收。

### 5.2 建议配置

> 先不安装；等 Lead/用户批准后作为 devDependency 安装 `electron-builder@^26.15.3`（当前 npm latest 26.15.3；Node 24 可运行）。本轮只给方案。

新建 `electron-builder.yml`（建议；所有路径相对项目根）：

```yaml
appId: com.nikopet.desktop
productName: Niko Pet 3D
copyright: "Local personal use only"

directories:
  output: release
  buildResources: build

files:
  - out/**/*
  - package.json
  - "!**/*.map"

extraResources:
  - from: build/tray.ico
    to: tray.ico
  - from: build/icon.ico
    to: icon.ico
  # 如果采用 C# helper：
  - from: native/fullscreen-watcher/bin/FullscreenWatcher.exe
    to: native/FullscreenWatcher.exe

asar: true
asarUnpack:
  - "**/*.node"          # 仅未来使用原生模块时需要

# 关键：使用本机已安装的 Electron 44.7.0，避免下载 44.9.1/其他版本
electronDist: node_modules/electron/dist
npmRebuild: false

win:
  icon: build/icon.ico
  requestedExecutionLevel: asInvoker
  target:
    - target: portable
      arch: [x64]
    - target: nsis
      arch: [x64]

portable:
  artifactName: NikoPet3D-${version}-portable-${arch}.${ext}

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: always
  createStartMenuShortcut: true
  shortcutName: Niko Pet 3D
  uninstallDisplayName: Niko Pet 3D
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  deleteAppDataOnUninstall: false
  include: build/installer.nsh
  artifactName: NikoPet3D-${version}-setup-${arch}.${ext}

compression: maximum
```

说明：

- **Electron 版本**：`electronDist` 指向未打包的 44.7.0 目录，electron-builder 直接使用；若该选项在 26.15.x 行为不符合预期，退回 `electronVersion: 44.7.0` + `electronDownload` 缓存，但**绝不能**让它拿到 44.9.1（本机会挂起）。
- **files**：electron-vite 输出 `out/main`、`out/preload`、`out/renderer`；`public/assets` 已被复制到 `out/renderer/assets`，不要再重复打 `public/**`。`package.json` 保留（main 入口/元数据）。
- **依赖**：当前 renderer 的 `three/skinview3d` 都被 Vite 打进 bundle，运行时不需要 node_modules；main 只用 electron + node 内置。因此 `files` 可以很精简。若使用 get-windows，需要 `node_modules/get-windows/**` + asarUnpack + allowBuilds，复杂度上升——这是选 C# helper 的又一理由。
- **extraResources**：托盘/应用图标放 asar 外，`process.resourcesPath` 直接可读，避免 asar/nativeImage 兼容问题；helper 同理。
- **NSIS**：per-user（无管理员）、可选安装目录、桌面/开始菜单快捷方式；`deleteAppDataOnUninstall:false` 保留设置/照片；`installer.nsh` 清理 Run 项。
- **签名**：本地自用，不做代码签名；SmartScreen 会提示“未知发布者”，验收时记录并让用户确认（Q7）。不做自动更新。

### 5.3 图标、资产、托盘

- `build/icon.ico`：从 `public/assets/skin/niko.png` 的头部正面 `(8,8,8,8)` 取 8×8 像素，最近邻放大，透明背景；生成 16/24/32/48/64/128/256 多尺寸 ICO。可用 Python/Pillow（DSH bundled Python 已有 Pillow；系统 Python 目前无 Pillow，建议用 bundled）或提交一次性生成的 ICO 文件。
- `build/tray.ico`：16/32/48，使用同一头部；比运行时 `crop(8,8,8,8).resize(32)` 更可控，且不依赖 asar 内 skin 路径。
- 不要修改 `niko.png`；图标只是派生资产。
- 运行时资产：
  - 开发：`pet:asset` 从 `public/`（`ELECTRON_RENDERER_URL` 时）读；打包：`out/renderer/assets/...`（当前逻辑 `join(__dirname,'../renderer')` 正确）；
  - 托盘：打包从 `process.resourcesPath/tray.ico`；开发从 `build/tray.ico`；
  - helper：打包 `process.resourcesPath/native/FullscreenWatcher.exe`；开发 `native/fullscreen-watcher/bin/...`；
  - 新增资产继续走 `ASSET_PATHS` 白名单 + preload `AssetName` union，不开放任意路径 IPC。
- 打包前脚本检查：icon/tray 存在、helper 存在（若启用）、皮肤/音频存在；失败则 `dist` 报错并停止。

### 5.4 package.json 建议

```json
{
  "name": "niko-pet-3d",
  "productName": "Niko Pet 3D",
  "version": "0.1.0",
  "description": "Local Windows desktop pet: Niko, a 3D Minecraft skin character.",
  "author": "<user>",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build && tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "dist": "electron-vite build && tsc --noEmit -p tsconfig.json && electron-builder --win --config electron-builder.yml",
    "dist:portable": "electron-vite build && electron-builder --win portable --config electron-builder.yml",
    "dist:nsis": "electron-vite build && electron-builder --win nsis --config electron-builder.yml",
    "source:zip": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-source-zip.ps1"
  },
  "devDependencies": {
    "electron": "44.7.0",
    "electron-builder": "^26.15.3"
  }
}
```

- **不要用 `pnpm` 脚本套 `pnpm`**：本机 `pnpm build` 偶发触发 deps status/install 卡住；`dist` 用 `electron-vite`/`electron-builder` 二进制或 `cmd /c node_modules\.bin\...`，与 handoff 的构建方式一致。
- `version` 建议 `0.1.0`（TECH-PLAN 也以 0.1.0 命名产物）；保持 `private:true`。
- 若加 `productName` 导致 `app.name`/userData 变化：main 在 `requestSingleInstanceLock()` 前 `app.setName('niko-pet-3d')`，显式固定 `%APPDATA%\niko-pet-3d`；或 `app.setPath('userData', join(app.getPath('appData'),'niko-pet-3d'))`。这样 dev/portable/NSIS 共用同一设置目录，升级不丢。
- `pnpm-workspace.yaml` 修复建议（取决于是否引入 get-windows）：
  - 不引入：删除 `allowBuilds` 整块（保留合法内容）。
  - 引入：`allowBuilds: { get-windows: true }`（布尔），并确认 pnpm 11 schema/版本；source zip 里必须包含最终版本。
  - 干净安装需要允许 electron/esbuild 的 install scripts（`electron` 下载二进制、`esbuild` 装平台包）；是否要在 `allowBuilds` 里显式列出，以实际 `pnpm install` 结果为准，加进 source zip 验收。

### 5.5 source zip

新增 `scripts/make-source-zip.ps1`（platform 写，不与 QA 的 `tools/**` 冲突）：

- 包名：`release/NikoPet3D-<version>-source.zip`。
- 包含：`src/**`、`public/**`（用户私有资产，仅本地交付）、`native/**`（C# 源码 + build.ps1，不含 bin）、`build/icon.ico`/`tray.ico`、`scripts/**`、`tests/**`、`tools/**`、`docs/**`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`electron.vite.config.ts`、`tsconfig.json`、`AGENTS.md`、`README.md`、`M0-REPORT.md`、`M1-REPORT.md`。
- 排除：`node_modules/`、`out/`、`release/`、`artifacts/`、`.scratch*`、`.git/`、`.electron-cache/`、`.pnpm-store/`、`*.log`。
- 生成前校验：`pnpm-lock.yaml` 存在、`pnpm-workspace.yaml` 合法（无占位符）、Electron 版本锁定、`public/assets` 关键文件存在；`--DryRun` 可选。
- 复现验收（干净目录）：
  1. 解压到含空格/中文的路径；
  2. `pnpm install --frozen-lockfile --store-dir .pnpm-store/v11`（离线/缓存环境确认 Electron 44.7.0 二进制可用）；
  3. `node_modules\.bin\electron-vite.cmd build` + `tsc --noEmit` + `vitest run`；
  4. 打包命令可用；不要求用户重装环境。
- 不在 source zip 中包含 `node_modules`/`out`/`release`；不包含 `%APPDATA%` 用户数据。

### 5.6 干净配置验收矩阵

| # | 场景 | 预期 |
|---|---|---|
| 1 | 删除 `%APPDATA%\niko-pet-3d`（或固定后的 userData）、Run 项、快捷方式；运行 portable | 首启向导出现；完成后宠物/托盘正常；无控制台窗口 |
| 2 | 走完向导；重启应用 | 不弹向导；size/volume/nickname/autostart 等保持 |
| 2b | 已有 v1 settings.json（含 `firstRun=true` 旧值）升级到 v2 | **不自动弹向导**；原有设置（含 autostart）保留；设置页可手动“运行向导” |
| 3 | 设置里关闭自启 → 检查 `HKCU\...\Run`；开启 → 注销/重启 | 项消失/出现；重启后宠物按 startHidden 设置显示或托盘 |
| 4 | 重复启动 portable / 已安装版 | 单实例；第二个进程退出；已有宠物被找回（单击托盘/第二实例） |
| 5 | 从 `C:\Program Files\...`、含空格/中文路径运行 portable | 皮肤/声音/图标/照片全部正常；无 asar 路径错误 |
| 6 | NSIS 安装到非默认目录 → 卸载 | 卸载不删设置/照片；Run 项清理；快捷方式清理 |
| 7 | 100% / 125% / 150% DPI | 宠物清晰、不越界、探头位置正确、无 resize 循环日志 |
| 8 | 多显示器（用户配合）：拖拽跨屏、拔插、全屏在副屏 | 落回正确屏；不进入空洞；探头跟全屏屏；退出回原屏 |
| 9 | 全屏视频/游戏（上/下/左/右） | 只有头；4–8 s；20–45 s；不挡画面；关闭/拖拽/拍照可用 |
| 10 | 托盘单击（隐藏时） | 宠物恢复；设置/退出菜单正常；tooltip 用 nickname |
| 11 | Ctrl+Alt+P（默认）/自定义快捷键 | 拍照成功；冲突提示；改键后旧键失效；退出后不残留 |
| 12 | 关闭自启/全屏探头后重启 | 行为保持；不会自动重新注册/探头 |
| 13 | source zip 解压到干净目录 → 安装/构建/测试 | 通过；不依赖本机 node_modules |
| 14 | Windows Defender/SmartScreen 首次运行 | 记录提示；不误报为失败；用户确认“仍要运行” |

### 5.7 打包风险

- 未签名 → SmartScreen/杀软提示；本地自用可接受（Q7）。
- electron-builder 首次运行可能需要网络下载 NSIS/winCodeSign 等工具；可设置 `ELECTRON_BUILDER_CACHE` 或离线缓存；本轮不安装，实际执行时先验证网络/缓存。
- `electronDist` 与 `electron-builder` 版本的组合需要一次实测；如果失败，不要退回“让 builder 下载 Electron”，而是用 `electronVersion: 44.7.0` + 本地缓存。
- portable 的 `PORTABLE_EXECUTABLE_FILE` 依赖 electron-builder 包装器；必须实测自启路径。
- NSIS 自定义 `installer.nsh` 语法要在真机测试；卸载 Run 项清理失败不影响卸载主体。

---

## 6. 文件级所有权、接口与依赖

### 6.1 文件所有权（建议）

| 文件/目录 | 建议 owner | 本流动作 | 依赖/冲突 |
|---|---|---|---|
| `src/main/index.ts` | **Lead** | 提供接线 spec；不直接改（handoff 约定） | 所有模块完成后串行；与 interaction/behavior 汇总冲突 |
| `src/main/ipc.ts` | **Lead**（handoff） | 新增 channel 规格；**`ASSET_PATHS` 白名单也由 Lead 接线**；建议 **临时转交 platform** 或 Lead 按 spec 实现 | 串行；若两人同时改易冲突；需 Lead 拍板 |
| `src/shared/contracts.ts`（新） | **Lead** | 冻结 `FullscreenState`/`BehaviorMode`/`ActionId`/动作优先级；platform 只消费 | 必须先于 platform/behavior 编码；禁止 platform 抢写 |
| `src/main/pet-window.ts` | **platform** | WindowMode、resize guard、focus、peek 移动、restore、display | 与 behavior 的 head-only 姿态通过 IPC，不直接改 renderer |
| `src/main/tray.ts` | **platform** | 单击、图标、菜单刷新、tooltip | P0 独立，最先做 |
| `src/main/fullscreen.ts`（新） | **platform** | 检测器/helper/PowerShell 兜底 | 依赖 helper 构建；与 index 接线 |
| `src/main/peek.ts`（新） | **platform** | 探头状态机/placement | 依赖 pet-window + shared/peek + behavior pose |
| `src/shared/peek.ts`（新） | **platform** | 纯几何/调度函数 | QA 写测试；无 Electron 依赖 |
| `src/main/autostart.ts`（新） | **platform** | 自启 apply/status/路径 | 依赖打包/portable 环境；P0 |
| `src/main/hotkeys.ts`（新） | **platform** | 注册/校验/回滚 | 依赖 interaction 动作白名单 |
| `src/main/settings.ts`、`src/shared/settings.ts` | **platform** | v2 schema、迁移、flush | interaction/behavior 消费字段；需接口冻结 |
| `src/main/settings-window.ts`、`src/renderer/settings.*` | **platform** | 完整设置 + wizard | 依赖 preload/ipc；可先做 UI |
| `src/main/photo.ts` | **platform** | PhotoController、photoDir、多屏、隐藏/探头 | 依赖 settings、pet mode、settings-window |
| `src/main/brightness.ts` | **platform** | 条件轮询、状态、full path | 依赖 settings.autoTorch、pet visibility |
| `src/preload/index.ts` | **platform** | 新 API 类型/桥接 | 与 ipc.ts 成对；Lead review |
| `electron-builder.yml`、`build/icon.ico`、`build/tray.ico`、`build/installer.nsh`、`scripts/**` | **platform** | 打包/图标/源码 zip | 依赖 feature freeze；`build/` 新目录 |
| `native/fullscreen-watcher/**`（新） | **platform** | C# helper 源码/build.ps1 | 不放进 QA 的 `tools/**`；打包 extraResources |
| `package.json` | **platform**（handoff） | scripts/元数据/electron-builder devDep | **新增依赖必须先经 Lead/用户批准** |
| `src/renderer/gestures.ts`、`src/shared/gesture.ts` | **interaction** | 平台只发事件；longPressMs/action 由 interaction 接 | 需接口冻结；不要跨写 |
| `src/renderer/animator.ts`、`src/renderer/pet.ts`、`viewer.ts` | **behavior** | head-only peek pose、action 执行、pixelRatio 更新 | 探头核心视觉依赖；需接口冻结 |
| `tests/**` | **qa-visual** | platform 给测试向量/fixtures；不写 tests | QA 落地单测；不阻塞 P0 编码 |
| `docs/PRD.md`、`DECISIONS.md`、`TECH-PLAN.md` | **Codex/Lead** | platform 提交修订建议（自启默认/探测器方案） | 不自己改；避免文档与实现冲突 |

### 6.2 接口冻结（建议在写代码前 30 分钟内确认）

1. **Settings v2**：字段/默认值/类型/迁移（§4.2/4.4）；interaction 需要 `longPressMs/actionSounds`，behavior 需要 `activityLevel/randomActions/fullscreenPeek`，photo 需要 `photoDir`，hotkeys 需要 `Record<ActionId,string|null>`。
2. **FullscreenState / BehaviorMode / ActionId**：Lead 在 `src/shared/contracts.ts` 冻结 `active/displayId/edge/windowBounds/phase`；main→renderer 用 `pet:peek-state`，renderer→main 用 `pet:head-anchor`；ready ack/错误处理由 Lead 定（§3.7）。
3. **ActionId**：`pet:action` 白名单与执行方（interaction/renderer vs main）；photo/togglePet 归 main，torch/stretch/后续行为动作归 renderer；平台注册层只做捕获与转发。
4. **IPC 归属**：`ipc.ts` 由 Lead 写还是转交 platform；如果是 Lead，platform 先交 spec + 类型，Lead 在模块完成后接线。
5. **自启默认 ON**：PRD/DECISIONS 更新；全新安装默认 true；已有 settings.json 迁移保留原值（Brief 要求），不强制改 ON。
6. **探测器方案**：C# helper 主方案；PowerShell fallback；get-windows 只做 spike（Q1）。
7. **依赖批准**：electron-builder devDependency；不引入 get-windows（除非 spike 通过并批准）；C# helper 不新增 npm 依赖。
8. **打包版本号/命名**：`0.1.0`、`NikoPet3D-*`；productName/userData 固定策略。

### 6.3 串行 / 并行

**可并行（互不阻塞）**

- P0-a：托盘单击 + 托盘图标（tray.ts/build/tray.ico）——独立。
- P0-b：resize guard/focus/window mode（pet-window.ts）——独立于 UI。
- P0-c：settings v2 + store 迁移 + autostart 模块（shared/settings + main/settings/autostart）——可与 UI 并行，但按 Commander Brief 的时间线排在 G1（托盘单击 + 全屏探头）之后进入实现。
- P0-d：fullscreen helper 源码/build + PowerShell fallback + pure peek math（fullscreen.ts/shared/peek.ts/native）——检测/几何先行，不依赖 behavior；这是 G1 关键路径。
- P0-e：electron-builder.yml/icon/source zip scripts——可提前试打包验证资产路径，但**不提前宣称安装包通过**；最终打包放在功能 freeze 后。
- P0-f：preload 新 API 类型/桥接——和 ipc spec 并行，但需接口冻结。

**必须串行**

1. **Lead 冻结** `src/shared/contracts.ts`（`FullscreenState`/`BehaviorMode`/`ActionId`）与 settings 迁移策略 → 各模块实现。
2. **G1 首个可见里程碑**：`tray.ts` 单击 + `fullscreen.ts`/`peek.ts`/`pet-window.ts` + behavior head-only pose + Lead 接线 → 真机全屏四边 + 托盘单击验证；G1 未过不进入设置/自启大面积实现。
3. behavior 的 head-only pose 完成 → 才能开真机全屏验收（否则只能测窗口移动）。
4. G1 通过后：settings v2/向导/自启/快捷键/photo/brightness 并行；interaction 的 longPressMs/action API 完成 → 设置页快捷键真正生效。
5. 所有功能 freeze → electron-builder 最终打包（之前只做试打包，不宣称通过）。
6. 打包 → QA 干净 profile 验收 → 用户确认。
7. 文档（PRD/DECISIONS/TECH-PLAN）更新在实现前完成，避免验收口径冲突；每个 worker 交付附修改文件、关联验收 ID、自动检查退出码、实机需测步骤、回退办法（Brief §6）。

### 6.4 对 interaction / behavior / Lead 的依赖清单

| 对方 | 需要提供 | 平台提供 | 风险 |
|---|---|---|---|
| interaction | `longPressMs/actionSounds` 接入；`ActionId` 白名单/互斥；探头时手势不被自动缩回打断；关闭/拖拽退出 peek 的信号消费 | `pet:peek-state`/`pet:action`；设置字段；快捷键注册结果 | 探头中长按关闭与窗口移动竞态，需要一起测 |
| behavior | head-only pose、头中心/半径上报（`pet:head-anchor`）、恢复正常姿态、走路暂停、`devicePixelRatio` 更新、动作执行 | `pet:peek-state`（`FullscreenState`）、显示信息事件、设置字段 | 没有 head-only 就没有“只露头”；这是关键路径 |
| Lead | `contracts.ts`/`index.ts`/`ipc.ts` 接线；`ASSET_PATHS` 新资产登记；依赖/目录批准；PRD/DECISIONS 更新；合并与最终构建 | 模块、spec、测试向量、打包配置 | 两个 writer 改 ipc.ts 会冲突；需提前定归属 |
| QA | shared/peek/settings 单测、全屏/托盘/设置验收、截图/录屏、clean profile | 可测纯函数、状态日志、验收清单 | 多显示器无硬件；需用户配合（Q8） |

---

## 7. 需要用户拍板的问题（8 个，均给推荐项）

> Commander Brief 已有 16 个用户问题（见 `docs/COMMANDER-BRIEF.md` §Questions）；本节只列 **平台流必须拍板、或 Brief 未覆盖/需要补充** 的 8 个，并尽量复用 Brief 的推荐项。已定的 P0、四人分工、方块风、默认自启 ON、交付形式、逐里程碑确认不再重问。

### Q1. 全屏检测用哪条技术路线？（Brief Q1 已定触发边界，这里问实现路线）

- **A（推荐）C# helper 主方案 + PowerShell 兜底**：本机 `csc.exe` 已验证；无 npm 原生依赖；能区分最大化/全屏/自动隐藏任务栏；代价是多一个 ~30 KB 的本地 exe 和 `build.ps1`。
- B. `get-windows` npm 方案：少写 C#，但 ESM-only + 原生 `.node` + pnpm 安装脚本审批 + 打包 asarUnpack，风险更高；当前机器上的 `allowBuilds` 占位符就是之前尝试留下的。
- C. 只做 PowerShell：零构建，但启动慢/常驻内存/高频轮询开销，P0 体验差；建议只做兜底。
- D. 暂不做全屏检测，只做“全屏时手动隐藏/恢复”：最省事，但不满足 A10。

> 推荐 A；如果选 B，必须先做隔离 spike（不允许直接改生产依赖）。

### Q2. 托盘单击的语义？（对应 Brief Q4）

- **A（推荐）单击=显示/找回**：宠物隐藏时单击显示；已显示时单击无动作（或只把宠物提到最前），避免误隐藏；双击保留兼容。
- B. 单击=显示/隐藏切换：更像常见托盘，但用户可能误点把宠物藏起来。
- C. 单击=显示，双击=打开设置：单击找回、双击进设置；右键菜单仍保留“设置”。
- D. 单击=打开设置：不推荐，找回路径变长。

> 推荐 A（“找回”语义最稳）；若用户喜欢切换，选 B。

### Q3. 全屏探头的触发范围？（对应 Brief Q1）

- **A（推荐）所有全屏**：浏览器 F11、视频全屏、游戏全屏都探头；排除本应用/桌面/任务栏/锁屏。
- B. 仅游戏进程：需要维护游戏进程识别/白名单，误判/维护成本高。
- C. 所有全屏，但用户可配置黑名单（如视频播放器不探头）：设置更复杂，P1 再加。
- D. 只在主显示器全屏时探头：多屏用户可能觉得副屏游戏没反应。

> 推荐 A，先简单可靠；以后按用户反馈加黑名单。

### Q4. 开机自启默认 ON 后，启动时宠物怎么出现？（对应 Brief Q6）

- **A（推荐）正常显示在任务栏上方**：用户开机就能看到 Niko；符合“桌宠”预期。
- B. 静默到托盘：开机不打扰，用户需要时单击托盘找回；更“低打扰”。
- C. 记住上次隐藏/显示状态：上次隐藏则静默，否则显示；实现更复杂，但最贴合习惯。
- D. 显示但延迟 30–60 s 出现：折中，开机阶段不抢资源。

> 推荐 A；若用户更在意开机安静，选 B（同时保留 `startHidden` 设置）。

### Q5. 设置保存方式？

- **A（推荐）自动保存 + 状态提示**：开关/下拉立即保存，滑块 400 ms debounce；底部显示“已保存 HH:mm:ss”；关闭窗口/退出前 flush。
- B. 显式“保存”按钮：行为可预期，但容易忘记保存、关闭丢改动。
- C. 混合：滑块/开关自动保存，昵称/路径/快捷键需要显式保存。
- D. 每次改动立即写盘（无 debounce）：最简单，但滑块拖动会频繁写文件。

> 推荐 A；实现时保留 flush。

### Q6. 自定义快捷键先做哪些动作、默认绑哪些？（对应 Brief Q14/Q15）

- **A（推荐）先接已有四个：拍照 / 显示隐藏 / 火把 / 伸懒腰**；默认仅 `photo=Ctrl+Alt+P`，其余留空；设置页只显示已实现动作。behavior/interaction 交付喂食/玩具/坐睡/起床后再按 `ActionId` 扩展。
- B. 只做两个：拍照 / 显示隐藏；最小实现，但用户要“动作快捷键”的诉求只满足一半。
- C. 一次接入 Brief Q14 的全部动作（含喂食/玩具/坐睡/醒）：功能完整，但依赖 behavior/interaction 未完成，设置页会出现不可用动作。
- D. 四个动作 + 默认都绑（如 `Ctrl+Alt+T/S`）：开箱即用，但冲突概率高，违背 Brief Q15 推荐。

> 推荐 A；后续按 `ActionId` 扩展，默认始终只绑拍照。

### Q7. 安装包/便携版是否接受“未签名 + SmartScreen 提示”？

- **A（推荐）不签名**：本地自用，不购买证书；首次运行需点“更多信息→仍要运行”；验收记录提示。
- B. 购买/使用代码签名证书：消除大部分 SmartScreen 提示，但有成本/证书管理。
- C. 自签证书：仍会提示不受信任，意义有限。
- D. 只交付 source zip / 不交付 exe：与用户已定的三件套冲突，不推荐。

> 推荐 A（本地自用）；如果用户希望更顺滑，再评估 B。

### Q8. 多显示器/DPI 验收怎么做？

- **A（推荐）用户临时接第二台显示器/使用现有副屏一起验收**：能真实验证拖拽、拔插、全屏副屏、DPI 混合；平台先交付纯函数测试 + 单屏验收。
- B. 只做单屏 + 纯逻辑测试，发布后用户自己试：开发快，但多屏 bug 可能到用户手里才暴露。
- C. 用虚拟显示器驱动（如虚拟屏软件）：能测坐标但不等于真实 DPI/任务栏；可能影响系统，不建议。
- D. 不做多屏支持（只主屏）：与 PRD “多显示器/DPI”冲突，不推荐。

> 推荐 A；本轮单屏环境先完成 `shared/peek`/display 纯函数测试和单屏验收，等用户方便时补多屏。

> 另需用户确认的 3 个已存在假设（不必单独占问题名额）：
> 1. 拖拽松手落回目标显示器任务栏上方（PRD/DECISIONS 已定）。
> 2. 自动火把在持续暗时最多每 10 分钟一次（PRD 已定，renderer 已实现）。
> 3. 昵称只用于托盘 tooltip/照片文件名，桌面零文字（PRD 已定）。

---

## 8. 实现任务拆分与工作量估算

> 以下只是建议；每个任务必须有独立 write scope，等 Lead 建任务板后执行。执行顺序按 Commander Brief 的 G1→G2→交付闸门：**先 G1（托盘单击 + 全屏探头）、再设置/自启/快捷键/拍照、最后打包与干净验收**；不要先做设置 UI 再回头补探头。估算为 platform 侧单人流，不含等待/评审。

| 任务 ID | 优先级 | 内容 | 建议 write scope | 依赖 | 估算 |
|---|---|---|---|---|---|
| `PT-01` | P0/G1 | 托盘单击 + 菜单刷新 + tooltip + 专用 tray.ico（不崩 fallback） | `src/main/tray.ts`、`build/tray.ico` | 无 | 0.5 d |
| `PT-02` | P0/G1 | resize guard 容差/自卫/模式门 + focus 实验 + backgroundThrottling + restore 位置 | `src/main/pet-window.ts`、`src/shared/settings.ts`（读取位置） | 无（focus 需真机验证） | 1 d |
| `PT-03` | P0/G1 | C# helper 源码/build.ps1 + `FullscreenProbe` + PowerShell fallback + 状态/退避/日志 | `native/fullscreen-watcher/**`、`src/main/fullscreen.ts`、`src/shared/peek.ts` | PT-01/02 无；打包需 extraResources | 1.5 d |
| `PT-04` | P0/G1 | `PeekController` 状态机 + 四边 placement + 随机/时序/互斥 + window mode 集成 | `src/main/peek.ts`、`src/shared/peek.ts`、`src/main/pet-window.ts` | Lead `contracts.ts`；behavior head-only pose；Lead ipc | 1.5 d |
| `PT-05` | P0/G2 | settings v2 + 迁移 + store flush + autostart.ts（全新安装默认 ON；已有配置保留原值；portable 路径；dev guard） | `src/shared/settings.ts`、`src/main/settings.ts`、`src/main/autostart.ts` | G1 通过 + 接口冻结 | 1.5 d |
| `PT-06` | P0/G2 | 完整设置窗 + 首启向导 + 保存/校验状态（同 renderer，?wizard=1；老配置不强弹） | `src/main/settings-window.ts`、`src/renderer/settings.*` | PT-05、preload/ipc | 2.5 d |
| `PT-07` | P1/G2 | 快捷键编辑器 + hotkeys.ts（注册/回滚/冲突）+ `ActionId` 接线 | `src/main/hotkeys.ts`、settings UI、`src/preload/index.ts` | interaction `ActionId` 实现 | 1 d |
| `PT-08` | P1/G2 | PhotoController（photoDir/多屏/隐藏/探头/互斥）+ brightness 条件轮询/状态 | `src/main/photo.ts`、`src/main/brightness.ts` | PT-05/06 | 1 d |
| `PT-09` | P0/交付 | electron-builder.yml + icon/tray/installer.nsh + dist scripts + source zip 脚本 | `electron-builder.yml`、`build/**`、`scripts/**`、`package.json` | 功能 freeze；依赖批准；G1 通过后可先试打包 | 1.5 d |
| `PT-10` | P0/交付 | 集成 + 干净 profile/便携/NSIS/source zip 验收 | Lead/QA 主责 | PT-01…09 | 1–2 d（QA/Lead） |
| `PT-11` | P0/G1 | 文档更新：PRD/DECISIONS/TECH-PLAN 自启默认（新装 ON/旧配置保留）/探测方案/托盘单击 | Codex/Lead | 用户确认 Q1/Q4 | 0.2 d |
| `PT-12` | P1/G1–G2 | 纯函数测试（peek/geometry/settings v2/autostart arg/display）+ fixtures | `tests/**`（QA） | PT-03/05 | 1 d（QA） |

**总估算**：platform 侧约 **10–12 人天**（不含 QA/behavior/interaction/Lead）；P0 用户可感知路径（PT-01/02/03/04 + 最小设置/自启）约 **5–6 个工作日**，完整设置/快捷键/拍照/打包再加 **4–6 天**。关键路径是 `PT-04` 依赖 behavior 的 head-only pose，`PT-06` 依赖 Lead 的 ipc.ts 接线。

---

## 9. 给 Lead 的简洁报告

### 9.1 结论

平台流当前**不具备交付条件**：托盘单击、全屏探头、完整设置/向导/自启、打包/源码 zip 全部缺失；同时存在一个真实的 P0 窗口自激循环（125% DPI 下 30–50 次/秒 `setBounds`），会直接阻碍探头实现。审计完成，设计已够进入实现；**本轮未写任何代码**。本文已按 Commander Brief 的接口命名、G1 顺序和“Lead 冻结 `src/shared/contracts.ts`”约定对齐；冲突处以 Brief/用户回答为准。

### 9.2 P0 缺陷（按优先级）

1. `PLT-01` resize guard 自激循环：`src/main/pet-window.ts:116-128`；证据 12,090 + 2,218 条日志（审计期间仍在增长）；修复容差/自卫/模式门。
2. `PLT-09` 托盘只有双击：`tray.ts:55-58`；当前实例已隐藏（QA 基线 13:39 起），单击无法找回；加 `click`（Q2 语义）。
3. `PLT-14` 设置页只有 size/volume：无向导/自启/全屏/快捷键/拍照目录；按 §4 重做。
4. `PLT-15` 自启默认 false + 完全未实现：含 portable `PORTABLE_EXECUTABLE_FILE` 路径陷阱；全新安装默认改 ON，既有 settings.json 迁移保留原值（Brief 要求）。
5. `PLT-25` 无 electron-builder/图标/source zip：按 §5 实现。
6. `PLT-26` `pnpm-workspace.yaml` 占位符：干净安装/source zip 会失败；先修。

### 9.3 设计决策

- **检测**：C# helper 主 + PowerShell 兜底；get-windows 仅 spike（避免 ESM/native/安装脚本审批风险）。
- **探头**：head-only render（同一窗口、隐藏身体、头中心=窗口中心）+ 四边透明窗口裁切；TECH-PLAN 的“窗口裁切身体”只适用于下边缘，必须纠正。
- **时序/互斥**：1 s 检测 + 2 次 hysteresis；20–45 s/4–8 s；walk/drag/close/photo/settings/lock/显示变化的完整状态机（§3.6）。
- **设置**：v2 schema、自动保存 + flush、首启 5 步向导（全新安装；老配置不弹）、自启“新装默认 ON、既有保留”（可关）、快捷键编辑器、多屏/DPI 数据源统一。
- **打包**：electron-builder `26.15.x` + `electronDist: node_modules/electron/dist` 锁 44.7.0；portable + NSIS per-user + source zip；图标/helper 走 `extraResources`；NSIS 卸载清 Run 项；干净 profile 验收。

### 9.4 问题（需要用户/Lead 拍板）

- Q1 检测路线（推荐 C# helper + PowerShell 兜底）；Q2 托盘单击语义（推荐“单击显示/找回”，已显示不隐藏）；Q3 全屏范围（推荐所有全屏）；Q4 自启后显示/静默（推荐安静显示在任务栏上方）；Q5 保存方式（推荐自动保存）；Q6 快捷键动作集（推荐先接已有四个、默认只绑拍照）；Q7 不签名接受 SmartScreen（推荐接受）；Q8 多显示器验收环境（推荐用户配合第二屏）。
- 另需 Lead 决策：**`src/shared/contracts.ts` 冻结**（`FullscreenState`/`BehaviorMode`/`ActionId`）；`ipc.ts` 是否临时转交 platform；`electron-builder` devDependency 批准；C# helper/native 目录批准；PRD/DECISIONS 自启新装/旧配置策略更新。

### 9.5 工作量与就绪度

- platform 约 10–12 人天；P0 可感知路径 5–6 天；打包/验收另 1–2 天（Lead/QA）。
- **就绪**：可以开 write-scoped 实现任务；开工前需（1）Q1–Q8 有答案或授权按推荐项，（2）Lead 冻结 `src/shared/contracts.ts`（`FullscreenState`/`BehaviorMode`/`ActionId`）与 settings 迁移（新装 ON/旧配置保留），（3）`index.ts`/`ipc.ts` 写入归属明确（含 `ASSET_PATHS`），（4）electron-builder/依赖批准。**当前唯一写入的审计文件是 `docs/streams/PLATFORM-AUDIT.md`。**

### 9.6 本轮未做 / 风险提醒

- 未启动可见 GUI 做验收；`PLT-02` 的焦点问题、`PLT-04` 的节流行为、真机全屏判定仍需 Lead/QA 在真实桌面验证。
- 当前实际运行实例使用 `.scratch-userdata`（不是 handoff 写的 `.scratch-userdata-live`）；未重启/未终止。后续实现任务不要杀这个实例。
- 当前单屏，多显示器/混合 DPI 只能先做纯函数测试；需用户配合 Q8。
- PRD/DECISIONS/TECH-PLAN 与用户最新“自启默认 ON”的口径需要 Codex/Lead 明确成“全新安装 ON、既有配置保留”；不要在实现里偷偷改文档。

---

## 附录 A：证据索引

| 证据 | 位置/命令 | 关键内容 |
|---|---|---|
| resize guard 告警 | `.scratch-userdata/logs/main.log`（审计期间 12,035→12,090 条） | 几乎全部为 `pet resize guard`；2026-10-21T05:39:07 出现 `913x913 -> 912`；另有 1 条 `Ctrl+Alt+P` 注册失败 |
| 历史实例日志 | `.scratch-userdata-live/logs/main.log`（2,218 条） | 16:16:28–16:17:22 连续 30–50 条/秒；16:18:44 关闭后仍有一条 |
| 当前实例 | 进程命令行 | `electron.exe --user-data-dir="...\.scratch-userdata" --debug-walk .`；PID 15364 等 |
| 当前显示 | `[System.Windows.Forms.Screen]::AllScreens` | `1536×960`，workArea `1536×912`，primary |
| 缩放因子 | renderer 进程命令行 | `--device-scale-factor=1.25` |
| Electron 版本 | `node_modules/electron/package.json` | `44.7.0` |
| pnpm 版本 | `pnpm --version` | `11.7.0` |
| C# 编译器 | `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` | 4.8.9221.0；.NET Framework 4.8.1 |
| 设置现状 | `.scratch-userdata/settings.json` | `firstRun=true`、`size=500`、`autostart=false`、`photoDir=""`、无新字段 |
| 打包缺失 | 根目录/`node_modules/.bin` | 无 electron-builder、无 `build/`/`release/`/`resources/` |
| 配置污染 | `pnpm-workspace.yaml` | `allowBuilds.get-windows = "set this to true or false"` |

## 附录 B：参考资料

- [get-windows README（sindresorhus/get-windows）](https://github.com/sindresorhus/get-windows) — ESM-only、`activeWindow`/`contentBounds`、Windows 支持；本审计据此评估方案 B。
- [get-windows 9.3.0 npm 元数据](https://registry.npmjs.org/get-windows/latest) — `node-pre-gyp install --fallback-to-build` 安装脚本、NAPI v9，解释 pnpm `allowBuilds` 风险。
- [electron-builder NSIS 文档](https://www.electron.build/nsis) — NSIS 配置项参考。
- [electron-builder npm 元数据](https://registry.npmjs.org/electron-builder/latest) — 当前 26.15.3，作为 devDependency 建议版本。

> 以上外部链接仅用于技术评估；本审计没有按外部内容做任何安装/配置更改。

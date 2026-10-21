# QA 基线（QA-BASELINE）— Niko Pet 3D

> 版本：v1.0 · 记录时间：2026-10-21 13:47–14:00（Asia/Shanghai）· 执行：qa-visual
>
> 范围：只读代码审计 + 构建/类型/测试 + 当前真实桌面观察 + PRD A01–A14 验收矩阵 + 里程碑 QA 模板与回归清单。
>
> 约束遵守：**没有修改** `src/`、`tests/`、`tools/`、`package.json`、`public/`；**没有杀、重启、移动、点击**当前运行实例；只写本文件与 `artifacts/qa-*` 证据文件。
>
> `docs/COMMANDER-BRIEF.md` 在本轮开始时**不存在**；13:55 出现后已补读并对齐（P0-0 基线检查点、P0-1 首个可见里程碑 = 全屏探头 + 托盘单击、G1/G2 证据闸门）。本轮任务 write scope 比 Brief 的 QA 范围更窄：只允许 `docs/QA-BASELINE.md` + `artifacts/qa-*`，所以没有新增 `tests/qa-*` / `tools/qa-*`。

---

## 0. 结论摘要（给 Lead）

| 项目 | 结果 |
|---|---|
| 构建 `electron-vite build` | **通过**，exit 0；main/preload/renderer 三端产物齐全 |
| 类型 `tsc --noEmit -p tsconfig.json` | **通过**，exit 0，无输出 |
| 单元测试 `vitest run` | **17/17 通过**（4 个文件，约 0.5 s），exit 0 |
| Git / 素材 | HEAD `0c8cb8c`（M1），工作区有 M2/M3 未提交改动；皮肤 SHA-256 仍为 `715b…705c`，未被动过 |
| 当前桌宠 | 进程存活（13:05:59 启动，5 个 Electron 进程），但**窗口自 13:39:14 起隐藏到托盘**；13:51 桌面截图**看不到宠物**；未重启 |
| A01–A14 矩阵 | **3 已测（历史/日志）+ 6 部分 + 3 未测 + 2 阻塞**；**0 项获得用户确认** |
| 最高优先级问题 | ① 自动火把（A07）在暗屏 16% 下 40+ 分钟从未触发，代码有两条抑制路径；② 托盘单击显示缺失（当前只能双击找回）；③ 全屏探头/设置向导/自启/打包仍未实现（A10/A12/A14） |
| 建议第一个 QA 靶点 | **P0-0 基线阻断：A07 自动火把 + A12 托盘单击恢复 + A11 拍照/设置接线**；随后按 Commander Brief 的 **P0-1 首个可见里程碑：A10 全屏探头 + 托盘单击（G1）**。详见 §9 |

> 一句话：**代码门禁是绿的，但真实桌面验收现在是「被冻结」状态**——宠物藏在托盘里，先解决「怎么找回」和「自动火把是否真的会触发」，再谈里程碑通过。

---

## 1. 环境与实例基线

### 1.1 主机与项目

| 项 | 值 |
|---|---|
| 项目根 | `<repo>` |
| 系统 | Windows 11 x64（26200，按项目文档） |
| 工具链 | Node 24 / pnpm 11 / PowerShell 7；Electron **44.7.0**（锁定） |
| Git | `master` @ `0c8cb8c7848720577f2ab0b35e18667f79207b94`；Commander Brief 定义 M1 `0c8cb8c` 为**可回滚锚点**，当前 M2/M3 是**候选基线**，需 P0-0 验证后才能冻结；工作区含 M2/M3 未提交改动（`M src/main/*`、`M src/renderer/*`、`?? src/main/brightness.ts`、`?? src/renderer/{torch,bread,particles,snacks}.ts` 等） |
| 显示 | 单显示器；逻辑 1536×960，workArea 1536×912（底部 48 px 为任务栏保留区）；Electron renderer 以 `--device-scale-factor=1.25` 运行，即 **125% DPI** |
| 皮肤 | `public/assets/skin/niko.png`，SHA-256 `715b4826eb9c7f0dd609a4cbad2cef5d130bf3f47fe323649350d5e2d7df705c` |

### 1.2 当前运行实例（只读观察）

| 项 | 值 |
|---|---|
| 启动时间 | 2026-10-21 13:05:59（本地） |
| 主进程 PID | `15364`；子进程 `17432`（GPU）、`23532`（Audio）、`23724`（Renderer）、`25692`（Network） |
| 启动命令 | `electron.exe --no-sandbox --user-data-dir="…\.scratch-userdata" --debug-walk .` |
| userData | `…\niko-pet-3d\.scratch-userdata`（**注意：目录名表明这是测试/QA 配置，不是 `.scratch-userdata-live`；正式用户配置目录本轮未运行**） |
| 远程调试 | 当前**未开**；`DevToolsActivePort` 是 2026-10-20 的旧文件，9223 端口无监听 |
| 单实例 | 已实现 `requestSingleInstanceLock()`；第二次启动会唤起宠物并打开设置 |
| 宠物窗口句柄 | `0x50A54`，class `Chrome_WidgetWin_1`，title `niko-pet-3d` |
| 窗口当前状态 | **`IsWindowVisible = false`**；DWM cloaked = 0；rect **624,0 912×912**（逻辑），物理约 780,0 1140×1140 |
| 窗口位置含义 | 窗口高 912 = 当前 workArea 高度，底边正好落在任务栏上沿；因窗口本身是方形，顶部在 y=0 |
| 当前设置（测试 profile） | `size=500`、`nickname=Niko`、`volume=0.55`、`muted=false`、`autostart=false`、`longPressMs=1500`、`darkThreshold=30`、`autoTorch=true`、`clickSounds=true`、`particles=true`、`firstRun=true`、`photoDir=""` |

> ⚠️ 按启动参数与内容判断，当前运行实例使用 **QA/测试 userData**（`.scratch-userdata`），设置已被改成 `size=500`、`firstRun=true`；它不是用户正式配置的稳定实例。真实用户配置目录本轮未运行。

---

## 2. 构建 / 类型 / 测试结果（精确）

所有命令均在项目根执行；**没有走 `pnpm build` / `pnpm test`**，避免 pnpm 的依赖状态检查触发安装。Electron 保持 44.7.0。

```powershell
cd <repo>

# 1) 构建
node_modules\.bin\electron-vite.cmd build

# 2) 类型
node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json

# 3) 测试
node_modules\.bin\vitest.cmd run --reporter=verbose
```

| 命令 | exit | 结果摘要 |
|---|---|---|
| `electron-vite build` | **0** | `out/main/index.js` 35.52 kB；`out/preload/index.js` 2.95 kB；`out/renderer/index.html` 0.38 kB；`out/renderer/settings.html` 1.20 kB；`assets/pet-BW6q9gqZ.js` 888.09 kB；`assets/settings-BvONB9js.js` 1.77 kB；首次三阶段构建 65 ms / 28 ms / 830 ms，二次 build renderer 312 ms |
| `tsc --noEmit -p tsconfig.json` | **0** | 无输出；tsconfig 为 strict + `noUncheckedIndexedAccess` |
| `vitest run --reporter=verbose` | **0** | **Test Files 4 passed (4)，Tests 17 passed (17)**，Duration 521 ms（import 42% / tests 24% / transform 21% / worker 13%），Vitest 5.0.5 |

测试明细（全部通过）：

| 文件 | 数量 | 覆盖 |
|---|---:|---|
| `tests/walk.test.ts` | 4 | 底部行走边界、40 px/s、边缘反弹、3–8 分钟 / 10–40 秒调度 |
| `tests/gesture.test.ts` | 8 | 单击、250 ms 拖拽门、1.5 s 火把、2.4 s 聚粒子、3 s 关闭、1.5 s 后移动不拖拽、取消清理、250 ms 内移动不算静止 |
| `tests/settings.test.ts` | 3 | 默认值、数值范围/nickname 清洗、坏 JSON/版本不兼容恢复 |
| `tests/settings-store.test.ts` | 2 | 坏 JSON 备份、并发保存不丢字段 |

补充检查：

- 构建产物 `out/main/index.js` mtime 2026-10-21 13:51:26；构建**没有重启**正在运行的实例（PIDs/StartTime 未变，日志持续写入）。
- `vitest` 在 `settings-store.test.ts` 的 stderr 是**预期的损坏配置备份日志**，不是失败。
- 测试自身会写 `artifacts/settings-test-*` 临时备份目录，运行后自动清理，不属于源码改动。
- 皮肤 SHA-256 与 M0/M1 记录一致；本轮未改素材。

**门禁结论：BUILD / TYPE / UNIT TEST 全部 PASS。**

---

## 3. 当前真实桌面观察（未重启、未点击）

### 3.1 当前状态：宠物不可见（隐藏到托盘）

- 2026-10-21 13:51:12 的桌面截图：`artifacts/qa-baseline-desktop-final.png`（1536×960，逻辑分辨率）。
- 截图中**没有宠物**；顶部中央的蓝发 Niko 头像是 **DSH 界面自己的会话头像**，不是桌宠（见 `artifacts/qa-crop-topcenter.png`）。
- 屏幕被 DSH 窗口覆盖，截图中**看不到任务栏/托盘图标**，因此本轮无法用截图直接确认托盘图标外观。
- 对隐藏窗口做 `PrintWindow(PW_RENDERFULLCONTENT)` 只能得到全黑图（`artifacts/qa-printwindow-hidden.png`），**不能**当作视觉证据。
- 日志证据：宠物在 `2026-10-21T05:39:14.641Z`（本地 13:39:14）被长按关闭并 `hide()`；托盘保留：
  - `05:39:11.917Z torch toggled by hold`
  - `05:39:12.820Z close gathering`
  - `05:39:13.430Z close burst` + `pet close expanded -> 0,0 1536x960`
  - `05:39:14.641Z pet hidden; walking paused`
  - `05:39:14.652Z pet close completed; compact bounds restored; tray retained`
- 上一次真正可见：`05:29:50Z`（13:29:50）`pet shown; walking resumed`。也就是说，**今天最后一次可见只持续了约 9 分 24 秒，之后一直藏在托盘**。
- 窗口对象仍然存在（`0x50A54` 隐藏），不是崩溃/退出；5 个 Electron 进程都还在，日志仍每 20 s 写 `screen brightness -> 16`。

![当前桌面：宠物不可见（2026-10-21 13:51，1536×960）](../artifacts/qa-baseline-desktop-final.png)

### 3.2 尺寸 / 位置 / 缩放

- 当前请求尺寸 `size=500`，`PET_WINDOW_SIZE=420`、默认 220 px 的映射公式为 `round(420 × 500 / 220) = 955`；但 `sizeForArea()` 会把窗口 clamp 到 workArea 的 `min(width, height) = 912`，所以实际窗口是 **912×912**。
- 由此推算实际宠物高度约 `912 × 220 / 420 = 477.7` 逻辑 px（物理约 597 px），**不是设置里的 500 px**。设置值 500 在当前 1536×960 / 125% DPI 环境**无法原样兑现**。
- 窗口顶边 y=0、底边 y=912，正好压在任务栏上沿；宠物脚底按 85% 画布高度计，脚底约 y=775，视觉上位于任务栏上方。
- 风险：窗口占满整个 workArea 高度；高 DPI + 大尺寸时，窗口内部透明区域非常大，可能放大鼠标轮询/射线检测/窗口移动的成本（A13 未测）。

### 3.3 透明 / 裁切 / 文字（当前只能“部分确认”）

| 检查项 | 本轮结论 | 依据 |
|---|---|---|
| 窗口透明、无边框、无黑底/白底矩形 | **当前无法观察**（窗口隐藏）；历史证据支持 | 历史桌面截图 `artifacts/pet-topmost.png`（2026-10-20 23:08）显示宠物直接叠在 DSH 界面上，无黑底/白底；M0-REPORT.md 的 44.7.0 runtime 验证 |
| 始终置顶、不占任务栏 | 当前间接确认（代码 + 历史） | `skipTaskbar: true`、`setAlwaysOnTop(true,'screen-saver')`；历史置顶截图；任务栏被 DSH 覆盖，未能直接确认。UIA 看到名为 “Electron 已固定”、AppID 为 `com.nikopet.desktop` 的**固定项**，但它**不能证明**当前窗口出现在任务栏 |
| 裁切 | **当前无法观察** | 需要可见状态 + 任务栏可见的 OS 截图；历史 `pet-topmost.png` 中宠物完整可见 |
| 桌面上是否有文字/气泡/名字 | 当前无法观察；代码层面无 | `viewer.nameTag = null`；`index.html` 只有 canvas；历史截图未见文字；但本轮没能在可见状态复验 |
| 125% DPI 是否模糊 | **未测** | Electron renderer 使用 `--device-scale-factor=1.25`，但没有当前可见截图/清晰度对比 |

> 关键限制：**CDP 的 `Page.captureScreenshot` 把透明页面拍成白底**（见 `artifacts/m2-close.png`、`m2-stretch.png`、`m2-torch.png`），所以 CDP 截图只能看姿态/粒子，**不能**证明“桌面背景透出、没有黑底”。透明/裁切必须用 OS 级桌面截图或录屏验收。

历史透明叠加证据（**2026-10-20 23:08，旧构建，仅作参考，非本轮验收**）：

![历史透明叠加证据：宠物直接叠在桌面上，无黑底](../artifacts/pet-topmost.png)

### 3.4 托盘 / 恢复路径

- 当前进程存在 `Electron_NotifyIconHostWindow`（handle `0x402CA`），日志有 `tray retained`，说明托盘图标/宿主仍在；但截图里任务栏被覆盖，**没有直接看到托盘图标**。
- 托盘菜单代码有四项：显示/隐藏 Niko、设置、拍照、退出（`src/main/tray.ts:30-53`）。
- **托盘单击没有实现**：`src/main/tray.ts:55-58` 只注册了 `tray.on('double-click')`；单击不会显示宠物。
- 双击恢复有过实际日志：`05:29:39.371Z pet shown` + `05:29:39.383Z pet restored from tray`。
- 因此当前唯一不重启的找回方式是：**托盘双击**，或右键托盘菜单选择“显示 Niko”。本轮按约束没有执行。

### 3.5 运行日志观察

| 观察 | 数值/证据 |
|---|---|
| `main.log` 规模 | 15,719 行 / 981,205 bytes（13:53:43 快照） |
| `ERROR` | **0** |
| `WARN` | 12,035 条，其中 **12,034 条是 `pet resize guard`**（约 76.6% 的日志） |
| 亮度轮询 | 每 20 s 一次，`screen brightness -> 16`（16% ≤ 阈值 30%，属于“暗”） |
| 自动火把 | **全日志没有任何 `auto torch` 记录**，只有 7 条手动 `torch toggled by hold` |
| 拍照 | **没有 `photo saved` / `photo failed` 记录**；`%USERPROFILE%\Pictures\NikoPet` **不存在** |
| 全局快捷键 | 2026-10-20 16:19 的旧会话有 `failed to register Ctrl+Alt+P photo shortcut`；当前 13:05 会话没有该警告，但仍未实测 |
| 窗口 resize 抖动 | 拖拽/关闭测试期间大量 `915x913 -> 912`、`913x912 -> 912` 警告，说明 OS/DPI 会持续触发 1–3 px 的 resize 反馈，被 guard 每帧纠正；有日志/性能风险 |

### 3.6 本轮不能声称的事项

- 不能声称“自动火把已验证”；日志和代码都指向未触发/可能缺陷。
- 不能声称“点击穿透到下层窗口已验证”；M0 报告本身也把此项列为未完成。
- 不能声称“拍照功能可用”；没有照片文件、没有成功日志。
- 不能声称“当前透明/裁切/文字已通过”；宠物现在隐藏。
- 不能声称“用户已确认”；本轮所有结论都还没有用户确认。

---

## 4. 验收矩阵 A01–A14（对照 PRD §13）

状态图例：

- ✅ **TESTED**：已有历史截图/日志/单测证据（但尚未获用户确认）。
- 🟨 **PARTIAL**：部分证据、仅代码级、或只有历史证据，需要复验。
- ⬜ **UNTESTED**：功能存在，但本轮没有实际触发/没有证据。
- ⛔ **BLOCKED**：功能未实现或环境不可达。
- **所有项的用户确认均为“未确认”**；用户确认是里程碑门禁，不是可选步骤。

| ID | PRD 验收点（摘要） | 覆盖范围 | 状态 | 证据（路径） | 缺口 / 说明 |
|---|---|---|---|---|---|
| A01 | 64×64 Slim 双层皮肤，3 px 手臂、第二层正常，无 UV 拉伸/黑边 | 模型/皮肤 | ✅ TESTED（历史） | `docs/M0-REPORT.md` §已验证；`artifacts/m0-final.png`；`artifacts/m1-idle2.png`；皮肤 SHA-256 一致 | 历史 renderer 截图，不是当前可见状态；用户未确认 |
| A02 | 透明无边框、置顶、不显示任务栏；空白处点击穿透；125% DPI 不模糊 | 窗口/系统 | 🟨 PARTIAL | `artifacts/pet-topmost.png`（透明叠加）；`src/main/pet-window.ts:55-79`；M0-REPORT.md | **点击穿透到下层窗口未验证**；当前窗口隐藏；任务栏处看不到；DPI 清晰度未对比 |
| A03 | 待机呼吸/眨眼/东张西望，低频不抽风 | 行为/动画 | 🟨 PARTIAL | `src/renderer/animator.ts`（呼吸、眨眼、glance）；`artifacts/m1-idle2.png` 单帧；M1-REPORT.md | 没有动作录像/时长证据；当前不可见 |
| A04 | 走路脚贴任务栏、手脚反相摆动、边缘转身、脚步音 | 行为/动画 | 🟨 PARTIAL | `tests/walk.test.ts` 4/4；`artifacts/m1-walk-left2.png`、`m1-walk-right2.png`；日志有 walk/facing；`animator.onFootstep → audio.step` | 脚贴任务栏/脚步音的当前视觉与听感未复验；历史图是 CDP 白底 |
| A05 | 伸懒腰双臂上举、身体后仰、2.5 s 平滑回待机 | 行为/动画 | 🟨 PARTIAL | `src/renderer/animator.ts:9,99-103`；`artifacts/m2-stretch.png`（CDP，白底） | 单帧不足以证明 2.5 s 时间轴；无录屏；用户未确认 |
| A06 | 吃面包完整演出：掏出→啃 3–4 口→掉屑→打嗝→爱心；无文字 | 行为/道具 | ⬜ UNTESTED | `src/renderer/pet.ts:85-116`（4 口、屑/爱心）；`bread.ts`；随机 8–20 分钟 | **无任何实际吃面包证据**；`bread-shot.mjs` 目标产物 `artifacts/bread-eat3.png` 不存在 |
| A07 | 亮度 ≤ 阈值自动举火把 12–18 s；火把只照角色；点燃/熄灭音效 | 火把/环境 | 🟨 PARTIAL（手动 PASS，自动存疑） | 手动：`05:39:11.917Z torch toggled by hold`、`artifacts/m2-torch.png`；自动：`src/renderer/pet.ts:67,138-161`；日志显示 16% 亮度下 40+ 分钟无 auto torch；Commander Brief §1/§5 同样标出 cold-start 10 分钟风险 | **P0 风险**：自动路径从未触发；见 §7-R2。另：`audio.ts` 没有加载 `fireLoop`，火星粒子未接，PRD 要求的燃烧循环音/火星缺失 |
| A08 | 单击摸头；按下压扁、松开回弹；长按 1.5 s 切火把；3 s 关闭；互不误触 | 手势 | ✅ TESTED（日志+单测） | `tests/gesture.test.ts` 8/8；日志 `05:39:10.415 press` → `05:39:11.917 torch` → `05:39:12.820 gather` → `05:39:13.430 close burst`；`artifacts/press-cdp.png` 等历史图 | 手势逻辑有单测+日志；**当前桌面视觉/压扁回弹观感未复验**；摸头的爱心/呼噜尚未接（Commander Brief §1）；无用户确认 |
| A09 | 关闭时紫色粒子扩散、停留约 1.2 s；隐藏到托盘；托盘可恢复 | 关闭/托盘 | ✅ TESTED（日志） | 日志关闭序列；`artifacts/m2-close.png`（CDP 白底粒子）；`05:29:39` 恢复日志；tray retained | 当前桌面截图无法证明透明叠加；恢复路径目前是双击，不是单击 |
| A10 | 全屏时只探头不挡画面、随机边缘；退出全屏恢复底部走动 | 全屏探头 | ⛔ BLOCKED | 全仓库无 fullscreen/probe 实现代码；PRD §6 | **未实现**；当前 DSH 窗口覆盖整屏（截图中无任务栏），是现成的 A10 全屏测试场景，但代码里没有检测/探头 |
| A11 | Ctrl+Alt+P 冻结姿态、截取桌面背景、保存 PNG；无 UI/水印 | 拍照 | ⬜ UNTESTED | `src/main/index.ts:42-77`、`src/main/photo.ts`；设置项 `photoDir` 未使用 | **无照片产物**；`Pictures\NikoPet` 不存在；旧会话快捷键注册失败过一次；按 Commander Brief §1：未隐藏设置窗、未冻结粒子、隐藏/探头时未先显示宠物、目标屏找不到时兜底到首屏、同秒文件名可能覆盖 |
| A12 | 托盘四项可用；设置持久化；自启默认关；单实例；多显示器不越界 | 托盘/设置/系统 | 🟨 PARTIAL | `src/main/tray.ts` 四项 + 双击恢复日志；`settings.json` + 2 个 store 测试；单实例 `index.ts:17-23`；settings 页仅大小/音量 | **单击缺失**；**自启完全未实现**；settings 只有 2 个控件；`longPressMs/firstRun/particles/photoDir/lastDisplayId/lastX` 等字段读入但未使用；只有单显示器，多屏未测 |
| A13 | 待机 CPU < 3%、走路 < 8%；无内存增长；隐藏时停止渲染 | 性能 | ⬜ UNTESTED | 无性能基线/采样；隐藏时仍有 20 s 亮度轮询；日志 12,034 条 resize guard | **没有任何性能数据**；无内存/CPU soak；透明窗口 + 大尺寸的渲染成本未知 |
| A14 | 便携 exe + 安装包可启动；源码可 `pnpm dev`；素材与文档齐全 | 打包/交付 | ⛔ BLOCKED | `package.json` 只有 dev/build/test；无 electron-builder 配置；无 `release/` 目录；构建通过、素材齐全 | **打包器/安装包未实现**；`pnpm dev` 未验证（AGENTS.md 明确警告 Agent 上下文不要启动可见 GUI） |

**统计：✅ 3（A01/A08/A09）· 🟨 6（A02/A03/A04/A05/A07/A12）· ⬜ 3（A06/A11/A13）· ⛔ 2（A10/A14）。**

### 4.1 PRD 中未进入 A01–A14、但用户明确列为 P0 的功能（补充矩阵）

| ID | 功能 | 状态 | 证据/缺口 |
|---|---|---|---|
| B01 | 全屏自动探头（同 A10） | ⛔ BLOCKED | 无实现；`get-windows` / C# helper / PowerShell 兜底均未落地 |
| B02 | 托盘**单击**显示/找回 | ⛔ BLOCKED | `tray.ts:55-58` 仅 double-click；用户最新决策要求“全屏探头 + 托盘单击先做” |
| B03 | 首次启动向导（尺寸/昵称/音量/长按/自启/暗处阈值） | ⛔ BLOCKED | `firstRun=true` 从未消费；`settings.html` 只有 size/volume |
| B04 | 完整设置页/持久化（静音、自启、长按、阈值、拍照目录、关于） | 🟨 PARTIAL | `settings.json` 有字段，但 UI 只暴露 size/volume；`longPressMs/particles/photoDir/autostart` 在运行逻辑中未消费 |
| B05 | 开机自启（默认按最新决策为开、可关） | ⛔ BLOCKED | 无 `app.setLoginItemSettings`；设置默认 `autostart=false`，与最新用户决策冲突 |
| B06 | 坐/睡/赖床/起床 | ⛔ BLOCKED | `animator.ts` 无坐/睡状态；PRD §4.1 |
| B07 | 挥手/跳舞/转圈 | ⛔ BLOCKED | 无动作实现 |
| B08 | 看鼠标 / 追鼠标 | 🟨 PARTIAL | 看鼠标有 `animator.setCursor`；追鼠标没有 |
| B09 | 自定义动作快捷键 | ⛔ BLOCKED | 只有全局 `Ctrl+Alt+P` 拍照 |
| B10 | 便携 exe / NSIS 安装包 / 源码 zip | ⛔ BLOCKED | 同 A14 |
| B11 | 拍照：隐藏/探头时临时回到中央、拍完恢复、保存目录可配 | ⛔ BLOCKED | `photoDir` 未用；隐藏时 `takePhoto` 不会先显示宠物 |
| B12 | 记住上次显示器/位置 | ⛔ BLOCKED | `lastDisplayId/lastX` 存在但没有任何写入/恢复逻辑 |
| B13 | 摸头爱心/呼噜 | ⛔ BLOCKED | 单击只有 `animator.pet()`；没有爱心粒子与猫呼噜音（Commander Brief §1） |
| B14 | 火把火星/燃烧循环音 | ⛔ BLOCKED | `torch.ts` 没有火星粒子；`audio.ts` 没有加载 `fireLoop`（Commander Brief §1） |

---

## 5. 里程碑 QA / 汇报模板

### 5.1 固定流程（每个里程碑必须走完）

1. **冻结基线**：记录 commit / 工作区状态 / Electron 版本 / 皮肤 SHA-256；确认没有未说明的 dirty 文件。
2. **代码门禁**：依次跑 build → tsc → vitest；三条命令都 exit 0 才能进入桌面验收。失败时先修代码，不进入视觉验收。
3. **恢复可见**：优先让用户/Lead 用托盘双击或“显示 Niko”恢复当前实例；**不要**为了验收杀掉用户实例。需要独立测试时，用**独立 userData** 启动 QA 实例（见 §6.4）。
4. **逐项走 A01–A14**：每项至少记录「操作 → 期望 → 实际 → 证据路径」；无法测的标 BLOCKED，不允许留空或写“应该可以”。
5. **证据采集**：透明/裁切/置顶/任务栏必须用 **OS 级桌面截图或录屏**；CDP 截图只能作为姿态/粒子的辅助。每个功能至少 1 张关键 PNG；每个里程碑 1–3 分钟连续操作录屏（必要时再补每个关键动作 15–30 s 短片）+ 日志摘录 + 缺陷清单（Commander Brief Q13 推荐 A）。
6. **日志对照**：保存 `userData/logs/main.log` 时间窗口；确认没有 ERROR、关键事件有记录、没有 resize 风暴/内存异常。
7. **写报告**：复制 §5.2 模板，附证据索引；把矩阵的 PASS/PARTIAL/UNTESTED/BLOCKED 更新到最新。
8. **用户确认**：把报告 + 截图/录屏 + 待决问题给用户；用户明确确认后，才能把里程碑标记为通过并进入下一阶段。

### 5.2 报告模板（复制使用）

```markdown
# M<N> 验收报告 — Niko Pet 3D

## 1. 基线
- 日期/时间：
- 执行人：
- Git commit / dirty：
- Electron / Node / OS：
- 皮肤 SHA-256：
- QA userData / 显示环境（分辨率、DPI、显示器数量）：

## 2. 变更范围
- 本里程碑改动：
- 未改动/兼容性说明：

## 3. 代码门禁（原始结果）
| 命令 | exit | 结果 |
|---|---|---|
| electron-vite build | | |
| tsc --noEmit | | |
| vitest run --reporter=verbose | | |

## 4. 验收矩阵
| ID | 状态 | 证据 | 备注 |
|---|---|---|---|
| A01 … A14 | | | |
| B01 … B12（如涉及） | | | |

统计：PASS __ / PARTIAL __ / UNTESTED __ / BLOCKED __

## 5. 真实桌面观察
- 窗口可见性 / 窗口矩形 / 所在显示器：
- 透明/黑底/白底：
- 裁切/贴任务栏：
- 文字/气泡/名字：
- 点击穿透/焦点：
- 托盘图标/单击/双击：
- 关键日志时间线：

## 6. 截图 / 录屏
| 场景 | 文件 | 时间 | 说明 |
|---|---|---|---|

## 7. 已知问题/风险
- P0：
- P1：
- 未测/环境限制：

## 8. 回归项
- 本次涉及、下一轮必须重跑的 A/B 项：
- 新增回归命令/脚本：

## 9. 用户确认
- 待确认问题（编号/选项/推荐）：
- 用户回复：
- 结论：通过 / 有条件通过 / 不通过

## 10. 下一步
-
```

### 5.3 截图 / 录屏命名

- 桌面截图：`artifacts/qa-M<N>-<scenario>-<HHmmss>.png`，例如 `qa-M3-A07-auto-torch-135500.png`。
- CDP 姿态辅助：`artifacts/qa-cdp-<scenario>-<HHmmss>.png`（必须标明“CDP 白底，不作透明证据”）。
- 录屏：`artifacts/qa-M<N>-<scenario>-<HHmmss>.mp4`；每个里程碑 1–3 分钟连续回归录屏，关键动作可另补 15–30 s 短片；长按类动作从按下前 2 s 开始录。
- 每张截图在报告里写清「时间、显示器/DPI、窗口 bounds、场景、通过/失败」。

### 5.4 当前“找回宠物”的操作（不改代码、不重启）

1. 右键托盘图标 → 菜单选「显示 Niko」；或直接**双击**托盘图标。
2. 确认日志出现 `pet shown; walking resumed` 和 `pet restored from tray`。
3. 若托盘图标在隐藏区域，先点任务栏“显示隐藏的图标”再操作。
4. 不要结束 Electron 进程；不要用第二个实例去“抢”当前 userData（会触发单实例逻辑，可能改变当前用户状态）。

---

## 6. 回归命令清单

### 6.1 代码门禁（每轮必跑）

```powershell
cd <repo>
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

node_modules\.bin\electron-vite.cmd build
node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
node_modules\.bin\vitest.cmd run --reporter=verbose
```

预期：三条命令 exit 0；vitest **4 files / 17 tests passed**。若测试数变化，报告里必须写清新增/删除项。

### 6.2 构建产物完整性

```powershell
node -e "const fs=require('node:fs');const need=['out/main/index.js','out/preload/index.js','out/renderer/index.html','out/renderer/settings.html','out/renderer/assets/skin/niko.png','out/renderer/assets/whale/Ya1.mp3','out/renderer/assets/whale/Ya2.mp3','out/renderer/assets/vanilla/textures/block/torch.png','out/renderer/assets/vanilla/textures/item/bread.png','out/renderer/assets/vanilla/sounds/fire/ignite.ogg','out/renderer/assets/vanilla/sounds/mob/endermen/portal.ogg','out/renderer/assets/vanilla/sounds/portal/travel.ogg'];for(const p of need)if(!fs.existsSync(p))throw Error('missing '+p);console.log('built files ok: '+need.length)"
```

皮肤不变检查：

```powershell
(Get-FileHash public\assets\skin\niko.png -Algorithm SHA256).Hash.ToLower()
# 预期：715b4826eb9c7f0dd609a4cbad2cef5d130bf3f47fe323649350d5e2d7df705c
```

### 6.3 桌面截图（透明/裁切的唯一有效证据）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\screenshot.ps1 -Out qa-M<N>-<scenario>.png
```

> 本机执行策略会拦截未签名 `.ps1`（直接 `& .\tools\screenshot.ps1` 会报 `UnauthorizedAccess`）；必须加 `-ExecutionPolicy Bypass` 或使用内联 `CopyFromScreen`。这是 QA 工具链缺口，建议 tools 所有者后续补一个签名/`.cmd` 包装或文档化。

### 6.4 启动独立 QA 实例（需要用户确认；不要覆盖用户实例）

```powershell
cmd /c 'set "ELECTRON_RUN_AS_NODE=" && cd /d "<repo>" && start "" "<repo>\node_modules\electron\dist\electron.exe" --no-sandbox --user-data-dir="<repo>\.scratch-userdata-qa" --remote-debugging-port=9223 --debug-walk .'
```

- `--debug-walk` 会加 `?nikoDebug=1`，暴露 `window.__niko`。
- 独立 `--user-data-dir` 避免和用户实例争单实例锁；**测试结束后只关这个 QA 实例**。
- 当前用户实例**没有**开 `--remote-debugging-port`，所以现在无法 CDP；不要为了 CDP 去重启它。

### 6.5 CDP 检查（端口 9223）

```powershell
node tools\m1-accept.mjs 9223      # forceWalk 左右、stopWalk、截图
node tools\m1-pose.mjs 9223        # 走路/待机姿态
node tools\m2-visual.mjs 9223      # stretch / torch / close / getParticles
node tools\bread-shot.mjs          # 吃面包截图（需先通过 CDP 触发 window.__niko.eat()）
```

注意（只记录，不修改 tools）：

- `tools/reload-capture.mjs` 和 `tools/test-press-cdp.mjs` 仍使用 `window.__nikoViewer`，当前构建已改为 `window.__niko.viewer`；这两个脚本需要 tools 所有者更新后才能作为回归使用。
- 关闭/粒子类 CDP 截图是白底，不能替代桌面截图；需要同时抓 OS 级截图。
- `window.__niko` 提供的调试入口：`getState()`、`forceWalk()`、`stopWalk()`、`stretch()`、`eat()`、`toggleTorch()`、`forceClose()`、`photo()`、`getTorch()`、`getParticles()`。

### 6.6 日志与产物检查

```powershell
# 关键事件
Select-String .scratch-userdata-qa\logs\main.log -Pattern 'pet shown|pet hidden|pet restored|press|release|drag|torch|close|auto torch|photo saved|ERROR|WARN'

# 粒子/关闭时间线
Select-String .scratch-userdata-qa\logs\main.log -Pattern 'close gathering|close burst|pet close completed'

# 拍照产物
Get-ChildItem "$env:USERPROFILE\Pictures\NikoPet" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,Length,LastWriteTime

# resize 风暴/内存（性能项）
(Get-Content .scratch-userdata-qa\logs\main.log | Select-String 'pet resize guard').Count
Get-Process electron | Select-Object Id,CPU,WorkingSet64,StartTime
```

### 6.7 打包回归（当前 BLOCKED，实现后补）

```powershell
# 当前 package.json 没有 dist 脚本，以下仅为未来验收占位
pnpm dist
Test-Path release\*.exe
```

验收时需在**干净目录/另一 Windows 用户配置**下验证：资产路径、托盘图标、自启、单实例、相机/截图、安装/卸载。

---

## 7. 最高风险的 5 个 QA 缺口

### R1（P0）当前不可观测 + 托盘单击缺失

宠物从 13:39:14 起隐藏到托盘；桌面截图看不到；当前没有 CDP；托盘**单击无效**，只能双击/右键找回。结果是：**本轮无法对透明、裁切、文字、点击穿透做当前视觉验收**，QA 被冻结在“日志/历史证据”层。用户已把“托盘单击找回”列为下一步优先项，必须在下一里程碑先落地并验收。

### R2（P0）自动火把可能不达标（A07）

- 日志：`screen brightness -> 16` 持续 40+ 分钟，`autoTorch=true`、阈值 30，但**全日志没有 `auto torch` 事件**（Commander Brief §1/§5 也标出同一冷启动风险）。
- 代码：`lastAutoTorchAt` 初始为 `0`，`performance.now()` 在页面加载后 < 10 分钟时必然满足 `now - 0 < 600000` → **每次 renderer 加载后的前 10 分钟不会自动触发**（PRD 与 Brief 都要求“冷启动暗处立即可触发，冷却只在触发后计时”）。
- 状态残留：PRD §5.1 要求“手动打开后一直保持，直到再次长按关闭或**隐藏宠物**”；当前 `closePet()`/`resetAfterRestore()` 没有清 `manualTorch`/`torchOn`。如果关闭时火把是手动开的，恢复后仍算手动开启，自动火把会被永久压住，直到用户再长按一次。
- 声音：`audio.ts` 没有加载/循环 `fireLoop`，PRD 要求的燃烧循环音缺失。
- 结论：A07 目前只能算“手动火把通过”，**自动火把必须重测并很可能要修**。

### R3（P0）验收覆盖严重不足

17 个单测只覆盖 walk / gesture / settings；**A06 面包、A07 自动火把、A11 拍照、A13 性能从未实际跑过**。没有 E2E、没有录屏、没有性能采样；`Pictures\NikoPet` 为空；`bread-eat3.png` 不存在；CDP 截图还是白底。按当前证据量，M2/M3 不能“通过”，只能“有条件部分通过”。

### R4（P0）用户点名的 P0 功能仍缺失（A10/A12/A14）

全屏探头、首启向导、完整设置、自启、坐/睡/赖床、挥手/跳舞/转圈、自定义动作快捷键、便携 exe/NSIS 全部未实现或只有字段占位。尤其 **A10 全屏探头**和 **A12 托盘单击**是 Commander Brief 的 **P0-1 首个可见交付**；A14 完全没有打包链路（P0-4）。按 PRD §14 与 Brief §3 的退出条件，M2/M4 门禁不成立。

### R5（P1）环境/工具/稳定性风险

- 只有**单显示器**，多显示器/跨屏拖拽/DPI 变化只能算“代码级支持”，未实测。
- **点击穿透到下层窗口**从未验证；M0 报告也把它列为未完成。
- `pet resize guard` 在 15,719 行日志里刷了 **12,034 条**，拖拽时每秒数十条；可能是 OS/DPI 反馈循环，至少是日志/性能风险。
- `screenshot.ps1` 被执行策略拦截；`reload-capture.mjs`/`test-press-cdp.mjs` 使用已不存在的 `window.__nikoViewer`；CDP 需要重启/新实例才能开端口。
- 当前跑的是按目录名/内容判断为 QA 的 `.scratch-userdata` 配置（`size=500`、`firstRun=true`），不是用户正式配置；真实用户状态未覆盖。

---

## 8. 用户验收问题（5–8 个，带选项/推荐）

> 这些是 QA/验收层的问题，不重复 DSH 界面里已经在问的“托盘单击行为”本身（显示/隐藏切换、只显示、打开设置）。每条都可以直接回复字母；推荐项默认用于下一轮 QA 计划和报告模板。

### Q1 修复顺序：自动火把 + 托盘单击 vs. 继续 P0 新功能？

| 选项 | 内容 |
|---|---|
| A | 先暂停新功能，修完 A07 自动火把 + 托盘单击再做别的（质量优先） |
| B | 按原计划先补全屏探头/设置/打包，A07 记为已知问题 |
| C | **并行**：A07 + 托盘单击作为 P0 热修，其他 P0 功能继续（推荐） |
| D | 先由用户确认是否接受 A07 现状，再决定 |

**推荐：C。** 理由：这两个问题阻断 QA 可观测性/核心体验，但不需要推翻 P0 路线。

### Q2 自动火把的“首启 10 分钟静默”是否保留？

| 选项 | 内容 |
|---|---|
| A | **去掉**：页面加载即可触发，冷却只在触发后计时（推荐，符合 PRD 与 Commander Brief §5 的硬要求） |
| B | 保留：首启 10 分钟内不自动举火把，日志/设置里说明 |
| C | 做成设置项，默认 0 分钟 |
| D | 只保留手动长按，取消自动火把 |

**推荐：A。**

### Q3 关闭/托盘恢复后，火把和手动状态怎么处理？

| 选项 | 内容 |
|---|---|
| A | **重置**：恢复后火把关闭、手动状态清除、粒子/吃面包清空，回到干净待机（推荐，符合 PRD §5.1“隐藏宠物”即结束手动火把） |
| B | 保留关闭前的火把状态（用户开着火把，恢复后继续） |
| C | 由设置项决定“恢复时是否保留火把” |
| D | 恢复时先伸懒腰/探头再回到待机 |

**推荐：A。** 理由：状态可预测，避免自动火把被残留 `manualTorch` 永久压住。

### Q4 当前隐藏的宠物怎么恢复做视觉验收？

| 选项 | 内容 |
|---|---|
| A | 用户/Lead 用托盘**双击**「显示 Niko」，我立即做桌面截图（推荐：不重启、不改状态） |
| B | 先实现托盘单击，再验收 |
| C | 用户确认后，启动**独立 userData** 的 QA 实例（`.scratch-userdata-qa`）验收，不碰当前实例 |
| D | 接受本轮无当前视觉验收，只保留日志/历史证据 |

**推荐：A。** 如果 A 不可行，选 C；不要把当前实例杀掉重启。

### Q5 完整设置/向导本轮做到什么范围？

| 选项 | 内容 |
|---|---|
| A | **完整 PRD §11.1/§11.2**：向导 + 尺寸/昵称/音量/静音/自启/长按/暗处阈值/拍照目录/关于（推荐，质量优先） |
| B | 分两步：本轮先做**首启向导 + 自启 + 尺寸/音量/静音/长按/阈值**，拍照目录/关于下轮 |
| C | 只做自启 + 托盘单击，其余暂缓 |
| D | 全部推迟到 M4 |

**推荐：B**（若时间紧）或 **A**（按“正式品质”目标）；不建议 C/D。

### Q6 自启默认已定 ON（用户最新决策）；安装版/便携版差异怎么定？

| 选项 | 内容 |
|---|---|
| A | **安装版默认 ON、便携版默认 OFF**；设置里可关（推荐，兼容两种交付路径） |
| B | 两种交付都默认 ON；设置里可关 |
| C | 安装版 ON，便携版首次启动时询问 |
| D | 两种都默认 OFF（不符合最新用户决策，仅作回退选项） |

**推荐：A。** 最新用户决策“新安装默认自启 ON、可关”不再重新讨论；这里只定便携版行为。

### Q7 多显示器/DPI 怎么验收？

| 选项 | 内容 |
|---|---|
| A | 本机**单屏 + 100/125/150% 缩放**先验收；双屏/跨屏标记 UNTESTED（推荐，当前即可执行） |
| B | 用户提供第二显示器/虚拟屏后再验收 |
| C | 用 Windows“显示设置”临时切分辨率/缩放，逐个跑 A02/A04/A12 |
| D | 接受单屏 125% 结论，双屏不测 |

**推荐：A + C 组合**；双屏未测必须在报告里显式标 BLOCKED，不能写“支持”。

### Q8 打包交付的顺序？

| 选项 | 内容 |
|---|---|
| A | **先便携 exe，再 NSIS 安装包**（推荐，先保证能启动/素材路径/托盘/自启，再做安装器） |
| B | 便携 exe + NSIS 同一轮完成 |
| C | 先源码 zip，再打包 |
| D | 只做便携版，不做安装包 |

**推荐：A。** 安装包会引入自启/路径/SmartScreen 的新变量，放在便携版稳定之后更稳。

---

## 9. 建议的第一个 QA 靶点

按 `docs/COMMANDER-BRIEF.md` §3，**P0-0 就是本基线**，P0-1 才是首个用户可见里程碑。因此 QA 顺序是：

1. **P0-0 阻断**：先把 M2/M3 候选基线验成可信基线（A07 自动火把 + A12 托盘单击恢复 + A11 拍照/设置接线）。
2. **G1 首个可见里程碑**：A12 托盘单击 + A10 全屏探头（四边截图 + 连续录屏 + 用户确认）。
3. **G2 中期**：设置/向导/自启、行为/互动闭环。

### 9.1 P0-0 首选：A07 自动火把（最可能已坏）

**为什么先打它：** 日志已经给出“亮度 16% + autoTorch=true + 40 分钟无 auto torch”的强反例；代码里有首启 10 分钟抑制和关闭后 `manualTorch` 残留两条路；修复成本低、影响核心体验（“暗处自动举火把”是 PRD 主打）。

**验收步骤：**

1. 用独立 QA 实例（或用户确认后在当前实例上）确保 `autoTorch=true`、`darkThreshold=30`、`manualTorch=false`、`torchOn=false`、宠物可见、处于待机。
2. 等下一次亮度轮询（≤20 s）；确认日志出现 `auto torch on for 12–18s (brightness 16)`。
3. 立刻抓 1 张 OS 级桌面截图 + 录屏 20 s：火把在右手、暖光只照角色、不压暗桌面、火星/光摇曳。
4. 计时：12–18 s 内自动收起；日志无异常；关闭火把音效可闻。
5. 手动长按 1.5 s 打开火把 → 确认手动优先、自动不再抢；隐藏宠物 → 恢复后手动状态应清除（按 Q3 的推荐 A）。
6. 10 分钟冷却：再次变暗事件不应早于 10 分钟触发；到点后允许再触发一次。
7. **通过标准：** 以上 1–6 全部满足；任一条不满足即 FAIL，并在报告里附日志时间线 + 截图。

### 9.2 G1 首个可见目标：A12 托盘单击 + A10 全屏探头

- 托盘单击：按 Commander Brief Q4 的**推荐 A：单击只负责找回，已显示时保持显示**（具体以用户回答为准）；从隐藏状态一键找回，日志有 `pet shown`。
- 全屏探头：当前 DSH 窗口覆盖整屏（截图中无任务栏），是**现成的真实全屏场景**；实现后确认宠物停止底部走动、身体沉到屏幕外、20–45 s 随机边缘探头 4–8 s、退出全屏恢复。用 OS 级录屏证明“不挡主画面”，并补上/下/左/右四边截图。

### 9.3 第三目标：A06/A11/A13 的“从 0 到 1”验收

- 面包：用 `window.__niko.eat()` 在 30 s 内强制触发，抓掏出→4 口→屑→打嗝→爱心全流程；不要等 8–20 分钟随机。
- 拍照：按 `Ctrl+Alt+P`，确认 `Pictures\NikoPet\Niko-YYYYMMDD-HHmmss.png` 生成、含桌面背景、无 UI/水印、拍完动作恢复。
- 性能：可见待机 60 s + 走路 60 s + 隐藏 60 s，采样 CPU/WorkingSet；确认待机 <3%、走路 <8%、隐藏不持续渲染。

---

## 附录 A：证据索引（本轮新增）

| 文件 | 时间 | 内容 | 限制 |
|---|---|---|---|
| `artifacts/qa-baseline-desktop-1.png` | 13:48:15 | 构建前桌面截图，宠物不可见 | DSH 覆盖任务栏；不能看托盘 |
| `artifacts/qa-baseline-desktop-final.png` | 13:51:12 | 构建后桌面截图，宠物仍不可见 | 同上 |
| `artifacts/qa-crop-topcenter.png` | 13:48:32 | 顶部中央区域放大：是 DSH 头像，不是宠物 | 防误判 |
| `artifacts/qa-crop-bottom.png` | 13:48:32 | 底部区域放大：DSH 内容，无任务栏 | 证明任务栏被覆盖 |
| `artifacts/qa-printwindow-hidden.png` | 13:49:31 | 隐藏窗口 `PrintWindow` 全黑 | 不能作为视觉证据 |
| `artifacts/qa-m1-right-crop.png` | 13:50:42 | 历史桌面截图右侧放大（聊天内嵌图） | 不是当前宠物，勿作为验收证据 |
| `artifacts/qa-m1-leftbottom-crop.png` | 13:50:42 | 历史桌面截图左下放大（DSH 壁纸） | 不是宠物 |
| `artifacts/qa-petlive-bottom-crop.png` | 13:50:42 | 历史截图局部 | 仅辅助定位，非验收 |
| `artifacts/pet-topmost.png` | 2026-10-20 23:08 | 历史桌面叠加：透明、置顶、无黑底 | 旧构建；非当前；用户未确认 |
| `artifacts/m2-torch.png` / `m2-stretch.png` / `m2-close.png` | 2026-10-20 23:56 | 火把/伸懒腰/紫粒子 | CDP 白底，不能证明透明 |
| `artifacts/m1-settings.png` | 2026-10-20 23:46 | 设置页截图（version 0.0.0、仅大小/音量） | 旧版；不是本轮 |
| `artifacts/m0-final.png` / `m1-idle2.png` / `m1-walk-left2.png` / `m1-walk-right2.png` | 2026-10-20 | 皮肤/待机/走路单帧 | CDP 白底；非当前 |
| `docs/streams/BEHAVIOR-AUDIT.md` / `INTERACTION-AUDIT.md` / `PLATFORM-AUDIT.md` | 2026-10-21 13:56 | 其他 worker 的只读审计 | 本轮未逐条复核；用于交叉验证，不替代本矩阵的实机状态 |

> 当前桌面的 1536×960 截图为 DPI 虚拟化后的逻辑尺寸；物理分辨率约 1920×1200（125%）。所有窗口 rect 为同一逻辑坐标系。

## 附录 B：关键源码引用（只读审计）

| 位置 | 事实 |
|---|---|
| `src/main/tray.ts:55-58` | 仅注册 `double-click` 显示；**没有 `click`** |
| `src/main/pet-window.ts:413-415` | `sizeForArea()` 把窗口 clamp 到 workArea 的 min(width,height) |
| `src/main/index.ts:17-23` | 单实例锁 + 第二实例唤起 |
| `src/main/index.ts:42-77` | 拍照 IPC / 全局快捷键 / desktopCapturer 调用；拍照前冻结 160 ms |
| `src/main/photo.ts:20-35` | 拍照固定写 `app.getPath('pictures')/NikoPet`，**未使用 `photoDir`**；找不到 source 时 fallback 到第一屏 |
| `src/renderer/pet.ts:67` | `lastAutoTorchAt = 0`（配合 §149 的 10 分钟判断，形成首启静默） |
| `src/renderer/pet.ts:138-161` | 自动火把：阈值、手动优先、12–18 s、10 分钟冷却 |
| `src/renderer/pet.ts:169-207` | `closePet()` / `onRestored` **没有清 `manualTorch`/`torchOn`** |
| `src/renderer/audio.ts:16-18` | 预加载声音列表**没有 `fireLoop`**；PRD 的燃烧循环音缺失 |
| `src/renderer/animator.ts` | 有呼吸/眨眼/glance/pet/stretch/eat；**没有坐/睡/赖床/挥手/跳舞/转圈** |
| `src/shared/gesture.ts:14-17` | 1500/2400/3000 ms 是常量；`longPressMs` 设置未接入 |
| `src/shared/settings.ts:20-34` | `firstRun/autostart/longPressMs/particles/photoDir/lastDisplayId/lastX` 等字段存在 |
| `src/renderer/settings.html` / `settings.ts` | UI 只有 size + volume；没有向导/自启/静音/阈值/拍照目录 |
| `src/main/index.ts` | 没有 `setLoginItemSettings`、没有全屏检测、没有向导窗口 |
| `package.json` | 只有 dev/build/test；没有 electron-builder / dist / release |

## 附录 C：本轮操作合规声明

- 未修改 `src/`、`tests/`、`tools/`、`package.json`、`public/` 或任何素材。
- 未杀、未重启、未移动、未点击当前运行实例；未打开设置窗口；未执行“显示 Niko”。
- 构建在 13:48 与 13:51 执行，运行实例 PIDs/StartTime 未变，日志持续写入，说明没有重启。
- 只新增 `docs/QA-BASELINE.md` 与 `artifacts/qa-*` 截图/裁剪；测试自身临时备份目录已由测试清理。
- 13:55 出现 `docs/COMMANDER-BRIEF.md` 后已补读，并据此更新 P0-0/P0-1 顺序、托盘单击推荐、证据包要求与自启问题；未据此改任何源码。
- 如需在下一轮恢复宠物做视觉验收：按 §5.4 操作，或由用户确认后使用 §6.4 的独立 QA 实例。

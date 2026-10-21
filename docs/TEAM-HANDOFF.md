# TEAM-HANDOFF — Niko Pet 3D 当前进度与分工

> 给所有 DeepSeek 工作对话和 Codex 指挥部的交接文档。最后更新：2026-10-21。
> 项目根：`C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d`

## 1. 项目目标

Windows 本地自用 3D 桌宠：用户自己的 Minecraft 皮肤（64×64 Slim 双层），Electron + Three.js + skinview3d。底部任务栏上方走动/待机；可伸懒腰、吃 Minecraft 面包、暗处自动举火把、长按关闭并留下紫色 MC 粒子、拍照；托盘常驻；最终交付便携 exe + NSIS 安装包 + 源码。

**不做公开分发**。Minecraft 音效/贴图和鲸鱼娘音效只在本机使用，不发布、不再分发。

## 2. 稳定基线

- Git 回滚锚点：`0c8cb8c`（M1 完成）。
- 当前检查点：`994906c`（M2/M3 代码 + 团队 handoff/SKILLS + Codex brief + 四流审计 + `src/shared/contracts.ts`）。构建和 17 个测试通过；M2/M3 的桌面验收仍以 G1 报告为准。
- 当前工作区可能在 worker 实现中再次变脏；每个 worker 只改自己的 write scope，Lead 逐个集成。
- Electron **锁定 44.7.0**：本机 44.9.1 在 Windows 11 26200 上 `app.whenReady` 不触发。不要升级/换版本。
- 仅本地开发；不要发布、不要动 `%APPDATA%\.minecraft` / `~/.dsh`。

## 3. 已实现（以代码和实际运行为准）

| 模块 | 状态 |
|---|---|
| 透明/无边框/置顶/跳过任务栏窗口；点击穿透 + 命中测试 | 已实现，M0/M1 实测 |
| Slim 双层皮肤、3/4 视角、待机/走路/摆臂/转身/眨眼/视线跟随 | 已实现 |
| 单击摸头/歪头/闭眼；按下压扁（1.05/0.88，220ms 回弹）+ Ya1/Ya2 | 已实现 |
| 底部任务栏行走、边缘反弹、30fps、多显示器基础 | 已实现 |
| 长按 1.5s 切换火把；继续到 2.4s 聚粒子、3s 关闭；全屏紫粒子后隐藏托盘 | 已实现（M2） |
| 拖拽（250ms 后启动）、跟手、落回任务栏；伸懒腰 | 已实现（M2） |
| 面包道具、咬 4 口、碎屑/爱心、咀嚼/打嗝声、随机 8–20 分钟 | 已实现（M3 代码，需验收） |
| 屏幕亮度 WMI 检测；暗处自动火把 12–18s；手动长按优先 | 已实现（M3 代码，需验收） |
| 拍照 `Ctrl+Alt+P`、冻结、桌面背景、保存到 `图片\NikoPet` | 已实现（M3 代码，需验收） |
| 头部俯仰约 ±60°、左右约 ±55°、自然随机抬头/低头 | 已实现 |
| 托盘菜单（显示/隐藏、设置、拍照、退出）、单实例 | 已有，但托盘目前双击显示，未单击 |
| 设置页（大小/音量/保存/关闭） | 极简骨架，非正式版 |
| 首启向导、自启、完整设置、全屏探头、坐/睡/赖床、玩具/喂食、自定义快捷键、安装包 | **未完成** |

## 4. 用户最新决策（2026-10-21 问答）

- P0：**先补齐缺失功能**（全屏探头、设置/向导/自启、安装包、坐睡、互动、快捷键）。
- Codex：**只做规划、评审、验收**；DeepSeek 写代码。
- 团队：**4 个 DeepSeek 工作对话** + Lead 集成：互动 / 行为视觉 / 平台发布 / QA。
- 质量：动画细腻度、视觉质感、行为智能、系统集成、稳定性/性能、安装分发全部要。
- 美术：**保留 MC 方块风**，强化动画、光影、粒子和镜头。
- 活跃度：**可配置，默认低打扰**。
- 系统：静音/音量/音效开关、暗处自动火把、多显示器/DPI、全屏探头；**开机默认自启**（用户补充，设置里要能关闭）。
- 交付：便携 exe + NSIS 安装包 + 源码 zip。
- 验收：每个里程碑汇报 + 截图/录屏，用户确认后继续。
- 重启：开发中可随时重启桌宠；设置和照片要保留。
- 提问：**每个功能点都要问**，多给选项。
- 参照：原版 MC 生态 + Shimeji 的行为密度。
- 下一阶段先看到：**全屏探头 + 托盘单击找回**。
- 额外：**自定义快捷键让桌宠做某项动作**。

## 5. 团队分工与写权限

> 先做只读审计，等 Codex 指挥部路线图和用户确认后再写代码。任何写代码任务必须带 write scope。

- **interaction-dev（互动）**
  - 所有权：`src/renderer/gestures.ts`、`src/shared/gesture.ts`、`src/renderer/particles.ts`、`src/renderer/torch.ts`、`tests/gesture.test.ts`
  - 方向：手势状态机、长按/拖拽/关闭、火把、紫粒子、动作快捷键的 renderer 侧动作接口。
- **behavior-dev（行为视觉）**
  - 所有权：`src/renderer/animator.ts`、`src/renderer/bread.ts`、`src/renderer/snacks.ts`、`src/renderer/pet.ts`（renderer 集成）
  - 方向：坐/睡/赖床/起床、喂食/玩具/摸头反馈、待机微动作、头部/视线/光影、面包。
- **platform-dev（平台发布）**
  - 所有权：`src/main/**`（除 `index.ts` 的集成冲突先报备）、`src/renderer/settings.*`、`src/preload/index.ts`、`electron-builder` 配置、`package.json` 打包脚本
  - 方向：托盘单击显示、全屏检测/探头窗口、完整设置/首启向导、自启、自定义快捷键注册、安装包/便携版。
- **qa-visual（QA/视觉）**
  - 所有权：`tests/**`（新增 QA 测试）、`tools/**`、`docs/QA*`
  - 方向：基线验收、截图/录屏、CDP 检查、回归清单、每个里程碑的验收报告。**不改 src**。
- **Lead（集成）**
  - 负责 `src/main/index.ts`、`src/main/ipc.ts`、跨模块接口、合并、最终构建和产物。
  - 先审计/任务板，再合并；不直接抢 worker 所有权文件。
- **Codex 指挥部**
  - 只写 `docs/COMMANDER-BRIEF.md` / 评审意见；不直接改源码。
  - 负责路线图、任务拆分、接口约定、验收标准。

## 6. 构建、测试、启动

```powershell
cd C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d

# 推荐：绕过 pnpm 的 deps status 检查（本机 pnpm 有时会在无 TTY 下卡 install）
cmd /c "node_modules\.bin\electron-vite.cmd build && node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
cmd /c "node_modules\.bin\vitest.cmd run"
```

如果 `pnpm install` 需要非交互：`cmd /c "set CI=true&& pnpm install --store-dir .pnpm-store/v11"`。
不要重新安装 Electron 后丢掉 `node_modules/electron/dist` 的 44.7.0 二进制；如丢失，从 `.scratch/electron447` 恢复。

**启动真实 GUI**（Agent shell 直接 GUI 受限；`Start-Process` 可能挂起）：

```powershell
# 已实测可用：cmd start 脱离启动
cmd /c 'set "ELECTRON_RUN_AS_NODE=" && cd /d "C:\...\niko-pet-3d" && start "" "C:\...\niko-pet-3d\node_modules\electron\dist\electron.exe" --no-sandbox --user-data-dir="C:\...\niko-pet-3d\.scratch-userdata-live" --debug-walk .'
```

- 不要升级 Electron；不要用 `pnpm dev` 在 Agent 里等 GUI。
- `--debug-walk` 会在页面 URL 加 `?nikoDebug=1`，暴露 `window.__niko`；远程调试端口需单独确认。
- 计划任务有时会 `Queued`（用户会话/调度器状态），`cmd start` 更可靠。
- 当前运行实例可能来自 `.scratch-userdata-live`，大小 400；不要无故重启或杀掉。

## 7. 关键文件/资产

- 皮肤：`public/assets/skin/niko.png`（Slim 双层，SHA256 `715B...705C`），不要改。
- 鲸鱼音效：`public/assets/whale/Ya1.mp3`、`Ya2.mp3`，不要改。
- MC 资产：`public/assets/vanilla/{sounds,textures}`，`ASSETS.json`；本地自用。
- 交互：`src/shared/gesture.ts`、`src/renderer/gestures.ts`。
- 动画：`src/renderer/animator.ts`；视角/皮肤：`src/renderer/viewer.ts`。
- 主进程：`src/main/pet-window.ts`、`ipc.ts`、`tray.ts`、`settings*.ts`、`brightness.ts`、`photo.ts`。
- 设置/向导：`src/renderer/settings.html/css/ts`（待重做）。
- 交付：尚无 `electron-builder` 配置；`package.json` 只有 dev/build/test。
- 文档：`docs/PRD.md`、`docs/TECH-PLAN.md`、`docs/DECISIONS.md`、`docs/M2-TASK.md`、`M0/M1-REPORT.md`。

## 8. 已知坑

1. Electron 44.9.1 挂起；必须 44.7.0。
2. `ELECTRON_RUN_AS_NODE=1` 会让 Electron 变 Node；启动前清空。
3. `NO_PROXY`/`no_proxy` 等大小写重复会让 `Start-Process` 失败；清掉小写代理变量或直接用 `cmd start`。
4. 透明窗口把 `window.innerWidth` 回灌给 viewer 会造成横向放大循环；只在初始/设置变化时 resize。
5. 窗口 resize guard 在关闭全屏粒子时必须跳过（`if (this.closing) return`）。
6. `did-finish-load` 早于 renderer 监听，行走状态会丢；`forceWalk` 要重复发送，加载后 400ms 再发一次。
7. 走路朝向不能做成背对镜头；当前 yaw 目标 0.28 / -0.45。
8. 压扁 pivot 在脚底，回弹 220ms `cubic-bezier(.34,1.56,.64,1)`。
9. 关闭时 2.4s 聚粒子、3.0s 爆发、1.2s 后隐藏；主进程 close timer + renderer 都要容错。
10. 火把只照角色（PointLight 挂右手），不做桌面暗角。
11. 没有文字/气泡/名字在桌宠画布上。
12. 用户会话/任务调度器可能让计划任务排队；GUI 验收用 `cmd start`，CDP 需确认端口。

## 9. 验收基线（当前）

- `node_modules\.bin\vitest.cmd run`：17/17 通过（M2 手势 8 个）。
- `electron-vite build` + `tsc --noEmit`：通过。
- 已目视：透明窗口、Slim 双层、待机/走路/摸头/压扁、火把、紫粒子关闭、面包/头部（部分截图在 `artifacts/`）。
- 待目视/回归：拖拽、长按真实时序、托盘单击/双击、设置保存、拍照快捷键、自动火把、全屏探头、安装包。

## 10. 用户第三轮决策（2026-10-21 追加）

- **关闭提示**：长按 3 秒关闭后，不用托盘气泡；桌宠从屏幕左/右/下随机边缘**只伸出手和 Minecraft 告示牌**，不露身体。告示牌英文 `I'M IN THE TRAY`。每次关闭都出；紫色粒子结束后 2.5 秒出，然后缩回托盘。点击告示牌/手直接把桌宠叫回桌面。
- **托盘**：单击=显示 Niko；双击=打开设置；右键菜单保留“隐藏 Niko”；隐藏的主要手势仍是长按 3 秒。
- **全屏探头**：底部 + 左右随机；20–45 秒一次，每次 4–8 秒；头部跟随鼠标；点击头部后回到底部任务栏上方 10 秒，再继续探头；出现在当前全屏应用所在显示器。
- **睡眠**：跟随系统空闲，20 分钟无操作后困倦；坐姿打盹、头一点一点；点击/摸头唤醒，赖床 2–4 秒再起身。
- **默认活跃度**：5–15 分钟一次小动作；可配置。
- **自定义快捷键**：第一批动作=显示/隐藏、喂食、设置、拍照、跳舞/转圈/挥手、火把、睡觉/叫醒、摸头/互动；团队选无冲突的 Ctrl+Alt 组合，并在设置/托盘/文档明确标注。
- **食物**：面包、曲奇、苹果、鱼/熟鱼；入口=快捷键 + 托盘菜单 + 设置动作列表；玩具暂缓，先优化核心。
- **性能模式**：三档。简约=关 AO/描边/AA、降粒子、30fps；普通=AO+待机微动作；华丽=全开+60fps。默认普通，设置里可切。
- **安装**：便携版 + 当前用户安装（无需管理员）；设置留 AppData，照片留图片目录，卸载默认不删。
- **QA 证据**：用户选择“远程看实时演示”；里程碑需要现场演示 + 截图/短录屏辅助，不能只发文字结论。
- **360° 转身与视线（2026-10-21 追加，最新口径）**：**只有点击桌宠后的 2 秒内**头/身体才看向鼠标（头先、身体 360° 最短路径跟上，0.8–1.2 秒、原地小碎步 + 轻微重心偏移）；**其余时间自由活动**，不持续追鼠标。走路不看鼠标、身体朝移动方向；吃/伸懒腰/拖拽/坐睡/探头/关闭时动作姿态优先。头局部 yaw ±55°、pitch ±60°，身体补足 360°，禁止瞬间跳转/连续过冲。**全屏探头同样只在点击头部后 2 秒内看鼠标**；其余时间自由/随机。空闲自由活动只做**偶尔小幅随机侧看/小转身**，不高频完整 360° 背对镜头；完整 360° 用于点击后的 2 秒看鼠标窗口和明确动作。

## 11. 下一步（P0）

1. 托盘单击显示 + 全屏自动探头（先给用户看到）。
2. 关闭告示牌提示（手+sign，无身体）。
3. 完整设置 + 首启向导 + 自启（默认开，可关）。
4. 坐/睡/赖床/起床，默认低打扰。
5. 喂食/摸头反馈、自定义动作快捷键。
6. 便携 exe + NSIS 安装包 + 源码 zip。
7. 每个功能点先问用户选项，再实现；里程碑做实时演示 + 截图/短录屏。

## 12. “像活物”行为导演决策（2026-10-21 追加）

- 大部分时间自主，偶尔回应；困/烦/忙时可以延迟、装没听见或拒绝，但要有明确动作反馈，不能让人以为坏了。
- 隐形状态：精力 energy + 心情/亲密度 mood/affection + 无聊度 boredom；不显示数值；跨重启记忆上次互动、睡醒节奏、亲密度。
- 自主活动：沿任务栏散步/停下看风景、伸懒腰/打哈欠/发呆、整理自己/摸帽子/拍衣服、主动吃面包/曲奇/苹果、坐/打盹/睡觉/赖床起床；玩具暂缓。
- 主动社交：偶尔走到鼠标/窗口附近待一会儿再走；低打扰。
- 过度摸头：先享受，再躲/扭头/轻轻抗议，不真的离开。
- 性格：慵懒 + 好奇 + 亲人的猫系；动作速度/幅度/顺序/小概率变体，不要机械重复。
- 微动作：呼吸/重心、眨眼/眼神游移、歪头/看不同方向、脚趾/脚掌轻点、帽子/衣角轻晃、偶尔小声呼噜/叹气。
- 活动范围：任务栏上方 + 屏幕左右边缘，不挡桌面中心。
- 看鼠标仍只在点击后 2 秒内；走路不看鼠标；自由空闲只偶尔小幅随机侧看/小转身。全屏探头同样只在点击头部后 2 秒看鼠标。
- 实现分 L1 生命模型+微动作+自主 idle，L2 反应/拒绝/过度摸头，L3 边缘漫游/靠近鼠标/长期记忆。task-12，等 task-10 完成后开工。

# HANDOFF — 给下一个智能体（Niko Pet 3D）

> 交接时间：2026-10-21 14:40（Asia/Shanghai）
> 项目根：`<repo>`
> Git：`79e92ae`（team checkpoint），工作区在该提交后应保持干净；先跑 `git status` 确认。
> **不是**工作区里旧的 PySide6 / 2D 项目。进入目录后先确认 `src/renderer/animator.ts`、`pet.ts`、`sign.ts`、`src/main/peek.ts` 存在。

## 1. 当前机器状态

- 桌宠当前仍在桌面上运行：主进程 PID `35016`，窗口 `0,48,923×920`，userData `.scratch-userdata`。
  **不要无故杀它**；需要重启时用 `docs/SKILLS.md` 的 `cmd start`，保留 `.scratch-userdata`（settings/照片）。
- 最后门禁（14:39）：
  - direct `electron-vite build`：exit 0
  - `tsc --noEmit -p tsconfig.json`：exit 0
  - `vitest run`：**5 files / 50 tests passed**
- Electron 锁定 **44.7.0**；不要升级（44.9.1 本机 `app.whenReady` 挂起）。
- 资产本地自用，不发布/不再分发；不要改 `public/assets/skin/niko.png`、`public/assets/whale/*`。

## 2. 已完成并提交

- 透明/置顶/跳过任务栏窗口、点击穿透 + 命中、底部行走、多显示器基础。
- Slim 双层皮肤、待机/走路/眨眼/视线、单击摸头、按压压扁/回弹、拖拽、伸懒腰。
- 长按 1.5s 火把、3s 关闭 + 紫粒子 + 托盘隐藏/恢复；面包/吃、暗处自动火把、拍照。
- **最新行为规则**：只有点击桌宠后约 2 秒内看鼠标；走路完全不看鼠标；空闲偶尔小幅随机侧看/小转身；允许 360° 最短路径转身；全屏探头同样只在点击头部后 2 秒看鼠标。
- **全屏 head-only 探头** renderer 已实现：`FullscreenState` 驱动，隐藏 body/arms/legs，只保留 head+hat；点击头部回底部 10s 再探头；退出全屏恢复。
- 平台：托盘单击显示、双击设置、右键隐藏；C# fullscreen helper + PowerShell fallback；PeekController 20–45s/4–8s、bottom/left/right、当前全屏显示器；resize guard 自激修复。
- 设置 v2：activityLevel/performanceMode、randomActions/actionSounds、fullscreenPeek/peekFrequency、sleep 字段、closeSignEnabled、startHidden、hotkeys；v1→v2 迁移，新装默认 autostart=true、旧配置保留；QA 50 测试通过。
- HotkeyManager 骨架 + main 已接 10 个默认快捷键；system action photo/settings/togglePet 由 main 执行，其余发 `pet:action`；walk pause IPC 已接。
- 互动修复：早期抖动不再永久取消长按、`longPressMs` 真实生效、TorchController 隐藏/关闭静音熄火、action bus 10 个 ActionId。
- 所有审计/报告/提示词已提交：`docs/streams/*`、`docs/QA-SETTINGS-V2.md`、`docs/COMMANDER-BRIEF.md`、`docs/CODEX-RESUME-PROMPT.md`、`docs/SKILLS.md`。

## 3. 未完成 / 交接时正在做

### G1（首个用户可见里程碑）未最终验收
- 代码已接：托盘、全屏检测、peek、head-only、360/2s 规则。
- **没有 QA 实机报告**（task-9 被中断，`docs/QA-P0-1.md` 未产生）。
- 必须实机验证：单击托盘找回、F11/视频全屏四边探头、只有头、点击头部回底部 10s、退出全屏恢复、resize guard 日志不再刷屏、125% DPI。
- `docs/QA-BASELINE.md` 有原基线；`qa-visual` 已停。

### 关闭告示牌（P0-1b）只完成了 renderer
- `src/renderer/sign.ts` 已完成：手+木牌、英文 `I'M IN THE TRAY`、left/right/bottom entering/holding/leaving、无身体、点击回调。
- **main/preload 没有接**：`task-14` 被中断，`src/main/pet-window.ts`/`src/preload/index.ts` 没有 close-sign 通道；当前关闭仍在粒子后约 1.2s 直接隐藏。
- 需要：`onCloseSign(CloseSignState)`、`revealFromCloseSign()`、main 在粒子后 2.5s 缩小窗口到边缘、发 entering/holding/leaving、可点击、点击后 `show()`；contracts 已有 `closeSign`/`closeSignReveal`。

### Life Director（“像活物”）只写了一个未接线文件
- `src/renderer/life.ts` 约 32KB，`tsc` 通过，但**未导入 pet.ts/animator.ts、未跑运行时、未写 `BEHAVIOR-LIFE.md`**；task-12 被中断。
- 需要：检查/测试 LifeModel（energy/mood/affection/boredom、localStorage 持久化）和 BehaviorDirector；再按 L1/L2/L3 接 animator/pet。不要直接相信它已可用。
- 用户要求：大部分自主、偶尔回应、困/烦/忙可延迟/拒绝、慵懒好奇亲人猫系、动作变化、微动作、过度摸头先享受再扭头、跨重启记忆、任务栏+左右边缘漫游、低打扰默认。

### 其余未做
- 完整设置 UI、首启向导、真正应用 autostart、快捷键编辑器 UI、设置保存后 HotkeyManager.apply 回滚提示。
- 坐/打盹/睡觉/赖床起床（只有设计/audit），喂食/玩具/摸头完整反馈（feed 目前复用面包动画；dance/wave/sleep/wake 返回 behavior-lock）。
- 性能三档真正影响 renderer（settings/contracts 已有字段，渲染接线未完成）。
- 便携 exe + NSIS + source zip、图标、干净 profile 验收、源码文档。
- 多显示器/混合 DPI 实机、pitch 极限穿模、360/2s 视觉 QA。
- Codex 对 interaction 的评审结论是 **BLOCK（端到端验收）**；action IPC 后来已接，但未重新评审；`docs/reviews/INTERACTION-P0-1-REVIEW.md` 内容很简略，建议重做评审。

## 4. 团队/任务板交接

所有 DeepSeek 队友已停止（inactive）。共享任务：
- task-1/2/3/4/5/6/7/10/11/13：completed（审计、P0-1 platform/interaction/behavior、task-10 renderer、settings v2、QA settings）。
- task-8（Lead 集成/G1）：in_progress，**无 G1 报告**。
- task-9（QA G1）：in_progress，**无报告**。
- task-12（Life Director）：in_progress，只有未接线 `life.ts`。
- task-14（sign main）：in_progress，**未写 main/preload 通道**。
- 下个智能体应先 `team_task_list`，把这些 in_progress 任务收尾/重开/关闭；不要直接假设它们完成。

## 5. 用户已确认的关键决策（不要重问，除非冲突）

- 技术：Electron + Three.js + skinview3d；3D；Slim 双层 64×64；固定 3/4 视角；底部任务栏活动；第一阶段先补功能。
- 点击=摸头；压扁/回弹；长按 1.5s 火把、3s 关闭+紫粒子；拖拽；紫粒子紫色 MC 风。
- 头只在点击后 2s 看鼠标；走路不看；空闲自由活动/偶发小幅随机侧看；可 360° 最短路径；全屏探头同一 2s 规则。
- 关闭：从屏幕左/右/下随机只伸出手 + 木牌 `I'M IN THE TRAY`，不露身体；每次关闭；粒子后 2.5s；点牌叫回。
- 托盘：单击显示、双击设置、右键隐藏；隐藏主要靠长按。
- 新装默认开机自启，可关；性能三档：简约/普通/华丽；默认低打扰。
- 交付：便携 exe + 当前用户 NSIS 安装包 + source zip；设置留 AppData、照片留图片目录、卸载默认不删。
- 质量：动画细腻度、视觉质感、行为智能、系统集成、稳定性/性能、安装分发都要；保留 MC 方块风。
- “像活物”：精力/心情/亲密度/无聊度、自主散步/发呆/整理自己/打哈欠/吃面包、偶尔靠近、过度摸头扭头、动作变化、跨重启记忆。
- 每个功能点先问用户 2–4 个选项；里程碑做**实时演示 + 截图/短录屏**，用户确认后再下一步。

## 6. 下个智能体的第一步

1. `cd` 到项目根；`git log --oneline -3` 应看到 `79e92ae`；`git status` 应干净。
2. 读 `docs/CODEX-RESUME-PROMPT.md`（如果是 Codex 指挥部）或本文件（如果是实现/集成智能体）。
3. 跑 direct 门禁（见 §1）。
4. 先处理 G1 实机验收（task-9）或 sign 主进程（task-14）二选一；不要同时改 G1 和 Life Director。
5. 打开 `src/renderer/life.ts`，先决定保留/重写/删除；不要在不理解的情况下接入。
6. 不要覆盖 worker 所有权文件；当前所有队友已停止，若要继续用团队，重新建任务/写 scope。
7. 用户当前实例在桌面；需要重启先征求同意，保留 `.scratch-userdata`。

## 7. 可直接给下一个智能体的提示词

```text
你是 Niko Pet 3D 的接手智能体。项目根：
<repo>
这是 Electron + Three.js + skinview3d 3D 桌宠，不是旧的 PySide6/2D 项目。当前 Git HEAD 应为 79e92ae，工作区应干净。

先读：
docs/HANDOFF-TO-NEXT-AGENT.md
docs/TEAM-HANDOFF.md
docs/COMMANDER-BRIEF.md
docs/CODEX-RESUME-PROMPT.md
docs/SKILLS.md
docs/streams/*（尤其 PLATFORM-P0-1、BEHAVIOR-P0-A/B、INTERACTION-P0-1）
docs/QA-SETTINGS-V2.md

当前关键状态：
- build/tsc/vitest 最后通过（50 tests）；Electron 44.7.0 锁定。
- 桌宠正在桌面运行（PID 35016，userData .scratch-userdata），不要无故杀。
- G1（托盘单击/全屏 head-only 探头/360 但仅点击后 2s 看鼠标/走路不看）代码已接但无 QA 实机报告。
- 关闭告示牌 renderer（sign.ts）已完成，main/preload 链路未接（task-14）。
- Life Director 只有未接线的 src/renderer/life.ts；未验证。
- 设置 v2/热键/walk pause 已接；设置 UI/向导/自启/安装包未做。

先跑：
cmd /c "node_modules\.bin\electron-vite.cmd build"
cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
cmd /c "node_modules\.bin\vitest.cmd run"
如果你看到的是 2D/PySide6 或没有上述文件，立即纠正目录，不要基于旧项目判断。

然后给用户一份简报：当前 verified 状态、G1 下一步、sign/life 的取舍、需要用户拍板的 8–12 个问题（每个 2–4 选项 + 推荐）。不要直接大改，不要升级 Electron，不要动受保护资产，不要杀正在运行的实例；每个功能点先问用户，里程碑要实时演示+截图/录屏。
```

# M2 — 手势、火把、关闭紫粒子、伸懒腰（给 Codex）

> 先读 `AGENTS.md`、`M0-REPORT.md`、`M1-REPORT.md`、`docs/PRD.md`、`docs/DECISIONS.md`。
>
> **不要启动可见 GUI 自测**；用 `pnpm build`、`pnpm test`、`tsc` 和纯 Node 验证。真实桌面由 Lead 用 CDP 验证。
>
> **Electron 锁定 44.7.0**；不要升级。

## 目标

把 M1 的单击手势扩展为完整的左键状态机，并实现用户最在意的三个动作：

1. **拖拽**：按住约 250ms 后可拖，窗口跟手，松手落回当前显示器任务栏上方。
2. **火把**：原地按住 1.5s 切换火把（右手持火把、暖光只照角色、点燃/熄灭音效、火焰摇曳）。
3. **关闭**：继续按住到 3s 关闭；2.4s 起角色周围聚紫色 Minecraft 粒子，3s 爆发成全屏紫粒子，约 1.2s 后隐藏到托盘。
4. **伸懒腰**：2.5s 双臂上举、身体后仰、头后仰；可由调试入口触发。

## 非目标（M3/M4）

- 面包、暗处自动火把、拍照、全屏探头、坐/睡、完整设置/向导、安装包。
- 不做桌面暗角；火把只照亮角色模型。
- 不做任何桌面文字。

## 手势状态机（关键）

只响应左键；透明区域不拦截；指针按下后在角色命中区域才生效。

| 时间/事件 | 行为 |
|---|---|
| pointerdown | 压扁（1.05/0.88，脚底 pivot），播 Ya1；开始 250ms 拖拽门、1.5s 火把计时、3s 关闭计时 |
| 移动 >5px 且已过 250ms，且未到 1.5s | 进入拖拽；取消火把/关闭计时；窗口跟手；肢体下垂/摆动 |
| 原地 1.5s | 切换火把（点燃/熄灭音效），保持按住；**不关闭**；到 3s 才关闭 |
| 2.4s | 关闭预览：紫色粒子在角色周围聚集（密度可低） |
| 3.0s | 关闭：角色消失，紫色粒子全屏爆发；窗口扩到当前显示器；约 1.2s 后隐藏到托盘 |
| 松开且未拖拽、未到 1.5s | 单击：摸头/歪头/闭眼/轻摆 + Ya2；不切火把 |
| 拖拽中松开 | 落到当前显示器任务栏上方，落地缓冲 + Ya2 |
| 1.5s 后松开（<3s） | 只切换火把 + Ya2；不关闭 |
| 移动发生在 1.5s 之后 | 不进入拖拽（保持关闭计时），避免误关 |

实现建议：
- 纯逻辑放 `src/shared/gesture.ts`，用 `now`/事件驱动，方便 vitest 覆盖；renderer 只做 DOM 事件和动画。
- 拖拽由 **main** 执行窗口跟随：renderer 发 `pet:drag:start` / `pet:drag:end`，main 用 `screen.getCursorScreenPoint()` 以 60fps 跟随并 clamp；renderer 只负责姿态。
- 关闭时 main 设置 `closing=true`，扩展窗口到 `display.bounds`；**M1 的 resize guard 必须在 closing 时跳过**，否则会被拉回 420。关闭完成后恢复 compact bounds 并 `hide()`。
- 关闭窗口全屏但 `setIgnoreMouseEvents(true)`，不挡桌面。

## 火把

- 右手挂点：复用 M0 的脚底/手臂坐标系；新建 `src/renderer/torch.ts`。
- 模型：2×2×10 的薄盒 + `block/torch.png` 贴图（已提取到 `public/assets/vanilla/textures/block/torch.png`）。
- 火焰：`flame.png` Sprite + 暖色 `PointLight`（`0xffa64d`，距离小）；只影响角色，不做桌面光照。
- 火焰摇曳：光强/位置轻微噪声；火星粒子可少量。
- 音效：`fire/ignite.ogg` 点燃；`block/candle/extinguish1.ogg` 熄灭；可选低音量 `fire/fire.ogg` 循环。
- 火把状态由 animator 控制：右手抬起、身体轻微侧倾；不阻断走路/眨眼。
- 自动暗处触发留到 M3；M2 只有长按手动切换。

## 关闭紫粒子

- 新增 `src/renderer/particles.ts`：Sprite 池 + 屏幕坐标粒子。
- 纹理：已提取的 `effect_0..7.png` / `glitter_0..7.png`（`public/assets/vanilla/textures/particle/`）；通过 preload 加载。
- 颜色：`#A855F7` / `#C084FC` / `#7C3AED` / `#4C1D95`；加色混合。
- 2.4s 起少量聚拢；3.0s 爆发 120–160 个，向上 + 径向，重力约 260px/s²，寿命 0.9–1.6s，带残影/拖尾。
- 角色在 3.0s 隐藏；粒子继续约 1.2s；然后窗口隐藏，托盘保留。
- 关闭音效：`mob/endermen/portal.ogg` + `portal/travel.ogg`。
- 关闭动画期间点击穿透。

## 伸懒腰

- `src/renderer/animator.ts` 增加 `stretch()`：2.5s 时间轴。
- 姿态：双臂向侧上方举、身体后仰、头后仰、脚底不动；起止用缓动，回到当前 idle/walk 姿态。
- 触发：调试 API `window.__niko.stretch()`；M2 可每 8–15 分钟随机一次（低频），M3 睡醒后再接。
- 音效：`mob/cat/purreow1.ogg` 低音量（可选）。

## 调试 API

扩展 `window.__niko`（仍只在 dev/`--debug-walk` 下暴露）：
- `stretch()`
- `toggleTorch(on?: boolean)`（验证火把视觉）
- `getState()` 增加 `torchOn`、`stretching`、`dragging`、`closing`、`gesturePhase`
- `getTorch()` 返回火把可见/光强
- `getParticles()` 返回当前粒子数量（关闭时可观察）
- `forceClose()`（可选，仅 dev）

## 测试

- `tests/gesture.test.ts`：250ms 前移动 → 单击；250ms 后移动 → 拖拽；1.5s → 火把；3s → 关闭；1.5s 后移动不拖拽；松开取消。
- 保留 M1 测试；`pnpm test` 全绿，`pnpm build` 通过。
- 不要求 GUI/E2E。

## 约束

- 只改本项目；不要改 `docs/`、`public/assets/skin/niko.png`、`public/assets/whale/*`。
- 可以新增 `M2-REPORT.md`。
- 不提交 `node_modules`/`out`/`artifacts`。
- 时间盒约 45–55 分钟；先保证手势、火把、关闭粒子、伸懒腰四项可运行，不要提前做 M3。

## 报告

`M2-REPORT.md`：完成项、手势时序表、调试 API 用法、build/test 结果、已知问题。

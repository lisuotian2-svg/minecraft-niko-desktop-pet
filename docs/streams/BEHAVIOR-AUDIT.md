# BEHAVIOR-AUDIT — Niko Pet 3D 行为与视觉流审计

> 作者：behavior-dev（只读审计）
> 日期：2026-10-21
> 状态：审计完成，**未修改任何 src / tests / assets / package 文件**；本文件是唯一写入。
> 项目根：`C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d`
> 依据：`docs/TEAM-HANDOFF.md`、`docs/SKILLS.md`、`docs/PRD.md`、`docs/DECISIONS.md`、`docs/TECH-PLAN.md`、`M0-REPORT.md`、`M1-REPORT.md`、`src/renderer/animator.ts`、`viewer.ts`、`bread.ts`、`snacks.ts`、`pet.ts`、`gestures.ts`、`particles.ts`、`torch.ts`、`audio.ts`、`src/shared/*`、`src/main/pet-window.ts`、`src/main/ipc.ts`、`src/preload/index.ts`，以及 `artifacts/` 中现有的 M0/M1/M2 截图。
> 说明：当前不存在 `docs/COMMANDER-BRIEF.md`；Codex 简报出现后，本文件中的路线/优先级需要与它对齐一次。
> 验证基线（本次只读复跑）：`vitest run` **17/17 通过**；`tsc --noEmit -p tsconfig.json` **通过**。未启动可见 GUI，未重启用户实例，未跑 build（未改代码）。

---

## 0. 结论摘要（给决策者）

1. **基础是好的**：Minecraft Slim 双层皮肤、透明窗口、3/4 视角、走路/待机/眨眼/摸头/压扁/伸懒腰/面包/火把都已能运行，M0/M1 的骨架和测试基线稳定。
2. **当前最大的问题不是“少一个动作”，而是“没有行为仲裁”**：`animator.ts` 是一个大的权重叠加器，`pet.ts` 用若干独立 `setTimeout` 和布尔开关驱动动作；走路由 main 进程独立驱动。结果是：
   - 吃饭/伸懒腰时窗口仍在走，角色会“滑行着吃/滑行着伸懒腰”；
   - 随机面包和随机伸懒腰是两套独立计时器，彼此不知道对方；
   - 点击/按压可以在任何状态下叠加，睡眠/坐着等新状态没有统一打断规则；
   - 动作优先级、冷却、互斥、打断都要靠散落的 `if`，后续加坐/睡/喂食/玩具会迅速失控。
3. **视觉上最影响观感的三件事**：没有接触阴影（角色浮在桌面）、头部 ±60° 俯仰在几何上会插进身体、走路时腿摆幅与窗口位移不匹配（滑步）。其次才是光影、镜头、粒子。
4. **P0 建议**：先建立 `BehaviorMachine`（纯逻辑）+ `animator` 姿态层 + `main` 走路暂停接口；同期修 walk 同步、头部俯仰安全范围、摸头反馈（purr/hearts）和接触阴影。坐/睡/赖床/手喂作为 P0 的第二块；毛线球等玩具作为 P1（用户已明确想要，但需先有行为仲裁）。
5. **前置依赖**：系统空闲（`powerMonitor.getSystemIdleTime`）、走路暂停/恢复、设置项、音频白名单（purr1–3/meow1）、`BlinkTexture` 半闭眼状态。没有这些接口，坐/睡只能做成“定时假睡”，不符合低打扰默认。
6. **需要用户拍板 8 个问题**（§7），每个都有推荐项；建议先答 Q1–Q5，工程接口可以并行冻结。
7. **就绪度**：审计完成、基线绿、接口草案已给出，**已具备开一个有明确 write scope 的实现任务**；但按团队流程，建议等 Codex 路线/用户 Q1–Q8 后再写代码。

---

## 1. 审计方法与证据

- 逐行阅读动画/行为/音频/窗口/设置代码；用像素检查确认皮肤眼睛几何（见 §2.4）；用现有截图做视觉抽查（`artifacts/m0-final.png`、`m1-idle.png`、`m1-walk-left/right.png`、`m2-stretch.png`、`m2-torch.png`、`pet-live-now.png`、`zoom-2.png`）。
- 现有截图的时效性要注意：`m1-walk-*` 是 M1 早期截图，当时朝向逻辑尚未改到现在的 `0.28/-0.45`，**不能直接拿来判定当前走路背身**；但它仍能说明“3/4 视角下脸部可读性”这个风险。所有视觉结论都以代码几何 + 需要 Lead 重新 CDP 截图复核的方式标注。
- 数值分析使用模型坐标（1 单位 = 1 个皮肤像素；角色 32 单位高；220px 宠物约 **6.9 screen px / model unit**）。所有“会穿模”的结论是几何推导，最终以真实截图为准。

### 1.1 当前实现的真实控制流

```
main/pet-window.ts
  └─ 30fps timer: 每 3–8 分钟随机开始 walk，10–40s 后停；移动窗口 x；发 pet:walking / pet:facing
renderer/pet.ts
  ├─ 手势：按/拖/火把/关闭（gestures.ts）
  ├─ 动画：animator.setWalking / pet / stretch / eat / setTorchOn / setDragging / land
  ├─ 独立计时器：scheduleSnack 8–20min；scheduleStretch 8–15min
  ├─ 状态布尔：eating / torchOn / manualTorch / autoTorchActive
  └─ 无全局状态机，无“动作锁”，无“走路暂停/恢复”
```

`animator.update()` 每一帧把所有动作当作权重叠加，见 `animator.ts:162-277`。它不知道“现在处于什么行为”，只知道几个时间窗；新增坐/睡/喂食/玩具时，叠加顺序会不可维护。

### 1.2 关键时序表（现状）

| 项目 | 当前值 | 代码位置 | 备注 |
|---|---|---|---|
| 渲染循环 | rAF，约 60fps；`dt` clamp 0.05s | `animator.ts:150-160` | 掉帧时动作会整体变慢 |
| 窗口行走 | 30fps timer | `pet-window.ts:143-146` | 每帧位置取整，40px/s 时约 1.33px/帧 |
| 走路速度 | `walkSpeed()` 约 40px/s（420 窗口），clamp 30–55 | `shared/walk.ts:61-63` | 与步摆幅不匹配，见 §2.2 |
| 步频 | `gaitPhase += dt * Math.PI * 3.1` → 3.1 步/s | `animator.ts:186-190` | 一步约 0.323s |
| 腿摆幅 | ±0.52 rad（约 30°） | `animator.ts:206-207` | 脚相对位移约 82px/半步 |
| 走路混合 | 指数，τ=0.16s（95% 约 0.48s） | `animator.ts:164-166` | 比 PRD 的 150–300ms 慢 |
| 转向 | 指数，τ=0.105s（95% 约 0.315s） | `animator.ts:180-184` | 可接受 |
| 头部跟随 | 指数，τ=0.13s（95% 约 0.39s） | `animator.ts:252-258` | 视线略“拖泥带水” |
| 眨眼 | 3–7s 随机，闭 130ms，18% 二连眨 | `animator.ts:265-276` | 眼睑贴图几何见 §2.4 |
| 摸头 | 2500ms，闭眼 850ms，1.2s 二连眨 | `animator.ts:125-130` | 无 purr、无爱心、无身体反馈 |
| 伸懒腰 | 2500ms，350ms 入 / 520ms 出 | `animator.ts:9-10,99-103,168-170` | 轮廓/穿模见 §2.6 |
| 吃面包 | 3800ms 动画 / 3900ms 收尾；咬 900/1600/2300/3000ms | `animator.ts:105-109`；`pet.ts:85-116` | 可与走路叠加，见 §2.7 |
| 面包屑/爱心 | 固定屏幕点 `rect.height * 0.52` | `pet.ts:72-75` | 嘴/头位置不跟随姿态 |
| 落地 | 720ms，bounce + squash | `animator.ts:10,218-234` | 无尘土、阴影不响应 |
| 随机面包 | 8–20min | `pet.ts:245-251` | 不检查 walking/stretching |
| 随机伸懒腰 | 8–15min | `pet.ts:253-259` | 不检查 walking/stretching |
| 自动火把 | 暗处 12–18s，10min 冷却 | `pet.ts:138-161` | 不检查 stretching/sleep |
| 关闭 | 2.4s 聚粒子 / 3.0s 爆发 / 1.2s 隐藏 | `gestures.ts`、`pet-window.ts:257-302` | 行为审计不展开 |

---

## 2. 现有动画/行为逐项审计

### 2.1 待机（Idle）——不丑，但“活人感”不足

**现状**：呼吸只有 `body.scale` 的 0.6–1.2% 和 `wrapper.position.y` 0.05（约 0.34px），周期约 3.3s；每 3.5–6.5s 生成一个 ±0.18 rad 的 glance；头部始终以鼠标为主目标；没有身体重心变化。

**问题**：
- **僵硬**：除呼吸/头部外，肩膀、躯干、腿部完全静止；从 3/4 看像一张会呼吸的立绘。
- **视线不自然**：光标在窗口外时也永远盯着光标方向（clamp 后固定），缺少“看看别处/发呆/低头”的 idle 目标；glance 是直接改目标再用 130ms 追，缺少 saccade 的“快速跳一下、停住”的感觉。
- **呼吸不对称**：单正弦，吸/呼各半；真人/猫是短吸、长呼、偶发停顿。
- **视觉细节**：没有影子；脚底与桌面之间没有接触感；深色外套/头发在深色壁纸上轮廓会糊（`artifacts/pet-live-now.png` 上角色直接压在深色 UI 上）。
- **帧/时序**：呼吸 y 位移只有 0.05 模型单位，在 220px 时小于 1px，实际几乎不可见；可改为 0.15–0.25 或只保留身体 scale + 肩部微动。

**建议（P0/P1）**：
- 呼吸改为非对称包络：吸 35%、停 10%、呼 55%，周期 3.4–4.2s；`body.scale.y` ±1.2%，肩/头延迟 100ms 跟随（次要运动）。
- 每 6–12s 一次轻微重心转移：`wrapper.rotation.z ±0.008`、`wrapper.position.x ±0.15`、头反向补偿 0.01。
- 视线目标三态：`track`（光标移动/靠近 1.5s）、`hold`（停住）、`idleSaccade`（光标 4s 无移动时，随机看向左/右/下，60–120ms 快速到位，停留 1–3s）。
- 眨眼保留，但增加 10% 长间隔（8–12s）和 5% 三连眨；配合半闭眼。
- 加接触阴影（§5.1），这是 ROI 最高的一步。

### 2.2 走路（Walk）——滑步是当前最明显的破绽

**现状**：窗口由 main 以约 40px/s 移动；renderer 的步频固定 3.1 步/s，腿摆 ±0.52 rad，手臂反相；身体有 0.35 的上下起伏；步声在 `gaitPhase` 跨 π 时播放（`walkBlend > 0.5` 才响）。

**定量问题**：
- 220px 宠物约 6.9 screen px / model unit；腿长 12 units；脚水平摆动幅度 ≈ `2 × 12 × sin(0.52) × 6.9 ≈ 82px`（半步从最前到最后）。
- 但窗口每半步只前进 `40px/s × 0.3226s ≈ 12.9px`。**腿在“原地大跨步”，身体却只挪了一点，滑步约 6 倍量级**。
- 结果：看起来像“在跑步机上走”，脚没有抓住地面；脚步音频率（3.1/s）也与 40px/s 的慢速不匹配。
- 窗口移动 30fps，走快了以后（建议提高速度）会出现 2–4px 的整窗跳动；renderer 的 60fps 动画无法补偿窗口位置。

**其他问题**：
- 起步/停步没有重心转移和脚掌 settle；`walkBlend` 一停，腿直接回到 0。
- 没有行走前倾、转向侧倾；拐弯时上半身像刚体。
- 朝向不对称：相机方位约 +30°，idle wrapper yaw = -22.5°，相对视角约 52.5°（偏侧面）；走右目标 +0.28（相对约 14°，几乎正面），走左 -0.45（相对约 56°，偏侧/背）。`m1-walk-left/right.png` 旧图里能看到明显背身；**需用当前代码重新截图**，但左右可读性不对称是几何上成立的。
- 走路时头部 yaw 乘 `1 - 0.65*walkBlend`，只保留 35% 的看鼠标角度；如果用户鼠标在侧面，头会“被身体拽走”，略显僵。
- 吃/伸懒腰不暂停 main 的走路（详见 §2.7/§2.8），这是 P0 bug。

**建议**：
- 二选一：**(A) 提高走路速度到约 80–110px/s，同时把腿摆幅降到 0.22–0.30 rad、步频按速度重算**；或 **(B) 保持 40px/s，把腿摆幅降到约 0.10–0.14 rad**。推荐 A（更自然、更有存在感；Shimeji 的行走也更明显）。
- 步频由 `speed / strideLength` 驱动，而不是固定 3.1；`walkSpeed` 按宠物尺寸比例调整。
- main 行走 tick 在 walking 时提高到 60fps（或至少 60fps 位置更新），避免整窗跳。
- 起步用 250ms 重心前移 + 第一脚；停步用 300ms 收脚；转身时 `wrapper.rotation.z ±0.03` 侧倾。
- 走右/走左的 yaw 目标重新用截图调，目标是两侧相对相机都在约 30–45°，脸可读、绝不背身；头部保留 50% 的鼠标跟随。
- 每 2–3 步加一次 1–2 个像素的尘土；落地/起跳时接触阴影缩小、变淡（§5）。
- 吃东西/伸懒腰/坐/睡时，main 必须暂停 auto-walk（§3/§6）。

### 2.3 眨眼（Blink）

**现状**：`BlinkTexture` 直接改 runtime 皮肤 canvas；`fillRect(9,13,2,2)` 和 `(13,13,2,2)` 填粉色眼睑，再在 y=14 画深色睫毛；`nextBlinkAt` 3–7s，18% 二连眨。

**像素级证据**：读 `public/assets/skin/niko.png` 头部正面（x 8–15, y 8–15）：
- 眼睛实际占 **x=9–10、13–14，y=12–14（2×3 像素）**，不是 2×2；
- 当前 blink 只覆盖 **y=13–14**，**y=12 的上眼球（深色）没有被盖住**；
- 眼睑粉 `#c86886` 正好等于 y=11 的皮肤色，睫毛 `#6b3039` 等于 y=14 的阴影色，颜色设计是对的；问题在覆盖行数。
- 外层的帽子/头发（head overlay，front 区 x=40–47）在 y=12–14 有镂空，会部分遮挡眼睑；具体遮挡效果必须截图确认。

**结论**：当前闭眼很可能读成“半睁/上眼睑偏暗”，而不是干净的闭眼；这是低成本、高观感收益的修复点。推荐：
- 眼睑改为 **x=9–10/13–14, y=12–14 的 2×3 填充**：y=12–13 粉色，y=14 深色睫毛；先做 A/B 截图对比，确认外层的镂空不会让眼睑看起来断裂。
- `BlinkTexture` 增加状态：`'open' | 'half' | 'closed'`；`half` 用于睡意、赖床、被摸时；`closed` 用于睡眠持续闭眼。
- 注意：当前 `setClosed()` 每次都会 `putImageData(original)`，如果以后在 runtime 皮肤上做 AO/腮红，会被 blink 覆盖掉；需要让 BlinkTexture 维护“原始 + 叠加层”的组合，或把 AO 放到单独材质/贴图（§5.10）。

### 2.4 视线/头部（Gaze / Head）

**现状**：`MAX_GAZE_YAW = π/3.1 ≈ 58°`，`MAX_GAZE_PITCH = π/3 = 60°`；头部 yaw 由光标 x 决定，pitch 由光标 y 决定；每 3.5–6.5s 叠加一个 ±0.18/±0.16 的随机 glance；walk 时 head yaw 乘 0.35。

**问题**：
1. **疑似 pitch 方向反了**：Three.js 中 `head.rotation.x` 正角度会让头前下方（+z 面）向下转（模型 front 朝 +z；相机在 +z 侧看得到脸）。而代码 `cursorPitch = (centerY - cursorY) / range * MAX`：光标在窗口上方 → 正值 → **头向下低**。代码注释说“抬头/低头”，但按 Three 旋转约定这是反的。**必须用 CDP 在光标上/下各截一帧确认**；如果确实是反的，这是 P1 功能 bug，修法只需翻转符号并保留 glancePitch 的语义。
2. **±60° pitch 会穿模**：头部 pivot 在脖子底部（skinview3d 的 head 组位于 body 顶部，head mesh 中心 y=4，底部在 y=0）。绕 x 转 θ 时，头底部前后角会下探 `4·sinθ`；θ=60° 时约 **3.46 model units** 进入 12 单位高的 body 顶部。也就是说，极端抬头/低头会把头的下沿插进胸口/领口。当前只加 `head.position.y` 0.08 级别补偿，不够。
   - 建议：pitch 上限收到约 ±38–42°，或用 `head.position.y += 4·|sin(pitch)|` 抬起头部（会露出脖子缝，不建议单独用）；配合 body 前倾/后仰 ±0.12，视觉上能保留“看得很高/很低”的感觉而避免穿模。
3. **始终盯鼠标**：光标离开窗口后头仍朝最后方向 clamp；没有 idle 视线；这在待机时显得“瞪人”。
4. **没有眼动**：眼睛是贴图，没有瞳孔独立运动；可以做“眼睛/眼皮 + 头”两级：大角度用头，小角度用眼睑/瞳孔贴图（成本较高，P2）。
5. **头部与身体解耦不足**：没有脖子/胸腔，极端 yaw 会让帽子外层的侧面贴图被拉伸/露出；需要截图矩阵（yaw ±55、pitch ±40、walk 左右）确认。
6. **walk 时 head yaw 只剩 35%**，用户在角色侧后方移动鼠标时，头会显得“被身体拖走”；建议保留 50–60%。

**建议**：先做“idle 视线三态 + pitch 符号复核 + pitch 安全钳制 + head lift/body lean 补偿”，这是动作自然度的核心。

### 2.5 摸头（Pet）——反馈太薄

**现状**：`pet()` 设 2500ms；`petSway = sin(now*0.012)*0.075*envelope`；`petEyesUntil = now+850`；`secondBlinkAt = now+1200`；头的 yaw/pitch 被 sway 和 -0.08 俯仰影响；press/release 只播 Ya1/Ya2。

**问题**：
- **频率太快**：`now*0.012` = 12 rad/s ≈ **1.9Hz** 的左右摇头；摸头应该是 0.7–1.1Hz 的慢晃。
- **没有声音**：没有 purr（purr1–3 已在 `public/assets/vanilla/sounds/mob/cat/`，但不在 IPC 白名单）；没有 meow 的偶发。
- **没有粒子**：`SnackParticles.hearts()` 只在吃面包最后一口调用；摸头没有爱心。
- **没有身体反馈**：头在动，身体/手臂/重心完全不动；应当有“向手的方向靠 + 身体轻微下沉/侧倾”。
- **眼睛处理**：闭眼 850ms 后强制二连眨，像“困”而不是“舒服”；建议闭眼/半闭 + 慢眨眼。
- **打断规则**：点击在 eat/stretch/sleep 时也会触发 `animator.pet()`；没有冷却；睡眠中按压还会压扁 + Ya1（会吵醒/惊吓）。
- **命中区域**：`hit-test.ts` 只按 base skin alpha；帽子/头发的 outer layer 不参与，摸头判定可能比看到的小；PRD 提到“头部球形膨胀 6px”，当前没有做。建议 hit-test 对头部加 4–6px 膨胀（interaction 侧）。

**建议 P0**：升级为 `pet_deluxe`：2.4–2.6s；头向光标方向靠 0.10–0.14 rad；身体侧倾 0.02、轻微下沉 0.3 unit；闭眼 700ms → 半闭 500ms；purr1–3 随机 + 15% meow；心形 3 个 + 4 个像素 sparkle；冷却 1.5–2s；走路时点击先暂停走路 2.6s（或至少不叠加滑步）；睡眠中第一次点击只做半醒/低声 purr（见 §3）。

### 2.6 伸懒腰（Stretch）——轮廓不像“伸懒腰”，有穿模/遮挡风险

**现状**：2500ms；双臂 `rotation.z` 到 ±2.35 rad（约 135°），`rotation.x=-0.25`；body `rotation.x=-0.2`；head pitch -0.27；腿 `*= (1-stretchWeight)`；入 350ms / 出 520ms。

**问题（结合 `artifacts/m2-stretch.png`）**：
- 截图里双臂像两片深色大翼举在头顶，头部被挡住/埋在中间；读不出“双臂上举、胸口打开、头后仰”。
- ±2.35 rad 从“手臂下垂”算起是 135°，只到斜上方 45°；因为 3/4 视角和盒子手臂的长边朝向相机，看起来像平板。建议 `rotation.z ≈ ±2.55–2.65`（更竖直的 V），`rotation.x ≈ -0.25~-0.35`（稍向前，避免挡脸），同时把 head pitch 改为 -0.32（抬头；注意 §2.4 的符号）。
- body 后仰只有 0.2 rad（11°）；腿被直接归零，没有“踮脚/重心后移”；整体像“把手臂举起来”，不像舒展。
- 没有阶段性：没有 anticipation（先缩一下）、没有 hold 的轻微颤抖、没有回弹；只是 smoothstep 包络。
- 没有 purreow 之外的反馈：`audio.stretch()` 已播 purreow，音量 0.12；没有哈欠/尾巴/粒子。
- 可能穿模：手臂在 ±2.35 时从肩部向外上，和帽子/头发在 3/4 视角下大量重叠；上臂/袖子是单块，无法弯肘，遮挡脸是主要观感问题，而不是严格几何穿模。
- 随机伸懒腰不检查 walking（`pet.ts:253-259`），会出现“滑行伸懒腰”；伸懒腰期间 `activeWalk` 被乘 0.05，但窗口还在走，滑得更明显。

**建议时间轴**（2.5s）：
| 时间 | 姿态 | 事件 |
|---|---|---|
| 0–250ms | 身体微缩、头先低 0.03、手臂略收 | anticipation |
| 250–1100ms | 手臂 z 到 ±2.55，x -0.3；body -0.26；head -0.32；腿 0 | 主伸展 |
| 1100–1900ms | 保持，叠加 2 次 ±0.015 的轻微 pulse；脚底不动 | hold |
| 1900–2500ms | 平滑回 idle/walk 基础姿态 | release |
| 250ms | purreow 0.12；结束时 15% 概率 meow | 声音 |
- 如果用户在 stretch 中点击：允许 pet overlay（只头部/眼睛），不打断 stretch；拖动/关闭可打断。
- 伸懒腰必须在 main 暂停 walk 之后播放；不要在 `walking=true` 时开始。

### 2.7 吃面包（Eat）——能演完，但“边吃边走”“面包位置”有破绽

**现状**：`pet.ts:85-116` 设置 3900ms；咬 4 口（900/1600/2300/3000ms）；`animator.eat()` 3800ms；右臂到 -1.86 rad（约 106° 前抬），z -0.34；左臂 0.08/0.18；头 pitch -0.1；面包 `PetBread` 挂在右臂上。`scheduleSnack` 8–20min 随机。

**问题**：
- **边吃边走**：`eat()` 的 guard 是 `!skinReady || eating || torchOn || isDragging || isClosing`，**没有 walking**；`scheduleSnack` 也不检查 walking。`animator` 的 `activeWalk` 没有乘 `eatWeight`，所以腿继续走、窗口继续移动，角色“边行军边啃面包”。
- **不可达代码**：`if (torchOn) toggleTorch(false)` 在 `torchOn` 已被 guard 拒绝之后，永远执行不到（`pet.ts:86-87`）；如果希望喂食自动熄火把，需要把熄火放到 guard 之前。
- **面包出现太突然**：`bread.setVisible(true)` 瞬间出现，没有从背后/物品栏掏出的 200ms 动作；`setBite(0)` 也是瞬切。
- **面包位置**：`PetBread` 根在右臂 `(0,-9.8,-1.2)`，手臂长 12，手在 -12；面包中心在 forearm 上 2.2 units，且 z 向后 1.2，举到嘴前可能穿到脸/帽子或看起来“手腕上长面包”。需要截图矩阵确认；建议加一个“手部 anchor”偏移（约 `y=-11.4, z=+1.2`，面向相机）并做 scale-in 120ms。
- **没有头和身体的咀嚼反馈**：只有右臂 `sin(now*0.014)*0.055` 的小晃动；头没有轻点头/张嘴（皮肤无嘴骨，只能用头/眼神）；身体没有前倾。
- **碎屑/爱心锚点错误**：`petOrigin()` 固定在 canvas 高度 52%，是胸口附近；面包在嘴/手附近，碎屑看起来从胸口掉出来。应按 3D 面包/头部世界坐标投影到屏幕（或至少用 0.38–0.42 高度 + 头部 yaw/pitch 补偿）。
- **动作重叠**：`scheduleStretch` 检查 `!eating`，但 `scheduleSnack` 不检查 `stretching`；吃完最后一咬到 3.9s 隐藏之间，stretch 也可能被安排；反过来，eating 期间点击会触发 pet overlay。
- **音频**：chew/burp 有；没有“掏出面包”的布料/物品声（可选）；purr 没有。
- **食欲/频率**：8–20min 随机在“低打扰默认”下略显频繁，建议 10–25min，并和 stretch 至少隔 2min。
- **无喂食互动**：目前只有随机自吃；用户要的“喂食”需要用户触发入口（§4.2）。

**建议**：先把 `eat` 纳入统一 `actionLock`；开始前 `main.pauseWalk()`；加 150–250ms 的“掏出”阶段；面包 anchor 调整为手部/面向相机；碎屑/爱心从头部/面包投影位置发出；头随咀嚼 ±0.04 点头；吃完 hearts + burp；结束恢复 idle，不要回到“刚才的 walking”除非用户希望；随机频率调低。

### 2.8 拖拽/落地（Drag / Landing）——基础可用，缺收尾

**现状**：拖拽 250ms 门槛，四肢下垂 `dangling`，body 0.06；松手 `land()` 720ms，wrapper bounce 1.35、body squash 0.07；压扁/回弹 220ms。

**问题**：
- 落地只有 bounce/squash，没有尘土、阴影缩放、脚步 settle；从 3/4 看像弹簧，不像重量。
- 拖拽时头仍然看鼠标（`headYaw` 目标仍在算），四肢下垂的同时头很“积极”，略违和；被拎起来时头可以更松、看向拖动方向或前下方。
- 拖拽中按压音/松手 Ya2 正常；落地 720ms 略长，结尾可以 300ms 收。
- 拖拽期间 `activeWalk` 被 0.9 衰减，但 main 已经 stopWalk；没问题。
- 从睡眠拖起：需要“被抱起”的快速惊醒，不能先播 900ms 赖床；拖拽优先级最高。

### 2.9 头部/身体穿模风险汇总

| 部位/条件 | 风险 | 说明 | 建议 |
|---|---|---|---|
| head pitch ±60° | **高** | 头下沿角下探 3.46 units 进入 body | 限制 ±40° + body lean；或 head lift 补偿 |
| head yaw ±58° | 中 | 帽子 outer layer 拉伸/外露；颈部平面 | 截图矩阵；必要时 ±50° |
| stretch arms ±135° | 中 | 与帽子/脸在 3/4 下大面积重叠 | 改 V 角 ±2.55，稍向前；截图 |
| eat bread at mouth | 中 | 无肘关节，面包/手可能穿脸/帽 | 调 anchor/手臂角；截图 |
| torch held near face | 中 | 火焰 sprite 贴近脸颊/帽子 | 截图；必要时 root x/z 调整 |
| sit/sleep 新姿态 | **高（未验证）** | 腿前伸 + wrapper 下移可能出窗/穿桌沿 | 先做静止姿态截图矩阵，再时间轴 |
| 眨眼眼睑 | 中 | 2×2 覆盖不足，外层镂空 | 2×3 眼睑 + half 状态；截图 |

### 2.10 视觉质量抽查（现有截图）

- `m0-final.png` / `m1-idle.png`：角色边缘清晰、Slim 双层正确，但**没有接触阴影**，脚底像悬空；深色服装在白色/深色背景上都需要轮廓/影子支撑。
- `m2-stretch.png`：双臂呈“屋顶”挡住头部，缺少伸懒腰的舒展轮廓；这是最需要重做的动作。
- `m2-torch.png`：火把/火焰/暖光能读出来，但火焰贴近脸颊；没有地面反光/影子，火把没有“照亮周围”的落点。
- `pet-live-now.png`：真实桌面上宠物直接叠在深色 UI 上，没有阴影/边缘光，暗色外套与背景融合；需要接触阴影 + 轻微 rim。
- `zoom-2.png`：像素风正确（Nearest），但 125% DPI 下存在非整数像素缩放的风险；需要 DPI/像素对齐测试（§5.9）。
- `m1-walk-left/right.png`：早期截图有明显背身/侧背；当前代码 yaw 已改，需重新截图验证，不能直接作为回归基线。
- `m2-close.png`：紫色粒子能看出 enderman 素材，但整体偏“纸屑”，缺少发光/拖尾的层次；属于 interaction 的后续优化，本文只记录。

---

## 3. 目标行为状态机：坐 / 睡 / 赖床 / 起床 / 伸懒腰

### 3.1 设计原则

1. **一个 `BehaviorMachine` 管全局**：纯逻辑放 `src/shared/behavior.ts`（新增，需 Lead 批准）；renderer 只消费快照；animator 只做姿态插值。
2. **基础状态互斥**：`idle / walk / sit / doze / sleep / wake / stretch / eat / play / drag / photo / closing`。
3. **叠加层（overlay）**：`pet`、`gaze`、`blink`、`breath`、`torch` 不是基础状态，可以在适合的基础状态上叠加；但它们也有白名单（比如 sleeping 不允许普通 pet overlay）。
4. **动作锁**：`actionLock = { kind, startedAt, endsAt }`；用户触发 > 随机触发；`close > drag > photo > wake > feed/toy > pet > stretch > sleep > sit`。
5. **低打扰默认**：不主动打断用户；睡眠只在系统空闲/夜间；一次清醒周期只伸一次懒腰；睡眠音效默认轻。
6. **可打断、可恢复**：基础姿态切换用 200–400ms 交叉淡化；坐/睡等大幅姿态用 500–900ms 分阶段进入；不许瞬移；关闭/拖拽/拍照最高优先。

### 3.2 状态图

```
boot
  └─(skinReady)─> idle <──────────────┐
                   │  │               │
       walk <──────┘  └──> sit ──> doze ──> sleep
        │                  │                 │
        │                  └──> stretch      ├─(click/pet)──> dozeNudge ──> sleep 或 wake
        │                                     ├─(system active)──> wake ──> stretch ──> idle
        └──> eat / feed / play / pet          ├─(drag)──> drag ──> idle
                                             ├─(feed/play hotkey)──> wake ──> action
                                             └─(close)──> closing
any ──(photo freeze)──> photo ──(unfreeze)──> previous state
any ──(restore)──> idle
```

### 3.3 状态/触发/退出表（默认值）

| 状态 | 进入条件 | 默认时长 | 退出/打断 | 行为 |
|---|---|---|---|---|
| `idle` | 启动/动作结束 | 持续 | walk/sit/动作 | 呼吸、眨眼、视线、微动 |
| `walk` | main 的 3–8min 随机（且 behavior 未锁） | 10–40s | 边界、行为锁、用户动作 | 走路/转向/脚步 |
| `sit` | idle 且 90–180s 无直接互动；非 walking；用户未禁用 | 20–90s，可延长 | 点击/摸头/动作/起床/走 | 腿前伸、身体降低、手臂搭腿；保留视线/眨眼 |
| `doze` | sit 持续 60–120s 且系统空闲上升中 | 30–120s | 点击/动作/睡 | 半闭眼、低头、呼吸变慢、偶发点头 |
| `sleep` | 系统空闲 ≥10min，或夜间(22:00–07:00)空闲 ≥5min；`sleepEnabled` | 到用户回来/关闭；每 2–5min 局部翻身 | 系统活动、点击（分阶段唤醒）、拖动、喂食/玩具、长按、关闭 | 坐睡/低头、闭眼、慢呼吸、偶发翻身、purr/呼吸声 |
| `wake` | 系统活动恢复 / 第二次点击 / 喂食/玩具 | 2.4–2.8s（不含随后 stretch） | 点击/拖动/动作/关闭 | 睁眼、抬头、赖床、坐起；随后 stretch |
| `stretch` | wake 后 / 随机 8–15min（且空闲） | 2.5s | 拖动/关闭；点击只做 pet overlay | §2.6 时间轴 |
| `eat` | 随机 10–25min，或喂食 | 3.8–4.6s | 拖动/关闭/火把；用户动作按锁规则 | 吃面包；暂停走路 |
| `feed` | 用户快捷入口（§4.2） | 4.6s | 拖动/关闭 | 与 eat 共用动画；更慢、更多爱心 |
| `play` | 用户快捷入口（毛线球） | 5–7s | 拖动/关闭 | 蹲伏/扑/拨球；暂停走路 |
| `drag` | 250ms 拖拽 | 直到松手 | 松手 → land → idle | 四肢下垂、头放松 |
| `photo` | 全局拍照 freeze | 160ms+ | unfreeze | 冻结所有姿态/呼吸/粒子 |
| `closing` | 长按 3s / forceClose | 3s 仪式 | 最高优先 | 紫粒子/隐藏 |

### 3.4 坐姿（Sit）时间轴

目标姿态（model units；符号以实际截图为准）：

| 部位 | idle | sit | 说明 |
|---|---|---|---|
| `wrapper.position.y` | 0 | -5.0（先试 -4.6 ~ -5.2） | 身体下沉；腿前伸后脚不会出窗 |
| `wrapper.rotation.z` | 0 | 0.02 | 轻微侧坐感 |
| `body.rotation.x` | 0 | 0.04 | 微前倾 |
| `legs.rotation.x` | 0 | -1.35（两腿前伸） | 负号 = 向 +z 前伸（需截图确认） |
| `rightArm.rotation.x/z` | walk/idle | -0.55 / -0.10 | 手搭腿 |
| `leftArm.rotation.x/z` | walk/idle | -0.55 / +0.10 | 手搭腿 |
| `head.rotation.x/y` | gaze | gaze * 0.9，pitch +0.02 | 保留看鼠标 |
| camera | 0.55 | 0.55 | 不推近；先保证不裁切 |

时间轴：

| 时间 | 动作 |
|---|---|
| 0–150ms | 重心后移，膝盖微弯（腿 x 到 -0.2），头看一眼落座方向 |
| 150–500ms | 身体下沉到 -5.0，腿到 -1.35，手臂到搭腿位；`smoothstep` |
| 500ms–sit 结束 | 呼吸/眨眼/看鼠标；每 8–15s 轻微换重心（z ±0.01） |
| 退出 0–350ms | 0–200ms 先起身体，200–350ms 腿/手臂回 idle；避免脚穿桌沿 |
| 声音 | 坐下时可选 `step/grass` 很轻（0.08），不强制 |

**风险**：sit 的腿前伸会让脚位于窗口底部附近；wrapper 下移 5 单位约 34px，而脚底距窗口底约 12%（约 50px），需要截图确认不裁切；如果裁切，优先减到 -4.2 或把相机 target 下移 0.5。

### 3.5 睡眠（Sleep）时间轴

**姿势选择**：默认 **坐睡**（sit 基础上身体再降 0.6–1.0，头低垂，手臂收拢），不做全身侧躺。理由：MC 无脊柱/膝盖关节，侧躺需要整体旋转，容易出窗/穿桌沿；坐睡能保留“猫耳女巫打盹”的可爱轮廓，也和现有 sit 共用姿态。侧躺可作为用户选择（Q2）。

| 阶段 | 时间 | 姿态/表现 | 声音/粒子 |
|---|---|---|---|
| `sleepEnter` | 0–250ms | 从 sit 呼气，肩放松，头开始低 | 轻 purreow 0.10 |
| | 250–900ms | 身体再降 0.8；头 pitch +0.35（低头；符号待确认）；手臂收拢（x -0.8, z ±0.25）；眼睛从半闭 → 全闭 | 呼吸 loop 0.06 渐入；purr loop 可选 0.05 |
| `sleepLoop` | 900ms 起循环 | 呼吸周期 4.8s：吸 1.8s / 呼 3.0s；body.scale.y ±1.8%；头随呼吸 ±0.008；每 8–20s 一次 90ms 的耳朵/头轻颤（不做耳朵骨骼，用头 z ±0.01） | 呼吸声；purr 低音量；不眨眼（持续闭眼） |
| `sleepRoll` | 每 2–5min | 局部翻身：body.rotation.z ±0.05、头 yaw ±0.12、手臂换一个折叠角度，800ms 完成；不整体转身 | 布料/呼吸声可省略 |
| `sleepEnd` | 到用户活动/关闭 | 进入 wake 或 dozeNudge | 呼吸渐出 |

**睡眠时长**：无上限；每 2–5min 做一次局部翻身，每 90min 做一次较大的姿态调整；如果系统空闲持续超过 2h，仍保持睡眠（低打扰），直到用户活动或关闭。

**睡眠中的输入规则（低打扰默认）**：

| 输入 | 第一次 | 第二次/持续 | 说明 |
|---|---|---|---|
| 单击 | **dozeNudge**：半睁眼、抬头 0.06、轻 purr，1.2s 后若仍无输入继续睡 | 3s 内再次点击 → 完全 wake | 不播 Ya1/压扁（睡眠中按压“软处理”）；需要 gestures policy |
| 拖动 | 立即 wake → drag（优先，不播赖床） | — | 被抱起必须醒 |
| 长按 1.5s | **最高优先**：强制 wake + 火把（不播赖床动画） | 继续到 2.4/3.0s 照常聚粒子/关闭 | 关闭/火把是用户明确意图 |
| 长按 3.0s | 直接进入 closing（不等 wake） | — | 睡眠中也能关闭，安全 |
| 系统活动恢复 | 1.2s 后 wake → 赖床 → stretch → idle | 同一睡眠周期只触发一次 | `powerMonitor.getSystemIdleTime()` |
| 喂食/玩具快捷入口 | wake（0.6s 快速）→ 对应动作 | — | 用户主动；睡眠中随机面包/伸懒腰/自动火把不触发（延后或跳过） |
| 拍照 freeze | 冻结当前睡眠姿态 | unfreeze 恢复 | 不 wake |
| 全屏探头 | 由 platform 优先，behavior 暂停 sleep 渲染/声音 | — | 接口见 §6 |

### 3.6 起床/赖床（Wake）时间轴

| 阶段 | 时间 | 表现 |
|---|---|---|
| `eyeOpen` | 0–500ms | 眼睛从 closed → half（300ms）→ open（200ms）；瞳孔/眼睑用 BlinkTexture 状态；头抬 0.06 |
| `stir` | 500–1000ms | 头抬起、肩膀动一下、手臂伸展开；呼吸加快到 3.4s 周期；可选 purreow 0.10 |
| `赖床 hold` | 1000–2000ms（随机 1–2s） | 如果用户没有继续互动，保持坐姿半醒、眼睛 half、头轻点；这是“赖床”；`wakeStretch=false` 时到此直接 idle |
| `sitUp` | 2000–2400ms | body 回正、腿回站姿、wrapper y 回 0；先抬头再起身体 |
| `stretch` | 2400–4900ms（wake 后自动） | 播放 §2.6 的 2.5s 伸懒腰；结束回 idle |
| 打断 | 任意 | 点击 → pet overlay（wake 中点击只做头部反应，不取消起床）；拖动/关闭 → 立即转 drag/closing；喂食/玩具 → 可取消 stretch，进入动作 |

**关键**：赖床不是“卡住”，而是“半醒 + 可选延迟”；用户再次点击/拖动/系统活动持续时立刻完全醒。默认 `wakeStretch = true`，允许关闭。

### 3.7 低打扰默认

- 坐：90–180s 无直接互动后触发，概率 65%（其余继续 idle）；用户正在操作也不会被打断。
- 睡：系统空闲 ≥10min（或 22:00–07:00 空闲 ≥5min）；**用户活跃时绝不睡**；`sleepEnabled` 可关。
- 醒来：系统活动恢复后 1.2s 才 wake，避免“碰一下鼠标就弹起来”；同一空闲周期最多一次 wake-stretch。
- 声音：睡眠呼吸/呼噜默认低音量（主音量 ×0.15）；静音设置生效；夜间可再降。
- 随机动作：随机进食 10–25min；随机伸懒腰 8–15min；两者最小间隔 2min；睡眠/坐/动作中不叠加。
- 睡眠中不自动火把、不自动进食、不自动伸懒腰；auto-torch 需在 sleep 时暂停。
- 不显示任何文字/气泡/名字；睡眠提示只能用呼吸/翻身/purr，不能用 “Z” 文字（会违反桌面无文字原则）。

### 3.8 需要新增的设置（建议 schema）

```ts
export type ActivityLevel = 'low' | 'normal' | 'high'
interface PetSettings {
  // ...M1 字段
  activityLevel: ActivityLevel       // 默认 'low'
  sleepEnabled: boolean              // 默认 true
  sleepAfterIdleSec: number          // 默认 600；范围 120–3600
  wakeStretch: boolean               // 默认 true
  sleepSounds: boolean               // 默认 true
}
```
> 具体字段由 Lead 与 platform 决定；`shared/settings.ts` 的版本兼容/默认值/范围校验要一起改。`activityLevel` 只调频率，不改变睡眠的硬条件（睡眠仍要求系统空闲），避免“活跃档在用户工作时睡觉”。

### 3.9 全屏探头（Peek）对行为的影响

> 按 `PLATFORM-AUDIT` 的 `pet:display-mode` 方案对齐：窗口位置/边缘/进度由 platform 控制，behavior 只负责“只露头”的姿态和暂停随机行为。全屏探头期间**不进入 sleep/sit**，避免和平台窗口移动抢状态。

| 阶段 | platform | behavior |
|---|---|---|
| 进入 `peeking` | 停止 walk，窗口移到边缘；发 `pet:display-mode`（edge/progress） | 取消当前 sit/doze/sleep/stretch/eat/feed/play（close/drag 除外）；停止睡眠音/呼吸 loop；隐藏 body/arms/legs/props，只保留 head，头中心对准窗口中心；暂停随机调度器 |
| 探头停留 | 控制窗口滑出/缩回 | 只做头部 idle（眨眼、轻微看相机/看屏幕边缘）；不走路、不进食、不睡、不发声（或极轻 purr） |
| 退出 `peeking` | 窗口回底部，发 `normal` | 恢复全身可见、道具/粒子清理；回到 `idle`（不要直接回到 sleep；用户刚有活动）；重新开始随机计时 |
| 用户点击/拖动/关闭 | platform 转发事件 | 按优先级：close > drag > 退出 peek 并执行点击反应；不要在 head-only 状态下播放全身动作 |

- 需要 platform 提供 `pet:display-mode`（`normal | peeking | peek-hidden | closing`）和可选的 head anchor 请求；behavior 在 `pet.ts` 内维护 `peekMode` overlay，不算基础状态。
- 如果 behavior 不实现 head-only framing，platform 的备选是“只从下边缘探头”（PLATFORM-AUDIT 不建议）；本审计建议按 head-only 做，但放在 platform peek 任务之后（行为线可先留 `peekMode` 钩子）。

---

## 4. 新增互动设计（3–5 个）

优先级：**pet_deluxe（摸头反馈升级）→ hand_feed（手喂面包）→ yarn_ball（毛线球）→ cursor_pounce（追光标扑击，可选）→ fish_treat（小鱼干，可选）**。全部复用现有 `PetBread`、`SnackParticles`、`PetAudio`、`gestures` 的按压/释放，不引入新框架。

### 4.1 `pet_deluxe` — 摸头反馈升级（P0）

| 项 | 设计 |
|---|---|
| 触发 | 单击角色（现有）；睡眠中第一次点击走 dozeNudge，不算完整 pet |
| 动作 | 2.6s：头向光标方向偏 0.10–0.14；眼睛闭 700ms → 半闭 500ms；身体侧倾 0.02、下沉 0.3；`wrapper.rotation.z` 慢摆 0.8Hz；头 z 轻微 0.004 抖动（purr 振动） |
| 道具 | 无 |
| 粒子 | 3 个爱心（`snacks.hearts`）+ 4 个粉色/白色像素 sparkle；锚点用头部投影位置 |
| 声音 | `purr1–3` 随机，gain 0.30；15% `meow1` gain 0.20；Ya2 保留但降低到 0.5 |
| 冷却 | 1.5–2s；同一秒内多次点击不叠加 purr |
| 互斥 | 可在 idle/sit/walk 上作为 overlay；不取消 eat/stretch；sleep 只做 dozeNudge；拖拽/关闭/拍照优先 |
| 复用 | `animator.pet()` 扩展；`snacks.hearts`；`PetAudio` 新增 purr/meow |

### 4.2 `hand_feed` — 手喂面包（P0b）

| 项 | 设计 |
|---|---|
| 触发 | 托盘菜单“喂食” + 自定义全局快捷键（推荐 Q4-A）；或双击宠物（备选 Q4-B，需 interaction 增加双击判定） |
| 动作 | 4.6s：0–200ms 右臂先向身后/物品栏方向收（掏面包），面包 scale 0→1；200–900ms 举到嘴边；1100/1800/2500/3200ms 咬 4 口（头轻点 +0.05，面包缩小）；3500ms 打嗝；3800–4600ms 放下/隐藏 |
| 道具 | 复用 `PetBread`；增加 `show/hide` + scale-in/out；锚点从 forearm 调整到 hand/面向相机 |
| 粒子 | 每口 8 个棕色碎屑（嘴/手投影点）+ 最后 3 个爱心；碎屑落向桌面方向 |
| 声音 | 每口 `eat1/eat2`（0.5）；`burp`（0.55）；可选嚼完 purr 0.15 |
| 冷却 | 60s；成功后把随机进食计时重置为 10–25min |
| 互斥 | 与随机 eat 共用 `actionLock.eat`；不可在 walk（先 pause）、drag、close、photo、sleep 中直接开始（sleep → wake 0.6s 后 feed）；torchOn 时自动熄灭（需要把熄火放在 guard 前）；用户触发优先于随机 |
| 复用 | bread.ts、pet.ts、audio.ts、snacks.ts；入口由 platform/main 提供 |

### 4.3 `yarn_ball` — 毛线球（P1）

| 项 | 设计 |
|---|---|
| 触发 | 托盘菜单/快捷键“玩”；或双击宠物（备选）；`toysEnabled` 默认 true |
| 动作 | 5–7s：毛线球从脚边生成，滚到角色前方，弹 2 次；角色蹲伏（wrapper y -1.2、腿 -0.4）→ 扑（wrapper y +6、body pitch 0.08）→ 用右臂拨球 2–3 次；球被拨得左右滚动，最后缩小消失；角色回 idle |
| 道具 | 新建 `src/renderer/toys.ts`（需 Lead 批准）：8×8×8 左右的 Box + 程序化 16×16 毛线纹理（避免新资产/白名单）；或从 MC `wool_*`/`string` 提取（需 tools/资产任务） |
| 粒子 | 球滚动时 2–4 个彩色线头像素 + 落地尘土；结束时 3 个爱心 + 4 个 sparkle |
| 声音 | `meow1` 0.20、`purr` 0.15、可复用 `random/click` 作拨球声（0.2，不新增资产） |
| 冷却 | 90s；与 feed/eat/stretch/sleep 互斥；walk 先 pause |
| 互斥 | `actionLock.play`；睡眠时用户触发 → wake 0.6s 后 play；拖动/关闭/拍照优先 |
| 风险 | 球在 3D 场景内，不移动窗口（避免平台依赖）；如果用户想要“追着跑”，需要 platform 的窗口 nudge，二期 |

### 4.4 `cursor_pounce` — 追光标扑击（可选 P1.5）

| 项 | 设计 |
|---|---|
| 触发 | 光标在角色附近快速移动 + 随机 1/12；仅 idle；冷却 8s；`activityLevel` 非 low 时可以更频繁 |
| 动作 | 700ms：先蹲 150ms、头压低、臀部微抬 → 原地小跳（wrapper y +4、腿收）→ 右臂前扑 → 落地 squash；不移动窗口 |
| 粒子 | 起跳/落地尘土，少量 sparkle |
| 声音 | 10% meow；扑空可选 `burp` 不适用，保持安静 |
| 互斥 | 不打断 eat/stretch/sit；sleep 中禁用；拖拽/关闭/拍照优先 |
| 复用 | animator + snacks；无新资产 |

### 4.5 `fish_treat` — 小鱼干（可选 P2）

| 项 | 设计 |
|---|---|
| 触发 | 与 feed 同一入口的第二个选项/快捷键；仅当 `fish` 资产可用 |
| 道具 | 需新增 `item/cod.png` 到 `public/assets/vanilla/textures` + IPC 白名单；或程序化 16×16 像素鱼 |
| 动作 | 1 口吃完，比面包短（2.2s）；爱心更多（5 个）；purr 更明显 |
| 冷却 | 120s，和 feed 共享互斥 |
| 价值 | 强化“猫”的设定；但资产/白名单是额外依赖，建议二期 |

### 4.6 动作仲裁/互斥矩阵

| 当前 \ 新动作 | pet_deluxe | hand_feed | yarn_ball | cursor_pounce | sleep/sit |
|---|---|---|---|---|---|
| idle | ✅ overlay | ✅ | ✅ | ✅ | ✅ 进入 |
| walk | ✅（暂停 2.6s 或 overlay） | ❌ 先 pause | ❌ 先 pause | ❌（可先 pause） | ✅ sit |
| sit | ✅ overlay | ✅ 可坐喂 | ✅ | ❌ | ✅ → doze/sleep |
| doze | ✅（dozeNudge） | ✅ wake 后 feed | ✅ wake 后 play | ❌ | ✅ → sleep |
| sleep | ⚠️ dozeNudge | ✅ wake 后 feed | ✅ wake 后 play | ❌ | — |
| eat | ✅ 仅头部 overlay（可选） | ❌ 忽略 | ❌ 忽略 | ❌ | ❌ |
| stretch | ✅ 仅头部 overlay | ❌ 忽略 | ❌ 忽略 | ❌ | ❌ |
| drag/close/photo | ❌ | ❌ | ❌ | ❌ | ❌ |

**规则**：
- 用户主动动作（feed/play）优先于随机动作；`close`/`drag`/`photo` 最高优先；`sleep` 最低。
- 同一时刻只允许一个基础动作；`pet` 是 overlay，但 sleeping 只允许 dozeNudge。
- 冷却用单调时钟 `performance.now()`；跨窗口隐藏/恢复要 reset 或按实际时间衰减（避免恢复后连发）。
- 所有动作开始前检查 `viewer.playerObject.visible`、`document.hidden`、`gestures.isClosing`、`photoFrozen`。

---

## 5. 视觉质感提升清单（按 ROI 排序）

> 原则：保留 MC 方块风：Nearest 纹理、硬边、像素级位移、低多边形；不加软阴影贴图/景深/大 bloom；透明窗口优先 2D 合成，避免 3D 阴影贴图。

### 5.1 P0 接触阴影（Contact Shadow）— ROI 最高

- **问题**：所有现有截图都没有影子；脚底像悬浮，深色壁纸上轮廓丢失。
- **方案**：在 WebGL canvas 之下新增一个 2D shadow canvas（`z-index` 低于 `#pet`），在脚底位置画一个硬边/3 色像素椭圆（宽约宠物高度的 30–35%，高 6–10px），不透明度 0.16–0.22；随 `scaleY` 压扁、跳跃/拖拽缩小变淡。
- **实现归属**：`snacks.ts` 增加 `ShadowLayer`，由 `pet.ts` 每帧喂 `wrapper.position.y`、`playerObject.scale`、`sleep/sit` 状态；不新建资产。
- **风险**：DOM 图层在透明窗口里绘制，需确认不拦截点击（`pointer-events:none`）、不产生窗口 resize 回路；不参与照片冻结的需要按 photo freeze 一起冻结。
- **验收**：浅色/深色壁纸、125% DPI、80/220/500px 各一张；脚底和影子不能分离。

### 5.2 P0 动作/视线/眨眼打磨

- idle 非对称呼吸、重心转移、视线三态（§2.1）；walk 速度/摆幅同步（§2.2）；blink 2×3 眼睑 + half 状态（§2.3）；pitch 符号/穿模（§2.4）；pet 慢摆/purr/hearts（§2.5）；stretch 新时间轴（§2.6）；eat 暂停走路/anchor（§2.7）。
- 这部分是“动作质量”，比加光影更影响观感，优先于 5.5–5.8。

### 5.3 P0 走路同步与窗口平滑

- main 行走 tick 在 walking 时 60fps；`walkSpeed` 提高到约 80–110px/s（按尺寸）；renderer 步频按速度计算；腿摆 ±0.22–0.30；起步/停步 settle。
- 如果用户偏好慢走，则选方案 B（40px/s + ±0.10 rad 小步），但默认推荐 A；这需要在任务里做一次 A/B 截图。

### 5.4 P0 头部安全范围/镜头取景

- pitch 先限 ±40°，配合 body lean；yaw 保持 ±55；头部 y 补偿 0.5–1.0；测试 80/220/500px 与 stretch/sit/sleep。
- 相机 target 可下移 0.5（sit/sleep 时 0.5–1.0），zoom 不自动变化；保证 stretch 手臂不裁切、sleep 不贴窗底。

### 5.5 P1 光照（Lighting）

- 现状：skinview3d 默认 `globalLight` AmbientLight 3、`cameraLight` PointLight 0.6；没有阴影，皮肤偏平。
- 方案：`globalLight.intensity` 2.2–2.5，`cameraLight` 0.8–0.9 暖白（0xfff1e0）；新增一盏来自左上方的低强度 DirectionalLight（0.25–0.4，冷色 0xbfd4ff）做 rim/key 分离；**不开 shadow map**，不压暗桌面；火把 PointLight 仍只照角色。
- 验证：与原始皮肤 PNG 颜色对比，避免过曝/偏色；深色/浅色壁纸截图；透明边缘无暗边。归属：Lead（`viewer.ts`）。

### 5.6 P1 镜头微动（Camera）

- 保持固定 3/4；鼠标在窗口内时 camera.position.x/y 偏移 ≤1.5%，250ms 缓动；stretch/sit/sleep 时 zoom 变化 ≤1–2%，target 下移 0.5；相机不绕角色旋转，不破坏“固定 3/4”决策。
- 用户拖拽/拍照时禁用；全屏探头时由 platform 控制窗口，behavior 不碰相机。
- 风险：任何 zoom/offset 都可能裁切；做尺寸矩阵。

### 5.7 P1 道具表现与粒子锚点

- 面包：scale-in 120ms、hand anchor 调整、面向相机；不穿脸；碎屑/爱心锚点用头部/面包的世界坐标投影（`Vector3.project(camera)`），而不是固定 52%。
- 火把：火焰与帽子的距离截图检查；火焰 sprite 可加 1px 像素外发光（不 bloom）。
- 玩具：程序化像素纹理，球体 8×8×8 低多边形，硬边；滚动/弹跳用简单重力，落点贴任务栏线。
- 粒子：最大数量/寿命保持；避免每帧分配；photo freeze 时暂停。

### 5.8 P1 落地/脚步尘土

- 落地（720ms）在 0–200ms 生成 4–6 个灰色像素尘，向两侧散开；每 2–3 步 1–2 个尘；影子随 bounce 缩放。
- 成本极低，能显著提升“重量感”。

### 5.9 P2 像素保真/抗锯齿/DPI

- 现状 `pixelRatio = min(devicePixelRatio, 2)`；本机 125% → 1.25，非整数缩放会让 texel 宽度不均/轻微 shimmer。建议做 3 组 A/B：`1`、`1.25`、`2`；优先 **整数缩放**（如 1 或 2）+ Nearest；避免 FXAA/后处理；silhouette 可以保留 MSAA。
- 相机/窗口位置取整；走路窗口 60fps；避免亚像素抖动。
- 不改皮肤原图；所有 runtime 贴图操作只在 canvas 副本。

### 5.10 P2 伪 AO（Ambient Occlusion）

- 在运行时皮肤副本上，对脖子下方、腋下、袖口/裤脚内侧做 1–2 像素的 8–12% 压暗；不修改 `niko.png`；与 BlinkTexture 的 original 管理合并，避免被 `putImageData` 覆盖。
- 或者用极低成本的“胸部/脖子下方半透明阴影面片”实现（更可控，但可能破坏方块感）。建议先做 5.1/5.5，AO 放后。

### 5.11 P2 描边/轮廓（Outline）

- 可选实验：仅对 head/body 用 inverted hull 背面壳扩 1px 深色边；**默认关闭**，作为设置项或 A/B 截图；优点是在任何壁纸上可读；缺点是可能像卡通描边、破坏 MC 方块风、透明边缘出现 alpha 问题。
- 若用户选“要描边”，先做 1–2 个任务的实验验证，不进入默认路径。

### 5.12 P2 颜色管理

- 检查 `renderer.outputColorSpace = SRGBColorSpace`、皮肤贴图 `colorSpace = SRGBColorSpace`、`toneMapping = NoToneMapping`；用吸色对比原始 PNG；检查透明边缘/帽子 alphaTest 是否有暗边或白边；不对桌面做任何颜色处理。

### 5.13 不做/暂缓

- Bloom、景深、SSAO、软阴影贴图、体积光：透明窗口 + 小画布 + 性能预算，ROI 低且会破坏像素质感。
- 全屏暗角：PRD 明确不做。
- 桌面文字/气泡/状态：禁止。

### 5.14 ROI 排序总表

| 排名 | 项目 | ROI | 成本 | 风险 | 归属 |
|---|---|---|---|---|---|
| 1 | 接触阴影 | 极高 | 0.5–1h | 低 | behavior（snacks/pet）+ Lead 审 |
| 2 | idle/视线/眨眼打磨 | 高 | 2–3h | 低 | behavior |
| 3 | 走路同步 + 60fps | 高 | 1.5–2.5h | 中（main + renderer） | platform + behavior |
| 4 | 头部安全范围/取景 | 高 | 1–2h | 中（截图） | behavior |
| 5 | 摸头 purr/hearts/身体反馈 | 高 | 1–1.5h | 低 | behavior + Lead(audio) |
| 6 | stretch 重做 | 高 | 1–1.5h | 中（姿态） | behavior |
| 7 | eat/feed 暂停走路 + anchor | 高 | 1h | 低 | behavior + platform |
| 8 | 光照 pass | 中高 | 1–2h | 中（颜色） | Lead(viewer) |
| 9 | 镜头微动 | 中 | 1h | 中（裁切） | Lead(viewer) |
| 10 | 尘土/影子动效 | 中 | 0.5h | 低 | behavior |
| 11 | 像素/DPI A/B | 中 | 1h | 低 | Lead + QA |
| 12 | 伪 AO | 中低 | 1.5h | 中（贴图管理） | behavior/Lead |
| 13 | 描边实验 | 低 | 2h+ | 高（风格） | Lead 实验 |
| 14 | 颜色管理核查 | 低 | 0.5h | 低 | Lead |
| 15 | bloom/DOF | 不做 | — | 高 | — |

---

## 6. 文件级拆分、接口与顺序

### 6.1 所有权/写作用域（建议）

| 文件 | 所有者 | 本阶段改动 | 依赖/风险 |
|---|---|---|---|
| `src/renderer/animator.ts` | behavior-dev | 姿态层 + sit/doze/sleep/wake/stretch/pet/play 时间轴；walk 同步；pitch 安全；事件回调；`applySnapshot()` | 需先冻结 `BehaviorSnapshot`；不要与 Lead 抢 `viewer` |
| `src/renderer/bread.ts` | behavior-dev | 道具通用化/scale-in/out；hand anchor；可选 fish 纹理 | 依赖 `PetApi.loadAsset`（如需新纹理） |
| `src/renderer/snacks.ts` | behavior-dev | 接触阴影层；dust/sparkle/heart API；世界坐标锚点；photo freeze | 需确认 z-index/点击穿透；与 particles 互不影响 |
| `src/renderer/pet.ts` | behavior-dev | 组合根：BehaviorMachine 接线、调度器、睡眠/坐/起床、喂食/玩具、音频/粒子、debug API 扩展 | 与 Lead 的 `main/index` 集成交界；合并冲突风险最高 |
| `src/shared/behavior.ts`（新） | behavior-dev（需 Lead 批准） | 纯状态机/时间轴/冷却/仲裁；可测试 | 新增文件，必须 Lead 批准写作用域 |
| `src/renderer/toys.ts`（新，可选） | behavior-dev（需批准） | 毛线球 mesh/物理/程序化纹理 | 需避免新资产白名单；如果不可，放 P1 以后 |
| `src/renderer/viewer.ts` | Lead（建议） | `BlinkTexture` half 状态；灯光/相机接口；pixelRatio/颜色 | behavior 只提供像素 spec；避免两边同时改 BlinkTexture |
| `src/renderer/audio.ts` | Lead（建议） | purr1–3/meow1、呼吸 loop、purr loop、fireLoop 可选；循环停止/淡出 | 依赖 IPC 白名单；behavior 只调用 |
| `src/renderer/gestures.ts` / `src/shared/gesture.ts` | interaction-dev | 睡眠按压策略；双击/长按动作；`onInterrupt`；点击/拖拽事件语义 | 不能改 pet.ts；接口由 Lead 冻结 |
| `src/main/ipc.ts`、`preload/index.ts` | platform-dev | idle 事件、behavior busy、动作 IPC、资产白名单（purr/meow）、设置接口 | 安全：只允许命名动作，不接受任意路径 |
| `src/main/pet-window.ts` | platform-dev | walking 时 60fps；`pauseWalk()/resumeWalk()`；busy 时不自动走；速度调整 | 与 behavior 的 pause 接口时序 |
| `src/main/index.ts`、`tray.ts` | platform/Lead | `powerMonitor` idle、托盘“喂食/玩”、快捷键注册、动作转发 | 集成点归 Lead |
| `src/shared/settings.ts`、`settings.*` | Lead/platform | activityLevel/sleepEnabled/sleepAfterIdleSec/wakeStretch/sleepSounds；校验/默认值 | 所有端共享，先冻结 |
| `tests/behavior.test.ts`（新） | qa-visual（或 behavior 经批准） | 状态机/冷却/打断的纯逻辑测试 | 测试所有权归 QA；不要和 QA 抢 |

### 6.2 需要冻结的接口（草案）

```ts
// src/shared/behavior.ts
export type BehaviorState =
  | 'idle' | 'walk' | 'sit' | 'doze' | 'sleep' | 'wake'
  | 'stretch' | 'eat' | 'play' | 'drag' | 'photo' | 'closing'

export type EyelidState = 'open' | 'half' | 'closed'
export type LocomotionDemand = 'run' | 'pause'

export interface BehaviorInput {
  nowMs: number
  dtMs: number
  systemIdleSec: number | null // null = 读不到，不睡眠
  cursorOnPet: boolean
  walking: boolean
  photoFrozen: boolean
  settings: Pick<PetSettings, 'activityLevel' | 'sleepEnabled' | 'sleepAfterIdleSec' | 'wakeStretch' | 'sleepSounds'>
}

export interface BehaviorPose {
  sit: number      // 0..1
  doze: number
  sleep: number
  wake: number
  stretch: number
  eat: number
  play: number
  pet: number
}

export type BehaviorEvent =
  | { type: 'wake' }
  | { type: 'sleepEnter' }
  | { type: 'stretchStart' }
  | { type: 'purr'; volume: number }
  | { type: 'breathStart' } | { type: 'breathStop' }
  | { type: 'footstep' }
  | { type: 'bite'; index: number }
  | { type: 'hearts'; count: number }
  | { type: 'crumbs'; count: number }
  | { type: 'locomotion'; demand: LocomotionDemand }
  | { type: 'playSpawn' } | { type: 'playPounce' }

export interface BehaviorSnapshot {
  state: BehaviorState
  elapsedMs: number
  pose: BehaviorPose
  eyelids: EyelidState
  events: BehaviorEvent[] // 每帧消费后清空
}
```

`PetAnimator` 增加 `applySnapshot(snapshot: BehaviorSnapshot): void` 或 `setBehaviorPose(pose, eyelids)`；`pet.ts` 每帧/定时器把 snapshot 交给 animator；animator 不再自己决定 `pet/stretch/eat` 的开始，只负责插值/回退。

**IPC（platform）**：
```ts
type InteractionAction = 'feed' | 'play' | 'sleep' | 'wake'
interface PetApi {
  onSystemIdle(cb: (seconds: number) => void): () => void
  getSystemIdleSeconds(): Promise<number | null> // 若 main 推送，可只用 onSystemIdle
  setBehaviorBusy(busy: boolean, reason: 'sit' | 'sleep' | 'eat' | 'feed' | 'play' | 'stretch' | 'pet' | 'drag'): void
  onInteractionAction(cb: (action: InteractionAction) => void): () => void
}
```
- main 用 `powerMonitor.getSystemIdleTime()` 每 5s 推送；锁屏/睡眠/恢复时也发。
- main 收到 `setBehaviorBusy(true)` 时：不再启动 auto-walk，若正在走则 `stopWalk()`；`false` 后重新计时，不立刻走。
- 托盘/快捷键只发送命名的 `InteractionAction`；不开放任意窗口/文件操作。

**设置**（§3.8）：先由 Lead 冻结字段，platform 实现默认值/校验/设置 UI 开关。

**资产白名单**（platform/Lead）：新增 `purr1`、`purr2`、`purr3`、`meow1`（文件已经在 `public/assets/vanilla/sounds/mob/cat/`；只需 IPC/preload/audio 接入）；如果玩具用程序化纹理，则无需新贴图；鱼干则需要 `cod` 贴图 + 资产提取流程。

**BlinkTexture**（Lead）：`setEyelid(state: 'open' | 'half' | 'closed')`；half 状态下 fill 上半行；sleep 用 closed 持续；注意原始 ImageData 与 AO/腮红叠加的协调。像素 spec 见 §2.3。

**PetAudio**（Lead）：`purr(): void`（随机 purr1–3）、`meow(): void`（15% 概率由调用方决定）、`breathStart()/breathStop()`、`purrLoopStart()/purrLoopStop()`、`fireLoopStart()/Stop()`（可选）；循环要淡入/淡出，muted/volume 变化时立即生效；photo freeze 时暂停。

**PetGestures（interaction）**：
- 新增 `setSleepingPolicy(sleeping: boolean)` 或在 `GestureEffects` 加 `shouldSuppressPressFeedback()`；睡眠中按压 **不压扁、不播 Ya1**，但仍启动长按/拖拽计时；松开时若未拖动且 <1.5s → 发送 `dozeNudge` 事件而不是普通 click。
- 新增 `onPointerDown/onPointerUp/onDragStart/onDragEnd` 回调或事件总线，供 `BehaviorMachine` 直接消费；避免 pet.ts 通过轮询状态猜。
- 双击/右键/DOM 事件只在用户选定 Q4-B 时加；不默认改左键语义。
- 拖拽开始/关闭/恢复时通知 behavior 重置睡眠状态；close/restore 必须清空 sleeping/actionLock。

**与并行审计的对齐（2026-10-21）**：

- **INTERACTION-AUDIT**：该流已经确认 `INT-P0-01`（前 250ms 抖动会永久取消长按，火把/关闭不可达）和 `INT-P0-02`（`longPressMs` 未消费）；这两项必须由 interaction 在 T2 先修，否则本审计的“睡眠中长按火把/关闭”验收无法通过。动作入口应复用 interaction 计划的 `src/shared/actions.ts` + `src/renderer/actions.ts` + `pet:action`（白名单/`canRunAction`），behavior 只消费 `feed/play/sleep/wake` 请求，**不另建第二套 action 总线**；interaction 也明确“posture 状态机是唯一真相”，与本审计 §3 一致。
- **PLATFORM-AUDIT**：该流计划 `pet:display-mode`/`peek` 状态和 settings schema v2；本审计的 `peekMode` 按 §3.9 对接，新增设置字段并入 schema v2 + `migrateV1toV2`，**不要直接把 `version:1` 改成 `version:2` 而丢失旧设置**。`src/main/index.ts`/`ipc.ts` 仍由 Lead 写。
- **INTERACTION-AUDIT 的 `INT-P0-04`**（关闭/隐藏后火把状态残留）会影响“睡眠中自动火把/恢复”验收；behavior 的 sleep 只负责“抑制自动火把”，火把状态复位由 interaction/Lead 修。

### 6.3 建议任务拆分（write-scoped）

| 任务 | 内容 | 所有者 | 依赖 | 预计 |
|---|---|---|---|---|
| T0 | 用户答复 Q1–Q8；Codex/Lead 冻结接口/settings/IPC | Lead + Codex | 本审计 | 0.5h |
| T1 | platform：idle 推送、busy/walk pause、60fps 行走、Action IPC、设置字段、资产白名单 | platform-dev | T0 | 1.5–2.5h |
| T2 | interaction：睡眠按压策略、手势事件/打断、双击（如选） | interaction-dev | T0 | 1–1.5h |
| T3 | Lead：`viewer.ts` BlinkTexture half、灯光/相机；`audio.ts` purr/meow/breath | Lead | T0（可与 T1/T2 并行） | 1–1.5h |
| T4 | behavior：`shared/behavior.ts` + `animator.ts` 姿态层 + sit/doze/sleep/wake/stretch/pet 时间轴 | behavior-dev | T3（BlinkTexture/audio 接口） | 3–4h |
| T5 | behavior：`snacks.ts` 接触阴影/dust/sparkle/hearts + `bread.ts` anchor/scale | behavior-dev | T4 的 pose 接口 | 1.5–2h |
| T6 | behavior：`pet.ts` 接线、动作锁/调度器、喂食/摸头、debug API | behavior-dev | T1/T2/T3/T4/T5 | 2–3h |
| T7 | behavior（可选）：`toys.ts` 毛线球/扑击 | behavior-dev | T6 + 用户 Q5 | 2–3h |
| T8 | QA：CDP state、截图矩阵、回归、性能 | qa-visual | T6/T7 + build | 2h |

**总估计**：P0（T0–T6）约 **9–14 agent 小时**；加玩具/鱼干（T7）再加 2–3h；QA 2h；Review/合并另计。可以拆成两个写任务：
- **B-P0a（仲裁+待机/走/摸头/阴影）**：T0–T6 中不依赖新姿态的部分；交付“不再滑行、有影子、摸头有 purr/hearts”。
- **B-P0b（坐/睡/赖床/伸懒腰+喂食）**：在 B-P0a 后的第二波；交付状态机/时间轴。
如果用户想更快看到全屏探头/设置，本行为任务不应抢 platform 的 P0；按 TEAM-HANDOFF 的“先让用户看到托盘/全屏”顺序，行为可以并行但集成排在 platform 之后。

### 6.4 必须顺序执行的链路

1. **T0 接口冻结** → 否则 `pet.ts` 会和 platform/preload 反复改。
2. **T1 settings/preload/IPC + T2 gesture policy + T3 viewer/audio** → 必须早于 T6，否则 feed/pet/sleep 只能写死或临时 hack。
3. **T4 姿态接口** → 早于 T5（`snacks` 需要 pose/head anchor）和 T6。
4. **T6 pet.ts 集成** → 必须等 T1/T2/T3/T4/T5；这是唯一的大合流点，Lead 应预留 review。
5. **T7 toy** → 可在 T6 后独立加；不要并行改 `pet.ts` 和 `toys.ts` 之外的文件。
6. **T8 QA** → 最后；build + CDP + 截图；真实桌面由 Lead/QA 用 scheduled task，不在 worker 会话开可见 GUI。

### 6.5 验收门槛（建议写进任务）

- `electron-vite build` + `tsc --noEmit` + `vitest run` 全绿；保留 17 个旧测试，新增 behavior 单测（状态迁移/冷却/打断）至少 8–12 条。
- CDP `window.__niko.getState()` 扩展：`behaviorState`、`pose`、`eyelids`、`sleeping`、`actionLock`、`systemIdleSec`。
- 截图矩阵：idle / walk L/R / sit / doze / sleep / wake / stretch / pet / feed / toy / landing / dark+light wallpaper / 80/220/500px / 100%+125% DPI；每张检查裁切/脚底/影子/穿模/文字（必须无文字）。
- 性能：idle CPU <3%，walk <8%；两分钟无内存增长；sleep 时渲染/音频都降低。
- 睡眠触发/唤醒的真实时序：系统空闲 10min（可用 debug 注入 idle 秒数模拟，不必真等）；点击/拖动/长按/关闭/恢复逐项验收。
- 用户确认：至少 sit/sleep/wake/stretch/pet/feed 六个动作的真实录屏或连续截图。

---

## 7. 需要用户拍板的问题（8 个，含推荐）

> 回复格式建议：`Q1-A, Q2-A, Q3-A, Q4-A, Q5-A, Q6-A, Q7-A, Q8-A`。若暂不回复，按推荐项实现，并在 M2/M3 报告标注“默认决策”。

### Q1. 默认活跃度/频率

- **A（推荐）低打扰**：明显随机动作 2–5 分钟一次；坐 = 90–180s 无互动后 65% 概率；睡 = 系统空闲 ≥10min（夜间 22:00–07:00 空闲 ≥5min）；保留三档设置（低/标准/活跃），默认低。
- B. 标准：明显动作 1–3 分钟；坐 60s；睡空闲 5min。
- C. 活跃：明显动作 30–90s；坐 30s；睡空闲 3min；更接近 Shimeji。
- D. 不随机：只眨眼/呼吸/看鼠标，所有动作都由用户快捷键触发。

> 推荐 A；它满足用户“默认低打扰 + 可配置”的要求，也不让桌宠完全变成静态摆件。

### Q2. 睡姿

- **A（推荐）坐睡**：腿前伸、身体降低、头低垂、手臂收拢；穿模/出窗风险最低，和 sit 共用姿态。
- B. 侧躺：整体横向躺任务栏，最可爱，但需要整体旋转，容易出窗/穿桌沿/穿模。
- C. 站立打盹：只低头闭眼，几乎不改变姿态；最不打扰但“睡”不明显。
- D. 先做 A，后续版本再尝试 B。

> 推荐 A（或 D）；如果用户坚持侧躺，需要额外 1–2 个任务做姿态/取景验证。

### Q3. 唤醒/赖床

- **A（推荐）低打扰赖床**：第一次点击只半醒/赖床 1–2s，第二次点击（3s 内）或拖动才完全醒；系统活动回来 → 1.2s 后 wake + 伸懒腰；同一个空闲周期只醒一次。
- B. 点击立即醒 + 伸懒腰。
- C. 点击只眨眼，只有拖动/快捷键才醒。
- D. 睡眠中不响应任何鼠标。

> 推荐 A；这是“猫会赖床”的核心萌点，也避免用户轻碰就惊醒。

### Q4. 喂食/玩具的入口

- **A（推荐）托盘菜单 + 自定义全局快捷键**：不改变现有左键语义；托盘加“喂食/玩”，设置里可绑定快捷键；桌面仍无文字。
- B. 双击宠物 = 喂食，三击 = 玩具：交互直接，但容易误触，且现有双击无定义。
- C. 角色旁悬浮小图标菜单：可见 UI，可能违反“桌面无文字/极简”的既定决策。
- D. 只保留自动随机，不提供用户触发。

> 推荐 A；如果用户想要更直接，可以 A + B（双击喂食）组合，但需要 interaction 增加双击判定和冷却。

### Q5. 新增互动范围

- **A（推荐）先做三项**：摸头反馈升级 + 手喂面包 + 毛线球；工期可控，覆盖“摸/喂/玩”。
- B. 只做摸头 + 喂食；更稳，先把坐睡做好。
- C. 再加小鱼干、逗猫棒、追光标扑击；内容更丰富，但资产/时间轴/测试都会增加。
- D. 只做坐/睡，不做互动。

> 推荐 A；小鱼干/逗猫棒/扑击可作为二期（§4.4/§4.5 已给设计）。

### Q6. 睡眠音效

- **A（推荐）MC 猫 purr1–3 + 程序化呼吸**：素材已经在本地，只需加 IPC/preload/audio 白名单；默认低音量；可静音。
- B. 只用程序化呼吸/呼噜，不加新资产：零资产依赖，但猫味弱一点。
- C. 睡眠完全静音：最安静，但少了“活着”的感觉。
- D. 加打鼾声：没有现成 MC 打鼾素材，需要自制或找素材，不建议。

> 推荐 A；如果不希望再动资产白名单，选 B。

### Q7. 视觉质感优先级

- **A（推荐）接触阴影 + 动作/眨眼/视线打磨 + 轻光影**：低风险、高回报，保持 MC 方块风。
- B. 加 1px 描边/轮廓：远看更清楚，但可能不像 MC，且透明边缘有 alpha 风险。
- C. 上 bloom/景深/后处理：透明窗口性价比低，容易破坏像素质感。
- D. 优先更高分辨率/抗锯齿：更锐利，但可能失去“像素块”感，且 125% DPI 不一定变清晰。

> 推荐 A；B 可作为设置项/二期实验，C 暂不做。

### Q8. 镜头

- **A（推荐）固定 3/4 + 极轻微鼠标视差 + 动作时 ≤2% 推拉**：保留现有构图，增加呼吸感，不裁切。
- B. 睡/吃时自动推近：更亲密，但需要更多取景测试，且可能频繁变化。
- C. 允许用户拖动旋转视角：改变“固定 3/4”决策，需要设置 UI 和持久化。
- D. 完全固定，不做任何镜头运动。

> 推荐 A；先做 A，若用户喜欢再在 B 上做可选开关。

---

## 8. 给 Lead 的简报（结论 + 交付建议）

### 8.1 结论

- 当前代码的**动作库**已够用，缺的是**行为编排**；坐/睡/赖床不是单独加 4 个动画，而是要先把 `BehaviorMachine`、动作锁、走路暂停、系统空闲接口做出来，否则会继续出现“边吃边走/滑行伸懒腰/点击叠加”。
- 视觉上先修 **3 个根问题**：接触阴影、头部俯仰安全范围、走路同步；再谈光影/镜头/描边。现有 `m2-stretch.png` 证明伸懒腰轮廓需要重做。
- 摸头反馈是低成本高回报：purr 素材已经在本地，只差白名单 + hearts；建议和 P0 一起做。
- 现有截图有的来自 M1 早期，不能直接当当前回归基线；必须让 QA/Lead 用当前 build 重新截走路/头部矩阵。

### 8.2 P0 改进（按实现顺序）

1. **行为仲裁基础**：`src/shared/behavior.ts` + `pet.ts` 接线 + `main` 的 `pauseWalk/resumeWalk` + `setBehaviorBusy`；所有随机/用户动作走 `actionLock`。
2. **走路同步**：main walking 60fps + 速度 80–110px/s（或用户选择 B 方案）+ renderer 步频/摆幅按速度计算 + 起步/停步 settle。
3. **头部安全**：pitch 限 ±40° + body lean/head lift；用 CDP 确认 pitch 符号（疑似反）；yaw 截图矩阵。
4. **摸头反馈**：慢摆 0.8Hz、purr1–3、hearts、身体侧倾、睡眠 dozeNudge；冷却 1.5s。
5. **接触阴影**：`snacks.ts` 第二 canvas；随压扁/跳跃/拖拽/坐睡缩放；photo freeze 同步。
6. **坐/睡/赖床**：§3 的时间轴；默认低打扰；睡眠需要 idle IPC；sleep 中点击/拖动/长按规则按 §3.5。
7. **伸懒腰重做**：§2.6 时间轴；确保不挡脸/不穿模、不在走路中播放。
8. **进食/喂食**：统一 `eat` 动作锁；暂停走路；面包 anchor；碎屑/爱心锚点；随机频率 10–25min。

### 8.3 状态机/接口（需 Lead 冻结）

- `BehaviorState`/`BehaviorSnapshot`/`BehaviorEvent`/`BehaviorPose`（§6.2）。
- IPC：`onSystemIdle`、`setBehaviorBusy`、`onInteractionAction`（feed/play/sleep/wake）；main 只接受命名动作。
- 设置：`activityLevel`、`sleepEnabled`、`sleepAfterIdleSec`、`wakeStretch`、`sleepSounds`（以及必要的 UI 开关）。
- 资产：`purr1–3`、`meow1` 加入白名单；`fireLoop` 可选接入；玩具优先程序化纹理，避免新资产。
- `BlinkTexture.setEyelid('open'|'half'|'closed')`；`PetAudio.purr/meow/breathStart/Stop`；`PetGestures` 睡眠按压策略/事件回调。

### 8.4 给 Lead 的请求

1. 等用户答 Q1–Q8；同时把 §6.2 接口发给 Codex 审一次，冻结版本后再分任务。
2. 给 platform 开 T1（idle/busy/assets/settings/60fps）；给 interaction 开 T2（sleep press policy/gesture events）；Lead 自己拿 T3（viewer BlinkTexture/灯光/相机 + audio purr）。
3. 给 behavior 开一个 write-scoped 任务，范围至少：
   ```
   docs/streams/BEHAVIOR-AUDIT.md（已完成）
   src/shared/behavior.ts（新，需批准）
   src/renderer/animator.ts
   src/renderer/bread.ts
   src/renderer/snacks.ts
   src/renderer/pet.ts
   src/renderer/toys.ts（二期/可选，需批准）
   tests/behavior.test.ts（与 QA 协调）
   ```
   **不改** `viewer.ts`/`audio.ts`/`gestures.ts`/`main/**`，这些由 Lead/platform/interaction 按 T2/T3 完成；避免写作用域重叠。
4. 真实桌面验收由 Lead/QA 用 scheduled task + CDP；worker 不启动可见 GUI、不重启用户实例。
5. 建议把 P0 拆两波：**B-P0a 仲裁+走路+头部+摸头+阴影**；**B-P0b 坐睡/赖床/伸懒腰+喂食**；玩具/鱼干二期。这样用户能更早看到“不滑行、有影子、摸头有反馈”，再看到睡姿。

### 8.5 风险与未决

- **未验证姿态**：sit/sleep 的腿/身体偏移是初值，必须用截图矩阵确认；若脚出窗/穿桌沿，优先调 `wrapper.position.y` 与相机 target，不要硬压。
- **pitch 符号**：高概率是反的，需要 CDP 一帧确认；如果确实反了，修复成本很低，但会影响“看鼠标”的既有观感，需要告知用户。
- **BlinkTexture 与 AO**：先做 blink 2×3；AO 后做，必须统一原始贴图管理。
- **idle IPC 不可用**：某些系统/远程会话读不到 idle；降级为“不睡，只坐”，日志记录，不报错。
- **性能**：阴影 + 更多粒子 + 60fps 窗口移动可能提高 CPU；验收 A13（idle <3%、walk <8%）；sleep 时降低更新/音频。
- **合并冲突**：`pet.ts` 是合流点，Lead 需要最后 review；`main/index.ts`/`ipc.ts` 不要由 behavior 改。
- **跨流阻塞**：interaction 的 `INT-P0-01`（抖动取消长按）和 `INT-P0-02`（`longPressMs` 未消费）不修，睡眠中长按火把/关闭不可验收；`INT-P0-04`（火把状态残留）不修，睡眠/恢复会带火把。platform 的 `pet:display-mode`/settings v2 未冻结，§3.9 与新增设置字段不能开工。
- **用户选择**：若 Q2 选侧躺、Q5 选 C（更多互动），本审计的工期/测试矩阵会扩大 1.5–2 倍，需要重新排期。
- **COMMANDER-BRIEF 缺失**：Codex 的路线若改变 P0 顺序（例如先全屏探头/安装包），行为任务应让路；本文件的状态机/接口仍可复用。

### 8.6 就绪度声明

- 本次审计**没有写代码**；工作区原有 M2/M3 改动未动；未重启用户实例。
- 基线：`vitest` 17/17、`tsc` 通过；构建基线参考 M1 报告（未在本次跑 build）。
- **Ready**：只要 Lead 确认写作用域 + 用户回答 Q1–Q8（至少 Q1–Q5），behavior-dev 可以开始 B-P0a；预计第一波交付 4–6 agent 小时（不含 Lead/platform 的接口工作与 QA）。
- **Blocked**：不阻塞于代码；阻塞于 **接口冻结**（T0）与 **用户决策**（Q1–Q8）。如果 Lead 决定先做全屏探头/安装包，行为线保持 audit 完成状态，等排期。

---

## 9. 附：结论一句话

**先把“行为编排 + 走路同步 + 头部安全 + 摸头反馈 + 接触阴影”做扎实，再做坐/睡/赖床/喂食/玩具；否则新增动作只会把现有的“滑行、叠加、穿模”放大。**

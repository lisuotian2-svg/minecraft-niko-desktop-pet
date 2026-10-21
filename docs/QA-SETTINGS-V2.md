# QA — Settings v2 迁移与默认值（QA-SETTINGS-V2）

> 版本：v1.0 · 日期：2026-10-21 14:28–14:32（Asia/Shanghai）· 执行：qa-visual
>
> 任务：task-13。`platform-dev` 的 task-11 已把 settings 升到 v2；本轮只更新测试并补迁移用例，**不改 `src`**（包含 `src/main/settings.ts`、`src/shared/settings.ts`），不重启/干扰当前 live pet，不启动可见 GUI。
>
> 写权限：`tests/settings.test.ts`、`tests/settings-v2.test.ts`、`docs/QA-SETTINGS-V2.md`。

---

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| 旧测试修复前 | `vitest` **2 failed / 32 passed**：`settings.test.ts` 仍断言 `version:1`、`autostart:false`，并把合法 v2 文件 `{"version":2,"size":300}` 当作 corrupted |
| 旧测试修复后 | `vitest` **50 passed / 0 failed**（5 files，652 ms），exit 0 |
| 类型检查 | `tsc --noEmit -p tsconfig.json` **exit 0** |
| 新增测试 | `tests/settings-v2.test.ts` 16 条：迁移 6、夹紧/校验 3、hotkeys 4、SettingsStore 持久化 3 |
| 迁移语义 | v1 → v2 保留旧字段；旧 `autostart=false` 保持 false；v1 缺 autostart 按旧默认 false；全新安装/无文件 autostart=true；未来版本/损坏 JSON 备份并恢复 v2 默认 |
| 仍待接线 | `autostart` 真正写系统登录项、settings UI 暴露 v2 字段、`HotkeyManager` 注册/冲突处理；本轮只验证 schema/store 语义 |

> 一句话：**settings v2 的 schema 层和 store 层已经可以被测试固定下来；红转绿完成，`src` 未改。**

---

## 1. 变更文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `tests/settings.test.ts` | 更新 | 3 条旧断言改为 v2：默认 `version=2`、`autostart=true`；v2 `size=300` 合法；新增 v1→v2 缺 autostart 的断言 |
| `tests/settings-v2.test.ts` | 新增 | 16 条迁移/默认值/夹紧/hotkeys/store 持久化测试 |
| `docs/QA-SETTINGS-V2.md` | 新增 | 本报告 |

**没有修改**：`src/main/settings.ts`、`src/shared/settings.ts`、其他 `src/**`、`package.json`、`public/**`、`tools/**`、`tests/settings-store.test.ts`、`tests/gesture.test.ts`、`tests/walk.test.ts`。

---

## 2. 只读源码基线（v2）

`src/shared/settings.ts` 当前 schema：

- `version: 2`
- 旧字段保留：`firstRun`、`size`、`nickname`、`volume`、`muted`、`autostart`、`longPressMs`、`darkThreshold`、`autoTorch`、`clickSounds`、`particles`、`photoDir`、`lastDisplayId?`、`lastX?`
- v2 新字段：`activityLevel`、`performanceMode`、`randomActions`、`actionSounds`、`fullscreenPeek`、`peekFrequency`、`sleepEnabled`、`sleepAfterIdleSec`、`wakeLieInSec`、`closeSignEnabled`、`startHidden`、`hotkeys`

默认值（`DEFAULT_SETTINGS`）：

| 字段 | 默认 |
|---|---|
| `version` | `2` |
| `autostart` | `true`（仅全新安装；已有 v1 文件保留原值） |
| `activityLevel` | `low` |
| `performanceMode` | `normal` |
| `randomActions` | `true` |
| `actionSounds` | `true` |
| `fullscreenPeek` | `true` |
| `peekFrequency` | `standard` |
| `sleepEnabled` | `true` |
| `sleepAfterIdleSec` | `1200` |
| `wakeLieInSec` | `3` |
| `closeSignEnabled` | `true` |
| `startHidden` | `false` |
| `hotkeys` | `DEFAULT_HOTKEYS`（`src/shared/contracts.ts`） |

---

## 3. 旧测试失败与修复

修复前实际输出：

```text
Test Files  1 failed | 3 passed (4)
Tests       2 failed | 32 passed (34)
```

失败 1：`tests/settings.test.ts` 的默认值断言仍为 `version: 1`、`autostart: false`。

失败 2：`{"version":2,"size":300}` 被旧测试期望为 `{ settings: DEFAULT_SETTINGS, corrupted: true }`，但当前实现把它当作合法 v2（`corrupted:false`、`size:300`）。

修复：

- 默认值改为 `version:2`、`autostart:true`，并补 v2 新字段的默认断言。
- `{"version":2,"size":300}` 改为合法 v2；未来版本（3、0、字符串 "2"）才作为 corrupted。
- `{"version":1,"size":300}` 期望迁移到 v2，且缺 autostart 时按旧默认 `false`。

---

## 4. 迁移语义矩阵（已测试）

| ID | 输入 | `corrupted` | 结果/关键断言 |
|---|---|---|---|
| SET-V2-01 | 完整 v1 fixture（size 321、volume 0.65、nickname `Niko-v1`、photoDir `D:\NikoPhotos`、autostart false 等） | false | `version=2`；全部旧字段原值保留；新字段取默认；`hotkeys=DEFAULT_HOTKEYS` |
| SET-V2-02 | v1 + `autostart:true` / `autostart:false` | false | 分别保持 true / false |
| SET-V2-03 | `{"version":1,"size":300}`（缺 autostart） | false | `version=2`、`size=300`、`autostart=false`（旧 v1 默认） |
| SET-V2-04 | `{"version":2,"size":300}`（缺 autostart） | false | `version=2`、`size=300`、`autostart=true`（新安装默认） |
| SET-V2-05 | `{"version":2,"autostart":false}` | false | `version=2`、`autostart=false` |
| SET-V2-06 | `{"version":3,"size":300}` / `{"version":0,...}` / `{"version":"2",...}` | true | 恢复 v2 默认（`autostart=true`） |
| SET-V2-07 | malformed JSON / `null` / v1 字段类型错误（如 `size:"large"`） | true | 恢复 v2 默认；SettingsStore 备份并重写 |

完整 v1 fixture（测试内定义，等价于 M1/M2 写出的文件）：

```json
{
  "version": 1,
  "firstRun": false,
  "size": 321,
  "nickname": "Niko-v1",
  "volume": 0.65,
  "muted": true,
  "autostart": false,
  "longPressMs": 1800,
  "darkThreshold": 42,
  "autoTorch": false,
  "clickSounds": false,
  "particles": false,
  "photoDir": "D:\\NikoPhotos",
  "lastDisplayId": 2,
  "lastX": 777
}
```

迁移后的断言是“旧字段全保留 + 新字段全默认”，不是只抽查 size/volume。

---

## 5. 新字段夹紧与 JSON 校验策略

### 5.1 数值夹紧（`parseSettings`，直接调用）

| 字段 | 范围 | 测试边界 |
|---|---|---|
| `size` | 80–500 | 1→80，999→500 |
| `volume` | 0–1 | -2→0，9→1 |
| `longPressMs` | 1000–2000 | 1→1000，9999→2000 |
| `darkThreshold` | 10–60 | 1→10，999→60 |
| `sleepAfterIdleSec` | 60–86400 | 0→60，999999→86400 |
| `wakeLieInSec` | 1–60 | 0→1，999→60 |

### 5.2 枚举/布尔回退（直接调用 `parseSettings`）

- `activityLevel: "hyper"` → `low`
- `performanceMode: "ultra"` → `normal`
- `peekFrequency: "sometimes"` → `standard`
- `randomActions: "yes"`（非布尔）→ `true`（默认）

### 5.3 JSON 文件级策略（`parseSettingsJson`）

- **数值越界不算 corrupted**：会夹紧到合法范围，文件保留（`corrupted:false`）。
- **枚举/布尔/hotkeys 类型错误算 corrupted**：整个文件备份 + 恢复 v2 默认，而不是静默局部回退。
- **未来版本**（3、0、字符串 "2"）算 corrupted；**v1/v2** 合法。
- **v1 无 autostart** 按旧默认 `false`；**v2 无 autostart** 按新安装默认 `true`。

> 这是“严格文件级校验”策略：坏字段会让整个 `settings.json` 走备份恢复。若产品希望“只回退坏字段、保留其它设置”，需要 platform 调整 `hasValidFieldTypes()`；本轮测试固定的是**当前实现**，不擅自改 `src`。

---

## 6. Hotkeys 策略（已测试）

`src/shared/settings.ts` 的 `parseHotkeys`：

| 情况 | 结果 |
|---|---|
| 整个 `hotkeys` 缺失 / 不是对象（直接 `parseSettings`） | 回退 `DEFAULT_HOTKEYS` |
| 某个 action 缺失 | 用该 action 的默认值 |
| action 为 `null` | 显式清空（`null`） |
| action 为空白字符串 `"   "` | 清空（`null`） |
| action 为超长字符串 | trim 后截断为 64 字符 |
| 未知 action key | 忽略，不进入结果 |
| JSON 中 `hotkeys` 容器/条目类型错误 | 文件级 corrupted，备份并恢复默认（严格策略） |
| JSON 中合法 partial hotkeys（如 `{"photo":null}`） | `corrupted:false`；photo 为 null，其余用默认 |

已覆盖的 JSON 非法样例：`hotkeys:"bad"`、`hotkeys:[]`、`hotkeys:{"photo":5}`、`hotkeys:{"photo":{"key":"P"}}`。

> 风险备注：当前“一个非法 hotkey 条目导致整个 settings 文件备份恢复”对用户体验偏重；如果后续改为“只重置 hotkeys”，需要新增/调整测试并同步 settings UI。本轮按实际行为回归。

---

## 7. SettingsStore 持久化/备份（已测试）

`src/main/settings.ts` 未改动，只通过测试验证行为：

| ID | 场景 | 断言 |
|---|---|---|
| SET-V2-14 | 全新安装：临时目录无 `settings.json` | `load()` 返回 `version=2`、`autostart=true`、`hotkeys=DEFAULT_HOTKEYS`；写出的 `settings.json` 与返回值深相等；无 `.corrupt-*` |
| SET-V2-15 | 已有 v1 文件 | `load()` 返回迁移后的 v2（旧字段保留、autostart=false）；磁盘 `settings.json` 被重写为 `version=2`、autostart=false、size=321、hotkeys 默认；无 `.corrupt-*` |
| SET-V2-16 | 未来版本 `{"version":3,"size":300}` | 生成 `settings.corrupt-<timestamp>-<pid>.json` 备份；`settings.json` 重写为 v2 默认（size 220、autostart true） |

`tests/settings-store.test.ts` 保持原样并继续通过；它的坏 JSON 备份断言与 v2 默认不冲突。

---

## 8. 测试结果（直接二进制）

```powershell
cd C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d

cmd /c "node_modules\.bin\vitest.cmd run --reporter=verbose 2>&1"
cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json 2>&1"
```

| 命令 | exit | 结果 |
|---|---|---|
| `vitest run --reporter=verbose` | **0** | **Test Files 5 passed (5)，Tests 50 passed (50)**；Duration 652 ms；Vitest 5.0.5 |
| `tsc --noEmit -p tsconfig.json` | **0** | 无输出；strict + `noUncheckedIndexedAccess` |

测试文件分布：

| 文件 | 数量 |
|---|---:|
| `tests/walk.test.ts` | 4 |
| `tests/gesture.test.ts` | 25（interaction 既有） |
| `tests/settings.test.ts` | 3（已更新） |
| `tests/settings-store.test.ts` | 2（未改） |
| `tests/settings-v2.test.ts` | 16（新增） |
| **合计** | **50** |

`vitest` 的 stderr 输出（`settings damaged; backup…`、`settings migrated to v2`、`settings created with v2 defaults`）是测试**故意触发的预期日志**，不是失败。

> 本轮按任务要求只跑 `vitest` 与 `tsc`；**未重跑 `electron-vite build`**，避免在 G1 集成进行中与平台改动竞争，也不覆盖当前 live 实例正在使用的 `out/`。上一轮 QA 基线（13:51）的 build 为 exit 0；Lead 在 G1 集成时会跑最终 build。

---

## 9. 覆盖表（task-13 验收点 → 测试）

| task-13 要求 | 覆盖测试 |
|---|---|
| v1 fixture → v2，保留 size/volume/nickname/photoDir/autostart | SET-V2-01（完整旧字段比较） |
| 新字段默认 low/normal/true/standard/1200/3/DEFAULT_HOTKEYS | SET-V2-01 + `settings.test.ts` 默认值断言 |
| 全新安装 autostart=true | SET-V2-14（SettingsStore 无文件） |
| 已有 v1 autostart=false 迁移后仍 false | SET-V2-01/SET-V2-15 |
| v1 缺 autostart 按旧默认 false | SET-V2-03 |
| version=2 合法 | SET-V2-04/SET-V2-05 |
| 非法/损坏备份行为保持 | SET-V2-06/SET-V2-16 + 既有 `settings-store.test.ts` |
| 范围夹紧 | SET-V2-07/08（新旧字段） |
| hotkeys 非法回默认/清空 | SET-V2-10~13 |
| 不改 src / live pet 不受影响 | 见 §10 |

---

## 10. 未覆盖与风险

1. **autostart 的系统效果未测**：本轮只验证 settings 值和 store 迁移；`app.setLoginItemSettings`/portable 路径/关闭自启删除登录项属于后续 platform 接线，不能据本报告宣称自启功能完成。
2. **settings UI 未接线**：v2 新字段（activityLevel、peekFrequency、hotkeys 等）尚未在设置页暴露；用户暂时改不了这些字段。
3. **HotkeyManager 未接入**：`src/main/hotkeys.ts` 只是 skeleton，未在 `index.ts` 注册；本轮只测 settings 中的 hotkey 存储策略，不测全局快捷键冲突/占用。
4. **严格 corrupted 策略**：单个 hotkey 条目类型错误会触发整个文件备份恢复；若产品要求局部回退，需 platform 修改并更新测试。
5. **真实用户数据未触碰**：迁移测试全部用临时目录/fixture；没有读取或改写 `.scratch-userdata` / 正式 userData / `Pictures\NikoPet`。
6. **未跑 build**：见 §8 说明；`tsc` 已覆盖测试文件的类型检查。
7. **live pet 状态**：本轮未重启、未点击、未显示/隐藏；测试不启动 Electron GUI。

---

## 11. 复现

```powershell
cd C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d
cmd /c "node_modules\.bin\vitest.cmd run --reporter=verbose"
cmd /c "node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json"
```

快速核对迁移（只跑新增文件）：

```powershell
cmd /c "node_modules\.bin\vitest.cmd run tests/settings-v2.test.ts --reporter=verbose"
```

> 迁移逻辑的权威回归是 `tests/settings-v2.test.ts`；不要从打包后的 `out/main/index.js` 里取内部函数做验证。

---

## 12. 给 platform-dev / Lead 的回执

- task-13 的 2 个旧断言已按 platform-dev 给的语义修复：`version=2`、`autostart=true`、v2 size=300 合法。
- 迁移行为与 platform-dev 临时脚本验证一致：
  - 完整 v1 → v2 保留全部旧字段；
  - v1 缺 autostart → false；
  - v1 显式 false/true 保留；
  - 无文件新装 → true；
  - v3/损坏 → backup + v2 默认。
- 额外固定了 v2 新字段默认、数值夹紧、严格 JSON 类型策略、hotkeys 的清空/默认/截断/严格策略。
- 未改 `src/main/settings.ts`；可把本文件 §4–§7 直接引用到 `PLATFORM-P0-2-PREP`。

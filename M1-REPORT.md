# M1 报告

## 完成

- 将 M0 的主进程拆为窗口、设置存储、设置窗口、托盘、IPC 和文件日志模块；渲染端拆为 viewer、animator、gestures、hit-test 和 audio。预加载层提供类型化 API。
- 保留 M0 已验收的透明窗口、Slim 双层皮肤、`viewer.zoom = 0.55`、射线加皮肤 alpha 命中、33 ms 系统光标轮询、Ya1/Ya2 点击音和以脚底为轴的压扁/220 ms 回弹。桌宠页面仅有画布，没有文字或 HUD。
- 主进程以 30 fps 在当前显示器 `workArea` 内移动窗口，3–8 分钟间隔、每次 10–40 秒、默认约 40 px/s；边界反弹，隐藏时暂停。走路和方向变化经 IPC 同步到渲染端。渲染端加入手脚反相摆动、身体起伏、200–300 ms 转向、脚步声、呼吸、偶尔环顾和随光标看向、3–7 秒随机纹理眨眼及偶尔双眨。点击后闭眼/歪头/轻摆约 2.5 秒，可与行走叠加。
- 托盘提供显示/隐藏、设置、拍照占位、退出；窗口关闭会隐藏，托盘退出才结束进程；单实例启动。日志写到 `app.getPath('userData')/logs/main.log`。
- `settings.json` 使用共享的手动类型校验和范围归一化，损坏或不兼容时备份后恢复默认；写入临时文件再原子重命名。最小设置窗口显示版本、大小和音量滑块及保存/关闭。保存后广播设置，音量立即用于后续点击音。默认 220 px 对应 420×420 窗口；其他大小按比例调整窗口，保持底部锚点，并受当前工作区尺寸限制。
- 安装 Vitest，覆盖行走边界、方向、时间间隔、设置默认值/范围/坏 JSON，以及设置文件备份和并发保存；`tsconfig.json` 也将测试文件纳入 strict 类型检查。
- 未实现 M2/M3 的长按、拖拽、火把、面包、粒子、探头或拍照功能。托盘拍照项仅写占位日志。

## 文件结构

- `src/main/`: `index.ts`、`pet-window.ts`、`settings.ts`、`settings-window.ts`、`tray.ts`、`ipc.ts`、`logger.ts`
- `src/preload/index.ts`: 桌宠、设置和调试 IPC API
- `src/shared/`: `settings.ts`、`walk.ts`、`easing.ts`
- `src/renderer/`: `pet.ts`、`viewer.ts`、`animator.ts`、`gestures.ts`、`hit-test.ts`、`audio.ts`、`pet.css`、`index.html`、`settings.ts`、`settings.css`、`settings.html`
- `tests/`: `walk.test.ts`、`settings.test.ts`、`settings-store.test.ts`

## 验证命令与结果

均在项目根目录执行；没有启动 `pnpm dev`、Electron 或任何可见 GUI。

```powershell
pnpm add -D vitest --store-dir .pnpm-store/v11
pnpm build
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
```

结果：Vitest 5.0.5 安装成功，Electron 仍锁定 **44.7.0**；`pnpm build` 退出码 0，生成 main/preload 和桌宠、设置两张 HTML；`pnpm test` 退出码 0，**3 个文件、9 项测试全部通过**；独立 TypeScript strict 检查退出码 0。

还执行了以下纯 Node 构建检查，退出码 0：

```powershell
node -e "const fs=require('node:fs');const crypto=require('node:crypto');const paths=['out/main/index.js','out/preload/index.js','out/renderer/index.html','out/renderer/settings.html','out/renderer/assets/skin/niko.png','out/renderer/assets/whale/Ya1.mp3','out/renderer/assets/whale/Ya2.mp3',...Array.from({length:6},(_,i)=>'out/renderer/assets/vanilla/sounds/step/grass'+(i+1)+'.ogg')];for(const p of paths)if(!fs.existsSync(p))throw Error('missing '+p);const main=fs.readFileSync(paths[0],'utf8');if(!main.includes('nikoDebug'))throw Error('debug query missing');const skin=crypto.createHash('sha256').update(fs.readFileSync('public/assets/skin/niko.png')).digest('hex');console.log('built files='+paths.length+'; skin sha256='+skin)"
```

输出为 `built files=13`，皮肤 SHA-256 为 `715b4826eb9c7f0dd609a4cbad2cef5d130bf3f47fe323649350d5e2d7df705c`，与 M0 记录一致。

## 已知问题

- 本 Agent 上下文不能进行桌面 GUI 验收。透明合成、点击穿透到下层窗口、托盘显示、眨眼观感、声音听感和 30 fps 窗口移动流畅度仍需 Lead 用真实桌面、scheduled task 与 CDP 检查。
- 当设置尺寸超过当前工作区宽或高时，窗口会缩到工作区内；此时显示尺寸小于滑块选值。设置页的 `version` 当前显示项目包版本 `0.0.0`。
- 拍照项是 M1 规定的占位；首次运行向导、自启设置及完整设置页属于后续里程碑。

## 给 Lead 的验收步骤

1. 在真实桌面按既有 scheduled task/CDP 流程启动未打包的 M1 构建。启动参数带 `--debug-walk` 时，主进程立即开始走路，并给桌宠页加 `?nikoDebug=1`；`window.__niko` 因此可在构建产物中使用。`pnpm dev` 的开发页面也会暴露该 API。普通打包运行不暴露它。
2. 在桌宠页 CDP Console 执行 `window.__niko.getState()`，确认 `skinReady: true`、`zoom: 0.55`、`walking`、`facing` 等值。执行 `await window.__niko.forceWalk(1)`、`await window.__niko.forceWalk(-1)`、`await window.__niko.stopWalk()` 验证左右行走、平滑转向和停止；`window.__niko.viewer.playerWrapper.rotation.y` 可用于观察方向变化。
3. 用 CDP 鼠标事件点角色和透明区。按下时检查 `window.__niko.getState()` 的 `scaleX≈1.05`、`scaleY≈0.88`；松开后约 220 ms 回到 1，并检查 `petting` 和 `blinking`。确认透明区仍点到下层窗口、宠物不抢焦点；通过日志核对 `interactive`、`press`、`release` 和 `skin loaded`。
4. 从托盘打开设置，调大小和音量并保存；确认窗口底边仍贴 `workArea.bottom`，尺寸持久化，点击音量立即改变。隐藏后再显示，确认走路暂停/恢复；关闭宠物窗口后确认托盘仍在。检查 `app.getPath('userData')/logs/main.log` 中的启动、加载、走路和错误记录。

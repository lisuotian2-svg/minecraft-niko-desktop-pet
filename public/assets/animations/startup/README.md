# Niko 开启动画资源位

本目录预留给以后制作的开启动画素材，目前没有动画，不延迟启动。

- 未来可放贴图、音频、关键帧 JSON 等本地资源；Vite 会复制到 `out/renderer/assets/animations/startup/`。
- 接入口：`src/renderer/startup.ts` 的 `StartupAnimation` / `playStartupSequence()`。
- `src/renderer/pet.ts` 在 Slim 皮肤加载后调用该入口，结束后开放正常互动。
- 目前入口立即显示原角色；没有制作或播放任何开启动画。
- 未来动画继续使用现有窗口及 64×64 Slim 双层模型，完成后回到桌面；素材失败时恢复显示角色。
- 将文件放进目录不会自动播放。制作动画时需实现回调并在 `pet.ts` 的调用处接入。

# 第三方素材与来源声明

本文件说明仓库里**不属于 MIT 授权**的内容。代码部分见 [LICENSE](LICENSE)。

## 0. 角色

Niko（猫耳女巫）是独立游戏 **《OneShot》**（Future Cat LLC）的角色。本项目是非官方的同人桌宠，角色形象与名称版权归原作者所有，与 Minecraft 一样不属于 MIT 授权范围；未获官方背书，官方要求时会立即下架。Minecraft 皮肤格式只是承载形式。

## 1. 角色皮肤

| 文件 | 说明 |
|---|---|
| `public/assets/skin/niko.png` | 64×64 RGBA、Slim（3px 手臂）、双层皮肤，由项目所有者提供 |
| `docs/niko-reference.png` | 与上者同一张图，作为建模参考留档 |
| `public/assets/icon/niko.ico`、`niko-avatar.ico` | 由皮肤头部裁切生成的本项目图标 |

皮肤版权归皮肤作者所有；本项目仅按原样用于渲染。若皮肤作者要求，可随时移除。

## 2. Minecraft Java 1.20.1 音效与贴图

来源：本地已购买的 Minecraft Java 1.20.1 客户端（`assets/indexes/5.json` 引用的音效对象，以及客户端 jar 内的贴图）。
提取脚本：`tools/extract-vanilla.ps1`。

| 类别 | 文件 |
|---|---|
| 音效 | `public/assets/vanilla/sounds/step/grass1..6.ogg`、`mob/cat/purr1..3.ogg`、`purreow1.ogg`、`meow1.ogg`、`eat1..2.ogg`、`random/burp.ogg`、`fire/ignite.ogg`、`fire/fire.ogg`、`block/candle/extinguish1.ogg`、`mob/endermen/portal.ogg`、`portal/travel.ogg`、`random/click.ogg` |
| 贴图 | `public/assets/vanilla/textures/item/bread.png`、`block/torch.png`、`particle/heart.png`、`particle/flame.png`、`particle/effect_0..7.png`、`particle/glitter_0..7.png`、`particle/generic_0..7.png` |
| 清单 | `public/assets/vanilla/ASSETS.json`（提取记录，只保留文件相对路径与 SHA1） |

**版权归 Mojang Studios / Microsoft 所有。** 这些素材：

- 不属于 MIT 授权，不可再许可、不可商用；
- 仅用于个人、非商业的桌宠展示；
- 如果你要公开分发本项目的修改版或做二次发布，请先删除 `public/assets/vanilla/` 并替换为自有素材（或用 `tools/extract-vanilla.ps1` 从自己的 Minecraft 安装重新提取，且同样只限个人使用）。

本项目**不是** Mojang / Microsoft 的官方项目，未获其背书。

## 3. 点击音效（鲸鱼娘）

| 文件 | 来源 |
|---|---|
| `public/assets/whale/Ya1.mp3` | `dsh-whale-widget` 插件的 `assets/Ya1.mp3` |
| `public/assets/whale/Ya2.mp3` | 同上 `Ya2.mp3` |

该插件在 `PROVENANCE.md` 中明确 `assets/**` 不包含在其 MIT 授权内，只能随插件 as-is 使用，不授予再许可。此处按原样保留，仅作个人使用的按下/松开反馈音。

## 4. 运行时依赖

`Electron`、`Three.js`、`skinview3d`、`electron-vite`、`Vitest` 等 npm 依赖遵循各自的开源许可，详见 `node_modules/<pkg>/LICENSE` 或 `pnpm-lock.yaml` 中锁定的版本。

## 5. 免责

仓库中的第三方素材仅为演示桌宠效果而保留。若任何权利方认为本仓库内容不当，请通过 [issue](https://github.com/lisuotian2-svg/minecraft-niko-desktop-pet/issues) 联系，我会立即移除相关文件。

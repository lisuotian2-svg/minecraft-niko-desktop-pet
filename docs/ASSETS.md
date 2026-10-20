# 素材清单与来源

> **仅本地自用。** Niko 皮肤、Minecraft 音效/贴图、鲸鱼娘点击音的版权不属于本项目；不要公开分发、不要上传 GitHub Release、不要商用。代码可以 MIT，素材不可以。

## 1. 皮肤

| 文件 | 说明 | 来源 | SHA256 |
|---|---|---|---|
| `assets/skin/niko.png` | 64×64 RGBA，Slim（3px 手臂），双层 | 用户附件 `niko.png` | `715B4826EB9C7F0DD609A4CBAD2CEF5D130BF3F47FE323649350D5E2D7DF705C` |
| `resources/icon.ico` | 由皮肤头部正面生成，多尺寸 | 本项目派生 | 构建时生成 |

校验结果：64×64、RGBA、Slim 手臂区 192 个不透明像素、外层帽子/衣服/四肢有内容。

## 2. 鲸鱼娘点击音

| 文件 | 用途 | 来源 | SHA256 |
|---|---|---|---|
| `Ya1.mp3` | 按下 | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-whale-widget\assets\Ya1.mp3` | `0AD8F934AE5FA3CBD42745E086A56AA6532766618C6A620B860A795BDC7689F9` |
| `Ya2.mp3` | 松开 | 同目录 `Ya2.mp3` | `1A8998077E5E306C3088BB442CE36617261DD58200754F457469A520801C565B` |

- 该挂件的 `PROVENANCE.md` 明确：`assets/**` 不在 MIT 范围，按 as-is 随插件分发、仅供运行该插件，不授予再许可。
- 本项目仅本地使用；再次分发前必须替换为自制音效。

## 3. Minecraft Java 1.20.1 音效

索引：`%APPDATA%\.minecraft\assets\indexes\5.json`  
对象：`%APPDATA%\.minecraft\assets\objects\<hash前2>/<hash>`

| 用途 | 源 key | SHA1 |
|---|---|---|
| 脚步 1–6 | `minecraft/sounds/step/grass1..6.ogg` | grass1 `227ab99bf7c6cf0b2002e0f7957d0ff7e5cb0c96` |
| 猫呼噜 | `minecraft/sounds/mob/cat/purr1..3.ogg` | purr1 `0acdc21b0f56dbe214ae2574d1f02a0ea2e99877` |
| 猫伸懒腰/喵 | `minecraft/sounds/mob/cat/purreow1.ogg`、`meow1.ogg` | purreow1 `a431511c850809ac8aad700e36dbd398f03efe3f`；meow1 `378d2a7a8979bb1291cbf0b1b9dc5f1de978883b` |
| 猫吃东西 | `minecraft/sounds/mob/cat/eat1..2.ogg` | eat1 `eb38199e62e5f06fafce817edea1db860d14bf81`；eat2 `193a41b1759531080c89a68a658572ea1d6333b4` |
| 打嗝 | `minecraft/sounds/random/burp.ogg` | `bdc648e04933df8ddcccc84b375d6556776d4331` |
| 火把点燃 | `minecraft/sounds/fire/ignite.ogg` | `a0d1fbff7e938e92c10c1576339dda668f40e111` |
| 火把熄灭 | `minecraft/sounds/block/candle/extinguish1.ogg` | `f82b1154b34cd0a93533b3384d820db37174bc2e` |
| 火把燃烧循环 | `minecraft/sounds/fire/fire.ogg` | `8b260108a73470c16cd244325242d4780cfb7d78` |
| 关闭 portal | `minecraft/sounds/mob/endermen/portal.ogg` | `7b4b5323ef066caa1ae43cbe66fffd9dfce4ed32` |
| 关闭 travel | `minecraft/sounds/portal/travel.ogg` | `43388701fac432a567fe9fec421521e6348ad780` |
| 设置点击 | `minecraft/sounds/random/click.ogg` | `ec4f4d122ab7c5d44e48419de0e3de1b0922514d` |

## 4. Minecraft Java 1.20.1 贴图

Jar：`%APPDATA%\.minecraft\versions\1.20.1-Fabric 0.19.5\1.20.1-Fabric 0.19.5.jar`  
内部路径：`assets/minecraft/textures/...`

| 用途 | 文件 |
|---|---|
| 面包 | `item/bread.png` |
| 火把 | `block/torch.png` |
| 爱心 | `particle/heart.png` |
| 火焰 | `particle/flame.png` |
| 紫色粒子 | `particle/effect_0..7.png`、`particle/glitter_0..7.png` |
| 面包屑/烟 | `particle/generic_0..7.png` |

> 注意：1.20.1 的 `assets/indexes/5.json` 只索引音效和少量 GUI 图；贴图在客户端 jar 内，提取脚本要读 jar。

## 5. 生成/提取

```powershell
# 从本机 Minecraft 提取音效 + 贴图
node tools/extract-assets.mjs `
  --minecraft "$env:APPDATA\.minecraft" `
  --jar "$env:APPDATA\.minecraft\versions\1.20.1-Fabric 0.19.5\1.20.1-Fabric 0.19.5.jar" `
  --out public/assets/vanilla

# 从鲸鱼娘挂件复制点击音（仅本地）
copy "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-whale-widget\assets\Ya1.mp3" public/assets/whale/
copy "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-whale-widget\assets\Ya2.mp3" public/assets/whale/

# 生成图标
python tools/make-icon.py public/assets/skin/niko.png resources/icon.ico
```

脚本会写 `ASSETS.json`（源 key、hash、大小），便于审计。

## 6. 发布检查

- [ ] 未创建公开 GitHub 仓库/Release。
- [ ] 安装包/便携版只在本机使用。
- [ ] 如需公开：替换 Niko 皮肤为原创/授权皮肤；替换鲸鱼娘点击音；替换 Minecraft 音效/贴图为自制或授权素材；重新检查 `ASSETS.md`。

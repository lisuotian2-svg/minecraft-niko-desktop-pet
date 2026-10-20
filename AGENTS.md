# AGENTS.md — Niko Pet 3D

## 环境

- Windows 11 x64；PowerShell 7；Node 24；pnpm 11。
- 项目根：`C:\Users\zgy15\Documents\deepseek-harness\default-workspace\niko-pet-3d`
- 包管理器只用 **pnpm**，不要用 npm/yarn。
- 这是本地自用项目，不要发布、不要上传、不要改全局配置、不要动 `%APPDATA%\.minecraft` 和 `~/.dsh`。

## 规则

1. 先读 `docs/PRD.md`、`docs/TECH-PLAN.md`、`docs/DECISIONS.md`，再写代码。
2. 只改本项目目录内的文件；不要改其他项目。
3. TypeScript strict；尽量把纯逻辑（手势/行走/粒子/设置）放进 `src/shared`，方便测试。
4. 每个里程碑必须能 `pnpm build`；有测试就 `pnpm test`。
5. 桌宠窗口上**不允许出现任何文字/气泡/名字**；调试信息只进日志，不要画到画布上。
6. 不要引入重型框架（React/Vue 等）；设置页用原生 TS + CSS。
7. 不要用 `any` 绕过类型；确实需要时加注释说明。
8. 不要提交 `node_modules`、`release`、`artifacts`。
9. 遇到不确定的产品选择，按 `PRD.md` 的推荐项实现，并在 `M0-REPORT.md` / `M1-REPORT.md` 记录。
10. 不要修改 `public/assets/skin/niko.png`、`public/assets/whale/*.mp3`。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm dist
```

## 当前阶段

M0 技术验证。详细任务见 `docs/M0-TASK.md`。

# Qx 开发者文档索引

> 状态：Current · 适用版本：v0.5.18 · Owner：Core · 最后复核：2026-07-15

面向核心贡献者。所有面向用户的说明在 [README.md](../README.md) 和 [`public/doc/`](../public/doc/) 下。

## 从这里开始

1. [`AGENTS.md`](../AGENTS.md) — 代码风格、Esc 协议、shadcn/主题规则、发版流程
2. [`architecture-principles.md`](./architecture-principles.md) — **SOLID、抽象层次、接口契约与文档义务**
3. [`UI_SPEC.md`](../UI_SPEC.md) — UI 视觉规范、CSS token、shell 三段式布局

## 架构

| 文档 | 覆盖范围 |
|---|---|
| [architecture-principles.md](./architecture-principles.md) | SOLID 落点、抽象分层、接口检查清单、反模式 |
| [technical-architecture.md](./technical-architecture.md) | 顶层架构、状态、tab 路由、module 深潜、性能与安全笔记 |
| [frontend-architecture.md](./frontend-architecture.md) | 前端子系统、状态管理、搜索管线、灵动岛、i18n、样式约定 |
| [shell-and-shortcuts.md](./shell-and-shortcuts.md) | **浮动面板 / 全局快捷键 toggle / managed State / 搜索重聚焦**（优先查这份） |
| [module-surfaces.md](./module-surfaces.md) | 主搜索直达模块子界面（Raycast 对照、RSS feed 深链、OPML/文件夹） |
| [rust-backend.md](./rust-backend.md) | Rust 模块导览、启动顺序、添加新模块流程、常见坑 |
| [runtime-threading.md](./runtime-threading.md) | **主线程 UI + blocking 多线程**：`runtime::ui` / `blocking`、模块命令模板、SIGTRAP 规避 |
| [ipc-catalogue.md](./ipc-catalogue.md) | 全部 127 个 Tauri 命令 + 事件通道；按模块分组 |
| [settings-panel.md](./settings-panel.md) | Settings/About 面板结构、Row/Card/SettingsCard 规范 |
| [macos-onboarding.md](./macos-onboarding.md) | macOS 首次启动权限引导（FDA / 剪贴板粘贴 / 可选 TCC） |

## 插件

| 文档 | 覆盖范围 |
|---|---|
| [`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md) | **作者总手册**：端口抽象、manifest、zip Import、调试、模式（**写插件从这里开始**） |
| [`public/doc/plugin-cli-protocol.md`](../public/doc/plugin-cli-protocol.md) | **`context.cli` 契约**：argv、超时、安全、版本 |
| [`public/doc/README.md`](../public/doc/README.md) | `public/doc` 目录索引 |
| [plugin-architecture.md](./plugin-architecture.md) | 宿主 iframe runtime、RPC、后台 badge 端口（贡献宿主） |
| [plugin-design-research.md](./plugin-design-research.md) | 设计调研（历史） |
| [ai-agent-runtime.md](./ai-agent-runtime.md) | QxAI 各层 |
| [`public/doc/plugin-system.md`](../public/doc/plugin-system.md) | 方案 + API/权限全表（参考） |
| [`public/doc/plugin-marketplace.md`](../public/doc/plugin-marketplace.md) | 市场打包与安装 |
| [`public/doc/raycast-plugin-conversion.md`](../public/doc/raycast-plugin-conversion.md) | Raycast → Qx |

常用检索：

- **写业务插件** → `public/doc/plugin-development-guide.md`
- **跑本机 CLI** → `public/doc/plugin-cli-protocol.md`
- **改宿主 RPC** → `plugin-architecture.md` + `src/plugin/rpcMethods.ts`

## 发布与运维

| 文档 | 覆盖范围 |
|---|---|
| [release-and-versioning.md](./release-and-versioning.md) | 版本一致性、GitHub Actions release、Homebrew tap、pre-flight |
| [`public/doc/release-workflow.md`](../public/doc/release-workflow.md) | commit、tag、发布和推送时使用的完整维护者流程 |

## 常用检索路径

- 想定抽象 / 审接口 → **`architecture-principles.md`（SOLID）** + 对应领域文档
- 想改 UI → `UI_SPEC.md` + `frontend-architecture.md` + `settings-panel.md`
- **想改全局快捷键 / 显示隐藏 / 缺 .manage()** → **`shell-and-shortcuts.md`**
- 想加 Rust 命令 → `rust-backend.md` + `ipc-catalogue.md`
- 想写/审插件 → **`public/doc/plugin-development-guide.md`** + `plugin-cli-protocol.md`
- 想改插件宿主 API → `plugin-architecture.md` + `rpcMethods.ts` + `plugin_api.rs`
- 想改 AI → `ai-agent-runtime.md`
- 想发版 → `release-and-versioning.md` + `public/doc/release-workflow.md` + `AGENTS.md` 的 Release 一节

## 维护规则

- **接口与抽象先契约、后实现**；公共 surface 变更必须同步文档（见 [architecture-principles.md](./architecture-principles.md)）。
- **禁止逐文件打补丁式修复**：能力问题修 host/converter/注册表/i18n 字典一次；然后 `npm run check`。
- 文档写**意图、边界、不变量**，避免只贴大段实现代码。
- 统一闸门：`npm run check`（含 architecture / docs / i18n / shell / island）。
- 修改 `src-tauri/src/lib.rs` 的 `generate_handler!` 后，同步 `ipc-catalogue.md` 并运行 `npm run docs:check`。
- 修改依赖主版本、应用版本或平台支持范围后，同步顶层架构和 README。
- 新增跨前后端功能时，至少更新前端/后端导览、IPC、权限与验证方式。
- 当前实现、研究提案和未来规划必须在文档页头明确标记；不要把计划描述成已交付能力。
- 每次 release 前复核本索引和所有标记为 Current 的文档。

## 计划中未写的

- CONTRIBUTING.md（外部贡献流程、PR 模板）
- 单元测试指南（目前无测试框架）
- macOS 签名 / notarization 手册
- Tauri v2 capability / ACL 说明
- vendored `cardinal/` 三个 crate 的来龙去脉

如你补写了，请顺手把本索引加一行。

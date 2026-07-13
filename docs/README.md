# Qx 开发者文档索引

> 状态：Current · 适用版本：v0.4.61 · Owner：Core · 最后复核：2026-07-10

面向核心贡献者。所有面向用户的说明在 [README.md](../README.md) 和 [`public/doc/`](../public/doc/) 下。

## 从这里开始

1. [`AGENTS.md`](../AGENTS.md) — 代码风格、Esc 协议、shadcn/主题规则、发版流程
2. [`UI_SPEC.md`](../UI_SPEC.md) — UI 视觉规范、CSS token、shell 三段式布局

## 架构

| 文档 | 覆盖范围 |
|---|---|
| [technical-architecture.md](./technical-architecture.md) | 顶层架构、状态、tab 路由、module 深潜、性能与安全笔记 |
| [frontend-architecture.md](./frontend-architecture.md) | 前端子系统、状态管理、搜索管线、灵动岛、i18n、样式约定 |
| [rust-backend.md](./rust-backend.md) | Rust 模块导览、启动顺序、添加新模块流程、常见坑 |
| [ipc-catalogue.md](./ipc-catalogue.md) | 全部 127 个 Tauri 命令 + 事件通道；按模块分组 |
| [settings-panel.md](./settings-panel.md) | Settings/About 面板结构、Row/Card/SettingsCard 规范 |

## 插件

| 文档 | 覆盖范围 |
|---|---|
| [plugin-architecture.md](./plugin-architecture.md) | 前端 iframe runtime、RPC 分发、AI 任务链路、权限模型 |
| [plugin-design-research.md](./plugin-design-research.md) | Raycast-like Rust 启动器插件设计调研 + Qx 落地建议 |
| [ai-agent-runtime.md](./ai-agent-runtime.md) | QxAI 各层（provider / streaming / tools / MCP / memory / soul） |
| [`public/doc/plugin-system.md`](../public/doc/plugin-system.md) | 插件系统白皮书（提案、manifest schema、打包） |
| [`public/doc/plugin-marketplace.md`](../public/doc/plugin-marketplace.md) | 插件市场发布 / 用户安装（面向作者） |
| [`public/doc/raycast-plugin-conversion.md`](../public/doc/raycast-plugin-conversion.md) | Raycast → Qx 转换脚本 |

## 发布与运维

| 文档 | 覆盖范围 |
|---|---|
| [release-and-versioning.md](./release-and-versioning.md) | 版本一致性、GitHub Actions release、Homebrew tap、pre-flight |
| [`public/doc/release-workflow.md`](../public/doc/release-workflow.md) | commit、tag、发布和推送时使用的完整维护者流程 |

## 常用检索路径

- 想改 UI → `UI_SPEC.md` + `frontend-architecture.md` + `settings-panel.md`
- 想加 Rust 命令 → `rust-backend.md` + `ipc-catalogue.md`
- 想改插件 API → `plugin-architecture.md` + `plugin-system.md` + `rpcMethods.ts`
- 想改 AI → `ai-agent-runtime.md`
- 想发版 → `release-and-versioning.md` + `public/doc/release-workflow.md` + `AGENTS.md` 的 Release 一节

## 维护规则

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

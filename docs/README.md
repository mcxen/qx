# Qx 开发者文档地图

> 状态：Current · 适用版本：v0.6.102 · Owner：Core · 最后复核：2026-08-31

`docs/` 只承载核心贡献者需要的当前架构和实现边界。面向用户、插件作者、运维和发布维护者的权威文档在 [`public/doc/`](../public/doc/)；历史记录与未落地研究不参与当前契约。

## 先读什么

| 工作 | 必读 |
|---|---|
| 任意代码或文档修改 | [`AGENTS.md`](../AGENTS.md) → [`architecture-principles.md`](./architecture-principles.md) → 根目录 [`TASK.md`](../TASK.md) |
| UI、布局、主题、Esc | [`UI_SPEC.md`](../UI_SPEC.md)；QxAI 再读 [`UI_SPEC_AI.md`](../UI_SPEC_AI.md) |
| 快捷键、窗口显隐、Tauri State | [`shell-and-shortcuts.md`](./shell-and-shortcuts.md) |
| 新模块、Shell/Esc/List 端口 | [`module-port-inventory.md`](./module-port-inventory.md) |
| 插件开发 | [`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md) |
| IPC 或公共边界 | [`interface-protocols.md`](./interface-protocols.md) + 对应领域文档 |
| 发布 | [`public/doc/release-workflow.md`](../public/doc/release-workflow.md) |

## 当前架构

### 总体与跨层契约

| 文档 | 唯一职责 |
|---|---|
| [`architecture-principles.md`](./architecture-principles.md) | SOLID、分层、端口设计、模块拆分与文档义务 |
| [`technical-architecture.md`](./technical-architecture.md) | 仓库边界、顶层代码地图、依赖方向和变更落点 |
| [`interface-protocols.md`](./interface-protocols.md) | 前后端运行时、IPC、事件、启动和平台通信不变量 |
| [`frontend-architecture.md`](./frontend-architecture.md) | React 子系统、状态、搜索、i18n 和样式所有权 |
| [`rust-backend.md`](./rust-backend.md) | Rust 模块、composition root 与新增命令路径 |
| [`runtime-threading.md`](./runtime-threading.md) | UI 主线程、async 协调、blocking worker 与锁边界 |
| [`ipc-catalogue.md`](./ipc-catalogue.md) | `generate_handler!` 的完整命令基线和事件目录 |

### Shell、模块与系统表面

| 文档 | 唯一职责 |
|---|---|
| [`shell-and-shortcuts.md`](./shell-and-shortcuts.md) | 浮动面板、全局快捷键、route toggle、窗口焦点和 State |
| [`module-port-inventory.md`](./module-port-inventory.md) | 内置模块与插件的 Shell、Esc、列表、缓存、HTTP 端口对照 |
| [`module-surfaces.md`](./module-surfaces.md) | 主搜索到模块内部对象或动作的深链协议 |
| [`qx-island-architecture.md`](./qx-island-architecture.md) | 当前 Island session、优先级、docked/floating 与插件 caps |
| [`tray-surface-design.md`](./tray-surface-design.md) | Tray Surface 尺寸、行型、provider 与测量规则 |
| [`settings-panel.md`](./settings-panel.md) | Settings/About 信息结构、Row/Card 和响应式规则 |
| [`macos-onboarding.md`](./macos-onboarding.md) | 首启能力介绍与 macOS 权限向导 |

### 插件宿主与 AI

| 文档 | 唯一职责 |
|---|---|
| [`plugin-architecture.md`](./plugin-architecture.md) | iframe/direct runtime、RPC、Workbench 与宿主内部 |
| [`plugin-storage.md`](./plugin-storage.md) | 包/数据目录、迁移、持久化、缓存登记和卸载语义 |
| [`ai-agent-runtime.md`](./ai-agent-runtime.md) | 当前 QxAI runtime 层次、工具和持久状态边界 |

公开协议不要在 `docs/` 重抄：

- 插件作者总入口：[`public/doc/plugin-development-guide.md`](../public/doc/plugin-development-guide.md)
- UI / Workbench：[`public/doc/plugin-ui-guidelines.md`](../public/doc/plugin-ui-guidelines.md)
- CLI：[`public/doc/plugin-cli-protocol.md`](../public/doc/plugin-cli-protocol.md)
- manifest、打包和市场：[`public/doc/plugin-marketplace.md`](../public/doc/plugin-marketplace.md)
- release：[`public/doc/release-workflow.md`](../public/doc/release-workflow.md)

## 用户、研究与历史

| 区域 | 性质 | 使用方式 |
|---|---|---|
| [`user-guide/README.md`](./user-guide/README.md) | Current 用户指南 | 描述已交付界面与操作；不放作者字段表 |
| [`research/`](./research/) | Research | 决策输入，不得当成已发布能力 |
| [`archive/`](./archive/) | Historical | 追溯旧方案、任务和版本；不得作为实现契约 |

当前任务只写在根目录 [`TASK.md`](../TASK.md)。历史台账中的未勾选项只有在按当前代码复现并重新建项后，才成为有效待办。

## 文档所有权

```text
docs/                 current contributor architecture
docs/research/        unshipped studies and proposals
docs/archive/         superseded historical material
public/doc/           canonical user/author/operator Markdown
dist/doc/             generated copy of public/doc; never edit or commit
```

根级 `doc/` 不是合法来源。`docs/README.md` 与 `public/doc/README.md` 名称相同但读者和职责不同，不是重复文件。

## 写作与同步规则

- Current 文档只写当前接口、边界和不变量；路线图进入 `TASK.md`，未决方案进入 `research/`。
- 被替代但仍有决策价值的长文移入 `archive/`，并从当前路径提供短而权威的替代页。
- 公共接口、Tauri command/event、权限、目录和分层变化必须在同一 change 更新对应文档。
- 能力错误修正端口一次并迁移所有第一方 consumer；不要在多个调用点各写一份兼容说明。
- 文档引用实现文件作为事实来源，但不复制容易漂移的源码清单或行数。
- 修改 `src-tauri/src/lib.rs` 的 `generate_handler!` 时同步 [`ipc-catalogue.md`](./ipc-catalogue.md)。

## 门禁

```sh
npm run docs:check  # 版本、IPC 基线、递归 Markdown 链接、公开文档去重
npm run check       # architecture + interfaces + docs + i18n + shell + island + ports
npm run build       # Vite 产物与 public/doc 复制链
```

文档链接门禁覆盖仓库根 Markdown、`docs/`（排除 `archive/`）和 `public/doc/` 的所有层级。归档链接允许保留历史状态；Current 与 Research 文档不允许断链。

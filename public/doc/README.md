# Qx 用户、插件作者与发布文档

`public/doc/` 是 Qx 会在产品、README 和发行流程中直接链接的公开文档源。
这里的文件按主题各自拥有唯一职责；不要在多份文档中复制同一协议。

## 从哪里开始

| 目标 | 入口 | 唯一职责 |
|---|---|---|
| 开发插件 | [插件开发手册](./plugin-development-guide.md) | 从零运行、选择端口、调试与交付检查 |
| 设计面板与动作 | [插件 UI 与 Actions 规范](./plugin-ui-guidelines.md) | Workbench、Top Bar、Bottom Bar、Actions、Esc 和主题 |
| 把 CLI 做成界面 | [CLI Workbench 模式](./plugin-cli-gui.md) | CLI 数据到 Workbench 的产品化模式 |
| 查询 CLI API | [CLI 协议](./plugin-cli-protocol.md) | `context.cli`、任务、PATH、安全与返回值 |
| 发布或安装插件 | [插件市场指南](./plugin-marketplace.md) | Manifest、包结构、市场索引、安装与签名 |
| 配置插件源（GitHub / CNB） | [插件市场指南 §5.1](./plugin-marketplace.md#51-github-与-cnb-示例) | 设置 → 扩展 → 插件库；商店 `#/sources` |
| 理解运行时边界 | [插件系统架构](./plugin-system.md) | 运行时、权限、通信和各协议的归属 |
| 接入系统托盘 | [Tray 协议](./plugin-tray.md) | `context.tray` |
| 迁移 Raycast 扩展 | [Raycast 迁移说明](./raycast-plugin-conversion.md) | 冻结转换器的边界与人工重实现路径 |
| 发布 Qx 客户端 | [发布流程](./release-workflow.md) | 版本、构建、Tag、推送和远端确认 |

## 文档归属规则

- `plugin-development-guide.md` 负责“怎么完成一个插件”，不复制完整 API。
- 端口的字段、返回值和安全语义只写在对应协议文档。
- Manifest 与分发只写在 `plugin-marketplace.md`。
- Workbench、Actions、键盘和主题只写在 `plugin-ui-guidelines.md`。
- `plugin-system.md` 只解释架构，不维护第二份作者手册。
- `release-workflow.md` 是客户端发布文档，不属于插件开发协议。
- `dist/doc/` 是构建产物，永远不要手工维护。

内部贡献者文档位于 [`docs/README.md`](../../docs/README.md)。

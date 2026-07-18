# Qx 用户 / 作者文档（`public/doc`）

面向**插件作者、市场维护者、发版操作**。  
核心贡献者架构说明见 [`docs/README.md`](../../docs/README.md)。

## 插件开发（从这里开始）

| 文档 | 用途 |
|------|------|
| **[plugin-development-guide.md](./plugin-development-guide.md)** | **作者手册总入口**：端口抽象、manifest、Import zip、调试、模式 |
| [plugin-cli-protocol.md](./plugin-cli-protocol.md) | `context.cli` 完整协议 |
| [plugin-cli-gui.md](./plugin-cli-gui.md) | CLI→GUI 抽象、`cli.json` / `ui` workbench、示例 |
| [plugin-system.md](./plugin-system.md) | 系统方案 + API/权限全表 |
| [plugin-marketplace.md](./plugin-marketplace.md) | 市场打包、Browse、本地 Import |
| [raycast-plugin-conversion.md](./raycast-plugin-conversion.md) | Raycast → Qx 转换 |

### 建议阅读顺序（写业务插件）

1. `plugin-development-guide.md` §0–§5（心智模型 + 端口 + 脚手架）  
2. 若跑本机命令 → `plugin-cli-protocol.md`  
3. 字段查表 → `plugin-system.md`  
4. 上架 → `plugin-marketplace.md`  

## 发版

| 文档 | 用途 |
|------|------|
| [release-workflow.md](./release-workflow.md) | 标签、CI、产物、updater |

## 设计草图

`ui-sketches/` — UI 探索，非契约。

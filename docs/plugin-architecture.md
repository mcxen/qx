# Qx 插件系统架构

> 面向核心贡献者的内部文档。描述前端插件运行时、RPC 分发、AI 任务、权限模型和面板生命周期。

## 1. 目录结构

| 文件 | 职责 |
|---|---|
| `src/plugin/types.ts` | 插件 manifest、运行时、AI 相关 TypeScript 类型 |
| `src/plugin/builtin.ts` | 内置模块注册（RSS、V2EX、Clipboard 等） |
| `src/plugin/registry.ts` | Zustand store：加载/卸载/启用/禁用/搜索/快捷键 |
| `src/plugin/runtime.ts` | iframe 沙箱生命周期、postMessage 协议、面板渲染 |
| `src/plugin/context.ts` | `createPluginContext` / `createUnavailableContext` |
| `src/plugin/rpcMethods.ts` | 所有 `handlePluginRpc` 处理器映射 |
| `src/plugin/aiRuntime.ts` | AI task 创建、状态维护、取消、权限门控 |
| `src/plugin/PluginHost.tsx` | 插件 panel 视图容器 |
| `src/modules/settings/PluginManager.tsx` | Extensions 设置页 UI |
| `src-tauri/src/` | Rust 后端：扫描、安装、存储、权限、AI 命令 |

## 2. 数据流

```text
manifest.json
    │
    ▼
Rust: list_installed_plugins()  ──►  PluginRegistry.load()
                                         │
                                         ▼
                              对 enabled 插件拓扑排序
                                         │
                                         ▼
                              loadPlugin(plugin, hooks)
                                         │
                                         ▼
                    read_plugin_entry(id) → Blob URL → sandbox iframe
                                         │
                                         ▼
                         iframe 发送 qx:plugin:loaded
                                         │
                                         ▼
                         注册 commands[] / panel 到 store
```

## 3. RPC 调用链路

插件代码调用 `context.ai.chat(...)` 时：

```text
plugin iframe
    │
    ├─ 内部 context.ai.chat 组装 payload
    │
    ▼
postMessage({ type: "qx:rpc", method: "aiChat", payload, requestId })
    │
    ▼
registry.ts: rpcHandler
    │
    ▼
handlePluginRpc(plugin, "aiChat", payload, hooks)
    │
    ▼
rpcMethods.ts: rpcHandlers["aiChat"]
    │
    ▼
assertPermission(plugin, perms, "ai")  →  invoke("plugin_ai_chat", { req: payload })
```

结果沿原路通过 `postMessage({ type: "qx:rpc:response", ... })` 返回 iframe。

## 4. 权限模型

插件 manifest `permissions` 是字符串数组，分三类：

1. **能力组**：`clipboard`、`http`、`notifications`、`ai`、`ai-memory`、`ai-bash`、`ai-tools`、`ai-background`、`system-info`、`system-stats`、`processes`、`apps`、`files`、`permissions`、`automation`、`storage-management`、`open-url`、`storage`。
2. **精确命令**：`invoke:<cmd>`，用于危险或细粒度命令（如 `invoke:qx_system_information_kill_process`）。
3. **通配**：`*`，允许所有，仅内部/调试插件使用。

危险命令白名单 `DANGEROUS_INVOKE_COMMANDS` 中的命令，即使插件声明了能力组，也必须显式声明 `invoke:<cmd>` 才能调用。例如结束进程、申请权限、清空数据、宏回放、录屏启动等。

## 5. AI 任务链路

```text
context.ai.tasks.submit({ prompt: "...", notify: true })
    │
    ▼
rpcHandlers.aiTaskSubmit
    │
    ▼
aiRuntime.submitAiTask(plugin, perms, settings, payload, options)
    │
    ▼
生成 ai-task-<timestamp>-<counter>，写入 aiTasks Map（state: queued）
    │
    ▼
异步 invoke("plugin_ai_chat", { req: payload })
    │
    ▼
state → running → succeeded / failed / cancelled
    │
    ▼
onPluginStatus 汇报到灵动岛，notify 为 true 时调用 plugin_notification_show
```

`aiTasks` 是进程内 Map，不跨会话持久化；任务在 Qx 隐藏到托盘后仍可继续运行。

## 6. 面板生命周期

插件声明 `panel` 时，会注册一个可切换的全屏视图 tab。

渲染：

```text
PluginHost 挂载
    │
    ▼
registeredPanel.render(container, context)
    │
    ▼
创建新 iframe，srcdoc 注入运行时 + 插件 index.js
    │
    ▼
等待 qx:plugin:loaded
    │
    ▼
postMessage({ type: "qx:renderPanel" })
    │
    ▼
iframe 内调用 plugin.panel.render(container, context)
```

销毁：

```text
PluginHost 卸载 或 切换到其他插件面板
    │
    ▼
registeredPanel.destroy(container)
    │
    ▼
postMessage({ type: "qx:destroyPanel" })
    │
    ▼
iframe 内调用 plugin.panel.destroy(container)
    │
    ▼
清理 timers，移除 iframe，unregisterPluginRuntime
```

## 7. 开发调试

- **Rescan**：Extensions 页面顶部 `Rescan` 按钮重新扫描 `~/.qx/plugins/`，无需重启。
- **Dev Mode Hot Reload**：Settings → Advanced → Developer Mode 开启后，插件文件变更每 3 秒自动重载。
- **脚手架**：Settings → Advanced → Create Plugin (`qx init`) 可一键生成插件模板。
- **手动安装**：将 `.qx-plugin` zip 放到 `~/.qx/plugins/` 并点击 Rescan。

## 8. 新增 RPC 方法步骤

1. 在 `src/plugin/types.ts` 的 `PluginContext` 中补充类型。
2. 在 `src/plugin/rpcMethods.ts` 的 `rpcHandlers` 新增处理器，必要时调用 `assertPermission` / `assertInvokeAllowed`。
3. 在 `src/plugin/context.ts` 的 `createPluginContext` 中暴露给插件。
4. 在 `src/plugin/runtime.ts` 的 iframe 内 runtime HTML 中同步暴露同名方法。
5. 更新 `public/doc/plugin-system.md` 的 context API 表格。
6. 运行 `npx tsc --noEmit` 与 `npm run build`。

## 9. 常见约束

- **不要**在插件 iframe 内直接调用 `invoke`；所有后端调用必须通过 `postMessage` → `handlePluginRpc`。
- **不要**在 `registry.ts` 中新增 RPC 处理逻辑；统一放到 `rpcMethods.ts`。
- **不要**在 `runtime.ts` 中新增 AI task 状态逻辑；统一放到 `aiRuntime.ts`。
- 新增 `context` API 时，同步更新 `createUnavailableContext`，否则命令执行时可能拿到过时的可用上下文。

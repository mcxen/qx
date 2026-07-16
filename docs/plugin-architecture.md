# Qx 插件系统架构

> 面向核心贡献者的内部文档。描述前端插件运行时、RPC 分发、AI 任务、权限模型和面板生命周期。

## 1. 目录结构

| 文件 | 职责 |
|---|---|
| `src/plugin/types.ts` | 插件 manifest、运行时、AI 相关 TypeScript 类型 |
| `src/plugin/builtin.ts` | 内置模块注册（RSS、V2EX、Clipboard 等） |
| `src/plugin/registry.ts` | Zustand store：加载/卸载/启用/禁用/搜索/快捷键 |
| `src/plugin/backgroundActivity.ts` | **后台 interval 端口**：job 快照、last/next run、running；UI 标签唯一数据源 |
| `src/plugin/runtime.ts` | iframe 沙箱生命周期、postMessage 协议、面板渲染 |
| `src/plugin/context.ts` | `createPluginContext` / `createUnavailableContext` |
| `src/plugin/rpcMethods.ts` | 所有 `handlePluginRpc` 处理器映射 |
| `src-tauri/src/plugin_cli.rs` | **业务 CLI 端口**：`run`/`bash`/`which`、**异步 jobs**（start/poll/cancel）、**system** open/reveal/env |
| `src/plugin/cliWorkbench.ts` | CLI→GUI helpers（ensure/json/map/wait）+ workbench kit |
| `src/plugin/aiRuntime.ts` | AI task 创建、状态维护、取消、权限门控 |
| `src/plugin/PluginHost.tsx` | 插件 panel 视图容器 |
| `src/components/PluginBackgroundBadge.tsx` | 搜索/Extensions/panel 共用后台标签（悬停最近执行时间） |
| `src/modules/settings/PluginManager.tsx` | Extensions 设置页 UI |
| `src-tauri/src/` | Rust 后端：扫描、安装、存储、权限、AI 命令 |


### Background interval port

`mode: "no-view"` + `interval` 命令由 `registry.ts` 调度，但**所有**用户可见的调度元数据只经 `backgroundActivity`：

| Op | 调用方 | 效果 |
|---|---|---|
| `markScheduled` | timer arm | 持久化 `nextRunAt`，标签显示已调度 |
| `markRunning` / `markFinished` | `runCommand` | 持久化 `lastRunAt` / error；标签显示运行中 → 最近执行 |
| `summarizePlugin` / `PluginBackgroundBadge` | ResultsList、Installed 卡片、PluginHost | 只读呈现 |

禁止在 UI 层另写一套 localStorage key 或直接读 timer Map。

**模块壳 chrome**（内置与扩展共用）：

- 前端端口 `useQxModuleShell`（`src/hooks/useQxModuleShell.ts`）
- 扩展宿主 `PluginPanelViewport` 使用同一 leave / Esc / Island / Actions 菜单装配
- 列表导航、主从 region 仍由插件 UI / 内置面板自管；壳只保证 QxShell 外框协议一致

**调度稳定性**（Bing 自动换壁纸 thrash 修复）：

- 每个 `pluginId\\0command` **只保留一个** pending timer，禁止堆叠。
- 过期 `nextRunAt` 不立刻连发：至少再等一个完整 `interval`。
- 宿主侧用 `lastRunAt + interval` 做二次节流。
- 后台 run 使用 `launchType: background` + 更长 timeout（120s），避免下载超时后并发 set wallpaper。
- Raycast `Cache` 落盘到 `localStorage`（如 Bing `lastRefresh`），不再每次 invoke 新建空 Map。

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

1. **能力组**：`clipboard`、`http`、`notifications`、`ai`、`ai-memory`、`ai-bash`、`ai-tools`、`ai-background`、`system-info`、`system-stats`、`processes`、`apps`、`files`、`permissions`、`automation`、`storage-management`、`open-url`、`storage`、`island`。
2. **精确命令**：`invoke:<cmd>`，用于危险或细粒度命令（如 `invoke:qx_system_information_kill_process`）。
3. **通配**：`*`，允许所有，仅内部/调试插件使用。

危险命令白名单 `DANGEROUS_INVOKE_COMMANDS` 中的命令，即使插件声明了能力组，也必须显式声明 `invoke:<cmd>` 才能调用。例如结束进程、申请权限、清空数据、宏回放、录屏启动等。

`island` 只开放 `context.island.show/update/dismiss`。宿主把每个插件限制为一个
`plugin-display` session，渲染结构化文本、真实进度和最多一个 manifest command
动作；浮窗启用、主窗隐藏策略和置顶均由用户设置控制。

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
    │
    ▼
宿主等待 `qx:renderPanel:response`（预算约 15s；超时拆 iframe）
```

**契约**：`panel.render` 只负责首次挂载与首帧 UI，**不得** `await` 长时间 CLI/网络。慢数据用 `void load()` 在后台更新 DOM。作者说明见 `public/doc/plugin-development-guide.md` §6.6。

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

## 9. System tray

Tray menu is built in `tray_menu.rs`:

| Source | Content |
|--------|---------|
| `tray_actions` status ids | Live **Memory / Network / CPU** (≈3s refresh while enabled) |
| `quick_entries` | Open modules |
| `tray_actions` window ids | Open / Keep visible / Settings / Hide |
| Plugin `context.tray` | Per-plugin items (`permission: tray`) |

Plugin API: `tray.setItems([{ id, title, command? }])` / `tray.clear()`. Click emits `plugin-tray-action`; frontend runs the command.

## 10. Raycast Action ≡ Qx Action

转换插件里的 `ActionPanel` **不是**第二套操作 UI。选中条目后 shim 上报
`qx:plugin:item-actions`，`PluginHost` 填入 `QxShell`：

| Raycast | QxShell |
|---------|---------|
| 第一个 Action | `primaryAction`（底栏 / Enter） |
| 全部 Action | `actions[]` + 右侧 Actions + ⌘K |
| 执行 | 宿主 `qx:run-item-action` → iframe handler |

可选「条目上显示操作按钮」只是卡片内 chips，关掉也不影响上述主路径。

## 11. CLI 异步与系统能力

```text
context.cli.start({ kind: "run", program, args })
        │
        ▼
plugin_cli_start(plugin_id, req)  →  JobRegistry + OS thread
        │
        ├─ stdout/stderr reader threads → JobSnapshot buffers
        ├─ cancel flag / kill Child
        └─ timeout → TimedOut

context.cli.poll / wait / cancel   ←  同一 snapshot
context.cli.map(items, worker, { concurrency })  ←  有界并行 run
context.system.env | openPath | revealPath       ←  权限 system
```

约束：

- 每插件最多 6 个 running job，全局 32；输出每流约 4MB 截断。
- `run`/`bash` 仍走 `spawn_blocking`，可与 jobs 并行；长任务优先 `start`。
- Job 按 `plugin_id` 隔离；poll/cancel 校验归属。

## 12. 常见约束

- **不要**在插件 iframe 内直接调用 `invoke`；所有后端调用必须通过 `postMessage` → `handlePluginRpc`。
- **不要**在 `registry.ts` 中新增 RPC 处理逻辑；统一放到 `rpcMethods.ts`。
- **不要**在 `runtime.ts` 中新增 AI task 状态逻辑；统一放到 `aiRuntime.ts`。
- 新增 `context` API 时，同步更新 `createUnavailableContext`，否则命令执行时可能拿到过时的可用上下文。
- CLI 逻辑放在 `plugin_cli.rs` / `cliWorkbench.ts`，不要把 job 表塞进 `plugin_api.rs`。

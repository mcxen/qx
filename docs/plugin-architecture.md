# Qx 插件系统架构

> 面向核心贡献者的内部文档。描述前端插件运行时、RPC 分发、AI 任务、权限模型和面板生命周期。

> 当前开发阶段兼容策略：Qx 尚无外部用户，插件均由 mcxen 维护。Workbench / plugin port 演进优先采用清晰的强契约，并在同一变更中迁移全部第一方插件；不要为尚不存在的第三方存量增加旧协议兼容层、别名或双实现。进入有外部用户阶段后必须显式重审本策略。

## 1. 目录结构

| 文件 | 职责 |
|---|---|
| `src/plugin/types.ts` | 插件 manifest、运行时、AI 相关 TypeScript 类型 |
| `src/plugin/builtin.ts` | 内置模块注册（RSS、V2EX、Clipboard 等） |
| `src/plugin/registry.ts` | Zustand store：加载/卸载/启用/禁用/搜索/快捷键 |
| `src/plugin/backgroundActivity.ts` | **后台 interval 端口**：job 快照、last/next run、running；UI 标签唯一数据源 |
| `src/plugin/runtime.ts` | iframe 沙箱生命周期、postMessage 协议、面板渲染 |
| `src/plugin/pluginShellBridge.ts` | panel session registry、Workbench/Chrome/Actions 消息信任边界与宿主订阅 |
| `src/plugin/pluginTheme.ts` | Custom Panel 主题 payload、公开语义 token 白名单与 iframe apply runtime |
| `src/plugin/pluginRuntimeTransport.ts` | sandbox iframe 创建与插件 asset URL 解析 |
| `src/plugin/pluginIsland.ts` | Workbench/RPC 共用的 island 权限、command、session 投影 |
| `src/plugin/context.ts` | `createPluginContext` / `createUnavailableContext` |
| `src/plugin/rpcMethods.ts` | 所有 `handlePluginRpc` 处理器映射 |
| `src-tauri/src/plugin_cli.rs` | **业务 CLI 端口**：`run`/`bash`/`which`、**异步 jobs**（start/poll/cancel）、**system** open/reveal/env |
| `src/plugin/pluginSdkFactory.ts` | CLI→GUI helpers + Workbench kit 的单一、自包含实现；host 调用并序列化进 iframe |
| `src/plugin/cliWorkbench.ts` | SDK factory 的类型化 host wrapper + iframe bootstrap 字符串 |
| `src/plugin/workbenchTypes.ts` | 声明式 Workbench 数据契约 + iframe 信任边界归一化 |
| `src/plugin/workbenchKeyboard.ts` | 隐藏 iframe 键盘转交策略 |
| `src/hooks/qxGridNavigation.ts` | Workbench 与内置网格共用的二维索引纯函数 |
| `src/plugin/PluginWorkbenchView.tsx` | Qx 原生 list/detail/progress 呈现；不含插件业务逻辑 |
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
- Workbench 的全宽集合浏览、详情开启状态、主从 region、Esc 与 Actions 由宿主管；custom panel 仍由插件自管
- Custom panel 的 resolved Light/Dark、`.dark` 和公开语义/Qx 兼容 token 由
  `pluginTheme` 统一投影；主题 class 或宿主外观 style token 变化时经 Shell bridge
  广播，插件不得用单一主题 fallback 猜测宿主颜色

### 声明式 Workbench 端口

```text
plugin business state
  └─ context.ui.mountWorkbench({ layout, items, detail, actions, island }, handlers)
       ├─ qx:plugin:workbench → normalizePluginWorkbenchState → PluginWorkbenchView
       ├─ QxShell search/tabs/navigation/Actions → qx:workbench:event → panel handlers
       ├─ action.command → registry.runCommand（同插件 manifest 校验）
       ├─ backgroundPoll.command → no-view interval scheduler → persisted snapshot
       │    └─ completion → qx:workbench:event/backgroundPoll → panel reload
       └─ island → PluginHost permission/command validation → shared IslandSession store
```

不变量：iframe 只发布可序列化纯数据；`raw` 不跨信任边界；宿主限制列表/字段/动作/表单控件数量和文本长度。item `id` 是强制、稳定、唯一的业务键；缺失或重复 item/tab/control id 在信任边界直接拒绝，tabs 至多一个 active，不保留 title/index 回退。`layout.kind` 可选 `list`（默认）或 `gallery`；Gallery 图片只接受 `https://` / `data:image/`，URL 超限整体拒绝而非截断，列数与比例由宿主归一化，选中与 Actions 仍走相同 Workbench 事件。详情图片可声明 `aspectRatio/zoomable/caption`，但加载失败、自适应窄栏和全尺寸 Dialog 均由宿主呈现；插件 iframe CSS 不能也不得覆盖宿主详情。`item.status/detail.status` 是保留旧内容时的局部 loading/success/error，不能用清空集合替代刷新反馈。详情表单只接受 `text` / `number` / `select`，变更以 `onInput` 纯数据事件回传；管理动作通过 `form.actions` 或连续 control 的稳定 `group.id + group.action` 声明，仍由宿主带 selectedId 投递 `onAction`。Workbench 没有 DOM/HTML 兼容分支；复杂自绘内容走独立 custom panel。后台轮询只能绑定本插件已注册的 `no-view + interval` command，panel 回调不拥有后台生命周期。

`mountWorkbench()` 返回轻量 controller：`update(patch)` 保留未给出的顶层字段，
`updateItems({ upsert, removeIds, order, selectedId })` 在 iframe SDK 内按稳定 id 合并，
再发布一份完整 state 进入同一归一化信任边界。它用于图片元数据/缩略图分批完成等
异步场景，不能发送 DOM patch。插件若并发产生整份快照，可提供单调递增 `revision`；
宿主忽略更旧 revision。selection、focus、scroll 的连续性依赖稳定 item id，插件不得
用数组索引或标题作为 id。

SDK 不维护 host/iframe 两份实现：`createPluginSdkRuntime` 是无外部闭包的自包含 factory，可信 context 直接调用，sandbox bootstrap 通过 `Function#toString` 注入同一实现。Workbench `island` 不再由 kit 额外调用 `context.island`；PluginHost 接受同一 state 后统一投影，避免 state 与 island 两条消息竞态。

#### 状态所有权与事件一致性

| 层 | 拥有内容 | 约束 |
|---|---|---|
| 插件业务状态 | 原始数据、过滤结果、业务选中项、loading/error、动作副作用 | `mountWorkbench` 是受控发布；handler 收到 query/tab/select 后必须先同步更新本地状态并重新发布，慢网络/CLI 另起异步任务 |
| 宿主交互状态 | 当前可见 query、active tab、pointer/keyboard selection、焦点与滚动 | query/tab/select 先乐观更新 React，再按顺序发给 iframe，保证 iframe 忙时仍有即时反馈 |
| 宿主安全边界 | runtime 身份、数据归一化、命令归属、图片协议、数量/长度上限 | 仅接受 `panelSessionsByPlugin` 当前 `pluginId + runtimeId + contentWindow` 的消息；旧 iframe 发布会被丢弃 |

宿主到插件的事件为 `query(value)`、`tab(id)`、`select(id)`、`action(id, selectedId)`、`commandComplete(command, at)`、`backgroundPoll(...)`。`action.selectedId` 是用户触发动作瞬间的宿主选择快照，插件 kit 必须优先用它解析 item，不能依赖可能尚未完成回画的旧 `state.selectedId`。Manifest `command` 动作由宿主校验为当前插件命令后在长期 runtime 执行，完成后以 `commandComplete` 通知 panel 单次重读共享状态；其余动作回到 panel handler。

插件 handler 不得在回写 query/tab/select 前等待网络、CLI 或数据库。推荐顺序：同步更新 state → `paint()` → debounce/cancel 旧任务 → 后台加载 → generation 校验 → 再 `paint()`。这样受控搜索不会回跳，慢旧结果也不会覆盖新查询。

#### 指针、焦点与键盘

```text
pointer click / host keydown / hidden iframe forwarded key
  → PluginHost responder
  → List: linear navigation | Gallery: rendered-column 2D navigation
  → optimistic selectedId + scrollIntoView
  → qx:workbench:event/select
  → plugin handler updates business state and republishes
```

- Workbench 可见时，业务 iframe 保留运行但使用 `display:none` 退出布局与 pointer hit-testing；鼠标只能命中宿主 List/Gallery。
- iframe 若在首次发布前暂时持有焦点，集合键通过 `qx:host-keydown` 重新派发到所属 iframe 元素，只进入当前 QxShell；后台 worker 无法劫持可见面板按键。
- List 使用上下/Page/Home/End；Gallery 使用实际 CSS 网格列数做左右/上下二维移动。搜索框有文字时左右保留 caret，空查询时左右浏览 Gallery；IME 与带修饰键事件始终让给编辑器/系统。
- List / Gallery 浏览态占满 Main Area；pointer 激活或 Enter 打开带详情条目后，宿主挂载左集合 + 右详情并把焦点交给 detail region。Esc 卸载详情并恢复集合焦点；query/tab 变化也关闭旧详情。无条目但存在面板级 detail 时直接使用全宽详情。
- Enter 对带详情条目优先打开详情，无详情时使用同一 primary action；Cmd/Ctrl+K 使用同一 QxShell Actions；自定义 panel 仍自管其 DOM 内交互，但不得注册进程级集合键或 Esc。

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

Workbench 图片仍是受限纯数据端口：`item.image` 在 Gallery 中作为卡片图片、在 List
中作为行缩略图；`detail.image` 在结构化详情顶部作为单张大图预览，
`detail.images[]` 用于社区帖子等多图内容并由宿主排成响应式网格。图片只接受 HTTPS
或 `data:image/` URL；多图最多 24 张，并统一经过
`normalizePluginWorkbenchState` 长度与协议校验。

## 4. 权限模型

插件 manifest `permissions` 是字符串数组，分三类：

1. **能力组**：`clipboard`、`http`、`notifications`、`ai`、`ai-memory`、`ai-bash`、`ai-tools`、`ai-background`、`system-info`、`system-stats`、`processes`、`apps`、`files`、`permissions`、`automation`、`storage-management`、`open-url`、`storage`、`island`。
2. **精确命令**：`invoke:<cmd>`，用于危险或细粒度命令（如 `invoke:qx_system_information_kill_process`）。
3. **通配**：`*`，允许所有，仅内部/调试插件使用。

危险命令白名单 `DANGEROUS_INVOKE_COMMANDS` 中的命令，即使插件声明了能力组，也必须显式声明 `invoke:<cmd>` 才能调用。例如结束进程、申请权限、清空数据、宏回放、录屏启动等。

`island` 只开放 `context.island.show/update/dismiss`。宿主把每个插件限制为一个
`plugin-display` session，渲染结构化文本、真实进度/宿主倒计时和最多一个 manifest
command 动作。动作图标与胶囊按钮 chrome 来自宿主受限集合；浮窗启用、主窗隐藏
策略和置顶均由用户设置控制。

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

声明式 Workbench 复用同一原则：item `actions[]` 对应 Raycast `List.Item actions`，第一个/`primary` 对应 Enter 与底栏主动作，完整集合进入右侧 Actions 和 Cmd/Ctrl+K。区别只在执行适配器：Raycast 走 shim handler id，Workbench 走 panel `onAction` 或 manifest `command`。

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

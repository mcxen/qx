# QxAI Agent Runtime 当前架构

> 状态：Current · 适用版本：v0.6.102 · Owner：QxAI/Core · 最后复核：2026-08-31
>
> 本文只描述当前代码可调用的运行时。早期参考形状和未落地的 live MCP / Soul 设想见 [`archive/ai-agent-runtime-design-history.md`](./archive/ai-agent-runtime-design-history.md)。聊天视觉与交互以 [`UI_SPEC_AI.md`](../UI_SPEC_AI.md) 为准。

## 1. 角色与隔离

QxAI 是内置聊天、P仔和受权限约束插件共用的异步 AI substrate，不是 Launcher 的启动依赖。

```text
QxAI / P仔 / plugin context.ai
              |
  provider catalogue + normalized transport
              |
 agent harness (hooks, tools, safety, actions)
       |               |                |
 sessions/files   SQLite memory   schedules/tasks
       \_______________|________________/
                 Rust worker I/O
```

硬边界：

- `App.tsx` 首阶段不静态加载 Agent graph；聊天 turn、P仔或 schedule 需要时再动态 import。
- 网络、SQLite、文件、provider 阻塞调用和 schedule 执行在 Rust blocking/worker 边界运行。
- AI 慢、关闭、配置错误或 provider 失败时，Launcher、Clipboard、Shell 和普通插件仍可使用。
- 一个会话的失败只结束该 run；标题、memory extraction、schedule 和 telemetry 都是可失败旁路。

## 2. Provider 与消息传输

Provider catalogue 统一内置 provider 和 OpenAI-compatible 自定义 provider。API key 由 Rust 后端保管，不暴露给插件 iframe。模型能力区分 `reasoning`、`vision` 与 `vision_known`；未知能力不能直接当作“不支持”。

当前传输：

- 同步结果：`context.ai.chat`；
- 文本增量：`context.ai.stream`；
- 结构化增量：`context.ai.streamEvents`，当前公开 `text_delta`、`reasoning_delta`，并以 `done` / `error` 收敛；
- 内置 Agent：native function-calling 或 ReAct 共享同一权限化 tool implementation。

每个 stream 必须有独立 request id 和单一终态：

```text
started -> delta* -> done | error | timeout | cancelled
```

旧请求不能覆盖新请求或另一个会话。listener、timer、队列占位和 Island session 在所有终态清理。token speed 优先使用 provider 的真实 usage 与 request duration；fallback 必须标明估算，不能用 0/1ms 或工具总耗时伪造速率。

图片进入 provider 前被规范为 OpenAI-compatible content parts。会话管理的本地图片转为有界 `data:` URL；前端预览使用 `convertFileSrc()`，不发布原始 `file://`。

## 3. 会话与并发

聊天是持久数据，不存 browser localStorage：

```text
~/.qx/QxAiSession/
├── index.json
└── sessions/<conversation-id>/
    ├── session.json
    └── files/
```

每次变更只 debounce 保存当前 session，Rust 原子替换对应 `session.json` 并更新轻量 index。删除会话时删除该会话目录。旧 bulk save command 只用于兼容/恢复。

每个 conversation 拥有独立 run state 和 FIFO 输入队列；不同会话可并发。活动 run 发布独立的 `qxai.run.<conversation-id>` Island task，因此切换聊天或模块不会隐藏后台生成状态。

P仔创建带当前内容快照的后台 conversation，并复用同一 store、stream、queue 和 persistence。关闭 P仔投影不会删除对话；写回 RSS 等领域数据必须调用窄 domain tool，不能直接修改源正文。

## 4. Agent harness

当前实现位于 `src/modules/qx-ai/agent/`：

| 组件 | 职责 |
|---|---|
| `stream.ts` | 事件监听、超时、取消和增量 flush |
| `function-loop.ts` / `react-loop.ts` | 两种 tool-calling transport 的 turn 编排 |
| `tools.ts` / `tools-modules.ts` | 权限化工具目录与模块适配 |
| `module-actions.ts` | 模块/插件注册的稳定意图动作 |
| `capabilities.ts` | skill 绑定的 module action、plugin command、agent tool 目录 |
| `hooks.ts` | `before_turn`、`after_turn`、`on_error`、`before_tool`、`after_tool` |
| `dangerous-tools.ts` | 写入、bash、schedule、插件命令等风险分类与确认 |
| `memory.ts` | turn 前冻结的 memory snapshot 与工具适配 |

模块通过注册表扩展动作，不在 Agent core 增长每功能 `switch`。插件用 `context.ai.actions.register()` 注册 namespaced action；disable/unload 时宿主清理。插件 hook 只能 dispatch 已声明的插件 command，不接受 iframe JS 回调。

### Safety 与 SOLO

Settings → AI Agent 的 dangerous-tools guard 默认开启，SOLO 默认关闭：

| 状态 | 行为 |
|---|---|
| guard off | 用户显式关闭分类与确认 |
| guard on + SOLO off | blacklist deny；只读安全 bash allow；写入/未知/复杂操作 ask |
| guard on + SOLO on | 跳过确认，但仍记录 SOLO 运行语义 |

无 `window.confirm` 的 headless context 把 ask 当 deny。安全判断必须解析嵌套 capability/action id，不能只看外层 `run_qx_capability` 名称。

## 5. Skills、Actions 与工具可见性

Skills 位于 `~/.qx/skills`，frontmatter mode 为 `fixed | smart | disabled`。Skill 可声明稳定 capability id；宿主在 turn 前注入当前 available/missing 绑定，模型通过统一 capability tool 执行，而不是猜 API。

工具只有同时满足以下条件才进入 schema / ReAct prompt：

1. Settings 中 Agent、tool group 与对应危险能力开关允许；
2. 依赖的 built-in module 已启用；
3. 工具自己的 `isAvailable(settings)` 通过；
4. 插件拥有对应 manifest permission。

`Model Tool Calling` 只选择 native schema 或 ReAct transport，不绕过权限。保存后即将开始的 turn 必须先 flush debounced settings，避免 Rust gate 读取旧配置。

## 6. Memory

长期记忆使用 `~/.qx/memories/memory.db`（SQLite + FTS5）：

- cold archive 保留原始与派生记录；
- active core records 进入有字符预算的 prompt snapshot；
- episodic 与 superseded records 不自动注入，但可搜索；
- derived record 保存 source/type/importance/supersedes lineage，提取不删除源记录；
- Manual / Smart / Off 分别表示显式写入、选择性提取、保留数据库但停止 recall/capture；Smart 返回零候选是有效结果。

所有命令走 blocking worker。snapshot 只获取一次 memory lock，不能在持锁时调用另一个加锁 wrapper。Settings 的明确清理操作才可删除数据库；普通 cache cleanup 不得触碰会话或 memory。

## 7. 任务、Schedule 与 MCP 边界

插件 `context.ai.tasks` 当前提供 `submit/list/get/cancel`，状态为 `queued/running/succeeded/failed/cancelled`。任务只保证 Qx 进程存活期间运行；完全退出后继续执行所需的 helper 尚不是当前能力。

定时任务单独持久化在 `~/.qx/qxai-schedules.json`，由 Rust worker 检查到期项。当前 kind：

- `morning_desk_log`：截图、剪贴板和默认模型生成 `Downloads/QxLogs` Markdown；
- `agent_prompt`：经延迟加载的前端 bridge 建立后台 conversation 并发起 turn。

MCP 当前只实现 `~/.qx/mcp.json` 的有界 JSON 读取、校验、写入和 Settings 编辑。仓库没有把 stdio server 变成 live tool namespace，也没有公开 `context.ai.tools.list/call`；文档和 UI 不得把“已保存 MCP 配置”等同于“已连接 MCP server”。

Soul/persona API 也不在当前 `PluginContext.ai` 中。若未来实现，必须先定义持久化、用户编辑权与插件不可覆盖的边界。

## 8. 插件公共表面

`src/plugin/types.ts` 是当前类型事实来源。已实现：

- catalogue：`providers`、`models`、`defaultModel`、`agentSettings`；
- transport：`chat`、`stream`、`streamEvents`；
- gated tools：`runBash`、`search.grep`；
- memory：`list/add/delete`；
- tasks：`submit/list/get/cancel`；
- actions：`list/run/register/unregister`；
- hooks：`list/register/unregister`。

权限边界：

| 权限 | 能力 |
|---|---|
| `ai` | provider、model、chat/stream |
| `ai-memory` | memory list/add/delete |
| `ai-bash` | bash 执行；仍受 Agent 设置和 safety gate |
| `ai-tools` | grep、actions、hooks 等非 bash 工具 |
| `ai-background` | 进程内 background tasks |
| `invoke:<cmd>` | 直接 Rust command 的精确额外授权 |

配置中存在 `ai-mcp` 名称不代表 live MCP 工具已实现；在真实 host 和插件适配同时落地前，不应发布依赖它的插件。

## 9. 验证

修改 Agent runtime 时至少验证：

- 多会话并发、FIFO、取消、timeout 与 stream 终态清理；
- provider 真实文本/图片请求和明确 unsupported 错误；
- native tools 与 ReAct 使用同一权限和 safety 结果；
- disabled module/tool/plugin 不进入目录；plugin unload 清理 actions/hooks；
- memory snapshot 锁、Smart 零候选与普通 cache cleanup 保护；
- schedule 不阻塞 UI、后台 conversation 不抢焦点；
- MCP 只声明配置 I/O，不出现虚假的 live connection；
- `npm run check`、`npm run build`，以及风险相称的 Rust 检查。

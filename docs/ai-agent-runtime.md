# Qx AI Agent Runtime

## Goal

QxAI is the shared AI substrate for built-in modules and plugins. It should not be a single chat panel API. It should expose a permissioned runtime that can choose models, call tools, use memory, stream output, and run background tasks.

## Agent Hooks (pre / post / error / tool)

Host port: `src/modules/qx-ai/agent/hooks.ts` (+ `tool-runner.ts`).

| Phase | When | Typical use |
|---|---|---|
| `before_turn` | Start of ReAct / function-calling turn | Inject host context, cancel, rewrite base prompt |
| `after_turn` | After final answer | Post-process answer text (best-effort) |
| `on_error` | Stream/tool/iteration failure | Friendly recovery text |
| `before_tool` | Before each tool `run` | Normalize args, block unsafe calls |
| `after_tool` | After tool observation | Enrich / redact observation |

- Registry: `registerQxAiHooks` / `unregisterQxAiHooksByOwner` / `listQxAiHooks` / `runQxAiHooks`.
- Built-ins (auto-seeded): `builtin:host-context`, `builtin:dangerous-tools-guard`, `builtin:tool-input-normalize`, `builtin:error-friendly`.

### Dangerous tools + SOLO mode

Settings → AI Agent → **Safety & SOLO** (persisted on `agent`):

| Setting | Default | Effect |
|---|---|---|
| `dangerous_tools_guard_enabled` | **on** | Classify high-impact tools; content-aware bash gate + confirm |
| `solo_mode` | **off** | Skip confirm prompts (autonomous SOLO) |

Implementation: `src/modules/qx-ai/agent/dangerous-tools.ts` (`evaluateSafetyGate`, `classifyBashScript`, `BASH_COMMAND_BLACKLIST`, `BASH_SAFE_COMMANDS`, catalogue for writes / MCP / plugins / schedules / open_path / clipboard / brightness / recapture, …). Nested ids on `run_qx_capability` / `run_module_action` / `run_plugin_command` are also resolved.

**Bash is not blanket-blocked.** With the guard on and SOLO off:

| Script class | Gate |
|---|---|
| Blacklist (`rm -rf`, `mkfs`, `dd if=`, fork bomb, pipe-to-shell, force-push, …) | **deny** |
| Safe / read-only (`ps`, `ls`, `git status`, `rg`, …) | **allow** |
| Write / install / unknown / complex shell | **ask** once (`window.confirm`) |

Other catalogue tools (writes, schedules, plugin runners, …) **ask** once rather than hard-deny. Headless contexts without `window.confirm` treat **ask** as deny.

Policy:

1. Guard **off** → no classification / prompts (user fully disabled).
2. Guard **on** + SOLO **on** → tools run without prompts; system prompt notes SOLO.
3. Guard **on** + SOLO **off** → blacklist deny; safe bash allow; else confirm once.

UI shows live status; SOLO toggle is disabled when the guard is off (gate already open).
- Single-hook failures are logged and skipped; only `before_turn.cancel` aborts the turn.
- Agent tool `list_agent_hooks` is read-only discovery.
- Plugin SDK (`ai-tools`): `context.ai.hooks.list/register/unregister` — plugin hooks dispatch a plugin **command** (no iframe JS callbacks). Cleared on plugin disable/unload.
- First-party modules may `registerQxAiHooks` with full `run` functions (same process).

```ts
import { registerQxAiHooks } from "./agent";

registerQxAiHooks([{
  id: "my-module:enrich",
  phase: "before_turn",
  priority: 40,
  owner: "builtin:my-module",
  run: (ctx) => ({
    systemAppend: `User locale notes: …`,
  }),
}]);
```

## Isolation (must not affect main features)

QxAI is an **optional async substrate**. Launcher, clipboard, shell, plugins UI, and other modules must keep working when AI is slow, disabled, or failing.

| Rule | Implementation |
|---|---|
| No AI graph on App import | `App.tsx` does not statically import store/agent; schedule bridge is `import()` + idle deferred start |
| Agent harness on demand | `store.sendMessage` / P仔 run dynamically `import("./agent")` only for a turn |
| Schedule off UI thread | Rust `qx_ai_schedule::start` seeds files and ticks on a worker thread with panic isolation; each due job spawns its own worker |
| Frontend schedule bridge | Listens after idle; `agent_prompt` opens a **background** conversation (no focus steal) and fire-and-forgets `sendMessage`; never awaits the full agent turn on the event path |
| Module preload | Non-AI modules first wave; `qx-ai` / `p-zai` second idle wave |
| Failure isolation | `loadSessions` / `loadProviders` / dream / schedule never throw into shell; turn-local errors stay on the conversation run |

Do **not** add synchronous AI init to `App` phase-1 load, clipboard capture, or global shortcut registration.

## 异步解耦、高可用与 SOLID 约束

QxAI 的开发规范以异步运行时为核心：UI、编排、传输、统计和 provider 适配必须是可
替换的窄接口，不能把某个 provider 的字段或 React 状态写成全局协议。

| 边界 | 唯一职责 | 不允许承担 |
|---|---|---|
| `agent/stream.ts` / Tauri stream event | 监听、取消、超时、归一化 `delta/done/error` | 直接修改会话或计算 UI 布局 |
| `stream-metrics.ts` | 消费归一化输出快照，关闭生成计时窗口 | 读取 provider、React、Tauri |
| `store.ts` | 会话队列、运行状态、结果持久化编排 | 在 UI 回调中执行同步网络/磁盘 |
| provider / Rust adapter | 请求、SSE、usage 与 request duration | 泄漏 OS 分支或依赖 React |
| title / dream / schedule | 可失败的旁路后台任务 | 阻塞主对话或改变主 turn 成功态 |

### Stream contract

每次流必须具备独立 request id 和明确终态：`started → delta* → done | error | timeout`。
监听器、timer、队列占位和 Island session 在所有终态收敛；旧请求的事件不能覆盖新请求
或另一个会话。UI 更新使用一个原子 `(content, reasoning)` 快照，避免两个回调重复推进
计时或产生中间不一致状态。

后端 `qxai-stream` 的 `done` 事件可扩展携带 `tokenCount`、`durationMs`、`tokenSpeed`：
provider 有真实 usage 时优先使用；没有 usage 时，前端仅用本次 provider 请求耗时和明确标记
为估算的 token 数计算 fallback。`durationMs` 包含 TTFT，但不包含工具轮次、标题生成或
其它旁路任务；不得用首 token 时间差的 0/1ms 作为分母。

### Failure isolation

网络/provider 超时只失败当前 run；会话加载失败以空工作区启动并保留 Shell；标题、记忆
dream、schedule 和 telemetry 均为 best-effort。阻塞 HTTP、数据库、文件和媒体操作必须
进入 Rust blocking pool 或有界 worker；不能因为一个慢 provider 占满 UI/Tokio 核心线程。

## QxAiSession persistence and concurrency

Built-in chat history is durable data under `~/.qx/QxAiSession` (folder layout,
RLM-style modular units), not browser localStorage:

```text
~/.qx/QxAiSession/
  index.json                      # lightweight catalog
  sessions/<conversation-id>/
    session.json                  # full conversation document
    files/*                       # managed attachment copies
```

Legacy `sessions.json` / `files/` are **not** migrated — missing layout marker or
legacy paths trigger a one-time wipe; the user starts with an empty session tree.
Each frontend mutation debounces into a single-session save command; it does not
serialize every other conversation. The backend atomically replaces only that
session's `session.json` and updates the small `index.json` catalog under a
blocking worker. The legacy bulk save command remains for compatibility and
recovery tooling. Deleting a conversation removes its entire folder. Settings →
Storage Management reports this directory as a protected durable bucket; users
may open it or explicitly clear all QxAI sessions, but general cache cleanup must
never remove it.

Each conversation owns an independent run state and FIFO input queue. Starting
a request in one conversation must not serialize, replace, or hide streaming
state from another conversation. Active runs publish separate
`qxai.run.<conversation-id>` Island task sessions so work remains visible after
the user switches chats or modules.

User attachments are copied into that session's `files/` directory before they
enter chat history. The provider adapter converts supported images to
OpenAI-compatible data URL content parts and bounded UTF-8 text files to inline
file context. Other managed files retain a real local path for QxAI's
permissioned file and bash tools. UI previews always use `convertFileSrc`; raw
`file://` URLs are not part of the frontend protocol.

## QxAI long-term memory (SQLite + FTS)

Long-term notes live under `~/.qx/memories/memory.db` (SQLite + FTS5), with an
RLM-style retrieval split:

| Layer | Role |
|---|---|
| **Cold archive** | Every `memory` / `user` note is stored (no hard size cap on the DB) |
| **FTS search** | `memory action=search` finds older notes without stuffing them into the prompt |
| **Hot snapshot** | Only a char-capped recent pack (~2200 / ~1375) is frozen into the system prompt |

`MEMORY.md` / `USER.md` are best-effort mirrors of the hot window after migration.
Dream consolidation rewrites the hot set; the archive remains searchable. All
memory commands, including the snapshot used before a turn, run through the
blocking worker. The snapshot command must take the memory lock exactly once;
it must never call a lock-taking wrapper while already holding that lock.
`qxai_memory_clear` drops the database (explicit user action only).

## Reference Shape

- Provider abstraction follows the same boundary used by Rust AI SDKs such as Rig and genai: callers select `provider + model`, while the runtime normalizes request/response formats.
- Tool execution follows a ReAct-style loop: observe context, think in model tokens, call a declared tool, feed the result back to the model, then continue until final output.
- MCP support is treated as another tool backend. Qx should act as an MCP host/client that lists tools, invokes tools, and stores per-server permissions.

## Runtime Layers

1. **Provider Catalog**
   - Built-in providers expose static model metadata.
   - OpenAI-compatible custom providers fetch model metadata from `GET /models`.
   - API keys stay in the Rust backend and are never exposed to plugin iframes.
   - Model entries expose `reasoning` and `vision` (multimodal image input).
     Detection order: provider `/models` architecture metadata → id heuristics
     → Settings `agent.model_capabilities` overrides (`provider|model` keys).
   - Image attachments require `vision`. The host fails with a clear unsupported
     capability error when images are present on a non-vision model.

2. **Message Transport**
   - Text messages use plain string content.
   - Multimodal messages use OpenAI-compatible content parts:
     - `{ type: "text", text }`
     - `{ type: "image_url", image_url: { url, detail } }`
   - Providers without image support must fail with a clear unsupported-capability error.

3. **Streaming**
   - Current APIs:
     - `context.ai.stream(input, onChunk, options?)`
     - `context.ai.streamEvents(input, onEvent, options?)`
   - The host starts `plugin_ai_stream_chat_events` and forwards provider SSE deltas
     to the requesting iframe while the request is still active. `stream()` is the
     compatibility text-only projection; it must never buffer an entire response
     and replay it with timers.
   - Structured events currently include `text_delta` and `reasoning_delta`; the
     host lifecycle also carries `error` and `done`. Future additions may include
     `toolCall`, `toolResult`, and `memory`.
   - Built-in function calling uses the same event transport. Tool call argument
     deltas are reconstructed in Rust, while text and reasoning remain live.
   - Function-call streaming retains the complete-response command as a
     compatibility fallback for OpenAI-compatible providers that accept tools
     but do not stream tool-call deltas reliably.
   - Current synchronous chat remains available as `context.ai.chat`.
   - The legacy host `g4f_chat` compatibility command is exposed as an async
     Tauri command and runs blocking provider I/O behind `spawn_blocking`; QxAI
     background title generation must never occupy the UI/runtime thread.

4. **Module ports exposed to the agent**
   - Screencap headless: `qx_screenshot` → `qxai_capture_desktop` (full display PNG + optional copy into Downloads/QxLogs).
   - Clipboard: `qx_clipboard_history` → recent history for digests.
   - Schedules: `list_schedules` / `upsert_schedule` / `delete_schedule` / `run_schedule_now` backed by `~/.qx/qxai-schedules.json`.
   - Kinds: `morning_desk_log` (Rust pipeline: screenshot + clipboard + default model → Markdown under `Downloads/QxLogs`) and `agent_prompt` (frontend chat turn with optional skill).
   - Bundled skill `morning-desk-log` is seeded on first launch; example schedule is disabled until the user enables it in Settings → AI Agent → Schedules.

4a. **Module Action catalogue (pluginized)**
   - Host port: `src/modules/qx-ai/agent/module-actions.ts`.
   - Modules and plugins register **stable intentional actions** (refresh, mark read, open workbench) separately from fine-grained data tools.
   - Agent tools: `list_module_actions` (discover) and `run_module_action` (execute by id). Example: `rss.refresh_all` refreshes every subscription; P仔 and QxAI share the same catalogue.
   - Builtin seeds include `rss.refresh_all` / `rss.refresh_feed` / `rss.mark_read`, `pzai.*`, `docs.write`, `weather.refresh`, `screencap.recapture`.
   - Visibility: required builtin modules must be enabled; disabled modules never appear in the list.
   - Plugin SDK (`permission: ai-tools`):
     - `context.ai.actions.list({ moduleId?, query? })`
     - `context.ai.actions.run(id, input?)`
     - `context.ai.actions.register([{ id, title, description, risk?, parameters?, invokeCommand?, command? }])` → ids become `plugin:<pluginId>:<id>`
     - `context.ai.actions.unregister()` — also auto-cleared on plugin disable/unload
   - Plugin-owned actions may back onto a permitted `invokeCommand` and/or a plugin `command` name. Do not hardcode per-plugin tools into the agent harness; register actions instead.

4a′. **Skill-driven Qx capabilities (modules + plugins)**
   - Host port: `src/modules/qx-ai/agent/capabilities.ts`.
   - Unified catalogue kinds:
     - `module_action` — same ids as §4a (`rss.refresh_all`, `plugin:<id>:<action>`)
     - `plugin_command` — launcher commands as `command:<pluginId>:<name>`
     - `agent_tool` — live tool names as `tool:<name>`
   - Agent tools: `list_qx_capabilities`, `run_qx_capability`, `list_plugins`, `run_plugin_command`.
   - **Skills are the workflow layer.** Frontmatter may declare:

     ```yaml
     capabilities:
       - rss.refresh_all
       - tool:rss_list_articles
       - command:v2ex:latest
       - plugin:my-plugin:sync
     ```

     When a skill is fixed/smart/selected, the host injects a **live binding block** (available vs missing) into the system prompt so the model executes via capability tools instead of inventing APIs.
   - Bundled skills: `morning-desk-log` (fixed), `rss-brief` (smart), `qx-plugin-capabilities` (smart). Seeded once into `~/.qx/skills` without overwriting user edits.
   - Plugin authors: register AI actions (`context.ai.actions.register`) **and/or** document launcher commands; optionally ship a skill that lists those capability ids.

4b. **Agent harness layout (speed + modularity)**
   - Source: `src/modules/qx-ai/agent/` — `tools`, `prompts`, `stream`, `react-loop`, `function-loop`, `memory`, `parse`, `types`, `module-actions`.
   - `react-agent.ts` re-exports the harness for existing imports.
   - Speed: context compaction (`MAX_CONTEXT_MESSAGES`), parallel multi-tool execution, throttled stream UI (~48 ms), compact tool catalog in the function-calling system prompt, frozen memory snapshot for prefix cache.
   - **Capability visibility**: each tool may declare `requiresModules` (e.g. `screencap`, `clipboard`, `rss`, `documents`, `weather`) and optional `isAvailable(settings)` (e.g. OCR master switch). `getEnabledTools` only exposes tools when Agent settings switches are on **and** every required builtin module is enabled **and** `isAvailable` passes. Disabled modules never appear in OpenAI tool schemas or ReAct prompts.
   - **Module tools** (when module/settings allow): system storage/network/power/brightness; OCR recognize/list; Text Toolbox docs list/read/write; RSS dashboard/feeds/articles/`rss_refresh_all`; weather current/location; screencap history/recapture; clipboard entry by id; P仔 workbench tools; module-action list/run.

5. **Native reasoning**
   - Reasoning is opt-in per conversation/request and is enabled only when the
     selected model advertises the capability.
   - Provider-native `reasoning_content` / `reasoning` text is rendered in a
     separate collapsible surface; it is never mixed into the final answer.
   - Opaque `reasoning_details` are preserved on assistant tool-call messages for
     provider continuity, but are not presented as readable chain-of-thought.
   - OpenRouter receives `reasoning.enabled`; DeepSeek receives its native
     `thinking.type` request shape. Other compatible providers receive
     `reasoning_effort` only after the caller explicitly opts in.

5. **Tools**
   - Built-in safe tools: provider/model list, memory read/write, search apps/files, HTTP fetch, notifications.
   - Dangerous tools: bash, process kill, permissions request, file write/delete. These require dedicated permissions such as `ai-bash` or exact `invoke:<cmd>`.
   - Bash execution must always use a timeout and return structured `{ status, stdout, stderr, timedOut }`.
   - Current global switches live in Settings -> AI Agent. Agent mode, tools,
     host/system tools, and native model tool-calling default **on** so chat can
     use Qx capabilities without flipping every switch.
   - Built-in tool groups also cover Qx system ports (`qx_system_info`,
     `qx_system_stats`, `qx_displays`, `qx_desktop_windows`, `qx_processes`),
     skill file CRUD (`list_skills` / `read_skill` / `write_skill`), and MCP
     config I/O (`read_mcp_config` / `write_mcp_config` on `~/.qx/mcp.json`).
   - Skills under `~/.qx/skills` declare `mode: fixed|smart|disabled` in
     frontmatter; Settings can override per skill. Fixed skills always inject;
     smart skills auto-match the user message; disabled skills only load via `/`.
   - `Model Tool Calling` selects the transport rather than the permission:
     enabled uses native tool schemas; disabled uses the portable ReAct prompt
     protocol. Both execute the same permissioned local tool implementations.
   - Before a built-in Agent starts, pending debounced settings are flushed so
     the Rust permission gate observes newly enabled Agent / Tools / Bash state.
   - Bash working directories expand `~`, `~/...`, and `~\...` at the shared CLI
     boundary before spawning. The shell is still executed with a bounded timeout.
   - Grep search is exposed as a real `rg`/`grep` subprocess through `context.ai.search.grep(query, opts?)`, capped by the user-configured result limit.

6. **MCP**
   - Config is user-managed JSON at `~/.qx/mcp.json` (`qxai_read_mcp_config` /
     `qxai_write_mcp_config`). Settings shows an editor; the agent can edit the
     same file when MCP tools are enabled.
   - Planned Rust host layer uses the official Rust MCP SDK shape: one configured server becomes a live tool namespace for stdio calls.
   - MCP tools should be discoverable through `context.ai.tools.list()` and callable through `context.ai.tools.call(name, input)`.

7. **Memory (RLM archive + Hermes hot window)**
   - **Cold store**: SQLite + FTS5 at `~/.qx/memories/memory.db` (targets `memory` / `user`).
     Notes are always appended; history is not silently dropped.
   - **Hot snapshot**: `qxai_memory_snapshot` packs recent entries into char-capped
     windows (~2200 memory / ~1375 user) for the system prompt (prefix-cache friendly).
   - **Search**: `memory action=search` (or query via tools) uses FTS so long archives stay findable.
   - Agent tools: unified `memory` (`add|replace|remove|status|search`), plus legacy aliases.
   - **Dream / sleep**: consolidates the hot set via the default model; diary under
     `~/.qx/memories/dreams/`. Archive rows remain searchable.
   - **Session search**: `qxai_session_search` walks `QxAiSession/sessions/*/session.json`.
   - No legacy import: layout reset deletes old MEMORY.md / USER.md / qxai-memory.json.
   - Explicit wipe: `qxai_memory_clear` (Settings → Storage).

8. **Background Tasks**
   - Current in-process task API:
     - `submit`, `list`, `get`, `cancel`
     - states: `queued`, `running`, `succeeded`, `failed`, `cancelled`
   - While Qx is hidden in the tray, tasks can keep running inside the app process and notify on completion.
   - Running after the app process fully exits requires a LaunchAgent/helper process; do not claim this until that helper is implemented.
   - Future persistent tasks should move the task ledger into SQLite and add `waitingForTool`.

9. **Soul / Persona**
   - `soul` is the persistent persona layer above memory:
     - default system prompt
     - tone and boundaries
     - preferred tools
     - memory access policy
   - Soul must be user-editable. Plugins may request a soul but cannot silently overwrite the global one.

## Plugin SDK Surface

Implemented now:

```ts
await context.ai.providers()
await context.ai.models(providerId)
await context.ai.defaultModel()
await context.ai.agentSettings()
await context.ai.chat("prompt", { provider, model, system })
await context.ai.chat({ prompt, images: ["data:image/png;base64,..."] })
await context.ai.stream("prompt", (chunk) => append(chunk), { provider, model })
await context.ai.streamEvents(
  "prompt",
  (event) => {
    if (event.type === "text_delta") append(event.delta)
    if (event.type === "reasoning_delta") updateReasoning(event.delta)
  },
  { provider, model, reasoning: true },
)
await context.ai.runBash("pwd && ls", { cwd, timeoutMs })
await context.ai.search.grep("TODO", { root: "/path/to/project", maxResults: 50 })
await context.ai.memory.list()
await context.ai.memory.add("User prefers concise answers", ["preference"])
await context.ai.memory.delete(id)
await context.ai.tasks.submit({ title: "Research", prompt: "...", notify: true })
await context.ai.tasks.list()
await context.ai.actions.list({ query: "refresh" })
await context.ai.actions.run("rss.refresh_all")
await context.ai.actions.register([
  {
    id: "sync",
    title: "Sync remote data",
    description: "Pull the latest remote catalogue",
    risk: "network",
    command: "sync",
  },
])
await context.ai.actions.unregister()
```

Planned:

```ts
await context.ai.tools.list()
await context.ai.tools.call(name, input)
await context.ai.soul.get()
await context.ai.soul.update(patch)
```

## Permissions

- `ai`: provider catalog and chat.
- `ai-memory`: memory list/add/delete.
- `ai-bash`: bash tool execution.
- `ai-tools`: non-dangerous tool calling, including configured grep search.
- `ai-mcp`: MCP server tool discovery and calls.
- `ai-background`: submit background agent tasks.
- Dangerous direct Rust commands still require exact `invoke:<cmd>`.

## UI Requirements

- Streaming output should render incrementally in the module or plugin panel.
- Background task progress should use QxShell island state while visible.
- Completion/failure should use system notification when the user is outside Qx.
- **Simple chat defaults** (default provider/model, system prompt) live in the AI module Chat Settings view.
- **Complex AI configuration** belongs in Settings -> AI Agent: built-in API keys, custom providers (BYOK), memory, agent mode, tools, bash, grep, and background tasks.
- Agent runtime switches use Qx custom controls, not native selects or checkboxes.
- AI list/chat operations go through QxShell `actions` + `Cmd+K` / `Ctrl+K` (Raycast-style Action Panel). Do not bind bare letter keys that steal search/input typing.

# Qx AI Agent Runtime

## Goal

QxAI is the shared AI substrate for built-in modules and plugins. It should not be a single chat panel API. It should expose a permissioned runtime that can choose models, call tools, use memory, stream output, and run background tasks.

## QxAiSession persistence and concurrency

Built-in chat history is durable data under `~/.qx/QxAiSession`, not browser
localStorage. `sessions.json` stores the conversation model and each session's
managed attachment copies live under `files/<conversation-id>/`. Writes are
atomic and filesystem work runs behind the Rust blocking boundary. Settings →
Storage Management reports this directory as a protected durable bucket; users
may open it or explicitly clear all QxAI sessions, but general cache cleanup
must never remove it.

Each conversation owns an independent run state and FIFO input queue. Starting
a request in one conversation must not serialize, replace, or hide streaming
state from another conversation. Active runs publish separate
`qxai.run.<conversation-id>` Island task sessions so work remains visible after
the user switches chats or modules.

User attachments are copied into the session directory before they enter chat
history. The provider adapter converts supported images to OpenAI-compatible
data URL content parts and bounded UTF-8 text files to inline file context.
Other managed files retain a real local path for QxAI's permissioned file and
bash tools. UI previews always use `convertFileSrc`; raw `file://` URLs are not
part of the frontend protocol.

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

7. **Memory (Hermes-style harness)**
   - Dual curated stores under `~/.qx/memories/`:
     - `MEMORY.md` — agent notes (2 200 char cap)
     - `USER.md` — user profile / preferences (1 375 char cap)
   - Entries are separated by `§`. Exact duplicates are rejected; overflow returns a consolidate error (no silent drop).
   - **Frozen snapshot**: `qxai_memory_snapshot` injects both stores into the system prompt once per turn (prefix-cache friendly). Mid-turn tool writes persist to disk; the prompt block updates next turn.
   - Agent tools: unified `memory` (`add|replace|remove|status`, targets `memory|user`), plus legacy `memory_list/add/delete` aliases.
   - **Dream / sleep**: `qxai_memory_dream` consolidates stores with the default model and writes a diary under `~/.qx/memories/dreams/`. The chat harness may auto-trigger dream after heavy tool turns.
   - **Session search**: `qxai_session_search` scans durable `QxAiSession` history for on-demand recall without bloating the system prompt.
   - Legacy `~/.qx/qxai-memory.json` is migrated into MEMORY/USER on first access.

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

# Qx AI Agent Runtime

## Goal

QxAI is the shared AI substrate for built-in modules and plugins. It should not be a single chat panel API. It should expose a permissioned runtime that can choose models, call tools, use memory, stream output, and run background tasks.

## Reference Shape

- Provider abstraction follows the same boundary used by Rust AI SDKs such as Rig and genai: callers select `provider + model`, while the runtime normalizes request/response formats.
- Tool execution follows a ReAct-style loop: observe context, think in model tokens, call a declared tool, feed the result back to the model, then continue until final output.
- MCP support is treated as another tool backend. Qx should act as an MCP host/client that lists tools, invokes tools, and stores per-server permissions.

## Runtime Layers

1. **Provider Catalog**
   - Built-in providers expose static model metadata.
   - OpenAI-compatible custom providers fetch model metadata from `GET /models`.
   - API keys stay in the Rust backend and are never exposed to plugin iframes.
   - Model entries should eventually include capabilities: `text`, `vision`, `toolCalling`, `json`, `streaming`, `embedding`.

2. **Message Transport**
   - Text messages use plain string content.
   - Multimodal messages use OpenAI-compatible content parts:
     - `{ type: "text", text }`
     - `{ type: "image_url", image_url: { url, detail } }`
   - Providers without image support must fail with a clear unsupported-capability error.

3. **Streaming**
   - Current API:
     - `context.ai.stream(input, onChunk, options?)`
     - `plugin_ai_stream_chat` returns text chunks and the plugin runtime delivers them through `onChunk`.
   - Stream events should include `delta`, `toolCall`, `toolResult`, `memory`, `error`, and `done`.
   - Current synchronous chat remains available as `context.ai.chat`.

4. **Tools**
   - Built-in safe tools: provider/model list, memory read/write, search apps/files, HTTP fetch, notifications.
   - Dangerous tools: bash, process kill, permissions request, file write/delete. These require dedicated permissions such as `ai-bash` or exact `invoke:<cmd>`.
   - Bash execution must always use a timeout and return structured `{ status, stdout, stderr, timedOut }`.
   - Current global switches live in Settings -> AI Agent. Agent mode and the master tools switch must be enabled before bash or grep tools run.
   - Grep search is exposed as a real `rg`/`grep` subprocess through `context.ai.search.grep(query, opts?)`, capped by the user-configured result limit.

5. **MCP**
   - Planned Rust host layer uses the official Rust MCP SDK shape: one configured server becomes a tool namespace.
   - MCP tools should be discoverable through `context.ai.tools.list()` and callable through `context.ai.tools.call(name, input)`.
   - MCP server configuration must be user-managed and auditable, not bundled invisibly by plugins.

6. **Memory**
   - User memory is explicit, inspectable, and deletable.
   - Current backing store is `~/.qx/qxai-memory.json`.
   - Future store should move to SQLite with tags, source plugin, timestamps, embeddings, and user-visible enable/disable flags.

7. **Background Tasks**
   - Current in-process task API:
     - `submit`, `list`, `get`, `cancel`
     - states: `queued`, `running`, `succeeded`, `failed`, `cancelled`
   - While Qx is hidden in the tray, tasks can keep running inside the app process and notify on completion.
   - Running after the app process fully exits requires a LaunchAgent/helper process; do not claim this until that helper is implemented.
   - Future persistent tasks should move the task ledger into SQLite and add `waitingForTool`.

8. **Soul / Persona**
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
await context.ai.runBash("pwd && ls", { cwd, timeoutMs })
await context.ai.search.grep("TODO", { root: "/path/to/project", maxResults: 50 })
await context.ai.memory.list()
await context.ai.memory.add("User prefers concise answers", ["preference"])
await context.ai.memory.delete(id)
await context.ai.tasks.submit({ title: "Research", prompt: "...", notify: true })
await context.ai.tasks.list()
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

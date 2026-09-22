import { invoke } from "@tauri-apps/api/core";
import { isBuiltinModuleEnabled } from "../../moduleAvailability";
import type { AgentSettings, Settings } from "../../settings/store";
import { useSettingsStore } from "../../settings/store";
import {
  asRecord,
  numberField,
  stringField,
  truncate,
  type ToolSpec,
} from "./types";
import { FILE_TOOLS } from "./tools-files";
import { ALL_MODULE_TOOLS } from "./tools-modules";
import {
  ensureBuiltinModuleActionsRegistered,
  listModuleActions,
  runModuleAction,
} from "./module-actions";
import {
  formatCapabilities,
  listInstalledPluginsForAgent,
  listQxCapabilities,
  runPluginCommandCapability,
  runQxCapability,
} from "./capabilities";
import { listQxAiHooks } from "./hooks";
import { HOST_MANAGEMENT_TOOLS } from "./tools-host-management";

import { mutateMemory, runMemoryDream } from "./memory";

export { HOST_MANAGEMENT_TOOLS };

const hostOn = (s: AgentSettings) => s.qx_host_actions_enabled;

/**
 * Skill-driven capability port: discover Qx modules + plugins, run actions/commands.
 * Prefer these when a skill declares `capabilities:` or the user asks for host work.
 */
export const CAPABILITY_TOOLS: ToolSpec[] = [
  {
    name: "list_qx_capabilities",
    description:
      "List available Qx capabilities: module actions (rss.refresh_all…), plugin commands (command:<pluginId>:<name>), and enabled agent tools (tool:<name>). Skills declare capabilities in frontmatter; call this to discover what the host can actually do now.",
    inputHint: '{"query": "rss", "kind": "module_action"}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        source: { type: "string", description: "module id or plugin id" },
        kind: {
          type: "string",
          description: "module_action | plugin_command | agent_tool | all",
        },
      },
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const settings = useSettingsStore.getState().settings;
      const enabled = getEnabledTools(settings.agent, settings)
        .map((tool) => tool.name)
        .filter(
          (name) =>
            name !== "list_qx_capabilities"
            && name !== "run_qx_capability"
            && name !== "list_plugins"
            && name !== "run_plugin_command",
        );
      const kindRaw = stringField(rec, "kind").trim() || "all";
      const kind =
        kindRaw === "module_action"
        || kindRaw === "plugin_command"
        || kindRaw === "agent_tool"
          ? kindRaw
          : "all";
      const caps = listQxCapabilities(
        {
          query: stringField(rec, "query") || undefined,
          source: stringField(rec, "source") || stringField(rec, "moduleId") || undefined,
          kind,
        },
        settings,
        enabled,
      );
      return formatCapabilities(caps);
    },
  },
  {
    name: "run_qx_capability",
    description:
      "Run one Qx capability by id from list_qx_capabilities. Module actions: rss.refresh_all. Plugin commands: command:v2ex:latest. For tool:* ids, call that tool by name instead. Prefer when executing a skill's capabilities list.",
    inputHint: '{"id": "rss.refresh_all", "input": {}}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        input: { type: "object" },
        action: { type: "string" },
        args: { type: "object" },
      },
      required: ["id"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const id =
        stringField(rec, "id") || stringField(rec, "action") || stringField(rec, "capability");
      let payload: Record<string, unknown> = {};
      if (rec.input && typeof rec.input === "object" && !Array.isArray(rec.input)) {
        payload = rec.input as Record<string, unknown>;
      } else if (rec.args && typeof rec.args === "object" && !Array.isArray(rec.args)) {
        payload = rec.args as Record<string, unknown>;
      }
      return runQxCapability(id, payload);
    },
  },
  {
    name: "list_plugins",
    description:
      "List installed Qx plugins (marketplace + built-in package surface) with their launcher commands. Disabled plugins are still listed; only enabled plugins are runnable. Use with run_plugin_command or run_qx_capability(command:pluginId:name).",
    inputHint: '{"query": "v2ex"}',
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
    },
    isEnabled: hostOn,
    run: async (input) => {
      const q = stringField(asRecord(input), "query").trim().toLowerCase();
      let plugins = listInstalledPluginsForAgent();
      if (q) {
        plugins = plugins.filter(
          (plugin) =>
            `${plugin.id} ${plugin.name} ${plugin.description} ${plugin.commands
              .map((c) => c.name)
              .join(" ")}`
              .toLowerCase()
              .includes(q),
        );
      }
      if (plugins.length === 0) return "No matching plugins.";
      return truncate(
        plugins
          .map((plugin) => {
            const cmds =
              plugin.commands.length > 0
                ? plugin.commands
                    .map((c) => `    - ${c.name}: ${c.title}${c.description ? ` — ${c.description}` : ""}`)
                    .join("\n")
                : "    (no interactive commands)";
            const lifecycle = plugin.canManageLifecycle
              ? "set_plugin_enabled / uninstall_plugin"
              : "manage in Settings → Extensions";
            return `- ${plugin.id} [${plugin.kind}/${plugin.enabled ? "enabled" : "disabled"}] ${plugin.name} v${plugin.version}\n  ${plugin.description || "(no description)"}\n  Lifecycle: ${lifecycle}\n${cmds}`;
          })
          .join("\n"),
        12_000,
      );
    },
  },
  {
    name: "run_plugin_command",
    description:
      "Run an installed plugin's launcher command by pluginId + command name (from list_plugins). Equivalent to run_qx_capability with id command:<pluginId>:<command>.",
    inputHint: '{"pluginId": "v2ex", "command": "latest"}',
    parameters: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        command: { type: "string" },
        input: { type: "object" },
      },
      required: ["pluginId", "command"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const pluginId = stringField(rec, "pluginId") || stringField(rec, "plugin_id");
      const command = stringField(rec, "command") || stringField(rec, "name");
      if (!pluginId.trim() || !command.trim()) {
        return "Error: pluginId and command are required.";
      }
      const payload =
        rec.input && typeof rec.input === "object" && !Array.isArray(rec.input)
          ? (rec.input as Record<string, unknown>)
          : {};
      return runPluginCommandCapability(pluginId.trim(), command.trim(), payload);
    },
  },
  {
    name: "list_agent_hooks",
    description:
      "List registered QxAI agent hooks (before_turn, after_turn, on_error, before_tool, after_tool). Built-ins inject host context and normalize capability tool inputs; plugins may register command-backed hooks.",
    inputHint: '{"phase": "before_turn"}',
    parameters: {
      type: "object",
      properties: {
        phase: {
          type: "string",
          description: "before_turn | after_turn | on_error | before_tool | after_tool",
        },
      },
    },
    isEnabled: hostOn,
    run: async (input) => {
      const phase = stringField(asRecord(input), "phase").trim();
      const valid =
        phase === "before_turn"
        || phase === "after_turn"
        || phase === "on_error"
        || phase === "before_tool"
        || phase === "after_tool"
          ? phase
          : undefined;
      const hooks = listQxAiHooks(valid);
      if (hooks.length === 0) return "No hooks registered.";
      return truncate(
        hooks
          .map(
            (hook) =>
              `- ${hook.id} [${hook.phase.join(",")}] priority=${hook.priority}${
                hook.owner ? ` owner=${hook.owner}` : ""
              }`,
          )
          .join("\n"),
      );
    },
  },
];

/** Discoverable module/plugin action port (shared by QxAI + P仔 + plugins). */
export const MODULE_ACTION_TOOLS: ToolSpec[] = [
  {
    name: "list_module_actions",
    description:
      "List discoverable module and plugin actions the agent may run (stable ids such as rss.refresh_all, pzai.open_article, plugin:<id>:<action>). Call this before inventing action ids. Optional moduleId or query filters the catalogue.",
    inputHint: '{"moduleId": "rss", "query": "refresh"}',
    parameters: {
      type: "object",
      properties: {
        moduleId: { type: "string", description: "Builtin module id or plugin id" },
        query: { type: "string", description: "Substring filter on id/title/description" },
      },
    },
    isEnabled: hostOn,
    run: async (input) => {
      ensureBuiltinModuleActionsRegistered();
      const rec = asRecord(input);
      const actions = listModuleActions({
        moduleId: stringField(rec, "moduleId") || stringField(rec, "module_id") || undefined,
        query: stringField(rec, "query") || undefined,
      });
      if (actions.length === 0) return "No module actions available (check module enablement).";
      return truncate(
        actions
          .map(
            (a) =>
              `- ${a.id} [${a.risk}] (${a.moduleId}${a.pluginId ? ` plugin:${a.pluginId}` : ""}): ${a.title} — ${a.description}${
                a.inputHint ? ` Example: ${a.inputHint}` : ""
              }`,
          )
          .join("\n"),
        12_000,
      );
    },
  },
  {
    name: "run_module_action",
    description:
      "Run a registered module/plugin action by stable id. Examples: rss.refresh_all (refresh all subscriptions), rss.refresh_feed with {\"id\":1}, pzai.open_article with {\"id\":42}. Prefer list_module_actions when unsure of the id.",
    inputHint: '{"id": "rss.refresh_all", "input": {}}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Stable action id from list_module_actions" },
        input: { type: "object", description: "Action arguments object" },
        // aliases models sometimes emit
        action: { type: "string" },
        args: { type: "object" },
      },
      required: ["id"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const id =
        stringField(rec, "id") || stringField(rec, "action") || stringField(rec, "actionId");
      let payload: Record<string, unknown> = {};
      if (rec.input && typeof rec.input === "object" && !Array.isArray(rec.input)) {
        payload = rec.input as Record<string, unknown>;
      } else if (rec.args && typeof rec.args === "object" && !Array.isArray(rec.args)) {
        payload = rec.args as Record<string, unknown>;
      } else {
        const {
          id: _omitId,
          action: _omitAction,
          actionId: _omitActionId,
          input: _omitInput,
          args: _omitArgs,
          ...rest
        } = rec;
        void _omitId;
        void _omitAction;
        void _omitActionId;
        void _omitInput;
        void _omitArgs;
        payload = rest;
      }
      return runModuleAction(id, payload);
    },
  },
];

export const TOOLS: ToolSpec[] = [
  ...FILE_TOOLS,
  {
    name: "http",
    description:
      "Make an HTTP GET (or other method) request and return the response body. Use for reading docs, APIs, RSS feeds.",
    inputHint: '{"url": "https://example.com", "method": "GET"}',
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute HTTP(S) URL" },
        method: { type: "string", description: "HTTP method (default GET)" },
        headers: { type: "object", description: "Optional headers map" },
        body: { type: "string", description: "Optional request body" },
      },
      required: ["url"],
    },
    isEnabled: (s) => s.http_fetch_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const url = stringField(rec, "url");
      if (!url.trim()) return "Error: http requires a 'url' field.";
      const method = stringField(rec, "method", "GET").toUpperCase();
      const headersRaw = rec.headers;
      const headers: Record<string, string> = {};
      if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
        for (const [k, v] of Object.entries(headersRaw)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
      const body = typeof rec.body === "string" ? rec.body : undefined;
      const response = await invoke<{
        status: number;
        ok: boolean;
        body: string;
      }>("plugin_http_fetch", {
        req: { url, method, headers, body, timeout_ms: 15_000 },
      });
      return truncate(`HTTP ${response.status}${response.ok ? "" : " (failed)"}:\n${response.body}`);
    },
  },
  {
    name: "apps",
    description:
      "Search applications installed on the current operating system by name. Returns matching app paths.",
    inputHint: '{"query": "safari"}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name fragment to search" },
      },
      required: ["query"],
    },
    isEnabled: (s) => s.app_search_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query");
      const results = await invoke<Array<{ name: string; path: string; kind: string }>>(
        "search_apps",
        { query },
      );
      if (results.length === 0) return "No matching apps.";
      return truncate(
        results
          .slice(0, 20)
          .map((r) => `${r.name} (${r.kind}) — ${r.path}`)
          .join("\n"),
      );
    },
  },
  {
    name: "notify",
    description:
      "Show a native Qx completion notification. Use for a requested completion alert, especially after a longer task.",
    inputHint: '{"title": "QxAI", "body": "Task completed"}',
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        body: { type: "string", description: "Notification body" },
      },
      required: ["title"],
    },
    isEnabled: (s) => s.notifications_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const title = stringField(rec, "title").trim();
      if (!title) return "Error: notify requires a 'title' field.";
      await invoke("plugin_notification_show", {
        req: { title, body: stringField(rec, "body"), subtitle: "" },
      });
      return "Notification shown.";
    },
  },
  {
    name: "memory",
    description:
      "Long-term memory (SQLite + FTS archive, RLM-style). Targets: memory | user. Actions: add | replace | remove | status | search | read. The prompt contains a bounded index. Search returns brief hits; read with id returns the full record. Scope is bound by the host, never model-selected. Archived originals require includeArchived=true.",
    inputHint:
      '{"action":"search","content":"display brightness"} or {"action":"add","target":"user","content":"Prefers concise Chinese"}',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "add | replace | remove | status | search | read",
        },
        target: { type: "string", description: "memory | user (optional filter for search)" },
        category: { type: "string", enum: ["user", "feedback", "project", "reference"], description: "Category for add" },
        content: {
          type: "string",
          description: "Entry text for add/replace, or search query for action=search",
        },
        old_text: {
          type: "string",
          description: "Unique substring or id for replace/remove",
        },
        includeArchived: { type: "boolean", description: "Search archived originals explicitly" },
        // aliases for older tools
        text: { type: "string" },
        query: { type: "string" },
        id: { type: "string" },
      },
      required: ["action"],
    },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (input, context) => {
      const rec = asRecord(input);
      let action = stringField(rec, "action").trim().toLowerCase() || "status";
      // Backward-compatible shims if the model emits memory_add style fields.
      if (!stringField(rec, "action") && stringField(rec, "text")) action = "add";
      if (!stringField(rec, "action") && stringField(rec, "id")) action = "remove";
      if (!stringField(rec, "action") && stringField(rec, "query")) action = "search";
      const target = stringField(rec, "target") || (action === "search" ? "" : "memory");
      const content =
        stringField(rec, "content")
        || stringField(rec, "text")
        || stringField(rec, "query");
      const oldText = stringField(rec, "old_text") || stringField(rec, "oldText") || stringField(rec, "id");
      const result = await mutateMemory({
        context,
        action,
        includeArchived: rec.includeArchived === true,
        target: target || null,
        content: content || null,
        oldText: oldText || null,
        category: stringField(rec, "category") || null,
      });
      if (action === "search") {
        const response = asRecord(result);
        if (Array.isArray(response.hits)) response.hits = response.hits.map((hit) => {
          const { content: _fullContent, ...brief } = asRecord(hit);
          return brief;
        });
        return truncate(JSON.stringify(response, null, 2));
      }
      return action === "read" ? JSON.stringify(result, null, 2) : truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "memory_dream",
    description:
      "Extract durable facts or use mode=compress to shorten existing core memories. Original records are preserved; any summary is stored as a derived record with source lineage.",
    inputHint: '{"transcript": "optional recent conversation summary"}',
    parameters: {
      type: "object",
      properties: {
        transcript: { type: "string", description: "Optional session text to distill" },
        mode: { type: "string", enum: ["manual", "compress"], description: "compress shortens existing core memories without deleting originals" },
      },
    },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (input, context) => {
      const rec = asRecord(input);
      const transcript = stringField(rec, "transcript") || undefined;
      const mode = stringField(rec, "mode") === "compress" ? "compress" : "manual";
      const result = await runMemoryDream(transcript, mode, context);
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "session_search",
    description:
      "Search past QxAI conversation folders (per-session JSON under ~/.qx/QxAiSession/sessions/). Use when recalling prior chats not in the memory archive.",
    inputHint: '{"query": "morning desk log", "limit": 8}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query").trim();
      if (!query) return "Error: session_search requires query.";
      const limit = numberField(rec, "limit", 12);
      const result = await invoke("qxai_session_search", { query, limit });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  // Legacy aliases kept so older prompts still work.
  {
    name: "memory_list",
    description: "Alias for memory action=status.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (_input, context) => {
      const result = await mutateMemory({
        context,
        action: "status",
        target: null,
        content: null,
        oldText: null,
      });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "memory_add",
    description: "Alias for memory action=add (defaults target=memory).",
    inputHint: '{"text": "User prefers dark mode", "target": "user"}',
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        content: { type: "string" },
        target: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        category: { type: "string", enum: ["user", "feedback", "project", "reference"] },
      },
      required: ["text"],
    },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (input, context) => {
      const rec = asRecord(input);
      const content = stringField(rec, "content") || stringField(rec, "text");
      const tags = Array.isArray(rec.tags)
        ? (rec.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      const target =
        stringField(rec, "target")
        || (tags.some((t) => /user|pref/i.test(t)) ? "user" : "memory");
      const result = await mutateMemory({
        context,
        action: "add",
        target,
        content,
        category: stringField(rec, "category") || tags.find((tag) => tag.startsWith("category:"))?.slice(9) || null,
        oldText: null,
      });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "memory_delete",
    description: "Alias for memory action=remove using old_text/id substring.",
    inputHint: '{"old_text": "dark mode"}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        old_text: { type: "string" },
        target: { type: "string" },
      },
    },
    isEnabled: (s) => s.memory_tool_enabled && s.memory_policy !== "off",
    run: async (input, context) => {
      const rec = asRecord(input);
      const oldText = stringField(rec, "old_text") || stringField(rec, "id");
      const result = await mutateMemory({
        context,
        action: "remove",
        target: stringField(rec, "target") || "memory",
        content: null,
        oldText,
      });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "qx_system_info",
    description:
      "Read Qx host system information: hostname, OS, chip/CPU, memory, and related machine facts.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_system_tools_enabled,
    run: async () => {
      const info = await invoke<Record<string, unknown>>("qx_system_information_check_system_info");
      return truncate(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "qx_system_stats",
    description: "Read live CPU and memory usage samples from the Qx system monitor.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_system_tools_enabled,
    run: async () => {
      const stats = await invoke<Record<string, unknown>>("get_system_stats");
      return truncate(JSON.stringify(stats, null, 2));
    },
  },
  {
    name: "qx_displays",
    description: "List connected displays with geometry and scale from the Qx display service.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_system_tools_enabled,
    run: async () => {
      const displays = await invoke<unknown[]>("display_list");
      return truncate(JSON.stringify(displays, null, 2));
    },
  },
  {
    name: "qx_desktop_windows",
    description:
      "List visible top-level desktop windows (title, bounds, monitor) via the Qx desktop_windows service.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_system_tools_enabled,
    run: async () => {
      const windows = await invoke<unknown[]>("desktop_windows_list", {
        query: {},
      });
      return truncate(JSON.stringify(windows, null, 2));
    },
  },
  {
    name: "qx_processes",
    description: "List running processes (name, pid, resource samples) from Qx system information.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_system_tools_enabled,
    run: async () => {
      const list = await invoke<Record<string, unknown>>("qx_system_information_list_processes");
      return truncate(JSON.stringify(list, null, 2));
    },
  },
  {
    name: "qx_screenshot",
    description:
      "Capture the full desktop via the Screencap module (headless, no picker UI). Primary display by default. Optionally copy into destDir (e.g. Downloads/QxLogs/screenshots).",
    inputHint: '{"destDir": "/Users/me/Downloads/QxLogs/screenshots"}',
    parameters: {
      type: "object",
      properties: {
        monitorId: { type: "number", description: "Optional display id from qx_displays" },
        destDir: {
          type: "string",
          description: "Optional directory to copy the PNG into (created if missing)",
        },
      },
    },
    requiresModules: ["screencap"],
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const monitorId =
        typeof rec.monitorId === "number"
          ? rec.monitorId
          : typeof rec.monitor_id === "number"
            ? rec.monitor_id
            : undefined;
      const destDir = stringField(rec, "destDir") || stringField(rec, "dest_dir") || undefined;
      const result = await invoke<Record<string, unknown>>("qxai_capture_desktop", {
        monitorId: monitorId ?? null,
        destDir: destDir?.trim() || null,
      });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "qx_clipboard_history",
    description:
      "Read recent Qx Clipboard history (text, OCR, image/file paths). Use for morning digests and recall.",
    inputHint: '{"limit": 40}',
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max items (1–200, default 40)" },
      },
    },
    requiresModules: ["clipboard"],
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const limit =
        typeof rec.limit === "number" && Number.isFinite(rec.limit) ? rec.limit : 40;
      const items = await invoke<unknown[]>("qxai_clipboard_history", { limit });
      if (!items.length) return "Clipboard history is empty.";
      return truncate(JSON.stringify(items, null, 2));
    },
  },
  {
    name: "qx_logs_directory",
    description:
      "Return the durable journal directory (usually ~/Downloads/QxLogs) used by morning desk logs.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async () => {
      const path = await invoke<string>("qxai_logs_directory");
      return path;
    },
  },
  {
    name: "list_schedules",
    description:
      "List QxAI timed schedules (daily local time). Kinds: morning_desk_log, agent_prompt.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async () => {
      const rows = await invoke<unknown[]>("qxai_list_schedules");
      return truncate(JSON.stringify(rows, null, 2));
    },
  },
  {
    name: "upsert_schedule",
    description:
      "Create or update a QxAI schedule. dailyTime is local HH:MM. kind: morning_desk_log | agent_prompt.",
    inputHint:
      '{"id":"morning-desk-log-10","name":"Morning desk log","enabled":true,"kind":"morning_desk_log","dailyTime":"10:00","skillId":"morning-desk-log"}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        enabled: { type: "boolean" },
        kind: { type: "string", description: "morning_desk_log | agent_prompt" },
        dailyTime: { type: "string", description: "HH:MM local" },
        skillId: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["id", "name", "dailyTime"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const id = stringField(rec, "id").trim();
      const name = stringField(rec, "name").trim() || id;
      const dailyTime =
        stringField(rec, "dailyTime") || stringField(rec, "daily_time") || "10:00";
      if (!id) return "Error: upsert_schedule requires id.";
      const kindRaw = (stringField(rec, "kind") || "morning_desk_log").toLowerCase();
      const kind =
        kindRaw.includes("agent") ? "agent_prompt" : "morning_desk_log";
      const schedule = {
        id,
        name,
        enabled: rec.enabled !== false,
        kind,
        dailyTime: dailyTime.trim(),
        skillId: stringField(rec, "skillId") || stringField(rec, "skill_id") || null,
        prompt: stringField(rec, "prompt") || null,
      };
      const saved = await invoke("qxai_upsert_schedule", { schedule });
      return truncate(`Saved schedule:\n${JSON.stringify(saved, null, 2)}`);
    },
  },
  {
    name: "delete_schedule",
    description: "Delete a QxAI schedule by id.",
    inputHint: '{"id": "morning-desk-log-10"}',
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const id = stringField(asRecord(input), "id").trim();
      if (!id) return "Error: delete_schedule requires id.";
      await invoke("qxai_delete_schedule", { id });
      return `Deleted schedule ${id}.`;
    },
  },
  {
    name: "run_schedule_now",
    description:
      "Run a schedule immediately. morning_desk_log captures desktop + writes Markdown under Downloads/QxLogs; agent_prompt queues a chat turn.",
    inputHint: '{"id": "morning-desk-log-10"}',
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const id = stringField(asRecord(input), "id").trim();
      if (!id) return "Error: run_schedule_now requires id.";
      const result = await invoke("qxai_run_schedule_now", { id });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "list_skills",
    description:
      "List installed QxAI skills (id, name, description, mode). Skills live under the Qx skills directory.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: () => true,
    run: async () => {
      const skills = await invoke<Array<Record<string, unknown>>>("qxai_list_skills");
      if (skills.length === 0) return "No skills installed.";
      return truncate(JSON.stringify(skills, null, 2));
    },
  },
  {
    name: "read_skill",
    description: "Read the full Markdown content of a QxAI skill by id.",
    inputHint: '{"id": "screenshot-expert"}',
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Skill id" } },
      required: ["id"],
    },
    isEnabled: () => true,
    run: async (input) => {
      const id = stringField(asRecord(input), "id").trim();
      if (!id) return "Error: read_skill requires 'id'.";
      const skill = await invoke<{ content: string; name: string; id: string }>("qxai_read_skill", {
        id,
      });
      return truncate(`# ${skill.name} (${skill.id})\n\n${skill.content}`);
    },
  },
  {
    name: "write_skill",
    description:
      "Create or overwrite a QxAI skill Markdown file. Optional mode: fixed | smart | disabled (written into frontmatter).",
    inputHint:
      '{"id": "my-skill", "content": "---\\nname: My Skill\\ndescription: ...\\nmode: smart\\n---\\n\\n# Steps\\n...", "mode": "smart"}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill file stem / folder id" },
        content: { type: "string", description: "Full SKILL.md Markdown" },
        mode: {
          type: "string",
          description: "optional fixed | smart | disabled",
        },
      },
      required: ["id", "content"],
    },
    isEnabled: () => true,
    run: async (input) => {
      const rec = asRecord(input);
      const id = stringField(rec, "id").trim();
      const content = stringField(rec, "content");
      if (!id || !content.trim()) return "Error: write_skill requires 'id' and 'content'.";
      const mode = stringField(rec, "mode").trim() || undefined;
      const skill = await invoke<{ id: string; path: string; mode: string }>("qxai_write_skill", {
        id,
        content,
        mode: mode || null,
      });
      return `Wrote skill ${skill.id} (${skill.mode}) → ${skill.path}`;
    },
  },
  {
    name: "read_mcp_config",
    description:
      "Read the user-managed MCP server list (~/.qx/mcp.json). Returns configured stdio servers.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: (s) => s.mcp_enabled,
    run: async () => {
      const config = await invoke<{ servers: unknown[] }>("qxai_read_mcp_config");
      return truncate(JSON.stringify(config, null, 2));
    },
  },
  {
    name: "write_mcp_config",
    description:
      "Replace the MCP config JSON. Pass either a full config object or a JSON string. Only edit when the user asks to add/change MCP servers.",
    inputHint:
      '{"servers":[{"id":"fs","name":"Filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"],"enabled":true}]}',
    parameters: {
      type: "object",
      properties: {
        servers: { type: "array", description: "MCP server entries" },
        content: { type: "string", description: "Raw JSON string alternative" },
      },
    },
    isEnabled: (s) => s.mcp_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      if (typeof rec.content === "string" && rec.content.trim()) {
        const config = await invoke("qxai_write_mcp_config_raw", { content: rec.content });
        return truncate(`Updated MCP config:\n${JSON.stringify(config, null, 2)}`);
      }
      const config = await invoke("qxai_write_mcp_config", {
        config: { servers: Array.isArray(rec.servers) ? rec.servers : [] },
      });
      return truncate(`Updated MCP config:\n${JSON.stringify(config, null, 2)}`);
    },
  },
  ...CAPABILITY_TOOLS,
  ...HOST_MANAGEMENT_TOOLS,
  ...MODULE_ACTION_TOOLS,
  ...ALL_MODULE_TOOLS,
];

/**
 * Tools visible to the model: agent switches AND required modules must be on.
 * Disabled / uninstalled modules never appear in schemas or system prompts.
 */
export function getEnabledTools(
  settings: AgentSettings,
  appSettings?: Settings,
): ToolSpec[] {
  if (!settings.agent_mode_enabled || !settings.tools_enabled) return [];
  ensureBuiltinModuleActionsRegistered();
  const snapshot = appSettings ?? useSettingsStore.getState().settings;
  return TOOLS.filter((tool) => {
    if (!tool.isEnabled(settings)) return false;
    if (tool.isAvailable && !tool.isAvailable(snapshot)) return false;
    const required = tool.requiresModules ?? [];
    if (required.length === 0) return true;
    return required.every((moduleId) => isBuiltinModuleEnabled(moduleId, snapshot));
  });
}

export function toolsToOpenAISchema(tools: ToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

import { invoke } from "@tauri-apps/api/core";
import { openUrl as openerOpenUrl } from "@tauri-apps/plugin-opener";
import type { InstalledPlugin, PluginRuntimeStatus } from "./types";
import {
  assertAgentToolFlag,
  cancelAiTask,
  getAiTask,
  listAiTasks,
  readAgentRuntimeSettings,
  submitAiTask,
  type AgentRuntimeSettings,
} from "./aiRuntime";

export interface PluginRuntimeOptions {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  onPluginStatus?: (status: PluginRuntimeStatus) => void;
}

const COMMAND_CAPABILITIES: Record<string, string> = {
  plugin_ai_list_providers: "ai",
  plugin_ai_default_model: "ai",
  plugin_ai_agent_settings: "ai",
  plugin_ai_chat: "ai",
  plugin_ai_stream_chat: "ai",
  plugin_ai_memory_list: "ai-memory",
  plugin_ai_memory_add: "ai-memory",
  plugin_ai_memory_delete: "ai-memory",
  plugin_ai_run_bash: "ai-bash",
  plugin_ai_grep_search: "ai-tools",
  qxai_list_providers: "ai",
  qxai_fetch_models: "ai",
  g4f_list_providers: "ai",
  g4f_chat: "ai",
  g4f_chat_custom: "ai",
  get_system_stats: "system-stats",
  qx_system_information_check_system_info: "system-info",
  qx_system_information_check_storage: "system-info",
  qx_system_information_check_network: "system-info",
  qx_system_information_list_processes: "processes",
  qx_system_monitor_network_counters: "system-info",
  qx_system_monitor_power: "system-info",
  qx_storage_overview: "storage-management",
  qx_permissions_status: "permissions",
  qx_permissions_open_settings: "permissions",
  search_apps: "apps",
  search_files: "files",
  get_clipboard_history: "clipboard",
  read_clipboard_image_now: "clipboard",
  read_image_file: "files",
  is_recording: "automation",
  list_gif_history: "automation",
  get_screencap_history: "automation",
  macro_list: "automation",
};

const DANGEROUS_INVOKE_COMMANDS = new Set([
  "plugin_perform_paste",
  "plugin_perform_paste_at_cursor",
  "qx_system_information_kill_process",
  "qx_permissions_request",
  "qx_storage_clear_cache",
  "qx_storage_clear_files",
  "clear_clipboard_history",
  "delete_clipboard_entry",
  "write_clipboard_image_entry",
  "record_clipboard_copy",
  "start_recording",
  "stop_recording",
  "save_gif",
  "delete_screencap",
  "macro_start_recording",
  "macro_stop_recording",
  "macro_save",
  "macro_delete",
  "macro_play",
  "settings::update_settings",
  "update_settings",
  "reset_settings",
  "import_settings",
  "export_settings",
  "history::clear_launch_history",
  "clear_launch_history",
  "clear_search_history",
  "delete_search_entry",
]);

function hasPermission(perms: Set<string>, permission: string): boolean {
  return perms.has("*") || perms.has(permission);
}

function hasInvokePermission(perms: Set<string>, cmd: string): boolean {
  return perms.has("*") || perms.has(cmd) || perms.has(`invoke:${cmd}`);
}

export function assertPermission(
  plugin: InstalledPlugin,
  perms: Set<string>,
  permission: string,
): void {
  if (!hasPermission(perms, permission)) {
    throw new Error(`Plugin ${plugin.id} lacks permission: ${permission}`);
  }
}

export function assertInvokeAllowed(
  plugin: InstalledPlugin,
  perms: Set<string>,
  cmd: string,
): void {
  if (hasInvokePermission(perms, cmd)) return;
  if (DANGEROUS_INVOKE_COMMANDS.has(cmd)) {
    throw new Error(`Plugin ${plugin.id} needs exact permission: invoke:${cmd}`);
  }
  const capability = COMMAND_CAPABILITIES[cmd];
  if (capability && hasPermission(perms, capability)) return;
  throw new Error(`Plugin ${plugin.id} lacks permission: invoke:${cmd}`);
}

function assertAi(plugin: InstalledPlugin, perms: Set<string>): void {
  assertPermission(plugin, perms, "ai");
}

function assertAiBackground(plugin: InstalledPlugin, perms: Set<string>): void {
  assertPermission(plugin, perms, "ai-background");
}

async function readMemoryPermission(
  plugin: InstalledPlugin,
  perms: Set<string>,
): Promise<AgentRuntimeSettings> {
  assertPermission(plugin, perms, "ai-memory");
  const settings = await readAgentRuntimeSettings();
  assertAgentToolFlag(settings, "memory_tool_enabled", "AI memory tool");
  return settings;
}

async function readBackgroundPermission(
  plugin: InstalledPlugin,
  perms: Set<string>,
): Promise<AgentRuntimeSettings> {
  assertAi(plugin, perms);
  assertAiBackground(plugin, perms);
  const settings = await readAgentRuntimeSettings();
  assertAgentToolFlag(settings, "background_tasks_enabled", "AI background tasks");
  return settings;
}

type RpcHandler = (
  plugin: InstalledPlugin,
  perms: Set<string>,
  payload: Record<string, unknown>,
  options: PluginRuntimeOptions,
) => Promise<unknown>;

export const rpcHandlers: Record<string, RpcHandler> = {
  invoke: async (plugin, perms, payload) => {
    const cmd = String(payload.cmd);
    assertInvokeAllowed(plugin, perms, cmd);
    return invoke(cmd, (payload.args as Record<string, unknown>) || {});
  },

  invokeRust: async (plugin, perms, payload) => {
    const cmd = String(payload.cmd);
    assertInvokeAllowed(plugin, perms, cmd);
    return invoke(cmd, (payload.args as Record<string, unknown>) || {});
  },

  showToast: async (_plugin, _perms, payload, options) => {
    options.onToast(String(payload.msg));
    return undefined;
  },

  prompt: async (_plugin, _perms, payload, options) => {
    return options.onPrompt(String(payload.label), payload.defaultValue as string);
  },

  openUrl: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "open-url");
    await openerOpenUrl(String(payload.url));
    return undefined;
  },

  clipboardRead: async (plugin, perms) => {
    assertPermission(plugin, perms, "clipboard");
    const result = await invoke<{ text: string }>("plugin_clipboard_read");
    return result.text;
  },

  clipboardWrite: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "clipboard");
    return invoke("plugin_clipboard_write", { text: String(payload.text ?? "") });
  },

  httpFetch: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "http");
    const options = (payload.options || {}) as Record<string, unknown>;
    return invoke("plugin_http_fetch", {
      req: {
        url: String(payload.url || ""),
        method: String(options.method || "GET"),
        headers: (options.headers || {}) as Record<string, string>,
        body: typeof options.body === "string" ? options.body : undefined,
        timeout_ms: typeof options.timeoutMs === "number" ? options.timeoutMs : undefined,
      },
    });
  },

  notificationShow: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "notifications");
    return invoke("plugin_notification_show", {
      req: {
        title: String(payload.title || ""),
        body: String(payload.body || ""),
        subtitle: String(payload.subtitle || ""),
      },
    });
  },

  aiListProviders: async (plugin, perms) => {
    assertAi(plugin, perms);
    return invoke("plugin_ai_list_providers");
  },

  aiDefaultModel: async (plugin, perms) => {
    assertAi(plugin, perms);
    return invoke("plugin_ai_default_model");
  },

  aiAgentSettings: async (plugin, perms) => {
    assertAi(plugin, perms);
    return invoke("plugin_ai_agent_settings");
  },

  aiChat: async (plugin, perms, payload) => {
    assertAi(plugin, perms);
    return invoke("plugin_ai_chat", { req: payload });
  },

  aiStreamChat: async (plugin, perms, payload) => {
    assertAi(plugin, perms);
    return invoke("plugin_ai_stream_chat", { req: payload });
  },

  aiRunBash: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "ai-bash");
    return invoke("plugin_ai_run_bash", { req: payload });
  },

  aiGrepSearch: async (plugin, perms, payload) => {
    assertPermission(plugin, perms, "ai-tools");
    return invoke("plugin_ai_grep_search", { req: payload });
  },

  aiMemoryList: async (plugin, perms) => {
    await readMemoryPermission(plugin, perms);
    return invoke("plugin_ai_memory_list");
  },

  aiMemoryAdd: async (plugin, perms, payload) => {
    await readMemoryPermission(plugin, perms);
    return invoke("plugin_ai_memory_add", {
      input: {
        text: String(payload.text || ""),
        tags: Array.isArray(payload.tags) ? payload.tags : [],
      },
    });
  },

  aiMemoryDelete: async (plugin, perms, payload) => {
    await readMemoryPermission(plugin, perms);
    return invoke("plugin_ai_memory_delete", { id: String(payload.id || "") });
  },

  aiTaskSubmit: async (plugin, perms, payload, options) => {
    const settings = await readBackgroundPermission(plugin, perms);
    return submitAiTask(plugin, perms, settings, payload, options);
  },

  aiTaskList: async (plugin, perms) => {
    await readBackgroundPermission(plugin, perms);
    return listAiTasks(plugin.id);
  },

  aiTaskGet: async (plugin, perms, payload) => {
    await readBackgroundPermission(plugin, perms);
    return getAiTask(plugin.id, String(payload.id || ""));
  },

  aiTaskCancel: async (plugin, perms, payload) => {
    await readBackgroundPermission(plugin, perms);
    return cancelAiTask(plugin.id, String(payload.id || ""));
  },

  getPreference: async (plugin, _perms, payload, options) => {
    return options.onGetPreference(plugin.id, String(payload.id));
  },

  storageGet: async (plugin, _perms, payload) => {
    return invoke("plugin_storage_get", { id: plugin.id, key: String(payload.key) });
  },

  storageSet: async (plugin, _perms, payload) => {
    return invoke("plugin_storage_set", {
      id: plugin.id,
      key: String(payload.key),
      value: payload.value,
    });
  },

  storageDelete: async (plugin, _perms, payload) => {
    return invoke("plugin_storage_delete", {
      id: plugin.id,
      key: String(payload.key),
    });
  },
};

export async function handlePluginRpc(
  plugin: InstalledPlugin,
  method: string,
  payload: Record<string, unknown>,
  options: PluginRuntimeOptions,
): Promise<unknown> {
  const perms = new Set(plugin.manifest?.permissions || []);
  const handler = rpcHandlers[method];
  if (!handler) {
    throw new Error(`Unknown RPC method: ${method}`);
  }
  return handler(plugin, perms, payload, options);
}

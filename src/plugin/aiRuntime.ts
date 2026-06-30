import { invoke } from "@tauri-apps/api/core";
import type { InstalledPlugin, PluginRuntimeStatus } from "./types";

export type AiTaskState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AiTaskRecord {
  id: string;
  pluginId: string;
  title: string;
  state: AiTaskState;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  cancelled?: boolean;
}

export interface AgentRuntimeSettings {
  agent_mode_enabled: boolean;
  tools_enabled: boolean;
  memory_tool_enabled: boolean;
  notifications_enabled: boolean;
  background_tasks_enabled: boolean;
}

export interface PluginRuntimeOptions {
  onPluginStatus?: (status: PluginRuntimeStatus) => void;
}

let requestCounter = 0;

const aiTasks = new Map<string, AiTaskRecord>();

export function publicAiTask(task: AiTaskRecord): Omit<AiTaskRecord, "pluginId" | "cancelled"> {
  const { pluginId: _pluginId, cancelled: _cancelled, ...publicTask } = task;
  return publicTask;
}

export async function readAgentRuntimeSettings(): Promise<AgentRuntimeSettings> {
  return invoke<AgentRuntimeSettings>("plugin_ai_agent_settings");
}

export function assertAgentToolsEnabled(settings: AgentRuntimeSettings): void {
  if (!settings.agent_mode_enabled) {
    throw new Error("AI Agent mode is disabled in Settings > Agent");
  }
  if (!settings.tools_enabled) {
    throw new Error("AI tools are disabled in Settings > Agent");
  }
}

export function assertAgentToolFlag(
  settings: AgentRuntimeSettings,
  key: keyof Pick<AgentRuntimeSettings, "memory_tool_enabled" | "background_tasks_enabled">,
  label: string,
): void {
  assertAgentToolsEnabled(settings);
  if (!settings[key]) {
    throw new Error(`${label} is disabled in Settings > Agent`);
  }
}

export async function notifyAiTask(
  plugin: InstalledPlugin,
  perms: Set<string>,
  settings: AgentRuntimeSettings,
  title: string,
  body: string,
): Promise<void> {
  if (!perms.has("notifications") && !perms.has("*")) return;
  if (!settings.notifications_enabled) return;
  await invoke("plugin_notification_show", {
    req: {
      title,
      body,
      subtitle: plugin.name,
    },
  }).catch(() => {});
}

export function submitAiTask(
  plugin: InstalledPlugin,
  perms: Set<string>,
  settings: AgentRuntimeSettings,
  payload: Record<string, unknown>,
  options: PluginRuntimeOptions,
): Omit<AiTaskRecord, "pluginId" | "cancelled"> {
  const now = Date.now();
  const id = `ai-task-${now}-${(requestCounter += 1)}`;
  const title = String(payload.title || "AI task").slice(0, 80);
  const notify = payload.notify !== false;
  const task: AiTaskRecord = {
    id,
    pluginId: plugin.id,
    title,
    state: "queued",
    createdAt: now,
    updatedAt: now,
  };
  aiTasks.set(id, task);

  void (async () => {
    task.state = "running";
    task.updatedAt = Date.now();
    options.onPluginStatus?.({
      kind: "activity",
      pluginId: plugin.id,
      label: "AI task",
      detail: title,
    });
    try {
      const result = await invoke<string>("plugin_ai_chat", { req: payload });
      if (task.cancelled) {
        task.state = "cancelled";
        task.updatedAt = Date.now();
        return;
      }
      task.result = result;
      task.state = "succeeded";
      task.updatedAt = Date.now();
      options.onPluginStatus?.({
        kind: "success",
        pluginId: plugin.id,
        label: "AI task done",
        detail: title,
      });
      if (notify) {
        await notifyAiTask(plugin, perms, settings, title, "AI task completed");
      }
    } catch (error) {
      if (task.cancelled) {
        task.state = "cancelled";
        task.updatedAt = Date.now();
        return;
      }
      task.error = error instanceof Error ? error.message : String(error);
      task.state = "failed";
      task.updatedAt = Date.now();
      options.onPluginStatus?.({
        kind: "error",
        pluginId: plugin.id,
        label: "AI task failed",
        detail: task.error.slice(0, 120),
      });
      if (notify) {
        await notifyAiTask(plugin, perms, settings, title, task.error.slice(0, 160));
      }
    }
  })();

  return publicAiTask(task);
}

export function listAiTasks(pluginId: string): Omit<AiTaskRecord, "pluginId" | "cancelled">[] {
  return Array.from(aiTasks.values())
    .filter((task) => task.pluginId === pluginId)
    .map(publicAiTask);
}

export function getAiTask(
  pluginId: string,
  id: string,
): Omit<AiTaskRecord, "pluginId" | "cancelled"> | null {
  const task = aiTasks.get(id);
  return task && task.pluginId === pluginId ? publicAiTask(task) : null;
}

export function cancelAiTask(
  pluginId: string,
  id: string,
): Omit<AiTaskRecord, "pluginId" | "cancelled"> {
  const task = aiTasks.get(id);
  if (!task || task.pluginId !== pluginId) {
    throw new Error(`AI task not found: ${id}`);
  }
  if (task.state === "queued" || task.state === "running") {
    task.cancelled = true;
    task.state = "cancelled";
    task.updatedAt = Date.now();
  }
  return publicAiTask(task);
}

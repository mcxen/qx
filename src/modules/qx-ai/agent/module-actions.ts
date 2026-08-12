/**
 * Module Action port — discoverable, permissioned actions for QxAI agents and plugins.
 *
 * Built-in modules and marketplace plugins register stable action ids
 * (e.g. `rss.refresh_all`). The agent exposes `list_module_actions` /
 * `run_module_action`; plugins use `context.ai.actions.*` (list / run / register).
 *
 * Design notes:
 * - Actions are intentional operations (refresh, mark read, open workbench), not
 *   low-level data tools. Fine-grained tools remain in tools-modules.ts.
 * - Action ids are namespaced: `rss.refresh_all`, `plugin:<pluginId>:<localId>`.
 * - Visibility follows module enablement + optional isAvailable gates.
 */

import { invoke } from "@tauri-apps/api/core";
import { isBuiltinModuleEnabled } from "../../moduleAvailability";
import type { Settings } from "../../settings/store";
import { useSettingsStore } from "../../settings/store";
import { asRecord, numberField, stringField, truncate } from "./types";

export type ModuleActionRisk = "read" | "write" | "network" | "destructive";

/** Public descriptor returned to models and plugins (no run handler). */
export interface ModuleActionPublic {
  id: string;
  title: string;
  description: string;
  /** Builtin module id, or plugin id for marketplace actions. */
  moduleId: string;
  pluginId?: string;
  risk: ModuleActionRisk;
  /** JSON-schema-like object for model tool args. */
  parameters?: Record<string, unknown>;
  inputHint?: string;
}

export interface ModuleActionSpec extends ModuleActionPublic {
  /** Builtin module ids that must be enabled for this action to appear. */
  requiresModules?: string[];
  isAvailable?: (settings: Settings) => boolean;
  /**
   * Owner key for bulk unregister (`builtin:rss`, `plugin:brew`).
   * Defaults to `moduleId` / `plugin:<pluginId>`.
   */
  owner?: string;
  run: (input: Record<string, unknown>) => Promise<string>;
}

/** Plugin registration payload (run is provided by host from command/invoke). */
export interface PluginModuleActionRegistration {
  /** Local id; becomes `plugin:<pluginId>:<id>`. */
  id: string;
  title: string;
  description: string;
  risk?: ModuleActionRisk;
  parameters?: Record<string, unknown>;
  inputHint?: string;
  /** Optional host invoke command (plugin must hold invoke permission). */
  invokeCommand?: string;
  /** Optional plugin command name dispatched through the registry. */
  command?: string;
}

const registry = new Map<string, ModuleActionSpec>();
let builtinsSeeded = false;

function ownerKey(spec: Pick<ModuleActionSpec, "owner" | "moduleId" | "pluginId">): string {
  if (spec.owner) return spec.owner;
  if (spec.pluginId) return `plugin:${spec.pluginId}`;
  return `builtin:${spec.moduleId}`;
}

export function toPublicAction(spec: ModuleActionSpec): ModuleActionPublic {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    moduleId: spec.moduleId,
    pluginId: spec.pluginId,
    risk: spec.risk,
    parameters: spec.parameters,
    inputHint: spec.inputHint,
  };
}

export function isModuleActionVisible(spec: ModuleActionSpec, settings: Settings): boolean {
  if (spec.isAvailable && !spec.isAvailable(settings)) return false;
  const required = spec.requiresModules ?? (spec.pluginId ? [] : [spec.moduleId]);
  if (required.length === 0) return true;
  return required.every((moduleId) => isBuiltinModuleEnabled(moduleId, settings));
}

/**
 * Register one or more actions. Same id replaces the previous entry.
 * Returns an unregister function for the registered ids.
 */
export function registerModuleActions(actions: ModuleActionSpec[]): () => void {
  const ids: string[] = [];
  for (const action of actions) {
    const id = action.id.trim();
    if (!id) continue;
    registry.set(id, { ...action, id, owner: ownerKey(action) });
    ids.push(id);
  }
  return () => {
    for (const id of ids) {
      const current = registry.get(id);
      if (current && ids.includes(id)) registry.delete(id);
    }
  };
}

/** Remove every action owned by `owner` (e.g. `plugin:brew`). */
export function unregisterModuleActionsByOwner(owner: string): void {
  for (const [id, spec] of [...registry.entries()]) {
    if (ownerKey(spec) === owner) registry.delete(id);
  }
}

export function getModuleAction(id: string): ModuleActionSpec | undefined {
  return registry.get(id.trim());
}

export function listModuleActions(
  filter: { moduleId?: string; query?: string; includeUnavailable?: boolean } = {},
  settings: Settings = useSettingsStore.getState().settings,
): ModuleActionPublic[] {
  ensureBuiltinModuleActionsRegistered();
  const q = (filter.query ?? "").trim().toLowerCase();
  const moduleFilter = (filter.moduleId ?? "").trim();
  const out: ModuleActionPublic[] = [];
  for (const spec of registry.values()) {
    if (moduleFilter && spec.moduleId !== moduleFilter && spec.pluginId !== moduleFilter) {
      continue;
    }
    if (!filter.includeUnavailable && !isModuleActionVisible(spec, settings)) continue;
    if (q) {
      const hay = `${spec.id} ${spec.title} ${spec.description} ${spec.moduleId}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(toPublicAction(spec));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function runModuleAction(
  id: string,
  input: unknown = {},
  settings: Settings = useSettingsStore.getState().settings,
): Promise<string> {
  ensureBuiltinModuleActionsRegistered();
  const actionId = id.trim();
  if (!actionId) return "Error: action id is required.";
  const spec = registry.get(actionId);
  if (!spec) {
    return `Error: unknown module action "${actionId}". Call list_module_actions to discover ids.`;
  }
  if (!isModuleActionVisible(spec, settings)) {
    return `Error: action "${actionId}" is unavailable (module disabled or capability off).`;
  }
  try {
    const result = await spec.run(asRecord(input));
    return truncate(result, 12_000);
  } catch (error) {
    return `Error running ${actionId}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Register marketplace-plugin actions under `plugin:<pluginId>:<localId>`.
 * Host builds the run handler from invokeCommand and/or plugin command name.
 */
export function registerPluginModuleActions(
  pluginId: string,
  actions: PluginModuleActionRegistration[],
  options: {
    runCommand?: (commandName: string, input: Record<string, unknown>) => Promise<string>;
    invokeAllowed?: (cmd: string) => boolean;
  } = {},
): void {
  const owner = `plugin:${pluginId}`;
  unregisterModuleActionsByOwner(owner);
  const specs: ModuleActionSpec[] = [];
  for (const raw of actions) {
    const localId = String(raw.id || "").trim();
    if (!localId) continue;
    const invokeCommand = raw.invokeCommand?.trim() || "";
    const command = raw.command?.trim() || "";
    if (!invokeCommand && !command && !options.runCommand) {
      continue;
    }
    const id = `plugin:${pluginId}:${localId}`;
    specs.push({
      id,
      title: String(raw.title || localId).slice(0, 80),
      description: String(raw.description || "").slice(0, 400),
      moduleId: pluginId,
      pluginId,
      risk: raw.risk || "write",
      parameters: raw.parameters,
      inputHint: raw.inputHint,
      owner,
      requiresModules: [],
      run: async (input) => {
        if (invokeCommand) {
          if (options.invokeAllowed && !options.invokeAllowed(invokeCommand)) {
            throw new Error(`Plugin lacks permission for invoke:${invokeCommand}`);
          }
          const result = await invoke(invokeCommand, input);
          return truncate(JSON.stringify(result ?? { ok: true }, null, 2));
        }
        if (command && options.runCommand) {
          return options.runCommand(command, input);
        }
        if (options.runCommand) {
          return options.runCommand(localId, input);
        }
        throw new Error(`Action ${id} has no executable backend.`);
      },
    });
  }
  registerModuleActions(specs);
}

/** Idempotent seed of first-party module actions. */
export function ensureBuiltinModuleActionsRegistered(): void {
  if (builtinsSeeded) return;
  builtinsSeeded = true;

  registerModuleActions([
    {
      id: "rss.refresh_all",
      title: "Refresh all RSS feeds",
      description:
        "Network-refresh every subscribed RSS/Atom feed. Use when the user asks to refresh subscriptions or pull latest articles.",
      moduleId: "rss",
      risk: "network",
      requiresModules: ["rss"],
      parameters: { type: "object", properties: {} },
      inputHint: "{}",
      run: async () => {
        const count = await invoke<number>("rss_refresh_all");
        return `Refreshed all RSS feeds (updated ${count} article rows).`;
      },
    },
    {
      id: "rss.refresh_feed",
      title: "Refresh one RSS feed",
      description: "Network-refresh a single feed by numeric id (from rss_list_feeds / list_module_actions context).",
      moduleId: "rss",
      risk: "network",
      requiresModules: ["rss"],
      parameters: {
        type: "object",
        properties: { id: { type: "number", description: "Feed id" } },
        required: ["id"],
      },
      inputHint: '{"id": 1}',
      run: async (input) => {
        const id = numberField(input, "id", 0);
        if (!id) return "Error: id (feed id) is required.";
        const result = await invoke("rss_refresh_feed", { id });
        return truncate(JSON.stringify(result, null, 2));
      },
    },
    {
      id: "rss.mark_read",
      title: "Mark RSS article read/unread",
      description: "Mark one article read or unread by article id.",
      moduleId: "rss",
      risk: "write",
      requiresModules: ["rss"],
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          isRead: { type: "boolean" },
        },
        required: ["id"],
      },
      inputHint: '{"id": 42, "isRead": true}',
      run: async (input) => {
        const id = numberField(input, "id", 0);
        if (!id) return "Error: id is required.";
        const isRead = input.isRead !== false && input.is_read !== false;
        await invoke("rss_mark_read", { id, isRead });
        return `Article ${id} marked ${isRead ? "read" : "unread"}.`;
      },
    },
    {
      id: "pzai.open_article",
      title: "Open article in P仔 workbench",
      description: "Load an RSS article into P仔 workbench by article id.",
      moduleId: "p-zai",
      risk: "write",
      requiresModules: ["p-zai", "rss"],
      parameters: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
      inputHint: '{"id": 42}',
      run: async (input) => {
        const id = numberField(input, "id", 0);
        if (!id) return "Error: id is required.";
        const { usePzaiStore } = await import("../../p-zai/store");
        await usePzaiStore.getState().openArticle(id);
        return truncate(JSON.stringify(usePzaiStore.getState().getWorkbenchSnapshot(), null, 2), 8000);
      },
    },
    {
      id: "pzai.set_summary",
      title: "Set P仔 summary",
      description: "Write the article summary on the P仔 workbench.",
      moduleId: "p-zai",
      risk: "write",
      requiresModules: ["p-zai"],
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          displayMode: { type: "string" },
        },
        required: ["summary"],
      },
      inputHint: '{"summary": "…"}',
      run: async (input) => {
        const summary = stringField(input, "summary");
        const { usePzaiStore } = await import("../../p-zai/store");
        const store = usePzaiStore.getState();
        store.setSummary(summary);
        const mode = stringField(input, "displayMode") || stringField(input, "display_mode");
        if (mode) store.setDisplayMode(mode as "original" | "summary" | "draft" | "split");
        return "P仔 summary updated.";
      },
    },
    {
      id: "pzai.set_draft",
      title: "Set P仔 draft",
      description: "Replace the editable draft body on the P仔 workbench.",
      moduleId: "p-zai",
      risk: "write",
      requiresModules: ["p-zai"],
      parameters: {
        type: "object",
        properties: {
          draft: { type: "string" },
          displayMode: { type: "string" },
        },
        required: ["draft"],
      },
      inputHint: '{"draft": "…"}',
      run: async (input) => {
        const draft = stringField(input, "draft");
        const { usePzaiStore } = await import("../../p-zai/store");
        const store = usePzaiStore.getState();
        store.setDraft(draft);
        const mode = stringField(input, "displayMode") || stringField(input, "display_mode") || "draft";
        store.setDisplayMode(mode as "original" | "summary" | "draft" | "split");
        return "P仔 draft updated.";
      },
    },
    {
      id: "pzai.save_docs",
      title: "Save P仔 workbench to Text Toolbox",
      description: "Persist current summary/draft/notes as Markdown in the documents workspace.",
      moduleId: "p-zai",
      risk: "write",
      requiresModules: ["p-zai", "documents"],
      parameters: { type: "object", properties: {} },
      inputHint: "{}",
      run: async () => {
        const { usePzaiStore } = await import("../../p-zai/store");
        const name = await usePzaiStore.getState().saveDraftToDocs();
        return `Saved P仔 workbench to Text Toolbox as ${name}.`;
      },
    },
    {
      id: "docs.write",
      title: "Write Text Toolbox file",
      description: "Create or overwrite a file in the Text Toolbox workspace.",
      moduleId: "documents",
      risk: "write",
      requiresModules: ["documents"],
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          content: { type: "string" },
        },
        required: ["name", "content"],
      },
      inputHint: '{"name": "notes.md", "content": "# Hello"}',
      run: async (input) => {
        const name = stringField(input, "name").trim();
        const content = stringField(input, "content");
        if (!name) return "Error: name is required.";
        const entry = await invoke("docs_write_file", { name, content });
        return truncate(JSON.stringify(entry, null, 2));
      },
    },
    {
      id: "weather.refresh",
      title: "Refresh weather",
      description: "Fetch current weather for the configured default location.",
      moduleId: "weather",
      risk: "network",
      requiresModules: ["weather"],
      parameters: { type: "object", properties: {} },
      inputHint: "{}",
      run: async () => {
        const data = await invoke("fetch_weather");
        return truncate(JSON.stringify(data, null, 2));
      },
    },
    {
      id: "screencap.recapture",
      title: "Recapture last screenshot region",
      description: "Re-capture the last screenshot region without showing the picker UI.",
      moduleId: "screencap",
      risk: "write",
      requiresModules: ["screencap"],
      parameters: { type: "object", properties: {} },
      inputHint: "{}",
      run: async () => {
        const result = await invoke("screencap_recapture_last_region");
        return truncate(JSON.stringify(result ?? { ok: true }, null, 2));
      },
    },
  ]);
}

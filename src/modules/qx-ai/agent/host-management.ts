/**
 * Narrow Qx-host management ports used by the AI agent.
 *
 * Keep policy ownership in the host domain that already owns the behavior:
 * settings delegate to their registered adapter and plugin lifecycle delegates
 * to the plugin registry. The agent never edits localStorage or plugin files.
 */
import { isBackgroundCategoryEnabled } from "../../../plugin/backgroundActivity";
import { usePluginRegistry } from "../../../plugin/registry";
import { useSettingsStore, type Settings } from "../../settings/store";
import { invoke } from "@tauri-apps/api/core";

export type QxManageableSettingValue = boolean | number | string;

export interface QxManageableSetting {
  id: string;
  title: string;
  description: string;
  type: "boolean" | "number" | "string";
  value: QxManageableSettingValue;
  risk: "write";
}

export interface QxSettingAdapter {
  id: string;
  title: string;
  description: string;
  type: QxManageableSetting["type"];
  read: () => QxManageableSettingValue;
  write: (value: QxManageableSettingValue) => Promise<void> | void;
}

const WALLPAPER_BACKGROUND_SETTING_ID = "plugins.background.wallpaper.enabled";

const settingAdapters = new Map<string, QxSettingAdapter>();

export function registerQxSettingAdapter(adapter: QxSettingAdapter): () => void {
  const id = adapter.id.trim();
  if (!id) throw new Error("Qx setting adapter id is required.");
  settingAdapters.set(id, { ...adapter, id });
  return () => {
    if (settingAdapters.get(id)?.write === adapter.write) settingAdapters.delete(id);
  };
}

async function updateSettingsSection<K extends keyof Settings>(
  section: K,
  patch: Partial<Settings[K]>,
): Promise<void> {
  const store = useSettingsStore.getState();
  await store.flush();
  const next = {
    ...store.settings,
    [section]: { ...store.settings[section], ...patch },
  };
  const persisted = await invoke<Settings>("update_settings", { settings: next });
  useSettingsStore.getState().setSettings(persisted);
}

function ensureBuiltinSettingAdapters(): void {
  const builtins: QxSettingAdapter[] = [{
    id: WALLPAPER_BACKGROUND_SETTING_ID,
    title: "Scheduled wallpaper changes",
    description:
      "Allow installed wallpaper plugins to run scheduled background changes. Manual wallpaper commands remain available when disabled.",
    type: "boolean",
    read: () => isBackgroundCategoryEnabled("wallpaper"),
    write: (value) => {
      usePluginRegistry
        .getState()
        .setBackgroundCategoryEnabled("wallpaper", value === true);
    },
  }, {
    id: "general.auto_update.enabled",
    title: "Automatic updates",
    description: "Check Qx and installed plugins for updates after startup.",
    type: "boolean",
    read: () => useSettingsStore.getState().settings.general.auto_update,
    write: (value) => updateSettingsSection("general", { auto_update: value === true }),
  }, {
    id: "appearance.floating_island.enabled",
    title: "Floating Island",
    description: "Allow the shared Bottom Island to detach into its floating desktop surface.",
    type: "boolean",
    read: () => useSettingsStore.getState().settings.appearance.island_float_enabled,
    write: (value) => updateSettingsSection("appearance", { island_float_enabled: value === true }),
  }, {
    id: "rss.background_refresh.enabled",
    title: "RSS background refresh",
    description: "Refresh RSS subscriptions on the configured background interval.",
    type: "boolean",
    read: () => useSettingsStore.getState().settings.rss.background_refresh_enabled,
    write: (value) => updateSettingsSection("rss", { background_refresh_enabled: value === true }),
  }, {
    id: "agent.background_tasks.enabled",
    title: "QxAI background tasks",
    description: "Allow QxAI schedules and other background agent tasks to run.",
    type: "boolean",
    read: () => useSettingsStore.getState().settings.agent.background_tasks_enabled,
    write: (value) => updateSettingsSection("agent", { background_tasks_enabled: value === true }),
  }, {
    id: "agent.host_actions.enabled",
    title: "QxAI host actions",
    description: "Allow QxAI to invoke registered Qx host-management tools.",
    type: "boolean",
    read: () => useSettingsStore.getState().settings.agent.qx_host_actions_enabled,
    write: (value) => updateSettingsSection("agent", { qx_host_actions_enabled: value === true }),
  }];
  for (const adapter of builtins) {
    if (!settingAdapters.has(adapter.id)) registerQxSettingAdapter(adapter);
  }
}

function settingAdapter(id: string): QxSettingAdapter | undefined {
  ensureBuiltinSettingAdapters();
  return settingAdapters.get(id.trim());
}

export function listQxManageableSettings(query = ""): QxManageableSetting[] {
  ensureBuiltinSettingAdapters();
  const normalized = query.trim().toLocaleLowerCase();
  return [...settingAdapters.values()]
    .filter((item) => {
      if (!normalized) return true;
      return `${item.id} ${item.title} ${item.description}`
        .toLocaleLowerCase()
        .includes(normalized);
    })
    .map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      type: item.type,
      value: item.read(),
      risk: "write",
    }));
}

export async function updateQxManageableSetting(
  id: string,
  value: QxManageableSettingValue,
): Promise<QxManageableSetting> {
  const adapter = settingAdapter(id);
  if (!adapter) {
    throw new Error(
      `Unknown Qx setting "${id}". Call list_qx_settings to discover writable setting ids.`,
    );
  }
  if (typeof value !== adapter.type) {
    throw new Error(`Setting "${adapter.id}" requires a ${adapter.type} value.`);
  }
  await adapter.write(value);
  return {
    id: adapter.id,
    title: adapter.title,
    description: adapter.description,
    type: adapter.type,
    value: adapter.read(),
    risk: "write",
  };
}

function installedMarketplacePlugin(pluginId: string) {
  const id = pluginId.trim();
  if (!id) throw new Error("pluginId is required.");
  if (id.startsWith("builtin:")) {
    throw new Error(
      `Built-in module "${id}" is not a marketplace plugin. Manage it from Settings → Extensions.`,
    );
  }
  const plugin = usePluginRegistry.getState().plugins.find((item) => item.id === id);
  if (!plugin) {
    throw new Error(`Installed plugin "${id}" was not found. Call list_plugins first.`);
  }
  return plugin;
}

export async function setInstalledPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<string> {
  const plugin = installedMarketplacePlugin(pluginId);
  await usePluginRegistry.getState().setEnabled(plugin.id, enabled);
  return `${plugin.name} (${plugin.id}) is now ${enabled ? "enabled" : "disabled"}.`;
}

export async function uninstallInstalledPlugin(pluginId: string): Promise<string> {
  const plugin = installedMarketplacePlugin(pluginId);
  await usePluginRegistry.getState().uninstall(plugin.id);
  return `Uninstalled ${plugin.name} (${plugin.id}) and removed its durable plugin data.`;
}

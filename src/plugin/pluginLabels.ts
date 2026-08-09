/**
 * Host-side display labels for plugins and built-in modules.
 *
 * Settings → Extensions, marketplace browse, and related chrome must use this
 * port. Published marketplace packages provide their own locale maps; an older
 * package without a map is shown as-is instead of adding a host-side translation.
 *
 * Resolution order for a name:
 * 1. Optional manifest `names` map (plugin-authored locales)
 * 2. Built-in: `launcher.<id>` then `module.<id>` (host i18n)
 * 3. Manifest / install `name` (raw package value when a locale is absent)
 */

import type { Locale } from "../i18n";
import type { PluginCommand, PluginManifest, PluginPanel, PluginPreference } from "./types";

export type TranslateFn = (key: string, fallback: string) => string;

export type PluginLabelSource = {
  id: string;
  name: string;
  description?: string;
  manifest?: Pick<PluginManifest, "names" | "descriptions" | "preferences" | "commands" | "panel"> | null;
};

export function builtinModuleIdFromPluginId(pluginId: string): string | null {
  return pluginId.startsWith("builtin:") ? pluginId.slice("builtin:".length) : null;
}

function pickFromLocaleMap(
  map: Record<string, string> | undefined | null,
  locale: Locale,
): string | null {
  if (!map) return null;
  const candidates = locale === "zh-CN"
    ? ["zh-CN", "zh", "zh_CN", "zh-Hans", "zh_Hans", "cn"]
    : ["en", "en-US", "en_US"];
  for (const key of candidates) {
    const value = map[key]?.trim();
    if (value) return value;
  }
  return null;
}

function builtinPreferenceKey(pluginId: string, preferenceId: string): string {
  const moduleId = builtinModuleIdFromPluginId(pluginId);
  const namespace = moduleId === "macros" ? "macros" : "screencap";
  return `plugins.${namespace}.preference.${preferenceId}`;
}

/** User-facing plugin / module title for host chrome (Settings list, detail, …). */
export function localizePluginName(
  plugin: PluginLabelSource,
  t: TranslateFn,
  locale: Locale = "en",
): string {
  const fromManifest = pickFromLocaleMap(plugin.manifest?.names, locale);
  if (fromManifest) return fromManifest;

  const moduleId = builtinModuleIdFromPluginId(plugin.id);
  if (moduleId) {
    // Prefer launcher product titles (e.g. 剪贴板历史), then short module labels.
    return t(`launcher.${moduleId}`, t(`module.${moduleId}`, plugin.name));
  }
  return plugin.name;
}

/** User-facing description for Settings cards and marketplace detail. */
export function localizePluginDescription(
  plugin: PluginLabelSource,
  t: TranslateFn,
  locale: Locale = "en",
): string {
  const fallback = (plugin.description || "").trim();
  const fromManifest = pickFromLocaleMap(plugin.manifest?.descriptions, locale);
  if (fromManifest) return fromManifest;

  const moduleId = builtinModuleIdFromPluginId(plugin.id);
  if (moduleId) {
    return t(`launcher.${moduleId}.desc`, fallback);
  }
  return fallback;
}

/** Marketplace index rows share the same external id namespace as installed plugins. */
export function localizeMarketplaceEntryName(
  entry: { id: string; name: string; names?: Record<string, string> },
  _t: TranslateFn,
  locale: Locale = "en",
): string {
  const fromIndex = pickFromLocaleMap(entry.names, locale);
  return fromIndex ?? entry.name;
}

export function localizeMarketplaceEntryDescription(
  entry: { id: string; description?: string; descriptions?: Record<string, string> },
  _t: TranslateFn,
  locale: Locale = "en",
): string {
  const fromIndex = pickFromLocaleMap(entry.descriptions, locale);
  return fromIndex ?? (entry.description || "").trim();
}

/** Resolve a manifest preference without exposing its raw English metadata. */
export function localizePluginPreference(
  plugin: PluginLabelSource,
  preference: PluginPreference,
  t: TranslateFn,
  locale: Locale = "en",
): PluginPreference {
  const key = builtinPreferenceKey(plugin.id, preference.id);
  const localizeBuiltin = (translationKey: string, fallback: string): string => (
    plugin.id === "builtin:screencap" || plugin.id === "builtin:macros"
      ? t(translationKey, fallback)
      : fallback
  );
  const localizedDescription = pickFromLocaleMap(preference.descriptions, locale);
  const localizedPlaceholder = pickFromLocaleMap(preference.placeholders, locale);
  return {
    ...preference,
    label: pickFromLocaleMap(preference.labels, locale)
      ?? localizeBuiltin(`${key}.label`, preference.label),
    description: localizedDescription
      ?? (preference.description
        ? localizeBuiltin(`${key}.desc`, preference.description)
        : preference.description),
    placeholder: localizedPlaceholder
      ?? (preference.placeholder
        ? localizeBuiltin(`${key}.placeholder`, preference.placeholder)
        : preference.placeholder),
    options: preference.options?.map((option) => ({
      ...option,
      label: pickFromLocaleMap(option.labels, locale)
        ?? localizeBuiltin(`${key}.option.${option.value}`, option.label),
    })),
  };
}

/** Resolve a manifest command title for launcher, shortcuts and Settings. */
export function localizePluginCommandTitle(
  _plugin: PluginLabelSource,
  command: Pick<PluginCommand, "name" | "title" | "titles">,
  _t: TranslateFn,
  locale: Locale = "en",
): string {
  return pickFromLocaleMap(command.titles, locale)
    ?? (command.title || command.name);
}

export function localizePluginCommandDescription(
  _plugin: PluginLabelSource,
  command: Pick<PluginCommand, "name" | "description" | "descriptions">,
  _t: TranslateFn,
  locale: Locale = "en",
): string {
  const fallback = command.description?.trim() ?? "";
  return pickFromLocaleMap(command.descriptions, locale)
    ?? fallback;
}

/** Resolve a panel title while respecting the manifest name as the canonical product title. */
export function localizePluginPanelTitle(
  plugin: PluginLabelSource,
  panel: Pick<PluginPanel, "title"> | null | undefined,
  t: TranslateFn,
  locale: Locale = "en",
): string {
  const manifestPanel = plugin.manifest?.panel;
  const fromManifest = pickFromLocaleMap(manifestPanel?.titles, locale);
  if (fromManifest) return fromManifest;

  const title = (panel?.title || manifestPanel?.title || "").trim();
  if (!title || title === plugin.name || title === manifestPanel?.title) {
    return localizePluginName(plugin, t, locale);
  }
  return title;
}

export function localizePluginCommandMode(mode: string, t: TranslateFn): string {
  if (mode === "view") return t("plugins.commandMode.view", "Panel");
  if (mode === "no-view") return t("plugins.commandMode.noView", "Background");
  return mode;
}

const PERMISSION_LABELS: Record<string, [key: string, fallback: string]> = {
  http: ["plugins.permission.http", "HTTP requests"],
  "open-url": ["plugins.permission.openUrl", "Open external links"],
  clipboard: ["plugins.permission.clipboard", "Clipboard"],
  storage: ["plugins.permission.storage", "Plugin storage"],
  notifications: ["plugins.permission.notifications", "Notifications"],
  tray: ["plugins.permission.tray", "System tray"],
  island: ["plugins.permission.island", "Qx Island"],
  "system-info": ["plugins.permission.systemInfo", "System information"],
  "system-stats": ["plugins.permission.systemStats", "System metrics"],
  processes: ["plugins.permission.processes", "Process management"],
  "display-control": ["plugins.permission.displayControl", "Display control"],
  "external-displays": ["plugins.permission.externalDisplays", "External displays"],
};

const HOST_CAPABILITY_LABELS: Record<string, [key: string, fallback: string]> = {
  plugin_file_read_base64: ["plugins.permission.fileRead", "Read local files"],
  plugin_file_write_base64: ["plugins.permission.fileWrite", "Write local files"],
  plugin_file_list: ["plugins.permission.fileList", "List local files"],
  plugin_file_exists: ["plugins.permission.fileExists", "Check local files"],
  plugin_file_ensure_dir: ["plugins.permission.fileDirectory", "Create local folders"],
  plugin_file_empty_dir: ["plugins.permission.fileDirectory", "Clear local folders"],
  plugin_run_applescript: ["plugins.permission.appleScript", "Run AppleScript"],
  qx_system_information_kill_process: ["plugins.permission.killProcess", "Terminate processes"],
};

/** Convert manifest capability codes to a human-readable Settings label. */
export function localizePluginPermission(
  permission: string,
  t: TranslateFn,
): string {
  const normalized = permission.trim();
  const known = PERMISSION_LABELS[normalized];
  if (known) return t(known[0], known[1]);

  if (normalized.startsWith("invoke:")) {
    const capability = normalized.slice("invoke:".length);
    const hostCapability = HOST_CAPABILITY_LABELS[capability];
    if (hostCapability) return t(hostCapability[0], hostCapability[1]);
    return t("plugins.permission.hostCapability", "Host capability: {name}")
      .replace("{name}", capability);
  }
  return normalized;
}

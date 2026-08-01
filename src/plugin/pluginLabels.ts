/**
 * Host-side display labels for plugins and built-in modules.
 *
 * Settings → Extensions, marketplace browse, and related chrome must use this
 * port — never paint raw English `plugin.name` when the UI locale is zh-CN.
 *
 * Resolution order for a name:
 * 1. Optional manifest `names` map (plugin-authored locales)
 * 2. Built-in: `launcher.<id>` then `module.<id>` (host i18n)
 * 3. External first-party: `plugins.ext.<id>.name` (host i18n)
 * 4. Manifest / install `name` fallback (English default)
 */

import type { Locale } from "../i18n";
import type { PluginManifest } from "./types";

export type TranslateFn = (key: string, fallback: string) => string;

/** Compact, product-owned copy for the plugins shipped in Qx's community catalog. */
const FIRST_PARTY_PLUGIN_LABELS: Record<string, { name: string; description: string }> = {
  brew: { name: "Brew", description: "Manage Homebrew packages (macOS)." },
  "external-display-control": { name: "External Display Control", description: "Adjust external display brightness." },
  "pomodoro-island": { name: "Pomodoro Island", description: "Focus timer with breaks." },
  "raycast-calendar": { name: "Quick Calendar", description: "Browse calendar months." },
  "qx-bing-wallpaper": { name: "Qx Bing Wallpaper", description: "Browse Bing daily wallpapers." },
  qxgold: { name: "QxGold", description: "Live JD gold prices and history." },
  qxcoolapk: { name: "QxCoolapk", description: "Browse Coolapk community feeds." },
  qxgh: { name: "QxGH", description: "Watch GitHub Actions and Releases." },
  qxheihe: { name: "QxHeihe", description: "Browse Heybox community posts." },
  qxpicture: { name: "Qxpicture", description: "Browse and save random images." },
  qxtieba: { name: "QxTieba", description: "Browse Baidu Tieba posts." },
  qxweibo: { name: "QxWeibo", description: "Browse Weibo posts and comments." },
  sysinfo: { name: "Sysinfo", description: "View CPU, memory, and system status." },
  unsplash: { name: "Unsplash", description: "Search Unsplash photos and set wallpapers." },
  v2ex: { name: "V2EX", description: "Browse latest and hot V2EX topics." },
  weather: { name: "Weather", description: "View current weather and forecasts." },
};

export type PluginLabelSource = {
  id: string;
  name: string;
  description?: string;
  manifest?: Pick<PluginManifest, "names" | "descriptions"> | null;
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

/** User-facing plugin / module title for host chrome (Settings list, detail, …). */
export function localizePluginName(
  plugin: PluginLabelSource,
  t: TranslateFn,
  locale: Locale = "en",
): string {
  const fromManifest = pickFromLocaleMap(plugin.manifest?.names, locale);
  if (fromManifest) return fromManifest;

  const firstParty = FIRST_PARTY_PLUGIN_LABELS[plugin.id];
  if (firstParty) return t(`plugins.ext.${plugin.id}.name`, firstParty.name);

  const moduleId = builtinModuleIdFromPluginId(plugin.id);
  if (moduleId) {
    // Prefer launcher product titles (e.g. 剪贴板历史), then short module labels.
    return t(`launcher.${moduleId}`, t(`module.${moduleId}`, plugin.name));
  }
  return t(`plugins.ext.${plugin.id}.name`, plugin.name);
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

  const firstParty = FIRST_PARTY_PLUGIN_LABELS[plugin.id];
  if (firstParty) return t(`plugins.ext.${plugin.id}.desc`, firstParty.description);

  const moduleId = builtinModuleIdFromPluginId(plugin.id);
  if (moduleId) {
    return t(`launcher.${moduleId}.desc`, fallback);
  }
  return t(`plugins.ext.${plugin.id}.desc`, fallback);
}

/** Marketplace index rows share the same external id namespace as installed plugins. */
export function localizeMarketplaceEntryName(
  entry: { id: string; name: string },
  t: TranslateFn,
): string {
  return t(`plugins.ext.${entry.id}.name`, FIRST_PARTY_PLUGIN_LABELS[entry.id]?.name ?? entry.name);
}

export function localizeMarketplaceEntryDescription(
  entry: { id: string; description?: string },
  t: TranslateFn,
): string {
  return t(
    `plugins.ext.${entry.id}.desc`,
    FIRST_PARTY_PLUGIN_LABELS[entry.id]?.description ?? (entry.description || "").trim(),
  );
}

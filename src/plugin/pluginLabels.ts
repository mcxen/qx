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
  return t(`plugins.ext.${entry.id}.name`, entry.name);
}

export function localizeMarketplaceEntryDescription(
  entry: { id: string; description?: string },
  t: TranslateFn,
): string {
  return t(`plugins.ext.${entry.id}.desc`, (entry.description || "").trim());
}

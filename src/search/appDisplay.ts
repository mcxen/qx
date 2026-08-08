import type { AppEntry } from "../store";
import { useLocale, useT, type Locale } from "../i18n";
import {
  localizePluginName,
  type TranslateFn,
} from "../plugin/pluginLabels";
import { usePluginRegistry } from "../plugin/registry";

/** English fallbacks for built-in module product titles (launcher.* keys). */
const MODULE_LABELS_EN: Record<string, string> = {
  clipboard: "Clipboard History",
  screencap: "Screenshot & Recording Module",
  rss: "RSS Reader",

  weather: "Weather",
  "qx-ai": "QxAI",
  macros: "Macro Recorder",
  documents: "Text Tools",
  "qx-tty": "QxTTY",
  settings: "Settings",
};

/** Surface deep-link English titles used as t() fallbacks. */
const MODULE_SURFACE_LABELS_EN: Record<string, string> = {
  "rss:import-opml": "Import OPML",
  "rss:add-feed": "Add RSS Feed",
  "qx-ai:new": "New AI Chat",
  "qx-ai:settings": "AI Chat Settings",
  "screencap:screenshot": "Take Screenshot",
  "screencap:record": "Start Screen Recording",
  "screencap:start": "Start Screen Recording",
  "documents:clean": "Clean Text",
  "documents:markdown": "Markdown Summary",
  "documents:json": "Format JSON",
};

/**
 * i18n keys for module surfaces (zh map under the same keys).
 * Prefer host i18n so system/preference language drives launcher labels.
 */
function surfaceI18nKey(moduleId: string, surface: string): string {
  return `module.surface.${moduleId}.${surface}`;
}

function moduleSurfaceForEntry(item: AppEntry): string | null {
  const moduleId = item.moduleId;
  if (!moduleId) return null;

  // Built-in panel/command entries use the legacy __qx:<tab> path or a
  // built-in open command. Dynamic module surfaces encode their root action
  // in the launch payload; leave feed names, locations, and saved items alone.
  if (item.path === `__qx:${moduleId}`) return "root";
  if (item.path.startsWith(`__qx:cmd:builtin:${moduleId}:`)) return "root";
  if (!item.path.startsWith("__qx:launch:")) return null;
  try {
    const launch = JSON.parse(decodeURIComponent(item.path.slice("__qx:launch:".length))) as {
      tab?: string;
      surface?: string;
    };
    return launch.tab === moduleId ? launch.surface ?? null : null;
  } catch {
    return null;
  }
}

function isModuleRootEntry(item: AppEntry): boolean {
  return moduleSurfaceForEntry(item) === "root";
}

function pluginIdFromAppPath(path: string): string | null {
  if (path.startsWith("__qx:plugin:")) {
    return path.slice("__qx:plugin:".length) || null;
  }
  const cmd = path.match(/^__qx:cmd:([^:]+):/);
  return cmd?.[1] ?? null;
}

/**
 * Pick the user-facing label for an app/file/command entry.
 * Under resolved zh-CN (explicit or Simplified Chinese system) prefer
 * Rust `display_name` for OS apps; modules/plugins use host i18n.
 */
const identityTranslate: TranslateFn = (_key, fallback) => fallback;

export function pickDisplayName(
  item: AppEntry,
  locale: Locale,
  t: TranslateFn = identityTranslate,
  plugins: Array<{
    id: string;
    name: string;
    description?: string;
    manifest?: { names?: Record<string, string> | null; descriptions?: Record<string, string> | null } | null;
  }> = [],
): string {
  // Settings shortcut row
  if (item.path === "__qx:settings" || item.moduleId === "settings") {
    return t("launcher.settings", MODULE_LABELS_EN.settings);
  }

  // Built-in modules (panel root + surface deep links)
  if (item.moduleId && !item.moduleId.startsWith("plugin:")) {
    const surface = moduleSurfaceForEntry(item);
    if (surface && surface !== "root") {
      const en = MODULE_SURFACE_LABELS_EN[`${item.moduleId}:${surface}`] ?? item.name;
      const localized = t(surfaceI18nKey(item.moduleId, surface), en);
      if (localized) return localized;
    }
    if (isModuleRootEntry(item) || surface === "root" || item.path === `__qx:${item.moduleId}`) {
      return t(
        `launcher.${item.moduleId}`,
        MODULE_LABELS_EN[item.moduleId] ?? item.name,
      );
    }
    // Named dynamic items (feed title, macro name, location) keep their own name.
  }

  // External plugin panel / command entries
  const pluginId = pluginIdFromAppPath(item.path);
  if (pluginId && !pluginId.startsWith("builtin:")) {
    const plugin = plugins.find((p) => p.id === pluginId);
    if (plugin) {
      return localizePluginName(
        {
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          manifest: plugin.manifest
            ? {
                names: plugin.manifest.names ?? undefined,
                descriptions: plugin.manifest.descriptions ?? undefined,
              }
            : null,
        },
        t,
        locale,
      );
    }
    return item.name;
  }

  // OS apps: Simplified Chinese systems use Finder display name when present.
  if (locale === "zh-CN" && item.display_name && item.display_name.trim()) {
    return item.display_name;
  }

  return item.name;
}

export function useDisplayName() {
  const locale = useLocale();
  const t = useT();
  const plugins = usePluginRegistry((state) => state.plugins);
  return (item: AppEntry) => pickDisplayName(item, locale, t, plugins);
}

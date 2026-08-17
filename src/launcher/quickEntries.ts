import type { QuickEntryConfig } from "../modules/settings/store";
import type { QuickEntry } from "./types";
import type { AppEntry } from "../store";
import { isBetaModule } from "../modules/catalog";
import { isBuiltinModuleEnabled } from "../modules/moduleAvailability";
import type { InstalledPlugin } from "../plugin/types";
import { localizePluginDescription, localizePluginName } from "../plugin/pluginLabels";
import type { Locale } from "../i18n";

type Translate = (key: string, fallback: string) => string;

export type QuickEntryTargetOption = {
  value: string;
  label: string;
  subtitle: string;
  titleKey?: string;
  subtitleKey?: string;
  /** Group label for selects (Modules / Plugins). */
  group?: string;
};

export const QUICK_ENTRY_TARGETS = [
  { value: "clipboard", label: "Clipboard History", subtitle: "Pinned, frequent, links", titleKey: "launcher.clipboard", subtitleKey: "launcher.clipboard.desc" },
  { value: "file-search", label: "File Search", subtitle: "Find recent files and folders", titleKey: "launcher.fileSearch", subtitleKey: "launcher.fileSearch.desc" },
  { value: "file-actions", label: "File Actions", subtitle: "Operate on the current Finder or Explorer selection", titleKey: "launcher.file-actions", subtitleKey: "launcher.file-actions.desc" },
  { value: "qx-ai", label: "QxAI", subtitle: "Chat and agent tasks", titleKey: "launcher.qx-ai", subtitleKey: "launcher.qx-ai.desc" },
  { value: "rss", label: "RSS Reader", subtitle: "Feeds and articles", titleKey: "launcher.rss", subtitleKey: "launcher.rss.desc" },
  { value: "screencap", label: "Screenshot & Recording Module", subtitle: "Screenshots and MP4/MOV recording", titleKey: "launcher.screencap", subtitleKey: "launcher.screencap.desc" },
  { value: "weather", label: "Weather", subtitle: "Current conditions and forecast", titleKey: "launcher.weather", subtitleKey: "launcher.weather.desc" },
  { value: "documents", label: "Text Tools", subtitle: "Text, Markdown, JSON", titleKey: "launcher.documents", subtitleKey: "launcher.documents.desc" },
  { value: "macros", label: "Macro Recorder", subtitle: "Record and replay actions", titleKey: "launcher.macros", subtitleKey: "launcher.macros.desc" },
  { value: "qx-tty", label: "QxTTY", subtitle: "Persistent local terminal sessions", titleKey: "launcher.qx-tty", subtitleKey: "launcher.qx-tty.desc" },
  {
    value: "settings:plugins",
    label: "Extensions",
    subtitle: "Install, update, and manage plugins",
    titleKey: "launcher.settingsPlugins",
    subtitleKey: "launcher.settingsPlugins.desc",
  },
  { value: "settings", label: "Qx Settings", subtitle: "Appearance, shortcuts, and preferences", titleKey: "launcher.settings", subtitleKey: "launcher.settings.desc" },
] as const;

export function pluginQuickEntryTarget(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function parsePluginQuickEntryTarget(target: string): string | null {
  if (!target.startsWith("plugin:")) return null;
  const id = target.slice("plugin:".length).trim();
  return id || null;
}

/** Builtin modules + installed external plugins (for the home Quick Entries editor). */
export function buildQuickEntryTargetOptions(
  plugins: InstalledPlugin[] | undefined,
  t?: Translate,
  locale: Locale = "en",
): QuickEntryTargetOption[] {
  const modules: QuickEntryTargetOption[] = QUICK_ENTRY_TARGETS.map((target) => ({
    value: target.value,
    label: t ? t(target.titleKey, target.label) : target.label,
    subtitle: t ? t(target.subtitleKey, target.subtitle) : target.subtitle,
    titleKey: target.titleKey,
    subtitleKey: target.subtitleKey,
    group: t ? t("launcher.quickGroup.modules", "Modules") : "Modules",
  }));

  const external = (plugins || [])
    .filter((plugin) => plugin.enabled && !plugin.id.startsWith("builtin:"))
    .slice()
    .sort((a, b) => localizePluginName(a, t ?? ((_, fallback) => fallback), locale)
      .localeCompare(localizePluginName(b, t ?? ((_, fallback) => fallback), locale), locale === "zh-CN" ? "zh-CN" : "en"))
    .map((plugin) => ({
      value: pluginQuickEntryTarget(plugin.id),
      label: localizePluginName(plugin, t ?? ((_, fallback) => fallback), locale),
      subtitle: localizePluginDescription(plugin, t ?? ((_, fallback) => fallback), locale) || plugin.id,
      group: t ? t("launcher.quickGroup.plugins", "Plugins") : "Plugins",
    }));

  return [...modules, ...external];
}

/** Localize default quick-entry titles; keep user-customized strings as-is. */
export function localizeQuickEntry(
  entry: Pick<QuickEntryConfig, "title" | "subtitle" | "target">,
  t: Translate,
  plugins?: InstalledPlugin[],
  locale: Locale = "en",
): { title: string; subtitle: string } {
  const fallback = QUICK_ENTRY_TARGETS.find((target) => target.value === entry.target);
  if (fallback) {
    const legacyDefaultTitle =
      entry.target === "screencap" && entry.title === "Screenshot Module";
    const title = !entry.title?.trim() || entry.title === fallback.label || legacyDefaultTitle
      ? t(fallback.titleKey, fallback.label)
      : entry.title;
    const subtitle = !entry.subtitle?.trim() || entry.subtitle === fallback.subtitle
      ? t(fallback.subtitleKey, fallback.subtitle)
      : entry.subtitle;
    return { title, subtitle };
  }

  const pluginId = parsePluginQuickEntryTarget(entry.target);
  if (pluginId) {
    const plugin = plugins?.find((item) => item.id === pluginId);
    return {
      title: entry.title?.trim() || (plugin ? localizePluginName(plugin, t, locale) : pluginId),
      subtitle: entry.subtitle?.trim() || (plugin ? localizePluginDescription(plugin, t, locale) : pluginId),
    };
  }

  return {
    title: entry.title?.trim() || t("launcher.quickEntry", "Quick Entry"),
    subtitle: entry.subtitle?.trim() || entry.target || "",
  };
}

const DEFAULT_QUICK_ENTRY_TARGETS = [
  "clipboard",
  "screencap",
  "documents",
  "settings:plugins",
  "settings",
];

export const DEFAULT_QUICK_ENTRIES: QuickEntryConfig[] = DEFAULT_QUICK_ENTRY_TARGETS.map((value) => {
  const target = QUICK_ENTRY_TARGETS.find((item) => item.value === value)!;
  return {
    id: target.value,
    title: target.label,
    subtitle: target.subtitle,
    target: target.value,
    enabled: true,
  };
});

export function sanitizeQuickEntries(entries: QuickEntryConfig[] | undefined): QuickEntryConfig[] {
  const source = Array.isArray(entries) && entries.length > 0 ? entries : DEFAULT_QUICK_ENTRIES;
  return source
    .map((entry, index) => {
      const fallback = QUICK_ENTRY_TARGETS.find((target) => target.value === entry.target);
      const pluginId = parsePluginQuickEntryTarget(entry.target || "");
      const id = entry.id?.trim() || `${entry.target || "quick"}-${index}`;
      const title =
        entry.title?.trim()
        || fallback?.label
        || (pluginId ? pluginId : "Quick Entry");
      const subtitle =
        entry.subtitle?.trim()
        || fallback?.subtitle
        || (pluginId ? pluginId : entry.target || "");
      const target = entry.target?.trim() || fallback?.value || "launcher";
      return {
        id,
        title,
        subtitle,
        target,
        // Quick entries are now add/remove only. Preserve old settings but
        // reactivate formerly disabled entries instead of exposing a toggle.
        enabled: true,
      };
    })
    .filter((entry) => entry.target);
}

function isQuickEntryTargetAvailable(
  target: string,
  plugins: InstalledPlugin[] | undefined,
): boolean {
  if (
    target === "file-search"
    || target === "settings"
    || target === "settings:plugins"
    || target === "launcher"
  ) {
    return true;
  }
  const pluginId = parsePluginQuickEntryTarget(target);
  if (pluginId) {
    const plugin = plugins?.find((item) => item.id === pluginId);
    return Boolean(plugin?.enabled);
  }
  // Builtin module tab ids
  return isBuiltinModuleEnabled(target);
}

export function toLauncherQuickEntries(
  entries: QuickEntryConfig[] | undefined,
  onNavigate: (tab: string) => void,
  t?: Translate,
  plugins?: InstalledPlugin[],
  locale: Locale = "en",
): QuickEntry[] {
  return sanitizeQuickEntries(entries)
    .filter((entry) => entry.enabled && isQuickEntryTargetAvailable(entry.target, plugins))
    .map((entry) => {
      const labels = t
        ? localizeQuickEntry(entry, t, plugins, locale)
        : { title: entry.title, subtitle: entry.subtitle };
      const pluginId = parsePluginQuickEntryTarget(entry.target);
      return {
        id: entry.id,
        title: labels.title,
        subtitle: labels.subtitle,
        target: entry.target,
        beta: !pluginId && isBetaModule(entry.target),
        onClick: () => onNavigate(entry.target),
      };
    });
}

/** Enabled builtin modules + external plugins for the launcher's complete module directory. */
export function toLauncherAllModules(
  onNavigate: (target: string) => void,
  t: Translate,
  plugins?: InstalledPlugin[],
  locale: Locale = "en",
): QuickEntry[] {
  return buildQuickEntryTargetOptions(plugins, t, locale)
    .filter((option) => option.value !== "settings" && option.value !== "settings:plugins")
    .filter((option) => isQuickEntryTargetAvailable(option.value, plugins))
    .map((option) => {
      const pluginId = parsePluginQuickEntryTarget(option.value);
      return {
        id: `all-modules-${option.value}`,
        title: option.label,
        subtitle: option.subtitle,
        target: option.value,
        beta: !pluginId && isBetaModule(option.value),
        onClick: () => onNavigate(option.value),
      };
    });
}

/** Project a quick-entry target into the same launchable shape as search results. */
export function quickEntryToAppEntry(
  entry: Pick<QuickEntry, "title" | "subtitle" | "target">,
  plugins?: InstalledPlugin[],
): AppEntry | null {
  const target = entry.target.trim();
  if (!target || target === "file-search") return null;
  if (target.startsWith("plugin:")) {
    const pluginId = parsePluginQuickEntryTarget(target);
    if (!pluginId) return null;
    const plugin = plugins?.find((item) => item.id === pluginId);
    return {
      name: entry.title || plugin?.name || pluginId,
      display_name: entry.title || plugin?.name || pluginId,
      subtitle: entry.subtitle || plugin?.description || pluginId,
      path: `__qx:plugin:${pluginId}`,
      icon: plugin?.manifest?.icon || `builtin:${pluginId}`,
      kind: "command",
    };
  }
  if (target === "settings:plugins") {
    return {
      name: entry.title || "Extensions",
      display_name: entry.title || "Extensions",
      subtitle: entry.subtitle || "Install, update, and manage plugins",
      path: "__qx:settings:plugins",
      icon: "builtin:plugins",
      kind: "command",
      moduleId: "settings",
    };
  }
  return {
    name: entry.title || target,
    display_name: entry.title || target,
    subtitle: entry.subtitle || "Module",
    path: `__qx:${target}`,
    icon: `builtin:${target}`,
    kind: "command",
    moduleId: target === "settings" ? "settings" : target,
  };
}

export function createQuickEntry(
  targetValue: string = QUICK_ENTRY_TARGETS[0].value,
  plugins?: InstalledPlugin[],
): QuickEntryConfig {
  const builtin = QUICK_ENTRY_TARGETS.find((item) => item.value === targetValue);
  if (builtin) {
    return {
      id: `${builtin.value}-${Date.now().toString(36)}`,
      title: builtin.label,
      subtitle: builtin.subtitle,
      target: builtin.value,
      enabled: true,
    };
  }
  const pluginId = parsePluginQuickEntryTarget(targetValue);
  const plugin = pluginId ? plugins?.find((item) => item.id === pluginId) : undefined;
  return {
    id: `${targetValue}-${Date.now().toString(36)}`,
    title: plugin?.name || pluginId || targetValue,
    subtitle: plugin?.description?.trim() || pluginId || targetValue,
    target: targetValue,
    enabled: true,
  };
}

/** Build a quick-entry config from a launcher result (plugin / module / app). */
export function quickEntryFromAppEntry(
  item: { name: string; path: string; kind?: string; subtitle?: string },
  plugins?: InstalledPlugin[],
): QuickEntryConfig | null {
  if (item.path.startsWith("__qx:plugin:")) {
    const pluginId = item.path.slice("__qx:plugin:".length);
    if (!pluginId) return null;
    return createQuickEntry(pluginQuickEntryTarget(pluginId), plugins);
  }
  if (item.path.startsWith("__qx:cmd:")) {
    // Prefer the plugin panel over a single command.
    const rest = item.path.slice("__qx:cmd:".length);
    const idx = rest.lastIndexOf(":");
    const pluginId = idx > 0 ? rest.slice(0, idx) : rest;
    if (!pluginId || pluginId.startsWith("builtin:")) {
      const builtinId = pluginId.startsWith("builtin:") ? pluginId.slice("builtin:".length) : "";
      if (builtinId && QUICK_ENTRY_TARGETS.some((t) => t.value === builtinId)) {
        return createQuickEntry(builtinId, plugins);
      }
      return null;
    }
    return createQuickEntry(pluginQuickEntryTarget(pluginId), plugins);
  }
  if (item.path === "__qx:settings:plugins") {
    return createQuickEntry("settings:plugins", plugins);
  }
  const tabMatch = item.path.match(
    /^__qx:(clipboard|screencap|rss|weather|qx-ai|macros|documents|qx-tty|settings)$/,
  );
  if (tabMatch) return createQuickEntry(tabMatch[1], plugins);
  return null;
}

export function isQuickEntryAlreadyAdded(
  entries: QuickEntryConfig[] | undefined,
  target: string,
): boolean {
  return sanitizeQuickEntries(entries).some((entry) => entry.target === target && entry.enabled !== false);
}

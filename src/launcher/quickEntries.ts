import type { QuickEntryConfig } from "../modules/settings/store";
import type { QuickEntry } from "./types";
import { isBetaModule } from "../modules/catalog";
import { isBuiltinModuleEnabled } from "../modules/moduleAvailability";
import type { InstalledPlugin } from "../plugin/types";

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
  { value: "qx-ai", label: "QxAI", subtitle: "Chat and agent tasks", titleKey: "launcher.qx-ai", subtitleKey: "launcher.qx-ai.desc" },
  { value: "rss", label: "RSS Reader", subtitle: "Feeds and articles", titleKey: "launcher.rss", subtitleKey: "launcher.rss.desc" },
  { value: "screencap", label: "Screen Capture", subtitle: "Screenshots and MP4/MOV recording", titleKey: "launcher.screencap", subtitleKey: "launcher.screencap.desc" },
  { value: "v2ex", label: "V2EX", subtitle: "Latest and hot topics", titleKey: "launcher.v2ex", subtitleKey: "launcher.v2ex.desc" },
  { value: "weather", label: "Weather", subtitle: "Current conditions and forecast", titleKey: "launcher.weather", subtitleKey: "launcher.weather.desc" },
  { value: "documents", label: "Documents", subtitle: "Disk notepad · folder files", titleKey: "launcher.documents", subtitleKey: "launcher.documents.desc" },
  { value: "macros", label: "Macro Recorder", subtitle: "Record and replay actions", titleKey: "launcher.macros", subtitleKey: "launcher.macros.desc" },
  { value: "qx-tty", label: "QxTTY", subtitle: "Persistent local terminal sessions", titleKey: "launcher.qx-tty", subtitleKey: "launcher.qx-tty.desc" },
  { value: "settings", label: "Settings", subtitle: "Appearance and plugins", titleKey: "launcher.settings", subtitleKey: "launcher.settings.desc" },
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
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((plugin) => ({
      value: pluginQuickEntryTarget(plugin.id),
      label: plugin.name || plugin.id,
      subtitle: plugin.description?.trim() || plugin.id,
      group: t ? t("launcher.quickGroup.plugins", "Plugins") : "Plugins",
    }));

  return [...modules, ...external];
}

/** Localize default quick-entry titles; keep user-customized strings as-is. */
export function localizeQuickEntry(
  entry: Pick<QuickEntryConfig, "title" | "subtitle" | "target">,
  t: Translate,
  plugins?: InstalledPlugin[],
): { title: string; subtitle: string } {
  const fallback = QUICK_ENTRY_TARGETS.find((target) => target.value === entry.target);
  if (fallback) {
    const title = !entry.title?.trim() || entry.title === fallback.label
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
      title: entry.title?.trim() || plugin?.name || pluginId,
      subtitle: entry.subtitle?.trim() || plugin?.description || pluginId,
    };
  }

  return {
    title: entry.title?.trim() || t("launcher.quickEntry", "Quick Entry"),
    subtitle: entry.subtitle?.trim() || entry.target || "",
  };
}

const DEFAULT_QUICK_ENTRY_TARGETS = ["clipboard", "rss", "settings", "file-search"];

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
        enabled: entry.enabled !== false,
      };
    })
    .filter((entry) => entry.target);
}

function isQuickEntryTargetAvailable(
  target: string,
  plugins: InstalledPlugin[] | undefined,
): boolean {
  if (target === "file-search" || target === "settings" || target === "launcher") return true;
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
): QuickEntry[] {
  return sanitizeQuickEntries(entries)
    .filter((entry) => entry.enabled && isQuickEntryTargetAvailable(entry.target, plugins))
    .map((entry) => {
      const labels = t
        ? localizeQuickEntry(entry, t, plugins)
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
  const tabMatch = item.path.match(
    /^__qx:(clipboard|screencap|rss|v2ex|weather|qx-ai|macros|documents|qx-tty|settings)$/,
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

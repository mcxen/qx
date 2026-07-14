import type { QuickEntryConfig } from "../modules/settings/store";
import type { QuickEntry } from "./types";

type Translate = (key: string, fallback: string) => string;

export const QUICK_ENTRY_TARGETS = [
  { value: "clipboard", label: "Clipboard History", subtitle: "Pinned, frequent, links", titleKey: "launcher.clipboard", subtitleKey: "launcher.clipboard.desc" },
  { value: "qx-ai", label: "QxAI", subtitle: "Chat and agent tasks", titleKey: "launcher.qx-ai", subtitleKey: "launcher.qx-ai.desc" },
  { value: "rss", label: "RSS Reader", subtitle: "Feeds and articles", titleKey: "launcher.rss", subtitleKey: "launcher.rss.desc" },
  { value: "screencap", label: "Screen Recording", subtitle: "GIF capture", titleKey: "launcher.screencap", subtitleKey: "launcher.screencap.desc" },
  { value: "v2ex", label: "V2EX", subtitle: "Latest and hot topics", titleKey: "launcher.v2ex", subtitleKey: "launcher.v2ex.desc" },
  { value: "weather", label: "Weather", subtitle: "Current conditions and forecast", titleKey: "launcher.weather", subtitleKey: "launcher.weather.desc" },
  { value: "documents", label: "Documents", subtitle: "Text, Markdown, JSON", titleKey: "launcher.documents", subtitleKey: "launcher.documents.desc" },
  { value: "macros", label: "Macro Recorder", subtitle: "Record and replay actions", titleKey: "launcher.macros", subtitleKey: "launcher.macros.desc" },
  { value: "settings", label: "Settings", subtitle: "Appearance and plugins", titleKey: "launcher.settings", subtitleKey: "launcher.settings.desc" },
] as const;

/** Localize default quick-entry titles; keep user-customized strings as-is. */
export function localizeQuickEntry(
  entry: Pick<QuickEntryConfig, "title" | "subtitle" | "target">,
  t: Translate,
): { title: string; subtitle: string } {
  const fallback = QUICK_ENTRY_TARGETS.find((target) => target.value === entry.target);
  if (!fallback) {
    return {
      title: entry.title?.trim() || t("launcher.quickEntry", "Quick Entry"),
      subtitle: entry.subtitle?.trim() || entry.target || "",
    };
  }
  const title = !entry.title?.trim() || entry.title === fallback.label
    ? t(fallback.titleKey, fallback.label)
    : entry.title;
  const subtitle = !entry.subtitle?.trim() || entry.subtitle === fallback.subtitle
    ? t(fallback.subtitleKey, fallback.subtitle)
    : entry.subtitle;
  return { title, subtitle };
}

export const DEFAULT_QUICK_ENTRIES: QuickEntryConfig[] = QUICK_ENTRY_TARGETS.map((target) => ({
  id: target.value,
  title: target.label,
  subtitle: target.subtitle,
  target: target.value,
  enabled: true,
}));

export function sanitizeQuickEntries(entries: QuickEntryConfig[] | undefined): QuickEntryConfig[] {
  const source = Array.isArray(entries) && entries.length > 0 ? entries : DEFAULT_QUICK_ENTRIES;
  return source
    .map((entry, index) => {
      const fallback = QUICK_ENTRY_TARGETS.find((target) => target.value === entry.target);
      const id = entry.id?.trim() || `${entry.target || "quick"}-${index}`;
      const title = entry.title?.trim() || fallback?.label || "Quick Entry";
      const subtitle = entry.subtitle?.trim() || fallback?.subtitle || entry.target || "";
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

export function toLauncherQuickEntries(
  entries: QuickEntryConfig[] | undefined,
  onNavigate: (tab: string) => void,
  t?: Translate,
): QuickEntry[] {
  return sanitizeQuickEntries(entries)
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const labels = t ? localizeQuickEntry(entry, t) : { title: entry.title, subtitle: entry.subtitle };
      return {
        id: entry.id,
        title: labels.title,
        subtitle: labels.subtitle,
        target: entry.target,
        onClick: () => onNavigate(entry.target),
      };
    });
}

export function createQuickEntry(targetValue = QUICK_ENTRY_TARGETS[0].value): QuickEntryConfig {
  const target = QUICK_ENTRY_TARGETS.find((item) => item.value === targetValue) ?? QUICK_ENTRY_TARGETS[0];
  return {
    id: `${target.value}-${Date.now().toString(36)}`,
    title: target.label,
    subtitle: target.subtitle,
    target: target.value,
    enabled: true,
  };
}

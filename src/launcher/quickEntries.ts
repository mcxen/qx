import type { QuickEntryConfig } from "../modules/settings/store";
import type { QuickEntry } from "./types";

export const QUICK_ENTRY_TARGETS = [
  { value: "clipboard", label: "Clipboard History", subtitle: "Pinned, frequent, links" },
  { value: "qx-ai", label: "QxAI", subtitle: "Chat and agent tasks" },
  { value: "rss", label: "RSS Reader", subtitle: "Feeds and articles" },
  { value: "screencap", label: "Screen Recording", subtitle: "GIF capture" },
  { value: "v2ex", label: "V2EX", subtitle: "Latest and hot topics" },
  { value: "weather", label: "Weather", subtitle: "Current conditions and forecast" },
  { value: "documents", label: "Documents", subtitle: "Text, Markdown, JSON" },
  { value: "macros", label: "Macro Recorder", subtitle: "Record and replay actions" },
  { value: "settings", label: "Settings", subtitle: "Appearance and plugins" },
] as const;

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
): QuickEntry[] {
  return sanitizeQuickEntries(entries)
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      subtitle: entry.subtitle,
      target: entry.target,
      onClick: () => onNavigate(entry.target),
    }));
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

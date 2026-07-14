import type { AppEntry } from "../store";
import { useLocale } from "../i18n";

/**
 * Pick the user-facing label for an app/file/command entry.
 * Under resolved zh-CN (explicit or Simplified Chinese system) prefer
 * Rust `display_name` (e.g. "微信"); English always uses file-stem `name`.
 */
export function pickDisplayName(item: AppEntry, locale: string): string {
  if (locale === "zh-CN" && item.display_name && item.display_name.trim()) {
    return item.display_name;
  }
  return item.name;
}

export function useDisplayName() {
  const locale = useLocale();
  return (item: AppEntry) => pickDisplayName(item, locale);
}

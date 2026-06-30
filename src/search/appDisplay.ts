import type { AppEntry } from "../store";
import { useLocale } from "../i18n";

/**
 * Pick the user-facing label for an app/file/command entry.
 * Under zh-CN we prefer the Rust-provided localized `display_name` (e.g. "微信")
 * if it differs from the file-stem `name`; otherwise fall back to `name`.
 * Other locales always show `name` so users keep the English file-stem identity.
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

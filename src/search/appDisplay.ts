import type { AppEntry } from "../store";
import { useLocale } from "../i18n";

const MODULE_LABELS_ZH: Record<string, string> = {
  clipboard: "剪贴板历史",
  screencap: "屏幕录制",
  rss: "RSS 阅读器",
  v2ex: "V2EX",
  weather: "天气",
  "qx-ai": "QxAI",
  macros: "宏录制",
  documents: "文本工具箱",
  settings: "设置",
};

const MODULE_SURFACE_LABELS_ZH: Record<string, string> = {
  "rss:root": "RSS 阅读器",
  "rss:import-opml": "导入 OPML",
  "rss:add-feed": "添加 RSS 订阅",
  "clipboard:root": "剪贴板历史",
  "qx-ai:root": "QxAI",
  "qx-ai:new": "新建 AI 对话",
  "qx-ai:settings": "AI 对话设置",
  "screencap:root": "屏幕录制",
  "screencap:start": "开始录屏",
  "v2ex:root": "V2EX",
  "v2ex:hot": "V2EX 热门",
  "v2ex:latest": "V2EX 最新",
  "weather:root": "天气",
  "macros:root": "宏录制",
  "documents:root": "文本工具箱",
  "documents:clean": "文本清理",
  "documents:markdown": "Markdown 摘要",
  "documents:json": "格式化 JSON",
};

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

/**
 * Pick the user-facing label for an app/file/command entry.
 * Under resolved zh-CN (explicit or Simplified Chinese system) prefer
 * Rust `display_name` (e.g. "微信"); English always uses file-stem `name`.
 */
export function pickDisplayName(item: AppEntry, locale: string): string {
  if (locale === "zh-CN" && item.display_name && item.display_name.trim()) {
    return item.display_name;
  }
  if (locale === "zh-CN" && item.moduleId) {
    const surface = moduleSurfaceForEntry(item);
    const localizedSurface = surface && MODULE_SURFACE_LABELS_ZH[`${item.moduleId}:${surface}`];
    if (localizedSurface) return localizedSurface;
    if (isModuleRootEntry(item)) return MODULE_LABELS_ZH[item.moduleId] ?? item.name;
  }
  return item.name;
}

export function useDisplayName() {
  const locale = useLocale();
  return (item: AppEntry) => pickDisplayName(item, locale);
}

/**
 * Module Surfaces — dynamic deep links for main search.
 * Design: docs/module-surfaces.md
 *
 * Concurrency rules (must not block launcher typing / app search):
 * - All providers that touch Rust use `await invoke` (async IPC), never sync FS/network.
 * - Callers must fire-and-forget or parallelize; do not await this on the apps critical path.
 * - Stale results are discarded by search seq in App.tsx, not by blocking.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  MODULE_SEARCH_MODULE_IDS,
  type ModuleSearchModuleId,
  useSettingsStore,
} from "../modules/settings/store";
import { useG4fStore } from "../modules/qx-ai/store";
import { isBuiltinModuleEnabled } from "../modules/moduleAvailability";

export type ModuleLaunch = {
  tab: string;
  surface: string;
  params?: Record<string, string | number | boolean | null>;
};

export type ModuleSurfaceHit = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  score: number;
  launch: ModuleLaunch;
  moduleId: ModuleSearchModuleId;
};

const pendingByTab = new Map<string, ModuleLaunch>();

export function setPendingModuleLaunch(launch: ModuleLaunch): void {
  pendingByTab.set(launch.tab, launch);
}

export function takePendingModuleLaunch(tab: string): ModuleLaunch | null {
  const launch = pendingByTab.get(tab) ?? null;
  if (launch) pendingByTab.delete(tab);
  return launch;
}

export function encodeModuleLaunchPath(launch: ModuleLaunch): string {
  return `__qx:launch:${encodeURIComponent(JSON.stringify(launch))}`;
}

export function parseModuleLaunchPath(path: string): ModuleLaunch | null {
  if (path.startsWith("__qx:launch:")) {
    try {
      const raw = decodeURIComponent(path.slice("__qx:launch:".length));
      const parsed = JSON.parse(raw) as ModuleLaunch;
      if (parsed && typeof parsed.tab === "string" && typeof parsed.surface === "string") {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  const feedMatch = path.match(/^__qx:rss:feed:(\d+)$/);
  if (feedMatch) {
    return { tab: "rss", surface: "feed", params: { feedId: Number(feedMatch[1]) } };
  }
  return null;
}

/** Whether a built-in module may appear in main search (static + dynamic). */
export function isModuleSearchEnabled(moduleId: string): boolean {
  if (!isBuiltinModuleEnabled(moduleId)) return false;
  const ms = useSettingsStore.getState().settings.module_search;
  if (!ms || ms.enabled === false) return false;
  const modules = ms.modules ?? {};
  if (Object.prototype.hasOwnProperty.call(modules, moduleId)) {
    return modules[moduleId as ModuleSearchModuleId] !== false;
  }
  // Unknown / missing key → enabled by default.
  return true;
}

export function scoreText(query: string, ...parts: Array<string | null | undefined>): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let best = 0;
  for (const part of parts) {
    if (!part) continue;
    const value = part.toLowerCase();
    if (value === q) best = Math.max(best, 100);
    else if (value.startsWith(q)) best = Math.max(best, 80);
    else if (value.includes(q)) best = Math.max(best, 55);
    else {
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1 && tokens.every((t) => value.includes(t))) {
        best = Math.max(best, 45);
      }
    }
  }
  return best;
}

function hit(
  partial: Omit<ModuleSurfaceHit, "moduleId"> & { moduleId: ModuleSearchModuleId },
): ModuleSurfaceHit {
  return partial;
}

// ── Providers ──────────────────────────────────────────────────────────────

type RssFeedRow = {
  id: number;
  url: string;
  title: string;
  icon?: string;
  unread_count?: number;
  folder_name?: string | null;
};

async function searchRssSurfaces(query: string): Promise<ModuleSurfaceHit[]> {
  if (!isModuleSearchEnabled("rss") || !("__TAURI_INTERNALS__" in window)) return [];
  try {
    const feeds = await invoke<RssFeedRow[]>("rss_list_feeds");
    const hits: ModuleSurfaceHit[] = [];
    for (const feed of feeds) {
      const score = scoreText(query, feed.title, feed.url, feed.folder_name ?? undefined, "rss", "feed", "订阅");
      if (score <= 0) continue;
      const unread = feed.unread_count ?? 0;
      hits.push(hit({
        id: `rss:feed:${feed.id}`,
        moduleId: "rss",
        title: feed.title || feed.url,
        subtitle: ["RSS", feed.folder_name || null, unread > 0 ? `${unread} unread` : null]
          .filter(Boolean)
          .join(" · "),
        icon: feed.icon || "builtin:rss",
        score,
        launch: { tab: "rss", surface: "feed", params: { feedId: feed.id } },
      }));
    }
    // Static sub-commands
    for (const item of [
      { surface: "root", title: "Open RSS Reader", keys: ["rss", "reader", "订阅", "feeds"] },
      { surface: "import-opml", title: "Import OPML", keys: ["opml", "import", "rss"] },
      { surface: "add-feed", title: "Add RSS Feed", keys: ["add", "feed", "subscribe", "rss"] },
    ] as const) {
      const score = scoreText(query, item.title, ...item.keys);
      if (score > 0) {
        hits.push(hit({
          id: `rss:cmd:${item.surface}`,
          moduleId: "rss",
          title: item.title,
          subtitle: "RSS · command",
          icon: "builtin:rss",
          score: Math.min(score, 70),
          launch: { tab: "rss", surface: item.surface },
        }));
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 12);
  } catch {
    return [];
  }
}

async function searchClipboardSurfaces(query: string): Promise<ModuleSurfaceHit[]> {
  if (!isModuleSearchEnabled("clipboard") || !("__TAURI_INTERNALS__" in window)) return [];
  const hits: ModuleSurfaceHit[] = [];
  const openScore = scoreText(query, "clipboard", "paste", "history", "剪贴板", "粘贴");
  if (openScore > 0) {
    hits.push(hit({
      id: "clipboard:root",
      moduleId: "clipboard",
      title: "Open Clipboard History",
      subtitle: "Clipboard · command",
      icon: "builtin:clipboard",
      score: openScore,
      launch: { tab: "clipboard", surface: "root" },
    }));
  }
  try {
    const history = await invoke<Array<{
      id: string;
      text: string;
      pinned: boolean;
      image_path?: string | null;
      file_path?: string | null;
    }>>("get_clipboard_history", { limit: 80 });
    for (const item of history) {
      const label = item.file_path
        ? (item.file_path.split(/[/\\]/).pop() || item.file_path)
        : item.image_path
          ? "Image"
          : item.text.replace(/\s+/g, " ").trim().slice(0, 80) || "Clipboard Item";
      const score = scoreText(
        query,
        label,
        item.text?.slice(0, 200),
        item.pinned ? "pinned" : "",
        "clipboard",
      );
      if (score <= 0) continue;
      hits.push(hit({
        id: `clipboard:item:${item.id}`,
        moduleId: "clipboard",
        title: label,
        subtitle: ["Clipboard", item.pinned ? "Pinned" : null, item.file_path ? "File" : item.image_path ? "Image" : "Text"]
          .filter(Boolean)
          .join(" · "),
        icon: "builtin:clipboard",
        score,
        launch: { tab: "clipboard", surface: "item", params: { id: item.id } },
      }));
    }
  } catch {
    // ignore
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10);
}

function searchQxAiSurfaces(query: string): ModuleSurfaceHit[] {
  if (!isModuleSearchEnabled("qx-ai")) return [];
  const hits: ModuleSurfaceHit[] = [];
  for (const item of [
    { surface: "root", title: "Open QxAI", keys: ["ai", "chat", "qxai", "gpt", "人工智能"] },
    { surface: "new", title: "New AI Chat", keys: ["new", "chat", "ai", "新建"] },
    { surface: "settings", title: "AI Chat Settings", keys: ["ai", "settings", "provider", "model"] },
  ] as const) {
    const score = scoreText(query, item.title, ...item.keys);
    if (score > 0) {
      hits.push(hit({
        id: `qx-ai:cmd:${item.surface}`,
        moduleId: "qx-ai",
        title: item.title,
        subtitle: "QxAI · command",
        icon: "builtin:qx-ai",
        score: Math.min(score, 75),
        launch: { tab: "qx-ai", surface: item.surface },
      }));
    }
  }
  try {
    const conversations = useG4fStore.getState().conversations ?? [];
    for (const conv of conversations) {
      const score = scoreText(query, conv.name, conv.provider, conv.model, "chat", "ai");
      if (score <= 0) continue;
      hits.push(hit({
        id: `qx-ai:chat:${conv.id}`,
        moduleId: "qx-ai",
        title: conv.name,
        subtitle: `QxAI · ${conv.provider} · ${conv.model}`,
        icon: "builtin:qx-ai",
        score,
        launch: { tab: "qx-ai", surface: "chat", params: { id: conv.id } },
      }));
    }
  } catch {
    // store may be empty before mount
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10);
}

async function searchMacroSurfaces(query: string): Promise<ModuleSurfaceHit[]> {
  if (!isModuleSearchEnabled("macros") || !("__TAURI_INTERNALS__" in window)) return [];
  const hits: ModuleSurfaceHit[] = [];
  const openScore = scoreText(query, "macro", "macros", "recording", "宏", "录制");
  if (openScore > 0) {
    hits.push(hit({
      id: "macros:root",
      moduleId: "macros",
      title: "Open Macro Recorder",
      subtitle: "Macros · command",
      icon: "builtin:macros",
      score: openScore,
      launch: { tab: "macros", surface: "root" },
    }));
  }
  try {
    const list = await invoke<Array<{
      id: number | null;
      name: string;
      total_duration_ms?: number;
    }>>("macro_list");
    for (const macro of list) {
      if (macro.id == null) continue;
      const score = scoreText(query, macro.name, "macro", "play");
      if (score <= 0) continue;
      hits.push(hit({
        id: `macros:play:${macro.id}`,
        moduleId: "macros",
        title: macro.name,
        subtitle: "Macros · play",
        icon: "builtin:macros",
        score,
        launch: { tab: "macros", surface: "play", params: { id: macro.id } },
      }));
    }
  } catch {
    // ignore
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

async function searchScreencapSurfaces(query: string): Promise<ModuleSurfaceHit[]> {
  if (!isModuleSearchEnabled("screencap") || !("__TAURI_INTERNALS__" in window)) return [];
  const hits: ModuleSurfaceHit[] = [];
  for (const item of [
    { surface: "root", title: "Open Screen Recording", keys: ["video", "mp4", "mov", "gif", "record", "screen", "录屏"] },
    { surface: "start", title: "Start Screen Recording", keys: ["start", "video", "mp4", "mov", "record", "gif", "录屏"] },
  ] as const) {
    const score = scoreText(query, item.title, ...item.keys);
    if (score > 0) {
      hits.push(hit({
        id: `screencap:cmd:${item.surface}`,
        moduleId: "screencap",
        title: item.title,
        subtitle: "Screen Recording · command",
        icon: "builtin:screencap",
        score: Math.min(score, 75),
        launch: { tab: "screencap", surface: item.surface },
      }));
    }
  }
  try {
    const history = await invoke<Array<{
      id: number;
      path: string;
      duration_ms: number;
      created_at: number;
    }>>("get_screencap_history");
    for (const entry of history) {
      const name = entry.path.split(/[/\\]/).pop() || entry.path;
      const score = scoreText(query, name, "video", "mp4", "mov", "gif", "recording", "history");
      if (score <= 0) continue;
      hits.push(hit({
        id: `screencap:gif:${entry.id}`,
        moduleId: "screencap",
        title: name,
        subtitle: "Screen Recording · Video / GIF",
        icon: "builtin:screencap",
        score,
        launch: { tab: "screencap", surface: "preview", params: { path: entry.path, id: entry.id } },
      }));
    }
  } catch {
    // ignore
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

function searchDocumentsSurfaces(query: string): ModuleSurfaceHit[] {
  if (!isModuleSearchEnabled("documents")) return [];
  const hits: ModuleSurfaceHit[] = [];
  for (const item of [
    { surface: "root", title: "Open Documents", keys: ["document", "documents", "text", "文档"] },
    { surface: "clean", title: "Documents · Clean Text", keys: ["clean", "normalize", "text"] },
    { surface: "markdown", title: "Documents · Markdown Summary", keys: ["markdown", "md", "summary"] },
    { surface: "json", title: "Documents · Format JSON", keys: ["json", "format", "pretty"] },
  ] as const) {
    const score = scoreText(query, item.title, ...item.keys);
    if (score > 0) {
      hits.push(hit({
        id: `documents:${item.surface}`,
        moduleId: "documents",
        title: item.title,
        subtitle: "Documents · tool",
        icon: "builtin:documents",
        score: Math.min(score, 72),
        launch: { tab: "documents", surface: item.surface },
      }));
    }
  }
  return hits;
}

function searchWeatherSurfaces(query: string): ModuleSurfaceHit[] {
  if (!isModuleSearchEnabled("weather")) return [];
  const hits: ModuleSurfaceHit[] = [];
  const openScore = scoreText(query, "weather", "forecast", "temperature", "天气", "气温");
  if (openScore > 0) {
    hits.push(hit({
      id: "weather:root",
      moduleId: "weather",
      title: "Open Weather",
      subtitle: "Weather · command",
      icon: "builtin:weather",
      score: openScore,
      launch: { tab: "weather", surface: "root" },
    }));
  }
  const weather = useSettingsStore.getState().settings.weather;
  const locations = [
    ...(Array.isArray(weather.locations) ? weather.locations : []),
    weather.location_override,
  ].map((l) => l.trim()).filter(Boolean);
  for (const loc of Array.from(new Set(locations))) {
    const score = scoreText(query, loc, "weather", "天气");
    if (score <= 0) continue;
    hits.push(hit({
      id: `weather:loc:${loc}`,
      moduleId: "weather",
      title: loc,
      subtitle: "Weather · location",
      icon: "builtin:weather",
      score,
      launch: { tab: "weather", surface: "location", params: { name: loc } },
    }));
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

function searchQxTtySurfaces(query: string): ModuleSurfaceHit[] {
  if (!isModuleSearchEnabled("qx-tty")) return [];
  const score = scoreText(query, "QxTTY", "terminal", "tty", "shell", "command line", "终端", "命令行");
  if (score <= 0) return [];
  return [hit({
    id: "qx-tty:root",
    moduleId: "qx-tty",
    title: "Open QxTTY",
    subtitle: "QxTTY · terminal",
    icon: "builtin:qx-tty",
    score: Math.min(score, 72),
    launch: { tab: "qx-tty", surface: "root" },
  })];
}

function searchV2exSurfaces(query: string): ModuleSurfaceHit[] {
  if (!isModuleSearchEnabled("v2ex")) return [];
  const hits: ModuleSurfaceHit[] = [];
  for (const item of [
    { surface: "root", title: "Open V2EX", keys: ["v2ex", "forum", "社区"] },
    { surface: "hot", title: "V2EX Hot", keys: ["v2ex", "hot", "热门"] },
    { surface: "latest", title: "V2EX Latest", keys: ["v2ex", "latest", "最新"] },
  ] as const) {
    const score = scoreText(query, item.title, ...item.keys);
    if (score > 0) {
      hits.push(hit({
        id: `v2ex:${item.surface}`,
        moduleId: "v2ex",
        title: item.title,
        subtitle: "V2EX · command",
        icon: "builtin:v2ex",
        score: Math.min(score, 72),
        launch: { tab: "v2ex", surface: item.surface },
      }));
    }
  }
  return hits;
}

/**
 * Aggregate dynamic surfaces for the main launcher search.
 * Providers run in parallel via Promise.all; each uses async invoke where needed.
 * Never call this in a way that delays `search_apps` — App loads it off the fast path.
 */
export async function searchModuleSurfaces(query: string): Promise<ModuleSurfaceHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  if (!useSettingsStore.getState().settings.module_search?.enabled) return [];

  // Parallel IPC: one slow module must not serialize the others.
  const results = await Promise.all([
    searchRssSurfaces(q),
    searchClipboardSurfaces(q),
    Promise.resolve(searchQxAiSurfaces(q)),
    searchMacroSurfaces(q),
    searchScreencapSurfaces(q),
    Promise.resolve(searchDocumentsSurfaces(q)),
    Promise.resolve(searchWeatherSurfaces(q)),
    Promise.resolve(searchV2exSurfaces(q)),
    Promise.resolve(searchQxTtySurfaces(q)),
  ]);

  return results
    .flat()
    .filter((h) => isModuleSearchEnabled(h.moduleId))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 16);
}

export { MODULE_SEARCH_MODULE_IDS };

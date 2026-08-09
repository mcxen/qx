import { usePluginRegistry } from "./registry";
import type { RegisteredCommand, RegisteredPanel, PluginContext, InstalledPlugin, PluginPreference } from "./types";
import { isBuiltinModuleEnabled } from "../modules/moduleAvailability";

// ---------------------------------------------------------------------------
// Builtin module definitions
// ---------------------------------------------------------------------------

/**
 * Optional launcher command beyond the panel itself.
 * Built-ins that only open their panel must leave `commands` empty — the panel
 * entry is already searchable. Module Surfaces carry real deep-link actions
 * (screenshot, new chat, OPML import, …).
 */
interface BuiltinCommandDef {
  name: string;
  title: string;
  keywords: string[];
}

interface BuiltinInfo {
  id: string;
  name: string;
  keywords: string[];
  /** Extra commands only — never a redundant "open this panel" entry. */
  commands: BuiltinCommandDef[];
  panel?: { title: string; keywords: string[] };
  description?: string;
  version?: string;
  author?: string;
  preferences?: PluginPreference[];
  /** Key in the global Settings store for preference values (e.g. "v2ex"). */
  settingsKey?: string;
}

const BUILTIN_MODULES: BuiltinInfo[] = [
  {
    id: "clipboard",
    name: "Clipboard",
    keywords: ["clipboard", "paste", "copy", "history", "剪贴板", "剪切板", "粘贴", "复制", "历史"],
    commands: [],
    panel: {
      title: "Clipboard History",
      keywords: ["clipboard", "paste", "history", "剪贴板", "粘贴"],
    },
    description: "Clipboard history manager",
  },
  {
    id: "qx-ai",
    name: "QxAI",
    keywords: ["ai", "chat", "gpt", "qxai", "qx ai", "llm", "agent", "人工智能", "聊天", "助手", "智能体"],
    commands: [],
    panel: {
      title: "QxAI Chat",
      keywords: ["ai", "chat", "gpt", "qxai", "llm", "人工智能", "聊天"],
    },
    description: "AI chat assistant",
  },
  {
    id: "screencap",
    name: "Screenshot & Recording Module",
    keywords: ["screenshot", "screen capture", "gif", "screencap", "screen record", "recording", "截图", "截屏", "录屏", "屏幕录制"],
    commands: [],
    panel: {
      title: "Screenshot & Recording Module",
      keywords: ["screenshot", "gif", "screencap", "screen record", "截图", "录屏"],
    },
    description: "Screenshots and MP4/MOV recording with optional GIF conversion",
    settingsKey: "screencap",
    preferences: [
      {
        id: "output_format",
        label: "Recording format",
        type: "select",
        default: "mp4",
        options: [{ value: "mp4", label: "MP4" }, { value: "mov", label: "MOV" }],
      },
      {
        id: "fps",
        label: "Frame rate",
        type: "select",
        default: "24",
        options: [{ value: "15", label: "15 fps" }, { value: "24", label: "24 fps" }, { value: "30", label: "30 fps" }],
      },
      {
        id: "quality",
        label: "Quality",
        type: "select",
        default: "balanced",
        options: [
          { value: "compact", label: "Compact" },
          { value: "balanced", label: "Balanced" },
          { value: "high", label: "High" },
        ],
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        default: "1080p",
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
          { value: "native", label: "Native (up to 4K)" },
        ],
      },
      {
        id: "capture_delay_seconds",
        label: "Capture delay",
        type: "select",
        default: "0",
        options: [{ value: "0", label: "None" }, { value: "5", label: "5s" }, { value: "10", label: "10s" }],
      },
      {
        id: "capture_confirm_mode",
        label: "Recording selection confirm",
        type: "select",
        default: "refine",
        options: [
          { value: "refine", label: "Refine then capture" },
          { value: "release", label: "Capture on release" },
        ],
      },
      { id: "auto_hide_after_capture", label: "Hide capture toolbar after capture", type: "boolean", default: true },
      {
        id: "show_main_after_screenshot",
        label: "Show Qx main window after screenshot",
        type: "boolean",
        default: true,
      },
      { id: "auto_copy_to_clipboard", label: "Copy screenshots and recordings to clipboard", type: "boolean", default: true },
      { id: "controls_pinned", label: "Keep capture toolbar visible", type: "boolean", default: false },
      { id: "screenshot_sound_enabled", label: "Play screenshot sound", type: "boolean", default: true },
      { id: "show_floating_thumbnail", label: "Show floating thumbnail", type: "boolean", default: true },
      { id: "remember_last_selection", label: "Remember last selection", type: "boolean", default: true },
      { id: "screenshot_include_cursor", label: "Show pointer in screenshots", type: "boolean", default: false },
      { id: "recording_include_cursor", label: "Show pointer in recordings", type: "boolean", default: true },
      { id: "recording_show_mouse_clicks", label: "Show mouse clicks in recordings", type: "boolean", default: false },
    ],
  },
  {
    id: "rss",
    name: "RSS Reader",
    keywords: ["rss", "reader", "feeds", "feed", "articles", "atom", "订阅", "阅读器", "文章", "资讯"],
    commands: [],
    panel: {
      title: "RSS Reader",
      keywords: ["rss", "feeds", "feed", "articles", "订阅"],
    },
    description: "RSS/Atom feed reader",
  },
  {
    id: "macros",
    name: "Macro Recorder",
    keywords: ["macro", "macros", "recording", "automation", "宏", "宏录制", "录制", "自动化"],
    commands: [],
    panel: {
      title: "Macro Recorder",
      keywords: ["macro", "macros", "recording", "宏", "录制"],
    },
    description: "Keyboard macro recorder",
    settingsKey: "macros",
    preferences: [
      {
        id: "stop_tail_seconds",
        label: "Discard tail when stopping",
        type: "select",
        default: "2",
        description: "Do not keep the final seconds used to reach the floating Stop control.",
        options: [
          { value: "0", label: "Keep everything" },
          { value: "1", label: "1 second" },
          { value: "2", label: "2 seconds (recommended)" },
          { value: "3", label: "3 seconds" },
          { value: "5", label: "5 seconds" },
        ],
      },
    ],
  },
  {
    id: "documents",
    name: "Documents",
    keywords: ["document", "documents", "doc", "markdown", "json", "text", "toolbox", "word count", "文档", "字数", "文本", "文本工具箱", "工具箱"],
    commands: [],
    panel: {
      title: "Document Tools",
      keywords: ["document", "documents", "doc", "markdown", "json", "word count", "文档", "字数", "文本"],
    },
    description: "Disk-backed text toolbox",
  },
  {
    id: "qx-tty",
    name: "QxTTY",
    keywords: ["terminal", "tty", "shell", "command line", "command", "console", "终端", "命令行", "命令", "控制台"],
    commands: [],
    panel: {
      title: "QxTTY",
      keywords: ["terminal", "tty", "shell", "command line", "终端", "命令行"],
    },
    description: "Persistent local terminal sessions",
  },
  {
    id: "weather",
    name: "Weather",
    keywords: ["weather", "forecast", "temperature", "climate", "天气", "气温", "温度", "预报", "天气预报"],
    commands: [],
    panel: {
      title: "Weather",
      keywords: ["weather", "forecast", "temperature", "天气", "气温", "预报"],
    },
    description: "Weather forecast and current conditions",
    preferences: [
      {
        id: "provider",
        label: "Provider",
        type: "string",
        required: false,
        default: "open-meteo",
        description: "Weather data provider: Open-Meteo (free) or OpenWeatherMap.",
      },
      {
        id: "api_key",
        label: "OpenWeatherMap API Key",
        type: "password",
        required: false,
        description: "Optional. Get one at openweathermap.org. Without it, Open-Meteo is used.",
      },
    ],
    settingsKey: "weather",
  },
];

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/** Flat list of all built-in module IDs. */
export const BUILTIN_IDS: string[] = BUILTIN_MODULES.map((m) => m.id);

/** Synthetic InstalledPlugin entries for built-in modules, for display in PluginManager. */
export const BUILTIN_PLUGINS: InstalledPlugin[] = BUILTIN_MODULES.map((mod) => ({
  id: `builtin:${mod.id}`,
  name: mod.name,
  version: mod.version ?? "built-in",
  description: mod.description ?? "",
  path: "",
  enabled: true,
  permissions: [],
  author: mod.author ?? "Qx",
  manifest: {
    id: `builtin:${mod.id}`,
    name: mod.name,
    version: mod.version ?? "0.0.0",
    description: mod.description ?? "",
    author: mod.author ?? "Qx",
    icon: "",
    keywords: mod.keywords,
    permissions: [],
    preferences: mod.preferences ?? [],
    commands: mod.commands.map((c) => ({
      name: c.name,
      title: c.title,
      keywords: c.keywords,
    })),
    panel: mod.panel
      ? { title: mod.panel.title, keywords: mod.panel.keywords }
      : undefined,
    dependencies: [],
    minAppVersion: "",
    entry: "index.js",
    signature: "",
    pubkey: "",
    settingsKey: mod.settingsKey,
  } as InstalledPlugin["manifest"] & { settingsKey?: string },
}));

/** Map of built-in plugin id → global settings key for preference storage. */
export const BUILTIN_SETTINGS_KEYS: Record<string, string> = Object.fromEntries(
  BUILTIN_MODULES.filter((m) => m.settingsKey).map((m) => [
    `builtin:${m.id}`,
    m.settingsKey!,
  ]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dispatch the navigation custom event that the shell listens for. */
function navigateToTab(tabId: string): void {
  if (!isBuiltinModuleEnabled(tabId)) return;
  window.dispatchEvent(
    new CustomEvent("qx:navigate", { detail: tabId }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register every built-in module's commands and panels into the plugin
 * registry store.  Call this once during application startup, *after* the
 * registry store has been created (which happens at module-import time thanks
 * to zustand's `create`).
 */
export function registerAllBuiltins(): void {
  const commands: RegisteredCommand[] = [];
  const panels: Record<string, RegisteredPanel> = {};

  for (const mod of BUILTIN_MODULES) {
    const pluginId = `builtin:${mod.id}`;
    const pluginName = mod.name;

    // --- Commands -----------------------------------------------------------
    for (const cmd of mod.commands) {
      const entry: RegisteredCommand = {
        pluginId,
        pluginName,
        name: cmd.name,
        title: cmd.title,
        keywords: [...mod.keywords, ...cmd.keywords],
        description: `Built-in: ${cmd.title}`,
        run: async (_ctx: PluginContext) => {
          navigateToTab(mod.id);
        },
      };
      commands.push(entry);
    }

    // --- Panel --------------------------------------------------------------
    if (mod.panel) {
      panels[pluginId] = {
        pluginId,
        pluginName,
        title: mod.panel.title,
        keywords: [...mod.keywords, ...mod.panel.keywords],
        render: async () => {}, // Built-in panels render via React in App.tsx
        destroy: async () => {},
      };
    }
  }

  // Merge into the existing zustand store while replacing prior built-ins.
  // This keeps HMR and repeated startup paths from duplicating command keys.
  usePluginRegistry.setState((state) => ({
    commands: [
      ...state.commands.filter((command) => !command.pluginId.startsWith("builtin:")),
      ...commands,
    ],
    panels: { ...state.panels, ...panels },
  }));
}

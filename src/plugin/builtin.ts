import { usePluginRegistry } from "./registry";
import type { RegisteredCommand, RegisteredPanel, PluginContext, InstalledPlugin, PluginPreference } from "./types";

// ---------------------------------------------------------------------------
// Builtin module definitions
// ---------------------------------------------------------------------------

interface BuiltinCommandDef {
  name: string;
  title: string;
  keywords: string[];
}

interface BuiltinInfo {
  id: string;
  name: string;
  keywords: string[];
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
    keywords: ["clipboard", "paste", "history", "剪贴板", "粘贴"],
    commands: [
      {
        name: "open-clipboard",
        title: "Open Clipboard History",
        keywords: ["clipboard", "paste", "history", "剪贴板", "粘贴", "open"],
      },
    ],
    panel: {
      title: "Clipboard History",
      keywords: ["clipboard", "paste", "history", "剪贴板", "粘贴"],
    },
    description: "Clipboard history manager",
  },
  {
    id: "qx-ai",
    name: "QxAI",
    keywords: ["ai", "chat", "gpt", "qxai", "llm", "人工智能", "聊天"],
    commands: [
      {
        name: "open-qxai",
        title: "Open QxAI Chat",
        keywords: ["ai", "chat", "gpt", "qxai", "llm", "人工智能", "聊天", "open"],
      },
    ],
    panel: {
      title: "QxAI Chat",
      keywords: ["ai", "chat", "gpt", "qxai", "llm", "人工智能", "聊天"],
    },
    description: "AI chat assistant",
  },
  {
    id: "screencap",
    name: "Screen Recording",
    keywords: ["gif", "screencap", "screen record", "录屏"],
    commands: [
      {
        name: "open-screencap",
        title: "Open Screen Recording",
        keywords: ["gif", "screencap", "screen record", "录屏", "open"],
      },
    ],
    panel: {
      title: "Screen Recording",
      keywords: ["gif", "screencap", "screen record", "录屏"],
    },
    description: "Screen recording and GIF capture",
  },
  {
    id: "rss",
    name: "RSS Reader",
    keywords: ["rss", "feeds", "feed", "articles", "订阅"],
    commands: [
      {
        name: "open-rss",
        title: "Open RSS Reader",
        keywords: ["rss", "feeds", "feed", "articles", "订阅", "open"],
      },
    ],
    panel: {
      title: "RSS Reader",
      keywords: ["rss", "feeds", "feed", "articles", "订阅"],
    },
    description: "RSS/Atom feed reader",
  },
  {
    id: "v2ex",
    name: "V2EX",
    keywords: ["v2ex", "topics", "forum", "社区", "帖子", "热门"],
    commands: [
      {
        name: "open-v2ex",
        title: "Open V2EX",
        keywords: ["v2ex", "topics", "forum", "社区", "帖子", "热门", "open"],
      },
    ],
    panel: {
      title: "V2EX",
      keywords: ["v2ex", "topics", "forum", "社区", "帖子", "热门"],
    },
    description: "V2EX forum viewer",
    preferences: [
      {
        id: "token",
        label: "Access Token",
        type: "password",
        required: false,
        description: "Required for API v2 features (notifications, node topics, replies). Go to v2ex.com/settings/tokens to create one.",
      },
      {
        id: "nodes",
        label: "Nodes",
        type: "string",
        required: false,
        default: "programmer create share ideas apple jobs qna",
        description: "Node names for the 'Topics By Node' view, separated by spaces.",
      },
    ],
    settingsKey: "v2ex",
  },
  {
    id: "macros",
    name: "Macro Recorder",
    keywords: ["macro", "macros", "recording", "宏", "录制"],
    commands: [
      {
        name: "open-macros",
        title: "Open Macro Recorder",
        keywords: ["macro", "macros", "recording", "宏", "录制", "open"],
      },
    ],
    panel: {
      title: "Macro Recorder",
      keywords: ["macro", "macros", "recording", "宏", "录制"],
    },
    description: "Keyboard macro recorder",
  },
  {
    id: "documents",
    name: "Documents",
    keywords: ["document", "documents", "doc", "markdown", "json", "word count", "文档", "字数", "文本"],
    commands: [
      {
        name: "open-documents",
        title: "Open Document Tools",
        keywords: ["document", "documents", "doc", "markdown", "json", "word count", "文档", "字数", "文本", "open"],
      },
    ],
    panel: {
      title: "Document Tools",
      keywords: ["document", "documents", "doc", "markdown", "json", "word count", "文档", "字数", "文本"],
    },
    description: "Document and text tools",
  },
  {
    id: "weather",
    name: "Weather",
    keywords: ["weather", "forecast", "temperature", "天气", "气温", "预报"],
    commands: [
      {
        name: "open-weather",
        title: "Open Weather",
        keywords: ["weather", "forecast", "temperature", "天气", "气温", "预报", "open"],
      },
    ],
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

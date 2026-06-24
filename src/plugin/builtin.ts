import { usePluginRegistry } from "./registry";
import type { RegisteredCommand, RegisteredPanel, PluginContext } from "./types";

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
  },
  {
    id: "screenshot",
    name: "Screenshot",
    keywords: ["screenshot", "capture", "screen", "截图", "截屏"],
    commands: [
      {
        name: "open-screenshot",
        title: "Open Screenshot",
        keywords: ["screenshot", "capture", "screen", "截图", "截屏", "open"],
      },
    ],
    panel: {
      title: "Screenshot",
      keywords: ["screenshot", "capture", "screen", "截图", "截屏"],
    },
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
  },
];

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/** Flat list of all built-in module IDs. */
export const BUILTIN_IDS: string[] = BUILTIN_MODULES.map((m) => m.id);

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

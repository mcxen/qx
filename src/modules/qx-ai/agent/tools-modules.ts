/**
 * Module- and host-system tools exposed to the agent when the corresponding
 * capability is enabled (module switch / OCR switch / system tools switch).
 */
import { invoke } from "@tauri-apps/api/core";
import {
  asRecord,
  numberField,
  stringField,
  truncate,
  type ToolSpec,
} from "./types";

const systemOn = (s: { qx_system_tools_enabled: boolean }) => s.qx_system_tools_enabled;
const hostOn = (s: { qx_host_actions_enabled: boolean }) => s.qx_host_actions_enabled;

export const MODULE_SYSTEM_TOOLS: ToolSpec[] = [
  {
    name: "qx_storage_info",
    description: "Disk storage summary (total / used / free) from the Qx system information service.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: systemOn,
    run: async () => {
      const info = await invoke("qx_system_information_check_storage");
      return truncate(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "qx_network_info",
    description: "Network interfaces and IP addresses from the Qx system information service.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: systemOn,
    run: async () => {
      const info = await invoke("qx_system_information_check_network");
      return truncate(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "qx_network_counters",
    description: "Per-interface byte counters (in/out) from the Qx network monitor.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: systemOn,
    run: async () => {
      const info = await invoke("qx_system_monitor_network_counters");
      return truncate(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "qx_power",
    description: "Battery / power status (charging, percent, source) from the Qx power monitor.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: systemOn,
    run: async () => {
      const info = await invoke("qx_system_monitor_power");
      return truncate(JSON.stringify(info, null, 2));
    },
  },
  {
    name: "qx_display_brightness",
    description:
      "List brightness-controllable displays (current/max/backend). Read-only; use qx_set_display_brightness to change.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: systemOn,
    run: async () => {
      const list = await invoke("display_brightness_list");
      return truncate(JSON.stringify(list, null, 2));
    },
  },
  {
    name: "qx_set_display_brightness",
    description:
      "Set display brightness (0–100 style value as accepted by the host). Requires a display id from qx_display_brightness. Visible side effect.",
    inputHint: '{"displayId": "<id from qx_display_brightness>", "value": 50}',
    parameters: {
      type: "object",
      properties: {
        displayId: { type: "string" },
        value: { type: "number", description: "Brightness 0–100 (clamped by host)" },
      },
      required: ["displayId", "value"],
    },
    isEnabled: systemOn,
    run: async (input) => {
      const rec = asRecord(input);
      const displayId = stringField(rec, "displayId") || stringField(rec, "display_id");
      const value = numberField(rec, "value", -1);
      if (!displayId.trim()) return "Error: displayId is required.";
      if (value < 0) return "Error: value is required (0–100).";
      await invoke("display_brightness_set", {
        displayId: displayId.trim(),
        value: Math.max(0, Math.min(100, Math.round(value))),
      });
      return `Set brightness of ${displayId} to ${Math.round(value)}.`;
    },
  },
  {
    name: "qx_previous_app",
    description:
      "Name of the frontmost app before Qx was summoned (useful for paste/context). Empty if unknown.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: hostOn,
    run: async () => {
      try {
        const name = await invoke<string | null>("floating_previous_app_name");
        return name?.trim() ? name : "(unknown previous app)";
      } catch {
        return "(previous app unavailable)";
      }
    },
  },
];

export const MODULE_OCR_TOOLS: ToolSpec[] = [
  {
    name: "ocr_status",
    description: "OCR engine status (enabled, downloaded models, platform backends).",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    isEnabled: hostOn,
    isAvailable: (settings) => settings.advanced.ocr_enabled,
    run: async () => {
      const status = await invoke("ocr_status");
      return truncate(JSON.stringify(status, null, 2));
    },
  },
  {
    name: "ocr_recognize_path",
    description: "Run OCR on a local image file path. Returns recognized text.",
    inputHint: '{"path": "/path/to/image.png"}',
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    isEnabled: hostOn,
    isAvailable: (settings) => settings.advanced.ocr_enabled,
    run: async (input) => {
      const path = stringField(asRecord(input), "path").trim();
      if (!path) return "Error: path is required.";
      const result = await invoke("ocr_recognize_path", { path });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "ocr_list_history",
    description: "List recent OCR history entries (id, text snippet, source).",
    inputHint: '{"limit": 20}',
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    isEnabled: hostOn,
    isAvailable: (settings) => settings.advanced.ocr_enabled,
    run: async (input) => {
      const limit = numberField(asRecord(input), "limit", 20);
      const rows = await invoke("ocr_list_history", { limit });
      return truncate(JSON.stringify(rows, null, 2));
    },
  },
];

export const MODULE_DOCUMENTS_TOOLS: ToolSpec[] = [
  {
    name: "docs_workspace",
    description: "Path of the Text Toolbox (documents) workspace directory.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["documents"],
    isEnabled: hostOn,
    run: async () => invoke<string>("docs_workspace_path"),
  },
  {
    name: "docs_list",
    description: "List text files in the Text Toolbox workspace (name, language, size, updated).",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["documents"],
    isEnabled: hostOn,
    run: async () => {
      const files = await invoke("docs_list_files");
      return truncate(JSON.stringify(files, null, 2));
    },
  },
  {
    name: "docs_read",
    description: "Read a file from the Text Toolbox workspace by file name.",
    inputHint: '{"name": "notes.md"}',
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    requiresModules: ["documents"],
    isEnabled: hostOn,
    run: async (input) => {
      const name = stringField(asRecord(input), "name").trim();
      if (!name) return "Error: name is required.";
      const content = await invoke<string>("docs_read_file", { name });
      return truncate(content, 12_000);
    },
  },
  {
    name: "docs_write",
    description:
      "Create or overwrite a file in the Text Toolbox workspace. Prefer when the user wants a durable note inside Qx docs.",
    inputHint: '{"name": "daily.md", "content": "# Hello"}',
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        content: { type: "string" },
      },
      required: ["name", "content"],
    },
    requiresModules: ["documents"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const name = stringField(rec, "name").trim();
      const content = stringField(rec, "content");
      if (!name) return "Error: name is required.";
      const entry = await invoke("docs_write_file", { name, content });
      return truncate(JSON.stringify(entry, null, 2));
    },
  },
  {
    name: "docs_inspect",
    description: "Inspect text metrics (chars, lines, language hints) without writing a file.",
    inputHint: '{"content": "...", "language": "markdown"}',
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        language: { type: "string" },
      },
      required: ["content"],
    },
    requiresModules: ["documents"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const content = stringField(rec, "content");
      const language = stringField(rec, "language") || "plain";
      const result = await invoke("docs_inspect_text", { content, language });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
];

export const MODULE_RSS_TOOLS: ToolSpec[] = [
  {
    name: "rss_dashboard",
    description: "RSS dashboard snapshot: unread counts and latest articles across feeds.",
    inputHint: '{"limit": 8}',
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const limit = numberField(asRecord(input), "limit", 8);
      const snap = await invoke("rss_dashboard_snapshot", { limit });
      return truncate(JSON.stringify(snap, null, 2));
    },
  },
  {
    name: "rss_list_feeds",
    description: "List subscribed RSS/Atom feeds (id, title, url, unread).",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async () => {
      const feeds = await invoke("rss_list_feeds");
      return truncate(JSON.stringify(feeds, null, 2));
    },
  },
  {
    name: "rss_list_articles",
    description: "List articles, optionally filtered by feedId, onlyUnread, or query.",
    inputHint: '{"feedId": 1, "onlyUnread": true, "query": "rust"}',
    parameters: {
      type: "object",
      properties: {
        feedId: { type: "number" },
        onlyUnread: { type: "boolean" },
        query: { type: "string" },
      },
    },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const feedId =
        typeof rec.feedId === "number"
          ? rec.feedId
          : typeof rec.feed_id === "number"
            ? rec.feed_id
            : null;
      const onlyUnread = rec.onlyUnread === true || rec.only_unread === true;
      const query = stringField(rec, "query").trim() || null;
      const articles = await invoke("rss_list_articles", {
        feedId,
        onlyUnread,
        query,
      });
      return truncate(JSON.stringify(articles, null, 2));
    },
  },
  {
    name: "rss_get_article",
    description: "Get one RSS article by id (title, body, link, read state).",
    inputHint: '{"id": 42}',
    parameters: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const id = numberField(asRecord(input), "id", 0);
      if (!id) return "Error: id is required.";
      const article = await invoke("rss_get_article", { id });
      return truncate(JSON.stringify(article, null, 2), 16_000);
    },
  },
  {
    name: "rss_mark_read",
    description: "Mark an RSS article read or unread.",
    inputHint: '{"id": 42, "isRead": true}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "number" },
        isRead: { type: "boolean" },
      },
      required: ["id"],
    },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const id = numberField(rec, "id", 0);
      if (!id) return "Error: id is required.";
      const isRead = rec.isRead !== false && rec.is_read !== false;
      await invoke("rss_mark_read", { id, isRead });
      return `Article ${id} marked ${isRead ? "read" : "unread"}.`;
    },
  },
  {
    name: "rss_refresh_feed",
    description: "Refresh one RSS feed by id (network).",
    inputHint: '{"id": 1}',
    parameters: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const id = numberField(asRecord(input), "id", 0);
      if (!id) return "Error: id is required.";
      const result = await invoke("rss_refresh_feed", { id });
      return truncate(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "rss_refresh_all",
    description:
      "Refresh all subscribed RSS/Atom feeds over the network. Prefer when the user asks to refresh subscriptions or pull the latest articles.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["rss"],
    isEnabled: hostOn,
    run: async () => {
      const count = await invoke<number>("rss_refresh_all");
      return `Refreshed all RSS feeds (updated ${count} article rows).`;
    },
  },
];

export const MODULE_WEATHER_TOOLS: ToolSpec[] = [
  {
    name: "weather_current",
    description: "Fetch current weather for the user's default/configured location.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["weather"],
    isEnabled: hostOn,
    run: async () => {
      const data = await invoke("fetch_weather");
      return truncate(JSON.stringify(data, null, 2));
    },
  },
  {
    name: "weather_for_location",
    description: "Fetch weather for a place name or query string.",
    inputHint: '{"location": "Shanghai"}',
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
    requiresModules: ["weather"],
    isEnabled: hostOn,
    run: async (input) => {
      const location = stringField(asRecord(input), "location").trim();
      if (!location) return "Error: location is required.";
      const data = await invoke("fetch_weather_for_location", { location });
      return truncate(JSON.stringify(data, null, 2));
    },
  },
  {
    name: "weather_detect_location",
    description: "Detect approximate geo location used by the weather service.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["weather"],
    isEnabled: hostOn,
    run: async () => {
      const loc = await invoke("detect_location");
      return truncate(JSON.stringify(loc, null, 2));
    },
  },
];

export const MODULE_SCREENCAP_TOOLS: ToolSpec[] = [
  {
    name: "screencap_history",
    description: "List recent screenshot/recording history from the Screencap module.",
    inputHint: '{"limit": 20}',
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    requiresModules: ["screencap"],
    isEnabled: hostOn,
    run: async (input) => {
      const limit = numberField(asRecord(input), "limit", 20);
      const rows = await invoke("get_screencap_history", { limit });
      return truncate(JSON.stringify(rows, null, 2));
    },
  },
  {
    name: "screencap_recapture",
    description:
      "Re-capture the last screenshot region (no picker UI). Requires a prior region capture in this session/settings.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["screencap"],
    isEnabled: hostOn,
    run: async () => {
      const result = await invoke("screencap_recapture_last_region");
      return truncate(JSON.stringify(result ?? { ok: true }, null, 2));
    },
  },
];

export const MODULE_CLIPBOARD_EXTRA_TOOLS: ToolSpec[] = [
  {
    name: "clipboard_get_entry",
    description: "Get one clipboard history entry by id (text, paths, image path, OCR).",
    inputHint: '{"id": "…"}',
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    requiresModules: ["clipboard"],
    isEnabled: hostOn,
    run: async (input) => {
      const id = stringField(asRecord(input), "id").trim();
      if (!id) return "Error: id is required.";
      const entry = await invoke("get_clipboard_entry", { id });
      return truncate(JSON.stringify(entry, null, 2));
    },
  },
];

export const MODULE_PZAI_TOOLS: ToolSpec[] = [
  {
    name: "pzai_get_workbench",
    description:
      "Get P仔 workbench state: current article, summary, draft, notes, displayMode, tags. Call before editing.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["p-zai"],
    isEnabled: hostOn,
    run: async () => {
      const { usePzaiStore } = await import("../../p-zai/store");
      return truncate(JSON.stringify(usePzaiStore.getState().getWorkbenchSnapshot(), null, 2), 12_000);
    },
  },
  {
    name: "pzai_open_article",
    description: "Open an RSS article into P仔 workbench by article id (loads body into original/draft).",
    inputHint: '{"id": 42}',
    parameters: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    requiresModules: ["p-zai", "rss"],
    isEnabled: hostOn,
    run: async (input) => {
      const id = numberField(asRecord(input), "id", 0);
      if (!id) return "Error: id is required.";
      const { usePzaiStore } = await import("../../p-zai/store");
      await usePzaiStore.getState().openArticle(id);
      return truncate(JSON.stringify(usePzaiStore.getState().getWorkbenchSnapshot(), null, 2), 8000);
    },
  },
  {
    name: "pzai_set_summary",
    description: "Write the article summary shown in P仔 Context and workbench summary pane.",
    inputHint: '{"summary": "…", "displayMode": "summary"}',
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        displayMode: { type: "string", description: "optional original|summary|draft|split" },
      },
      required: ["summary"],
    },
    requiresModules: ["p-zai"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const summary = stringField(rec, "summary");
      const { usePzaiStore } = await import("../../p-zai/store");
      const store = usePzaiStore.getState();
      store.setSummary(summary);
      const mode = stringField(rec, "displayMode") || stringField(rec, "display_mode");
      if (mode) store.setDisplayMode(mode as "original" | "summary" | "draft" | "split");
      return "Summary updated on workbench.";
    },
  },
  {
    name: "pzai_set_draft",
    description: "Replace the editable draft body in P仔 workbench (rewrites / polished article).",
    inputHint: '{"draft": "…", "displayMode": "draft"}',
    parameters: {
      type: "object",
      properties: {
        draft: { type: "string" },
        displayMode: { type: "string" },
      },
      required: ["draft"],
    },
    requiresModules: ["p-zai"],
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const draft = stringField(rec, "draft");
      const { usePzaiStore } = await import("../../p-zai/store");
      const store = usePzaiStore.getState();
      store.setDraft(draft);
      const mode = stringField(rec, "displayMode") || stringField(rec, "display_mode") || "draft";
      store.setDisplayMode(mode as "original" | "summary" | "draft" | "split");
      return "Draft updated on workbench.";
    },
  },
  {
    name: "pzai_set_display_mode",
    description: "Change P仔 workbench display mode: original | summary | draft | split.",
    inputHint: '{"mode": "split"}',
    parameters: {
      type: "object",
      properties: { mode: { type: "string" } },
      required: ["mode"],
    },
    requiresModules: ["p-zai"],
    isEnabled: hostOn,
    run: async (input) => {
      const mode = stringField(asRecord(input), "mode").trim();
      if (!["original", "summary", "draft", "split"].includes(mode)) {
        return "Error: mode must be original|summary|draft|split.";
      }
      const { usePzaiStore } = await import("../../p-zai/store");
      usePzaiStore.getState().setDisplayMode(mode as "original" | "summary" | "draft" | "split");
      return `Display mode set to ${mode}.`;
    },
  },
  {
    name: "pzai_set_notes",
    description: "Update P仔 context notes for the current article.",
    inputHint: '{"notes": "…"}',
    parameters: {
      type: "object",
      properties: { notes: { type: "string" } },
      required: ["notes"],
    },
    requiresModules: ["p-zai"],
    isEnabled: hostOn,
    run: async (input) => {
      const notes = stringField(asRecord(input), "notes");
      const { usePzaiStore } = await import("../../p-zai/store");
      usePzaiStore.getState().setNotes(notes);
      return "Notes updated.";
    },
  },
  {
    name: "pzai_save_docs",
    description: "Save current summary+draft+notes as Markdown into the Text Toolbox workspace.",
    inputHint: "{}",
    parameters: { type: "object", properties: {} },
    requiresModules: ["p-zai", "documents"],
    isEnabled: hostOn,
    run: async () => {
      const { usePzaiStore } = await import("../../p-zai/store");
      const name = await usePzaiStore.getState().saveDraftToDocs();
      return `Saved to Text Toolbox as ${name}.`;
    },
  },
];

export const ALL_MODULE_TOOLS: ToolSpec[] = [
  ...MODULE_SYSTEM_TOOLS,
  ...MODULE_OCR_TOOLS,
  ...MODULE_DOCUMENTS_TOOLS,
  ...MODULE_RSS_TOOLS,
  ...MODULE_WEATHER_TOOLS,
  ...MODULE_SCREENCAP_TOOLS,
  ...MODULE_CLIPBOARD_EXTRA_TOOLS,
  ...MODULE_PZAI_TOOLS,
];

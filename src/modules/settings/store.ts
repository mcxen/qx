import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  CONFIGURABLE_BUILTIN_MODULE_IDS,
  type ConfigurableBuiltinModuleId,
} from "../catalog";
import {
  DEFAULT_FILE_SEARCH_CATEGORIES,
  normalizeFileSearchCategories,
} from "../../search/fileCategories";

let saveSeq = 0;
let saveInFlight = false;
let saveQueued = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveIdleWaiters: Array<() => void> = [];
const SAVE_DEBOUNCE_MS = 350;

function notifySaveIdle() {
  if (saveInFlight || saveQueued || saveTimer) return;
  const waiters = saveIdleWaiters;
  saveIdleWaiters = [];
  waiters.forEach((resolve) => resolve());
}

function waitForSaveIdle(): Promise<void> {
  if (!saveInFlight && !saveQueued && !saveTimer) return Promise.resolve();
  return new Promise((resolve) => {
    saveIdleWaiters.push(resolve);
  });
}

function cancelScheduledSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveQueued = false;
  notifySaveIdle();
}

export interface GeneralSettings {
  launch_at_login: boolean;
  language: string;
  auto_update: boolean;
  autoHideOnBlur: boolean;
  data_path: string;
  has_shown_launcher: boolean;
  /** macOS first-launch permission wizard finished (or non-macOS auto-complete). */
  has_completed_onboarding: boolean;
}

export type LauncherResultDensity = "comfortable" | "compact";

export interface AppearanceSettings {
  theme: string;
  glass_enabled: boolean;
  blur_opacity: number;
  blur_radius: number;
  shell_region_opacity: number;
  surface_opacity: number;
  control_opacity: number;
  bottom_bar_opacity: number;
  window_width: number;
  window_height: number;
  border_radius: number;
  font_size: number;
  /**
   * Launcher result row density.
   * - `comfortable`: Spotlight-style two-line rows (default)
   * - `compact`: single-line dense rows
   */
  launcher_result_density: LauncherResultDensity;
  /** Home island mode id — see `src/home-island` registry (free string for extensibility). */
  home_island_mode: string;
  /** Multi-select set for idle home island rotation (empty → use home_island_mode). */
  home_island_modes: string[];
  /** Seconds between multi-mode rotation; 0 = no rotate. */
  home_island_rotate_secs: number;
  home_island_cpu: boolean;
  home_island_gpu: boolean;
  home_island_memory: boolean;
  /** Floating island webview (default off — dogfood). */
  island_float_enabled: boolean;
  /** Promote sticky task when main window hides. */
  island_float_when_main_hidden: boolean;
  island_float_always_on_top: boolean;
  /** Prefer docked when main is visible (no dual show). */
  island_prefer_docked_when_main_visible: boolean;
}

export interface ShortcutBinding {
  key: string;
  enabled: boolean;
}

export type NetworkProxyMode = "off" | "system" | "manual";

export interface AdvancedSettings {
  log_level: string;
  dev_mode: boolean;
  /** `"off"` | `"system"` | `"manual"`. Empty/missing: derived from legacy enabled flag. */
  network_proxy_mode: NetworkProxyMode | string;
  /** Legacy; kept in sync when mode changes. Prefer `network_proxy_mode`. */
  network_proxy_enabled: boolean;
  network_proxy_url: string;
  ocr_enabled: boolean;
  ocr_engine: string;
  ocr_model_size: string;
}

export interface AgentSettings {
  agent_mode_enabled: boolean;
  default_provider: string;
  default_model: string;
  model_tools_enabled: boolean;
  tools_enabled: boolean;
  memory_tool_enabled: boolean;
  app_search_enabled: boolean;
  file_search_enabled: boolean;
  http_fetch_enabled: boolean;
  notifications_enabled: boolean;
  mcp_enabled: boolean;
  bash_enabled: boolean;
  bash_timeout_ms: number;
  bash_cwd: string;
  grep_search_enabled: boolean;
  grep_command: "rg" | "grep";
  grep_root: string;
  grep_max_results: number;
  background_tasks_enabled: boolean;
  agent_max_iterations: number;
}

export interface RssSettings {
  offline_cache_enabled: boolean;
  max_articles_per_feed: number;
  bottom_island_mode: "scroll" | "index";
  image_display_mode: "fixed" | "full";
  image_fixed_width: number;
  article_font_size: number;
  article_font_family: string;
  show_feed_icons: boolean;
  retention_days: number;
}

export interface V2exSettings {
  token: string;
  nodes: string;
}

export interface WeatherSettings {
  provider: string;
  api_key: string;
  location_override: string;
  locations: string[];
  units: string;
}

export interface SearchMetadataEntry {
  aliases: string[];
  tags: string[];
  /** When true, app floats to the top of the empty launcher (Spotlight-style pin). */
  pinned?: boolean;
  /** Lower values appear first among pinned apps. */
  pin_order?: number;
  /**
   * When true, app is omitted from the empty home Suggestions list.
   * Still findable via search so the user can unhide from the context menu.
   */
  hidden?: boolean;
}

export interface QuickEntryConfig {
  id: string;
  title: string;
  subtitle: string;
  target: string;
  enabled: boolean;
}

export interface TrayActionConfig {
  id: string;
  title: string;
  enabled: boolean;
}

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  path: string;
}

export interface PluginDisplaySettings {
  raycast_action_panel: boolean;
}

export interface FileSearchCategory {
  id: string;
  label: string;
  /** Lowercase extensions without a leading dot. */
  extensions: string[];
  /** Match directory results instead of file extensions. */
  include_folders?: boolean;
  /** Final fallback for every file not claimed by an earlier category. */
  catch_all?: boolean;
}

export interface FileSearchSettings {
  categories: FileSearchCategory[];
}

/** Built-in module ids that can contribute to main launcher search. */
export type ModuleSearchModuleId =
  | "clipboard"
  | "qx-ai"
  | "rss"
  | "screencap"
  | "macros"
  | "documents"
  | "weather"
  | "v2ex"
  | "qx-tty";

export const MODULE_SEARCH_MODULE_IDS: ModuleSearchModuleId[] = [
  "clipboard",
  "qx-ai",
  "rss",
  "screencap",
  "macros",
  "documents",
  "weather",
  "v2ex",
  "qx-tty",
];

export const MODULE_SEARCH_LABELS: Record<ModuleSearchModuleId, { title: string; hint: string }> = {
  clipboard: { title: "Clipboard", hint: "History items and open command" },
  "qx-ai": { title: "QxAI", hint: "Conversations, new chat, settings" },
  rss: { title: "RSS Reader", hint: "Feeds, folders, open reader" },
  screencap: { title: "Screen Capture", hint: "Screenshots, MP4/MOV recording, and optional GIF conversion" },
  macros: { title: "Macro Recorder", hint: "Saved macros" },
  documents: { title: "Text Toolbox", hint: "Disk notepad · folder files" },
  weather: { title: "Weather", hint: "Locations and open weather" },
  v2ex: { title: "V2EX", hint: "Hot / Latest views" },
  "qx-tty": { title: "QxTTY", hint: "Persistent local terminal sessions" },
};

export interface ModuleSearchSettings {
  /** Master switch for all module search integration. */
  enabled: boolean;
  /** Missing keys default to enabled. */
  modules: Partial<Record<ModuleSearchModuleId, boolean>>;
}

export interface BuiltinModulesSettings {
  /** Missing keys default to enabled for backwards compatibility. */
  modules: Partial<Record<ConfigurableBuiltinModuleId, boolean>>;
}

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  shortcuts: Record<string, ShortcutBinding>;
  app_shortcuts: Record<string, ShortcutBinding>;
  plugins: PluginConfig[];
  plugin_display: PluginDisplaySettings;
  file_search: FileSearchSettings;
  advanced: AdvancedSettings;
  agent: AgentSettings;
  rss: RssSettings;
  v2ex: V2exSettings;
  weather: WeatherSettings;
  search_metadata: Record<string, SearchMetadataEntry>;
  module_search: ModuleSearchSettings;
  builtin_modules: BuiltinModulesSettings;
  quick_entries: QuickEntryConfig[];
  tray_actions: TrayActionConfig[];
}

export type SettingsTab =
  | "general"
  | "file-search"
  | "shortcuts"
  | "plugins"
  | "permissions"
  | "appearance"
  | "agent"
  | "rss"
  | "weather"
  | "advanced"
  | "ocr"
  | "about";

export const DEFAULT_SETTINGS: Settings = {
  general: {
    launch_at_login: false,
    language: "system",
    auto_update: true,
    autoHideOnBlur: true,
    data_path: "",
    has_shown_launcher: false,
    has_completed_onboarding: false,
  },
  appearance: {
    theme: "light",
    glass_enabled: true,
    blur_opacity: 0.16,
    blur_radius: 14,
    shell_region_opacity: 0.10,
    surface_opacity: 0.36,
    control_opacity: 0.68,
    bottom_bar_opacity: 0.08,
    window_width: 0,
    window_height: 0,
    border_radius: 8,
    font_size: 14,
    launcher_result_density: "comfortable",
    home_island_mode: "system",
    home_island_modes: ["system"],
    home_island_rotate_secs: 8,
    home_island_cpu: true,
    home_island_gpu: true,
    home_island_memory: true,
    island_float_enabled: false,
    island_float_when_main_hidden: true,
    island_float_always_on_top: true,
    island_prefer_docked_when_main_visible: true,
  },
  shortcuts: {
    // Swapped defaults: primary Alt+Space preserves current view; launcher recall is Alt+Shift+Space.
    toggle_launcher: { key: "Alt+Shift+Space", enabled: false },
    toggle_window: { key: "Alt+Space", enabled: true },
    clipboard: { key: "Alt+V", enabled: false },
    record_gif: { key: "Alt+G", enabled: false },
    capture_screenshot: { key: "Alt+Shift+S", enabled: false },
    toggle_capture_controls: { key: "Alt+Shift+C", enabled: false },
    rss: { key: "Alt+R", enabled: false },
  },
  app_shortcuts: {},
  plugins: [],
  plugin_display: {
    // Optional in-iframe action chips. Real actions always use QxShell (⌘K / bottom bar).
    raycast_action_panel: false,
  },
  file_search: {
    categories: DEFAULT_FILE_SEARCH_CATEGORIES,
  },
  advanced: {
    log_level: "info",
    dev_mode: false,
    network_proxy_mode: "off",
    network_proxy_enabled: false,
    network_proxy_url: "",
    ocr_enabled: false,
    ocr_engine: "apple-vision",
    ocr_model_size: "tiny",
  },
  agent: {
    agent_mode_enabled: false,
    default_provider: "openrouter",
    default_model: "openrouter/auto",
    model_tools_enabled: false,
    tools_enabled: false,
    memory_tool_enabled: true,
    app_search_enabled: true,
    file_search_enabled: true,
    http_fetch_enabled: false,
    notifications_enabled: true,
    mcp_enabled: false,
    bash_enabled: false,
    bash_timeout_ms: 30000,
    bash_cwd: "",
    grep_search_enabled: false,
    grep_command: "rg",
    grep_root: "",
    grep_max_results: 80,
    background_tasks_enabled: false,
    agent_max_iterations: 12,
  },
  rss: {
    offline_cache_enabled: true,
    max_articles_per_feed: 500,
    bottom_island_mode: "scroll",
    image_display_mode: "full",
    image_fixed_width: 320,
    article_font_size: 14,
    article_font_family: "system-ui",
    show_feed_icons: true,
    retention_days: 30,
  },
  v2ex: {
    token: "",
    nodes: "programmer create share ideas apple jobs qna",
  },
  weather: {
    provider: "open-meteo",
    api_key: "",
    location_override: "",
    locations: [],
    units: "celsius",
  },
  search_metadata: {},
  module_search: {
    enabled: true,
    modules: {
      clipboard: true,
      "qx-ai": true,
      rss: true,
      screencap: true,
      macros: true,
      documents: true,
      weather: true,
      v2ex: true,
      "qx-tty": true,
    },
  },
  builtin_modules: {
    modules: Object.fromEntries(
      CONFIGURABLE_BUILTIN_MODULE_IDS.map((id) => [id, true]),
    ) as Record<ConfigurableBuiltinModuleId, boolean>,
  },
  quick_entries: [
    { id: "clipboard", title: "Clipboard History", subtitle: "Pinned, frequent, links", target: "clipboard", enabled: true },
    { id: "rss", title: "RSS Reader", subtitle: "Feeds and articles", target: "rss", enabled: true },
    { id: "settings", title: "Settings", subtitle: "Appearance and plugins", target: "settings", enabled: true },
    { id: "file-search", title: "File Search", subtitle: "Find recent files and folders", target: "file-search", enabled: true },
  ],
  tray_actions: [
    { id: "status_memory", title: "Memory", enabled: true },
    { id: "status_network", title: "Network", enabled: true },
    { id: "status_cpu", title: "CPU", enabled: false },
    { id: "open_main", title: "Open Main Window", enabled: true },
    { id: "keep_visible", title: "Keep Window Visible", enabled: true },
    { id: "settings", title: "Settings", enabled: true },
    { id: "hide_main", title: "Hide Main Window", enabled: false },
  ],
};

interface SettingsStore {
  settings: Settings;
  activeTab: SettingsTab;
  loaded: boolean;
  setSettings: (s: Settings) => void;
  setActiveTab: (t: SettingsTab) => void;
  patch: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  patchShortcut: (id: string, binding: Partial<ShortcutBinding>) => void;
  patchAppShortcut: (id: string, binding: Partial<ShortcutBinding>) => void;
  patchSearchMetadata: (id: string, value: SearchMetadataEntry) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
  flush: () => Promise<void>;
  reset: () => Promise<void>;
  importFrom: (path: string) => Promise<void>;
  exportTo: (path: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  activeTab: "general",
  loaded: false,
  setSettings: (settings) => set({ settings }),
  setActiveTab: (activeTab) => set({ activeTab }),
  patch: (key, value) => {
    const next = { ...get().settings, [key]: value };
    set({ settings: next });
    void get().save();
  },
  patchShortcut: (id, binding) => {
    const cur = get().settings.shortcuts;
    const existing = cur[id] ?? { key: "", enabled: true };
    const next = { ...cur, [id]: { ...existing, ...binding } };
    const settings = { ...get().settings, shortcuts: next };
    set({ settings });
    void get().save();
  },
  patchAppShortcut: (id, binding) => {
    const cur = get().settings.app_shortcuts;
    const existing = cur[id] ?? { key: "", enabled: true };
    const nextBinding = { ...existing, ...binding };
    const next = { ...cur };
    if (!nextBinding.key.trim()) {
      delete next[id];
    } else {
      next[id] = nextBinding;
    }
    const settings = { ...get().settings, app_shortcuts: next };
    set({ settings });
    void get().save();
  },
  patchSearchMetadata: (id, value) => {
    const aliases = Array.from(new Set(value.aliases.map((item) => item.trim()).filter(Boolean)));
    const tags = Array.from(new Set(value.tags.map((item) => item.trim()).filter(Boolean)));
    const pinned = Boolean(value.pinned);
    const hidden = Boolean(value.hidden);
    const pin_order = pinned
      ? (typeof value.pin_order === "number" && Number.isFinite(value.pin_order)
        ? value.pin_order
        : Date.now())
      : undefined;
    const nextEntry: SearchMetadataEntry = {
      aliases,
      tags,
      ...(pinned ? { pinned: true, pin_order } : {}),
      ...(hidden ? { hidden: true } : {}),
    };
    const current = get().settings.search_metadata;
    const nextMetadata = { ...current };
    const isEmpty =
      nextEntry.aliases.length === 0
      && nextEntry.tags.length === 0
      && !nextEntry.pinned
      && !nextEntry.hidden;
    if (isEmpty) {
      delete nextMetadata[id];
    } else {
      nextMetadata[id] = nextEntry;
    }
    const settings = { ...get().settings, search_metadata: nextMetadata };
    set({ settings });
    void get().save();
  },
  load: async () => {
    try {
      const s = await invoke<Settings>("get_settings");
      set({
        settings: {
          ...DEFAULT_SETTINGS,
          ...s,
          general: { ...DEFAULT_SETTINGS.general, ...s.general },
          appearance: { ...DEFAULT_SETTINGS.appearance, ...s.appearance },
          plugin_display: { ...DEFAULT_SETTINGS.plugin_display, ...s.plugin_display },
          file_search: {
            ...DEFAULT_SETTINGS.file_search,
            ...(s as Settings).file_search,
            categories: normalizeFileSearchCategories((s as Settings).file_search?.categories),
          },
          advanced: { ...DEFAULT_SETTINGS.advanced, ...s.advanced },
          agent: { ...DEFAULT_SETTINGS.agent, ...s.agent },
          rss: { ...DEFAULT_SETTINGS.rss, ...s.rss },
          v2ex: { ...DEFAULT_SETTINGS.v2ex, ...s.v2ex },
          weather: {
            ...DEFAULT_SETTINGS.weather,
            ...s.weather,
            locations: Array.isArray(s.weather?.locations) ? s.weather.locations : DEFAULT_SETTINGS.weather.locations,
          },
          shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...s.shortcuts },
          app_shortcuts: { ...DEFAULT_SETTINGS.app_shortcuts, ...s.app_shortcuts },
          search_metadata: { ...DEFAULT_SETTINGS.search_metadata, ...s.search_metadata },
          module_search: {
            ...DEFAULT_SETTINGS.module_search,
            ...(s as Settings).module_search,
            modules: {
              ...DEFAULT_SETTINGS.module_search.modules,
              ...((s as Settings).module_search?.modules ?? {}),
            },
          },
          builtin_modules: {
            ...DEFAULT_SETTINGS.builtin_modules,
            ...(s as Settings).builtin_modules,
            modules: {
              ...DEFAULT_SETTINGS.builtin_modules.modules,
              ...((s as Settings).builtin_modules?.modules ?? {}),
            },
          },
          quick_entries: Array.isArray(s.quick_entries) && s.quick_entries.length > 0
            ? s.quick_entries
            : DEFAULT_SETTINGS.quick_entries,
          tray_actions: Array.isArray(s.tray_actions) && s.tray_actions.length > 0
            ? s.tray_actions
            : DEFAULT_SETTINGS.tray_actions,
        },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  save: async () => {
    saveSeq += 1;
    saveQueued = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flushSettingsSave(get);
    }, SAVE_DEBOUNCE_MS);
  },
  flush: async () => {
    await flushQueuedSettingsSave(get);
  },
  reset: async () => {
    try {
      cancelScheduledSave();
      await waitForSaveIdle();
      const s = await invoke<Settings>("reset_settings");
      set({ settings: s });
    } catch (e) {
      console.error("reset_settings failed", e);
    }
  },
  importFrom: async (path: string) => {
    try {
      cancelScheduledSave();
      await waitForSaveIdle();
      const s = await invoke<Settings>("import_settings", { path });
      set({ settings: s });
    } catch (e) {
      console.error("import_settings failed", e);
      throw e;
    }
  },
  exportTo: async (path: string) => {
    try {
      await flushQueuedSettingsSave(get);
      await invoke("export_settings", { path });
    } catch (e) {
      console.error("export_settings failed", e);
      throw e;
    }
  },
}));

async function flushQueuedSettingsSave(get: () => SettingsStore) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saveQueued && !saveInFlight) {
    void flushSettingsSave(get);
  }
  await waitForSaveIdle();
}

async function flushSettingsSave(get: () => SettingsStore) {
  if (saveInFlight) return;

  saveInFlight = true;
  try {
    while (saveQueued) {
      saveQueued = false;
      const seq = saveSeq;
      const settings = get().settings;
      try {
        await invoke<Settings>("update_settings", {
          settings,
        });
      } catch (e) {
        if (seq === saveSeq) {
          console.error("update_settings failed", e);
        }
      }
    }
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      void flushSettingsSave(get);
    } else {
      notifySaveIdle();
    }
  }
}

export const SHORTCUT_GROUPS: { group: string; ids: string[] }[] = [
  { group: "global", ids: ["toggle_launcher", "toggle_window"] },
  { group: "clipboard", ids: ["clipboard"] },
  { group: "rss", ids: ["rss"] },
  { group: "capture", ids: ["capture_screenshot", "record_gif", "toggle_capture_controls"] },
];

export const SHORTCUT_LABELS: Record<string, string> = {
  toggle_launcher: "Toggle Launcher Search",
  toggle_window: "Toggle Current Window",
  clipboard: "Open Clipboard",
  record_gif: "Start Screen Recording",
  capture_screenshot: "Take Screenshot",
  toggle_capture_controls: "Toggle Capture Island",
  rss: "Open RSS Reader",
};

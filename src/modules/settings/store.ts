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
import { getDefaultQxHostShortcuts } from "../../utils/keyboard";

const DEFAULT_HOST_SHORTCUTS = getDefaultQxHostShortcuts();

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
  /** Update source preference: auto compares the configured mirrors and GitHub. */
  update_source: "auto" | "cnb" | "github";
  /** Legacy compatibility field; use appearance.window_behavior instead. */
  autoHideOnBlur: boolean;
  data_path: string;
  has_shown_launcher: boolean;
  /** macOS first-launch permission wizard finished (or non-macOS auto-complete). */
  has_completed_onboarding: boolean;
  /** Version of the macOS privacy walkthrough last completed. */
  permission_onboarding_version: number;
}

export type LauncherResultDensity = "comfortable" | "compact";
export type WindowBehavior = "always-on-top" | "normal" | "auto-hide";

export type HomeDashboardWidgetId =
  | "launcher.pinned"
  | "system.cpu"
  | "system.memory"
  | "system.power"
  | "system.network"
  | "system.display-brightness"
  | "rss.unread-latest"
  | `provider:${string}`;

export const DEFAULT_HOME_DASHBOARD_WIDGETS: HomeDashboardWidgetId[] = [
  "launcher.pinned",
  "system.cpu",
  "system.memory",
  "system.power",
  "system.network",
  "rss.unread-latest",
];

export interface AppearanceSettings {
  theme: string;
  /** Runtime application icon. The tray icon stays unchanged. */
  app_icon: "original" | "cloud";
  /** Show the Qx-drawn desktop title bar and window controls. */
  title_bar_visible: boolean;
  /** Main window z-order and blur behavior. */
  window_behavior: WindowBehavior;
  /** Keep Qx visible in the macOS Dock or Windows taskbar. */
  show_in_app_list: boolean;
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
  /** Ordered, host-rendered widgets shown while Launcher query is empty. */
  home_dashboard_widgets: HomeDashboardWidgetId[];
  /** Home island mode id — see `src/home-island` registry (free string for extensibility). */
  home_island_mode: string;
  /** Multi-select set for idle home island rotation (empty → use home_island_mode). */
  home_island_modes: string[];
  /** Seconds between multi-mode rotation; 0 = no rotate. */
  home_island_rotate_secs: number;
  home_island_cpu: boolean;
  home_island_memory: boolean;
  /** Floating island webview (default on so new installs can float immediately). */
  island_float_enabled: boolean;
  /** Seconds between standing module/plugin sessions in the shared island. */
  island_float_rotate_secs: number;
  /** Keep an already manually floated island visible when main hides. */
  island_float_when_main_hidden: boolean;
  island_float_always_on_top: boolean;
  /** Legacy persisted preference; manual float requests override it. */
  island_prefer_docked_when_main_visible: boolean;
  /** Persisted physical desktop coordinates; null keeps the default top-right anchor. */
  island_float_x: number | null;
  island_float_y: number | null;
}

export interface ShortcutBinding {
  key: string;
  enabled: boolean;
}

export type NetworkProxyMode = "off" | "system" | "manual";

export interface AdvancedSettings {
  logging_enabled: boolean;
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

/** One plugin marketplace / mirror (`index.json`). */
export interface PluginRegistrySource {
  id: string;
  name: string;
  index_url: string;
  enabled: boolean;
}

export const DEFAULT_PLUGIN_REGISTRIES: PluginRegistrySource[] = [
  {
    id: "qx-official",
    name: "Qx Official",
    index_url: "https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json",
    enabled: true,
  },
];

export type QxAiSkillLoadMode = "fixed" | "smart" | "disabled";

/** Manual override for catalog-detected model capabilities. Key: `provider|model`. */
export interface ModelCapabilityOverride {
  vision?: boolean;
  reasoning?: boolean;
  /** Optional context window override (tokens). */
  context_length?: number;
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
  qx_host_actions_enabled: boolean;
  /** System stats / displays / process tools. */
  qx_system_tools_enabled: boolean;
  /**
   * When true (default), classify high-impact tools: bash is content-gated
   * (blacklist deny / safe allow / else ask); writes and other side-effect tools
   * ask once. When false, the gate is fully disabled.
   */
  dangerous_tools_guard_enabled: boolean;
  /**
   * SOLO mode: autonomous agent — skip confirm prompts so high-impact tools
   * (non-blacklisted bash, plugin commands, writes, schedules…) may run without
   * asking. Prefer only for trusted tasks.
   */
  solo_mode: boolean;
  /** Overrides skill frontmatter mode by skill id. */
  skill_modes: Record<string, QxAiSkillLoadMode>;
  /** Per-model vision/reasoning overrides when auto-detect is wrong. */
  model_capabilities: Record<string, ModelCapabilityOverride>;
  /**
   * Starred models for quick pick. Keys are `provider|model` (same as capability keys).
   * Sorted favorites float to the top of model selectors.
   */
  favorite_models: string[];
  defaults_version: number;
  agent_max_iterations: number;
}

export interface RssSettings {
  background_refresh_enabled: boolean;
  background_refresh_interval_hours: number;
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

export interface TrayProviderConfig {
  id: string;
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

export interface ScreencapSettings {
  output_format: "mp4" | "mov";
  fps: 15 | 24 | 30;
  quality: "compact" | "balanced" | "high";
  resolution: "720p" | "1080p" | "native";
  capture_confirm_mode: "refine" | "release";
  capture_delay_seconds: 0 | 3 | 5 | 10;
  auto_hide_after_capture: boolean;
  /** When false, a successful screenshot stays fully hidden (no main panel / screencap tab). */
  show_main_after_screenshot: boolean;
  auto_copy_to_clipboard: boolean;
  history_layout: "list" | "gallery";
  controls_pinned: boolean;
  screenshot_sound_enabled: boolean;
  show_floating_thumbnail: boolean;
  remember_last_selection: boolean;
  screenshot_include_cursor: boolean;
  recording_include_cursor: boolean;
  recording_show_mouse_clicks: boolean;
  recording_microphone_id: string | null;
  screenshot_destination: "library" | "desktop" | "documents" | "clipboard" | "custom";
  recording_destination: "library" | "desktop" | "documents" | "custom";
  screenshot_custom_directory: string | null;
  recording_custom_directory: string | null;
  screenshot_open_after: "none" | "preview" | "mail";
  recording_open_after: "none" | "player" | "mail";
}

export interface MacroSettings {
  /** Seconds at the end of a recording that are reserved for stopping it. */
  stop_tail_seconds: 0 | 1 | 2 | 3 | 5;
}

/** Built-in module ids that can contribute to main launcher search. */
export type ModuleSearchModuleId =
  | "clipboard"
  | "qx-ai"
  | "rss"
  | "p-zai"
  | "screencap"
  | "macros"
  | "documents"
  | "weather"
  | "qx-tty";

export const MODULE_SEARCH_MODULE_IDS: ModuleSearchModuleId[] = [
  "clipboard",
  "qx-ai",
  "rss",
  "p-zai",
  "screencap",
  "macros",
  "documents",
  "weather",
  "qx-tty",
];

export const MODULE_SEARCH_LABELS: Record<ModuleSearchModuleId, { title: string; hint: string }> = {
  clipboard: { title: "Clipboard", hint: "History items and open command" },
  "qx-ai": { title: "QxAI", hint: "Conversations, new chat, settings" },
  rss: { title: "RSS Reader", hint: "Feeds, folders, open reader" },
  "p-zai": { title: "P仔", hint: "AI reading companion for RSS" },
  screencap: { title: "Screenshot & Recording Module", hint: "Screenshots, MP4/MOV recording, and optional GIF conversion" },
  macros: { title: "Macro Recorder", hint: "Saved macros" },
  documents: { title: "Text Toolbox", hint: "Disk notepad · folder files" },
  weather: { title: "Weather", hint: "Locations and open weather" },
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
  /** Marketplace catalogs / mirrors (GitHub + domestic mirrors, etc.). */
  plugin_registries: PluginRegistrySource[];
  file_search: FileSearchSettings;
  screencap: ScreencapSettings;
  macros: MacroSettings;
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
  /** Ordered lightweight manifest providers rendered by the Tray panel. */
  tray_providers: TrayProviderConfig[];
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
  | "advanced"
  | "ocr"
  | "storage"
  | "about";

export const DEFAULT_SETTINGS: Settings = {
  general: {
    launch_at_login: false,
    language: "system",
    // Enabled by default — this also upgrades installed compatible plugins.
    auto_update: true,
    update_source: "auto",
    autoHideOnBlur: false,
    data_path: "",
    has_shown_launcher: false,
    has_completed_onboarding: false,
    permission_onboarding_version: 0,
  },
  appearance: {
    theme: "light",
    app_icon: "cloud",
    title_bar_visible: true,
    window_behavior: "normal",
    show_in_app_list: true,
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
    home_dashboard_widgets: [...DEFAULT_HOME_DASHBOARD_WIDGETS],
    home_island_mode: "system",
    home_island_modes: ["system"],
    home_island_rotate_secs: 8,
    home_island_cpu: true,
    home_island_memory: true,
    island_float_enabled: true,
    island_float_rotate_secs: 8,
    island_float_when_main_hidden: true,
    island_float_always_on_top: true,
    island_prefer_docked_when_main_visible: true,
    island_float_x: null,
    island_float_y: null,
  },
  shortcuts: {
    // macOS keeps Option+Space; Windows avoids its system-menu/PowerToys chord.
    toggle_launcher: { key: DEFAULT_HOST_SHORTCUTS.toggleLauncher, enabled: false },
    toggle_window: { key: DEFAULT_HOST_SHORTCUTS.toggleWindow, enabled: true },
    clipboard: { key: "Alt+V", enabled: false },
    record_gif: { key: "Alt+G", enabled: false },
    capture_screenshot: { key: "Alt+Shift+S", enabled: false },
    recapture_last_region: { key: "Alt+Shift+R", enabled: false },
    toggle_capture_controls: { key: "Alt+Shift+C", enabled: false },
    rss: { key: "Alt+R", enabled: false },
    tray_open_main: { key: "Alt+Shift+O", enabled: false },
    tray_keep_visible: { key: "Alt+Shift+K", enabled: false },
    tray_settings: { key: "Alt+Shift+,", enabled: false },
    tray_hide_main: { key: "Alt+Shift+H", enabled: false },
    tray_status_memory: { key: "", enabled: false },
    tray_status_network: { key: "", enabled: false },
    tray_status_cpu: { key: "", enabled: false },
  },
  app_shortcuts: {},
  plugins: [],
  plugin_display: {
    // Optional in-iframe action chips. Real actions always use QxShell (⌘K / bottom bar).
    raycast_action_panel: true,
  },
  file_search: {
    categories: DEFAULT_FILE_SEARCH_CATEGORIES,
  },
  screencap: {
    output_format: "mp4",
    fps: 24,
    quality: "balanced",
    resolution: "1080p",
    capture_confirm_mode: "refine",
    capture_delay_seconds: 0,
    auto_hide_after_capture: true,
    show_main_after_screenshot: true,
    auto_copy_to_clipboard: true,
    history_layout: "gallery",
    controls_pinned: false,
    screenshot_sound_enabled: true,
    show_floating_thumbnail: true,
    remember_last_selection: true,
    screenshot_include_cursor: false,
    recording_include_cursor: true,
    recording_show_mouse_clicks: false,
    recording_microphone_id: null,
    screenshot_destination: "library",
    recording_destination: "library",
    screenshot_custom_directory: null,
    recording_custom_directory: null,
    screenshot_open_after: "none",
    recording_open_after: "none",
  },
  macros: {
    stop_tail_seconds: 2,
  },
  plugin_registries: DEFAULT_PLUGIN_REGISTRIES.map((entry) => ({ ...entry })),
  advanced: {
    logging_enabled: false,
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
    agent_mode_enabled: true,
    default_provider: "openrouter",
    default_model: "openrouter/auto",
    model_tools_enabled: true,
    tools_enabled: true,
    memory_tool_enabled: true,
    app_search_enabled: true,
    file_search_enabled: true,
    http_fetch_enabled: true,
    notifications_enabled: true,
    mcp_enabled: true,
    bash_enabled: true,
    bash_timeout_ms: 30000,
    bash_cwd: "",
    grep_search_enabled: true,
    grep_command: "rg",
    grep_root: "",
    grep_max_results: 80,
    background_tasks_enabled: true,
    qx_host_actions_enabled: true,
    qx_system_tools_enabled: true,
    dangerous_tools_guard_enabled: true,
    solo_mode: false,
    skill_modes: {},
    model_capabilities: {},
    favorite_models: [],
    defaults_version: 2,
    agent_max_iterations: 12,
  },
  rss: {
    background_refresh_enabled: true,
    background_refresh_interval_hours: 24,
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
    // Off by default: launcher stays apps/files/commands until the user opts in.
    enabled: false,
    modules: {
      clipboard: true,
      "qx-ai": true,
      rss: true,
      "p-zai": true,
      screencap: true,
      macros: true,
      documents: true,
      weather: true,
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
    { id: "screencap", title: "Screenshot & Recording Module", subtitle: "Screenshots and MP4/MOV recording", target: "screencap", enabled: true },
    { id: "documents", title: "Text Tools", subtitle: "Text, Markdown, JSON", target: "documents", enabled: true },
    {
      id: "settings-plugins",
      title: "Extensions",
      subtitle: "Install, update, and manage plugins",
      target: "settings:plugins",
      enabled: true,
    },
    {
      id: "settings",
      title: "Qx Settings",
      subtitle: "Appearance, shortcuts, and preferences",
      target: "settings",
      enabled: true,
    },
  ],
  tray_actions: [
    { id: "status_memory", title: "Memory", enabled: true },
    { id: "status_network", title: "Network", enabled: true },
    { id: "status_cpu", title: "CPU", enabled: false },
    { id: "open_main", title: "Open Main Window", enabled: true },
    { id: "keep_visible", title: "Window Display Mode", enabled: true },
    { id: "settings", title: "Settings", enabled: true },
    { id: "hide_main", title: "Hide Main Window", enabled: false },
  ],
  tray_providers: [],
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
          appearance: {
            ...DEFAULT_SETTINGS.appearance,
            ...s.appearance,
            window_behavior:
              s.appearance?.window_behavior === "always-on-top"
              || s.appearance?.window_behavior === "normal"
              || s.appearance?.window_behavior === "auto-hide"
                ? s.appearance.window_behavior
                : s.general?.autoHideOnBlur === false
                  ? "normal"
                  : "auto-hide",
            home_dashboard_widgets:
              Array.isArray(s.appearance?.home_dashboard_widgets)
              && s.appearance.home_dashboard_widgets.length > 0
                ? s.appearance.home_dashboard_widgets
                : DEFAULT_SETTINGS.appearance.home_dashboard_widgets,
          },
          plugin_display: { ...DEFAULT_SETTINGS.plugin_display, ...s.plugin_display },
          plugin_registries:
            Array.isArray((s as Settings).plugin_registries)
            && (s as Settings).plugin_registries.length > 0
              ? (s as Settings).plugin_registries.map((entry) => ({
                  id: String(entry?.id || "").trim() || `registry-${Math.random().toString(36).slice(2, 8)}`,
                  name: String(entry?.name || "").trim() || String(entry?.index_url || "Library"),
                  index_url: String(entry?.index_url || "").trim(),
                  enabled: entry?.enabled !== false,
                })).filter((entry) => entry.index_url)
              : DEFAULT_PLUGIN_REGISTRIES.map((entry) => ({ ...entry })),
          file_search: {
            ...DEFAULT_SETTINGS.file_search,
            ...(s as Settings).file_search,
            categories: normalizeFileSearchCategories((s as Settings).file_search?.categories),
          },
          screencap: { ...DEFAULT_SETTINGS.screencap, ...s.screencap },
          macros: { ...DEFAULT_SETTINGS.macros, ...s.macros },
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
          tray_providers: Array.isArray(s.tray_providers) ? s.tray_providers : [],
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
  { group: "capture", ids: ["capture_screenshot", "recapture_last_region", "record_gif", "toggle_capture_controls"] },
  { group: "tray", ids: ["tray_open_main", "tray_keep_visible", "tray_settings", "tray_hide_main", "tray_status_memory", "tray_status_network", "tray_status_cpu"] },
];

export const SHORTCUT_LABELS: Record<string, string> = {
  toggle_launcher: "Toggle Launcher Search",
  toggle_window: "Toggle Current Window",
  clipboard: "Open Clipboard",
  record_gif: "Start Screen Recording",
  capture_screenshot: "Take Screenshot",
  recapture_last_region: "Recapture Last Region",
  toggle_capture_controls: "Toggle Capture Island",
  rss: "Open RSS Reader",
  tray_open_main: "Tray · Open Main Window",
  tray_keep_visible: "Tray · Keep Window Visible",
  tray_settings: "Tray · Settings",
  tray_hide_main: "Tray · Hide Main Window",
  tray_status_memory: "Tray · Memory Status",
  tray_status_network: "Tray · Network Status",
  tray_status_cpu: "Tray · CPU Status",
};

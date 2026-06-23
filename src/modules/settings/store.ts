import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface GeneralSettings {
  launch_at_login: boolean;
  language: string;
  auto_update: boolean;
  autoHideOnBlur: boolean;
  data_path: string;
}

export interface AppearanceSettings {
  theme: string;
  blur_opacity: number;
  window_width: number;
  window_height: number;
  border_radius: number;
  font_size: number;
  home_island_mode: "default" | "system";
  home_island_cpu: boolean;
  home_island_gpu: boolean;
  home_island_memory: boolean;
}

export interface ShortcutBinding {
  key: string;
  enabled: boolean;
}

export interface AdvancedSettings {
  log_level: string;
  dev_mode: boolean;
}

export interface RssSettings {
  offline_cache_enabled: boolean;
  max_articles_per_feed: number;
  bottom_island_mode: "scroll" | "index";
}

export interface PluginConfig {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  path: string;
}

export interface Settings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  shortcuts: Record<string, ShortcutBinding>;
  plugins: PluginConfig[];
  advanced: AdvancedSettings;
  rss: RssSettings;
}

export type SettingsTab =
  | "general"
  | "plugins"
  | "shortcuts"
  | "appearance"
  | "rss"
  | "advanced"
  | "about";

export const DEFAULT_SETTINGS: Settings = {
  general: {
    launch_at_login: false,
    language: "en",
    auto_update: true,
    autoHideOnBlur: true,
    data_path: "",
  },
  appearance: {
    theme: "light",
    blur_opacity: 0.20,
    window_width: 680,
    window_height: 500,
    border_radius: 12,
    font_size: 14,
    home_island_mode: "system",
    home_island_cpu: true,
    home_island_gpu: true,
    home_island_memory: true,
  },
  shortcuts: {
    toggle_launcher: { key: "Alt+Space", enabled: true },
    screenshot: { key: "Alt+S", enabled: true },
    clipboard: { key: "Alt+V", enabled: true },
    record_gif: { key: "Alt+G", enabled: true },
    rss: { key: "Alt+R", enabled: true },
    settings: { key: "Cmd+,", enabled: true },
  },
  plugins: [],
  advanced: {
    log_level: "info",
    dev_mode: false,
  },
  rss: {
    offline_cache_enabled: true,
    max_articles_per_feed: 500,
    bottom_island_mode: "scroll",
  },
};

interface SettingsStore {
  settings: Settings;
  activeTab: SettingsTab;
  loaded: boolean;
  setSettings: (s: Settings) => void;
  setActiveTab: (t: SettingsTab) => void;
  patch: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  patchShortcut: (id: string, binding: Partial<ShortcutBinding>) => void;
  load: () => Promise<void>;
  save: () => Promise<void>;
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
  load: async () => {
    try {
      const s = await invoke<Settings>("get_settings");
      set({
        settings: {
          ...DEFAULT_SETTINGS,
          ...s,
          general: { ...DEFAULT_SETTINGS.general, ...s.general },
          appearance: { ...DEFAULT_SETTINGS.appearance, ...s.appearance },
          advanced: { ...DEFAULT_SETTINGS.advanced, ...s.advanced },
          rss: { ...DEFAULT_SETTINGS.rss, ...s.rss },
          shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...s.shortcuts },
        },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  save: async () => {
    try {
      const s = await invoke<Settings>("update_settings", {
        settings: get().settings,
      });
      set({ settings: s });
    } catch (e) {
      console.error("update_settings failed", e);
    }
  },
  reset: async () => {
    try {
      const s = await invoke<Settings>("reset_settings");
      set({ settings: s });
    } catch (e) {
      console.error("reset_settings failed", e);
    }
  },
  importFrom: async (path: string) => {
    try {
      const s = await invoke<Settings>("import_settings", { path });
      set({ settings: s });
    } catch (e) {
      console.error("import_settings failed", e);
      throw e;
    }
  },
  exportTo: async (path: string) => {
    try {
      await invoke("export_settings", { path });
    } catch (e) {
      console.error("export_settings failed", e);
      throw e;
    }
  },
}));

export const SHORTCUT_GROUPS: { group: string; ids: string[] }[] = [
  { group: "Global", ids: ["toggle_launcher", "settings"] },
  { group: "Screenshot", ids: ["screenshot"] },
  { group: "Clipboard", ids: ["clipboard"] },
  { group: "RSS", ids: ["rss"] },
  { group: "Recording", ids: ["record_gif"] },
];

export const SHORTCUT_LABELS: Record<string, string> = {
  toggle_launcher: "Toggle Launcher",
  screenshot: "Take Screenshot",
  clipboard: "Open Clipboard",
  record_gif: "Record Screen GIF",
  rss: "Open RSS Reader",
  settings: "Open Settings",
};

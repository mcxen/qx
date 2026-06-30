import { create } from "zustand";

export interface AppEntry {
  name: string;
  display_name?: string;
  path: string;
  icon: string;
  kind?: "app" | "command" | "clipboard" | "file" | "folder" | "calculation";
}

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: string;
  pinned: boolean;
  copy_count: number;
  image_path?: string | null;
}

/** History entry (launches) */
export interface HistoryEntry {
  id: number;
  name: string;
  path: string;
  timestamp: string;
}

/** Search history entry */
export interface SearchHistoryEntry {
  id: number;
  query: string;
  timestamp: string;
}

export interface RssFeed {
  id: number;
  url: string;
  title: string;
  icon: string;
  last_fetched: number;
  error_count: number;
}

export interface RssArticle {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  summary: string;
  content: string;
  author: string;
  link: string;
  image_url: string;
  is_read: number;
  is_starred: number;
  published_at: number;
}

export type BuiltinTab =
  | "launcher"
  | "clipboard"
  | "screencap"
  | "rss"
  | "v2ex"
  | "weather"
  | "settings"
  | "macros"
  | "documents";
export type Tab = BuiltinTab | string;
export type SearchScope = "all" | "apps" | "files" | "clipboard";
export type LoadingPhase = "loading-apps" | "ready" | "loading-background";

interface AppStore {
  visible: boolean;
  query: string;
  results: AppEntry[];
  selectedIndex: number;
  tab: Tab;
  clipboardHistory: ClipboardEntry[];
  /** Loading phase for phased startup */
  loadingPhase: LoadingPhase;
  /** Set true once apps cache has been loaded from DB */
  appsReady: boolean;
  setVisible: (v: boolean) => void;
  setQuery: (q: string) => void;
  setResults: (r: AppEntry[]) => void;
  setSelectedIndex: (i: number) => void;
  setTab: (t: Tab) => void;
  setClipboardHistory: (h: ClipboardEntry[]) => void;
  setLoadingPhase: (phase: LoadingPhase) => void;
  setAppsReady: (ready: boolean) => void;
  updateResultIcons: (iconForPath: (path: string) => string | undefined) => void;
}

export const useStore = create<AppStore>((set) => ({
  visible: false,
  query: "",
  results: [],
  selectedIndex: 0,
  tab: "launcher",
  clipboardHistory: [],
  loadingPhase: "loading-apps",
  appsReady: false,
  setVisible: (visible) => set({ visible }),
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setTab: (tab) => set({ tab, query: "", results: [], selectedIndex: 0 }),
  setClipboardHistory: (clipboardHistory) => set({ clipboardHistory }),
  setLoadingPhase: (loadingPhase) => set({ loadingPhase }),
  setAppsReady: (appsReady) => set({ appsReady }),
  updateResultIcons: (iconForPath) =>
    set((state) => ({
      results: state.results.map((r) => {
        const icon = iconForPath(r.path);
        return icon !== undefined ? { ...r, icon } : r;
      }),
    })),
}));

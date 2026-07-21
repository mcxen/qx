import { create } from "zustand";

export interface AppEntry {
  name: string;
  display_name?: string;
  /** Optional list subtitle (module surfaces, clipboard preview, etc.). */
  subtitle?: string;
  path: string;
  icon: string;
  kind?: "app" | "command" | "clipboard" | "file" | "folder" | "calculation";
  /** Built-in module owner for availability/maturity presentation. */
  moduleId?: string;
  /**
   * Optional precomputed match tier for launcher ranking (lower = better).
   * Used when keywords matched but the visible title does not contain the query.
   * See `search/rankResults.ts`.
   */
  matchScore?: number;
  /**
   * Rolling 30-day open count for this path (search recommendations).
   * Advisory only — main match quality still wins in `rankSearchResults`.
   */
  clickCount?: number;
  /** Unix modification time in seconds for file/folder search results. */
  modified_at?: number;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: string;
  pinned: boolean;
  copy_count: number;
  image_path?: string | null;
  file_path?: string | null;
  /** Ordered native file clipboard payload; legacy rows fall back to file_path. */
  file_paths?: string[];
  /** Stable kind captured with file clipboard semantics; avoids guessing folders from extensions. */
  file_kind?: "image" | "video" | "audio" | "pdf" | "folder" | "file" | null;
  /** Cached OCR text for images — used by launcher / module search. */
  ocr_text?: string | null;
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
  | "documents"
  | "qx-tty";
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
  setVisible: (visible) => set((state) => (state.visible === visible ? state : { visible })),
  setQuery: (query) => set((state) => (state.query === query ? state : { query })),
  setResults: (results) => set((state) => (state.results === results ? state : { results })),
  setSelectedIndex: (selectedIndex) =>
    set((state) => (state.selectedIndex === selectedIndex ? state : { selectedIndex })),
  setTab: (tab) =>
    set((state) => {
      if (state.tab === tab) {
        // Same tab: clear search text when re-entering launcher, but never wipe
        // the home list. Wiping results made Option+Space / Esc return flash empty.
        if (tab === "launcher" && (state.query !== "" || state.selectedIndex !== 0)) {
          return { query: "", selectedIndex: 0 };
        }
        return state;
      }
      // Tab switch: reset query/selection for the destination module, but keep
      // `results` so returning to the launcher is instant (no empty flash while
      // search_apps reloads). Empty-query doSearch / loadEmptyLauncherApps own
      // replacing the list when the home path is actually stale.
      return { tab, query: "", selectedIndex: 0 };
    }),
  setClipboardHistory: (clipboardHistory) =>
    set((state) => (state.clipboardHistory === clipboardHistory ? state : { clipboardHistory })),
  setLoadingPhase: (loadingPhase) =>
    set((state) => (state.loadingPhase === loadingPhase ? state : { loadingPhase })),
  setAppsReady: (appsReady) => set((state) => (state.appsReady === appsReady ? state : { appsReady })),
  updateResultIcons: (iconForPath) =>
    set((state) => ({
      results: state.results.map((r) => {
        const icon = iconForPath(r.path);
        return icon !== undefined ? { ...r, icon } : r;
      }),
    })),
}));

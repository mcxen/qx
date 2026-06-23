import { create } from "zustand";

export interface AppEntry {
  name: string;
  path: string;
  icon: string;
  kind?: "app" | "command" | "clipboard" | "file";
}

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: string;
  pinned: boolean;
  copy_count: number;
}

export interface ScreenshotEntry {
  path: string;
  timestamp: string;
}

export type ScreenshotCaptureStatus = "idle" | "selecting" | "saving";

export interface ScreenshotCaptureState {
  status: ScreenshotCaptureStatus;
  backgroundPath: string | null;
  error: string | null;
  previewPath: string | null;
  scaleFactor: number;
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
  | "screenshot"
  | "screencap"
  | "rss"
  | "settings"
  | "macros";
export type Tab = BuiltinTab | string;
export type SearchScope = "all" | "apps" | "files" | "clipboard";

interface AppStore {
  visible: boolean;
  query: string;
  results: AppEntry[];
  selectedIndex: number;
  tab: Tab;
  clipboardHistory: ClipboardEntry[];
  screenshotCapture: ScreenshotCaptureState;
  setVisible: (v: boolean) => void;
  setQuery: (q: string) => void;
  setResults: (r: AppEntry[]) => void;
  setSelectedIndex: (i: number) => void;
  setTab: (t: Tab) => void;
  setClipboardHistory: (h: ClipboardEntry[]) => void;
  setScreenshotCapture: (state: Partial<ScreenshotCaptureState>) => void;
  updateResultIcons: (iconForPath: (path: string) => string | undefined) => void;
}

const initialScreenshotCapture: ScreenshotCaptureState = {
  status: "idle",
  backgroundPath: null,
  error: null,
  previewPath: null,
  scaleFactor: 1,
};

export const useStore = create<AppStore>((set) => ({
  visible: false,
  query: "",
  results: [],
  selectedIndex: 0,
  tab: "launcher",
  clipboardHistory: [],
  screenshotCapture: initialScreenshotCapture,
  setVisible: (visible) => set({ visible }),
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setTab: (tab) => set({ tab, query: "", results: [], selectedIndex: 0 }),
  setClipboardHistory: (clipboardHistory) => set({ clipboardHistory }),
  setScreenshotCapture: (state) =>
    set((current) => ({
      screenshotCapture: { ...current.screenshotCapture, ...state },
    })),
  updateResultIcons: (iconForPath) =>
    set((state) => ({
      results: state.results.map((r) => {
        const icon = iconForPath(r.path);
        return icon !== undefined ? { ...r, icon } : r;
      }),
    })),
}));

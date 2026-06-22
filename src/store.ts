import { create } from "zustand";

export interface AppEntry {
  name: string;
  path: string;
  icon: string;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  timestamp: string;
}

export interface ScreenshotEntry {
  path: string;
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

export type Tab = "launcher" | "clipboard" | "screenshot" | "screencap" | "rss" | "settings" | "macros";

interface AppStore {
  visible: boolean;
  query: string;
  results: AppEntry[];
  selectedIndex: number;
  tab: Tab;
  clipboardHistory: ClipboardEntry[];
  setVisible: (v: boolean) => void;
  setQuery: (q: string) => void;
  setResults: (r: AppEntry[]) => void;
  setSelectedIndex: (i: number) => void;
  setTab: (t: Tab) => void;
  setClipboardHistory: (h: ClipboardEntry[]) => void;
}

export const useStore = create<AppStore>((set) => ({
  visible: false,
  query: "",
  results: [],
  selectedIndex: 0,
  tab: "launcher",
  clipboardHistory: [],
  setVisible: (visible) => set({ visible }),
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setTab: (tab) => set({ tab, query: "", results: [], selectedIndex: 0 }),
  setClipboardHistory: (clipboardHistory) => set({ clipboardHistory }),
}));

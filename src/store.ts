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
  id: string;
  path: string;
  timestamp: string;
}

type Tab = "launcher" | "clipboard" | "screenshot";

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
  setTab: (tab) => set({ tab }),
  setClipboardHistory: (clipboardHistory) => set({ clipboardHistory }),
}));

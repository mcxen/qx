import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface RssFeed {
  id: number;
  url: string;
  title: string;
  icon: string;
  last_fetched: number;
  error_count: number;
  unread_count: number;
  created_at: number;
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
  is_read: boolean;
  is_starred: boolean;
  published_at: number;
  created_at: number;
}

export type RssView = "feeds" | "articles" | "detail";

export type ArticleFilter = "all" | "unread" | "starred";

interface RssStore {
  view: RssView;
  selectedFeedId: number | null;
  selectedArticleId: number | null;
  selectedIndex: number;

  feeds: RssFeed[];
  articles: RssArticle[];
  currentArticle: RssArticle | null;

  filter: ArticleFilter;
  search: string;

  loading: boolean;
  error: string | null;
  refreshingFeedId: number | null;

  setView: (v: RssView) => void;
  setSelectedFeedId: (id: number | null) => void;
  setSelectedArticleId: (id: number | null) => void;
  setSelectedIndex: (i: number) => void;
  setFilter: (f: ArticleFilter) => void;
  setSearch: (s: string) => void;
  setArticles: (a: RssArticle[]) => void;
  setCurrentArticle: (a: RssArticle | null) => void;
  setError: (e: string | null) => void;
  setRefreshing: (id: number | null) => void;

  loadFeeds: () => Promise<void>;
  openFeed: (id: number) => Promise<void>;
  refreshFeed: (id: number) => Promise<void>;
  refreshAll: () => Promise<void>;
  removeFeed: (id: number) => Promise<void>;
  addFeed: (url: string) => Promise<void>;

  loadArticles: () => Promise<void>;
  openArticle: (id: number) => Promise<void>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  markAllRead: (feedId: number) => Promise<void>;
  toggleStar: (id: number, isStarred: boolean) => Promise<void>;

  goBack: () => void;
  moveSelection: (delta: number, length: number) => void;
}

function startOfDay(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(x.getTime() / 1000);
}

export function classifyArticleTime(publishedAt: number): "today" | "yesterday" | "earlier" {
  if (!publishedAt) return "earlier";
  const today = startOfDay(new Date());
  const yesterday = today - 86400;
  if (publishedAt >= today) return "today";
  if (publishedAt >= yesterday) return "yesterday";
  return "earlier";
}

export const useRssStore = create<RssStore>((set, get) => ({
  view: "feeds",
  selectedFeedId: null,
  selectedArticleId: null,
  selectedIndex: 0,

  feeds: [],
  articles: [],
  currentArticle: null,

  filter: "all",
  search: "",

  loading: false,
  error: null,
  refreshingFeedId: null,

  setView: (view) => set({ view }),
  setSelectedFeedId: (selectedFeedId) => set({ selectedFeedId }),
  setSelectedArticleId: (selectedArticleId) => set({ selectedArticleId }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setFilter: (filter) => {
    set({ filter });
    void get().loadArticles();
  },
  setSearch: (search) => {
    set({ search });
    void get().loadArticles();
  },
  setArticles: (articles) => set({ articles }),
  setCurrentArticle: (currentArticle) => set({ currentArticle }),
  setError: (error) => set({ error }),
  setRefreshing: (refreshingFeedId) => set({ refreshingFeedId }),

  loadFeeds: async () => {
    set({ loading: true, error: null });
    try {
      const feeds = await invoke<RssFeed[]>("rss_list_feeds");
      set({ feeds, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  openFeed: async (id) => {
    set({ selectedFeedId: id, view: "articles", selectedIndex: 0, search: "", filter: "all" });
    await get().loadArticles();
  },

  refreshFeed: async (id) => {
    set({ refreshingFeedId: id, error: null });
    try {
      await invoke<number>("rss_refresh_feed", { id });
      await get().loadFeeds();
      if (get().view === "articles" && get().selectedFeedId === id) {
        await get().loadArticles();
      }
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ refreshingFeedId: null });
    }
  },

  refreshAll: async () => {
    set({ refreshingFeedId: -1, error: null });
    try {
      await invoke<number>("rss_refresh_all");
      await get().loadFeeds();
      if (get().view === "articles") await get().loadArticles();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ refreshingFeedId: null });
    }
  },

  removeFeed: async (id) => {
    try {
      await invoke("rss_remove_feed", { id });
      await get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addFeed: async (url) => {
    set({ loading: true, error: null });
    try {
      await invoke<RssFeed>("rss_add_feed", { url });
      await get().loadFeeds();
      set({ loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  loadArticles: async () => {
    const { selectedFeedId, filter, search } = get();
    if (selectedFeedId == null) {
      set({ articles: [] });
      return;
    }
    try {
      const onlyUnread = filter === "unread";
      const list = await invoke<RssArticle[]>("rss_list_articles", {
        feedId: selectedFeedId,
        onlyUnread,
        query: search || null,
      });
      const filtered = filter === "starred" ? list.filter((a) => a.is_starred) : list;
      set({ articles: filtered });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  openArticle: async (id) => {
    try {
      const a = await invoke<RssArticle | null>("rss_get_article", { id });
      set({ selectedArticleId: id, currentArticle: a, view: "detail" });
      if (a && !a.is_read) {
        await invoke("rss_mark_read", { id, isRead: true });
        set({ currentArticle: { ...a, is_read: true } });
        void get().loadArticles();
        void get().loadFeeds();
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markRead: async (id, isRead) => {
    try {
      await invoke("rss_mark_read", { id, isRead });
      set((s) => ({
        articles: s.articles.map((a) => (a.id === id ? { ...a, is_read: isRead } : a)),
        currentArticle:
          s.currentArticle && s.currentArticle.id === id
            ? { ...s.currentArticle, is_read: isRead }
            : s.currentArticle,
      }));
      void get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markAllRead: async (feedId) => {
    try {
      await invoke("rss_mark_all_read", { feedId });
      set((s) => ({
        articles: s.articles.map((a) => ({ ...a, is_read: true })),
      }));
      void get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleStar: async (id, isStarred) => {
    try {
      await invoke("rss_toggle_star", { id, isStarred });
      set((s) => ({
        articles: s.articles.map((a) =>
          a.id === id ? { ...a, is_starred: isStarred } : a,
        ),
        currentArticle:
          s.currentArticle && s.currentArticle.id === id
            ? { ...s.currentArticle, is_starred: isStarred }
            : s.currentArticle,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  goBack: () => {
    const { view } = get();
    if (view === "detail") {
      set({ view: "articles", selectedArticleId: null, currentArticle: null });
    } else if (view === "articles") {
      set({ view: "feeds", selectedFeedId: null, articles: [], selectedIndex: 0 });
    }
  },

  moveSelection: (delta, length) => {
    if (length <= 0) return;
    set((s) => ({
      selectedIndex: Math.max(0, Math.min(s.selectedIndex + delta, length - 1)),
    }));
  },
}));

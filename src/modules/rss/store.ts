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
  folder_id?: number | null;
  folder_name?: string | null;
}

export interface RssFolder {
  id: number;
  name: string;
  parent_id?: number | null;
  sort_order: number;
  created_at: number;
  feed_count: number;
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
  folders: RssFolder[];
  articles: RssArticle[];
  readingArticles: RssArticle[];
  currentArticle: RssArticle | null;

  filter: ArticleFilter;
  search: string;

  loading: boolean;
  error: string | null;
  refreshingFeedId: number | null;
  statusMessage: string | null;

  setView: (v: RssView) => void;
  setSelectedFeedId: (id: number | null) => void;
  setSelectedArticleId: (id: number | null) => void;
  setSelectedIndex: (i: number) => void;
  setFilter: (f: ArticleFilter) => void;
  setSearch: (s: string) => void;
  setArticles: (a: RssArticle[]) => void;
  setReadingArticles: (a: RssArticle[]) => void;
  setCurrentArticle: (a: RssArticle | null) => void;
  setError: (e: string | null) => void;
  setRefreshing: (id: number | null) => void;
  setStatusMessage: (m: string | null) => void;

  loadFeeds: () => Promise<void>;
  loadFolders: () => Promise<void>;
  openFeed: (id: number) => Promise<void>;
  refreshFeed: (id: number) => Promise<void>;
  refreshAll: () => Promise<void>;
  removeFeed: (id: number) => Promise<void>;
  addFeed: (url: string) => Promise<void>;
  updateFeed: (id: number, url: string, title: string) => Promise<void>;
  setFeedFolder: (feedId: number, folderId: number | null) => Promise<void>;
  createFolder: (name: string) => Promise<RssFolder | null>;
  renameFolder: (id: number, name: string) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  importOpml: (content: string) => Promise<number>;
  exportOpml: () => Promise<string>;

  loadArticles: () => Promise<void>;
  openArticle: (id: number) => Promise<void>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  markAllRead: (feedId: number) => Promise<void>;
  toggleStar: (id: number, isStarred: boolean) => Promise<void>;

  goBack: () => void;
  moveSelection: (delta: number, length: number) => void;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export const useRssStore = create<RssStore>((set, get) => ({
  view: "feeds",
  selectedFeedId: null,
  selectedArticleId: null,
  selectedIndex: 0,

  feeds: [],
  folders: [],
  articles: [],
  readingArticles: [],
  currentArticle: null,

  filter: "all",
  search: "",

  loading: false,
  error: null,
  refreshingFeedId: null,
  statusMessage: null,

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
  setReadingArticles: (readingArticles) => set({ readingArticles }),
  setCurrentArticle: (currentArticle) => set({ currentArticle }),
  setError: (error) => set({ error }),
  setRefreshing: (refreshingFeedId) => set({ refreshingFeedId }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),

  loadFeeds: async () => {
    if (!isTauriRuntime()) {
      set({ feeds: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const feeds = await invoke<RssFeed[]>("rss_list_feeds");
      const folders = await invoke<RssFolder[]>("rss_list_folders").catch(() => [] as RssFolder[]);
      set({ feeds, folders, loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadFolders: async () => {
    if (!isTauriRuntime()) return;
    try {
      const folders = await invoke<RssFolder[]>("rss_list_folders");
      set({ folders });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  openFeed: async (id) => {
    set({ selectedFeedId: id, view: "articles", selectedIndex: 0, search: "", filter: "all" });
    await get().loadArticles();
  },

  refreshFeed: async (id) => {
    if (!isTauriRuntime()) return;
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
    if (!isTauriRuntime()) return;
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
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_remove_feed", { id });
      await get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addFeed: async (url) => {
    if (!isTauriRuntime()) return;
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

  updateFeed: async (id, url, title) => {
    if (!isTauriRuntime()) return;
    set({ loading: true, error: null });
    try {
      await invoke<RssFeed>("rss_update_feed", { id, url, title });
      await get().loadFeeds();
      set({ loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  setFeedFolder: async (feedId, folderId) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke<RssFeed>("rss_set_feed_folder", { feedId, folderId });
      await get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createFolder: async (name) => {
    if (!isTauriRuntime()) return null;
    try {
      const folder = await invoke<RssFolder>("rss_create_folder", {
        name,
        parentId: null,
      });
      await get().loadFolders();
      return folder;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  renameFolder: async (id, name) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_rename_folder", { id, name });
      await get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteFolder: async (id) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_delete_folder", { id });
      await get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  importOpml: async (content) => {
    if (!isTauriRuntime()) return 0;
    set({ loading: true, error: null, statusMessage: "Importing OPML…" });
    try {
      const count = await invoke<number>("rss_import_opml", { content });
      await get().loadFeeds();
      set({
        loading: false,
        statusMessage: `Imported ${count} feed${count === 1 ? "" : "s"}`,
      });
      window.setTimeout(() => {
        if (get().statusMessage?.startsWith("Imported")) set({ statusMessage: null });
      }, 2200);
      return count;
    } catch (e) {
      set({ loading: false, error: String(e), statusMessage: null });
      throw e;
    }
  },

  exportOpml: async () => {
    if (!isTauriRuntime()) return "";
    const content = await invoke<string>("rss_export_opml");
    return content;
  },

  loadArticles: async () => {
    const { selectedFeedId, filter, search } = get();
    if (!isTauriRuntime()) {
      set({ articles: [], error: null });
      return;
    }
    if (selectedFeedId == null) {
      set({ articles: [] });
      return;
    }
    try {
      const onlyUnread = filter === "unread";
      let articles = await invoke<RssArticle[]>("rss_list_articles", {
        feedId: selectedFeedId,
        onlyUnread,
        query: search.trim() || null,
      });
      if (filter === "starred") {
        articles = articles.filter((a) => a.is_starred);
      }
      set({ articles, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  openArticle: async (id) => {
    if (!isTauriRuntime()) return;
    try {
      const state = get();
      const readingArticles =
        state.view === "detail" && state.readingArticles.some((article) => article.id === id)
          ? state.readingArticles
          : state.articles;
      const a = await invoke<RssArticle | null>("rss_get_article", { id });
      set({ selectedArticleId: id, currentArticle: a, readingArticles, view: "detail" });
      if (a && !a.is_read) {
        await invoke("rss_mark_read", { id, isRead: true });
        set((s) => ({
          currentArticle: { ...a, is_read: true },
          readingArticles: s.readingArticles.map((article) =>
            article.id === id ? { ...article, is_read: true } : article,
          ),
        }));
        void get().loadArticles();
        void get().loadFeeds();
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markRead: async (id, isRead) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_mark_read", { id, isRead });
      set((s) => ({
        articles: s.articles.map((a) => (a.id === id ? { ...a, is_read: isRead } : a)),
        readingArticles: s.readingArticles.map((a) => (a.id === id ? { ...a, is_read: isRead } : a)),
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
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_mark_all_read", { feedId });
      set((s) => ({
        articles: s.articles.map((a) => ({ ...a, is_read: true })),
        readingArticles: s.readingArticles.map((a) => ({ ...a, is_read: true })),
      }));
      void get().loadFeeds();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleStar: async (id, isStarred) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_toggle_star", { id, isStarred });
      set((s) => ({
        articles: s.articles.map((a) =>
          a.id === id ? { ...a, is_starred: isStarred } : a,
        ),
        readingArticles: s.readingArticles.map((a) =>
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
    const { view, currentArticle } = get();
    // Close open article first (detail view or master-detail reader still showing).
    if (view === "detail" || currentArticle) {
      set({
        view: "articles",
        selectedArticleId: null,
        currentArticle: null,
        readingArticles: [],
      });
      return;
    }
    if (view === "articles") {
      set({
        view: "feeds",
        selectedFeedId: null,
        selectedArticleId: null,
        currentArticle: null,
        articles: [],
        readingArticles: [],
        selectedIndex: 0,
        search: "",
      });
    }
  },

  moveSelection: (delta, length) => {
    if (length <= 0) return;
    set((state) => ({
      selectedIndex: Math.max(0, Math.min(length - 1, state.selectedIndex + delta)),
    }));
  },
}));

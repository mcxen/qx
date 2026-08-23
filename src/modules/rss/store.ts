import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface RssFeed {
  id: number;
  url: string;
  title: string;
  icon: string;
  last_fetched: number;
  latest_article_published_at: number;
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
  reading_progress: number;
  published_at: number;
  created_at: number;
}

export type RssView = "feeds" | "articles" | "detail";

export type ArticleFilter = "all" | "unread" | "starred";

export interface RssRefreshProgress {
  scope: "feed" | "all";
  phase: "fetching" | "saving" | "finished";
  feedId?: number | null;
  feedTitle?: string | null;
  completed: number;
  total: number;
  failed: number;
}

export type RssStatusMessage =
  | { kind: "importingOpml" }
  | { kind: "importedFeeds"; count: number };

interface RssLoadOptions {
  force?: boolean;
}

const RSS_FEEDS_FRESH_MS = 30_000;
const RSS_ARTICLES_FRESH_MS = 30_000;
const RSS_ARTICLE_LIST_LIMIT = 120;
const RSS_ARTICLE_CACHE_LIMIT = 12;

let feedsLoadedAt = 0;
let feedsInFlight: Promise<void> | null = null;
const articleCache = new Map<string, { articles: RssArticle[]; loadedAt: number }>();
const articleRequests = new Map<string, Promise<void>>();
let activeArticlesKey = "";

function articleCacheKey(
  feedId: number,
  filter: ArticleFilter,
  search: string,
): string {
  return `${feedId}\0${filter}\0${search.trim().toLocaleLowerCase()}`;
}

function rememberArticles(key: string, articles: RssArticle[]): void {
  articleCache.delete(key);
  articleCache.set(key, { articles, loadedAt: Date.now() });
  while (articleCache.size > RSS_ARTICLE_CACHE_LIMIT) {
    const oldestKey = articleCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    articleCache.delete(oldestKey);
  }
}

function invalidateArticleCache(feedId?: number): void {
  for (const key of articleCache.keys()) {
    if (feedId === undefined || key.startsWith(`${feedId}\0`)) articleCache.delete(key);
  }
}

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
  refreshProgress: RssRefreshProgress | null;
  statusMessage: RssStatusMessage | null;

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
  setStatusMessage: (m: RssStatusMessage | null) => void;

  loadFeeds: (options?: RssLoadOptions) => Promise<void>;
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

  loadArticles: (options?: RssLoadOptions) => Promise<void>;
  openArticle: (id: number) => Promise<void>;
  markRead: (id: number, isRead: boolean) => Promise<void>;
  markAllRead: (feedId: number) => Promise<void>;
  toggleStar: (id: number, isStarred: boolean) => Promise<void>;
  saveReadingProgress: (id: number, progress: number) => Promise<void>;

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
  refreshProgress: null,
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

  loadFeeds: async (options = {}) => {
    if (!isTauriRuntime()) {
      set({ feeds: [], loading: false, error: null });
      return;
    }
    if (!options.force && get().feeds.length > 0 && Date.now() - feedsLoadedAt < RSS_FEEDS_FRESH_MS) {
      return;
    }
    if (feedsInFlight) {
      await feedsInFlight;
      return;
    }

    const hasCachedFeeds = get().feeds.length > 0;
    if (!hasCachedFeeds) set({ loading: true, error: null });
    feedsInFlight = (async () => {
      try {
        const [feeds, folders] = await Promise.all([
          invoke<RssFeed[]>("rss_list_feeds"),
          invoke<RssFolder[]>("rss_list_folders").catch(() => [] as RssFolder[]),
        ]);
        feedsLoadedAt = Date.now();
        set({ feeds, folders, loading: false, error: null });
      } catch (e) {
        set({ loading: false, error: String(e) });
      } finally {
        feedsInFlight = null;
      }
    })();
    await feedsInFlight;
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
    if (get().refreshingFeedId != null) return;
    set({
      refreshingFeedId: id,
      refreshProgress: {
        scope: "feed",
        phase: "fetching",
        feedId: id,
        feedTitle: get().feeds.find((feed) => feed.id === id)?.title ?? null,
        completed: 0,
        total: 1,
        failed: 0,
      },
      error: null,
    });
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<RssRefreshProgress>("rss:refresh-progress", (event) => {
        if (event.payload.scope === "feed" && event.payload.feedId === id) {
          set({ refreshProgress: event.payload });
        }
      });
      await invoke<number>("rss_refresh_feed", { id });
      await get().loadFeeds({ force: true });
      if (get().view === "articles" && get().selectedFeedId === id) {
        invalidateArticleCache(id);
        await get().loadArticles({ force: true });
      }
    } catch (e) {
      set({ error: String(e) });
    } finally {
      unlisten?.();
      set({ refreshingFeedId: null, refreshProgress: null });
    }
  },

  refreshAll: async () => {
    if (!isTauriRuntime()) return;
    if (get().refreshingFeedId != null) return;
    const knownTotal = get().feeds.length;
    set({
      refreshingFeedId: -1,
      refreshProgress: {
        scope: "all",
        phase: "fetching",
        feedId: null,
        feedTitle: null,
        completed: 0,
        total: knownTotal,
        failed: 0,
      },
      error: null,
    });
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<RssRefreshProgress>("rss:refresh-progress", (event) => {
        if (event.payload.scope === "all") {
          set({ refreshProgress: event.payload });
        }
      });
      await invoke<number>("rss_refresh_all");
      await get().loadFeeds({ force: true });
      invalidateArticleCache();
      if (get().view === "articles") await get().loadArticles({ force: true });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      unlisten?.();
      set({ refreshingFeedId: null, refreshProgress: null });
    }
  },

  removeFeed: async (id) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_remove_feed", { id });
      invalidateArticleCache(id);
      await get().loadFeeds({ force: true });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addFeed: async (url) => {
    if (!isTauriRuntime()) return;
    set({ loading: true, error: null });
    try {
      await invoke<RssFeed>("rss_add_feed", { url });
      await get().loadFeeds({ force: true });
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
      await get().loadFeeds({ force: true });
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
      await get().loadFeeds({ force: true });
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
      await get().loadFeeds({ force: true });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteFolder: async (id) => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("rss_delete_folder", { id });
      await get().loadFeeds({ force: true });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  importOpml: async (content) => {
    if (!isTauriRuntime()) return 0;
    set({ loading: true, error: null, statusMessage: { kind: "importingOpml" } });
    try {
      const count = await invoke<number>("rss_import_opml", { content });
      await get().loadFeeds({ force: true });
      set({
        loading: false,
        statusMessage: { kind: "importedFeeds", count },
      });
      window.setTimeout(() => {
        if (get().statusMessage?.kind === "importedFeeds") set({ statusMessage: null });
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

  loadArticles: async (options = {}) => {
    const { selectedFeedId, filter, search } = get();
    if (!isTauriRuntime()) {
      set({ articles: [], error: null });
      return;
    }
    if (selectedFeedId == null) {
      set({ articles: [] });
      return;
    }
    const key = articleCacheKey(selectedFeedId, filter, search);
    const cached = articleCache.get(key);
    if (cached) {
      articleCache.delete(key);
      articleCache.set(key, cached);
      activeArticlesKey = key;
      set({ articles: cached.articles, error: null });
      if (!options.force && Date.now() - cached.loadedAt < RSS_ARTICLES_FRESH_MS) return;
    } else if (activeArticlesKey !== key) {
      activeArticlesKey = key;
      set({ articles: [] });
    }
    const existingRequest = articleRequests.get(key);
    if (existingRequest) {
      await existingRequest;
      return;
    }

    const request = (async () => {
      try {
        const articles = await invoke<RssArticle[]>("rss_list_articles", {
          feedId: selectedFeedId,
          onlyUnread: filter === "unread",
          onlyStarred: filter === "starred",
          query: search.trim() || null,
          limit: RSS_ARTICLE_LIST_LIMIT,
        });
        rememberArticles(key, articles);
        const latest = get();
        if (latest.selectedFeedId != null
          && articleCacheKey(latest.selectedFeedId, latest.filter, latest.search) === key) {
          activeArticlesKey = key;
          set({ articles, error: null });
        }
      } catch (e) {
        const latest = get();
        if (latest.selectedFeedId != null
          && articleCacheKey(latest.selectedFeedId, latest.filter, latest.search) === key) {
          set({ error: String(e) });
        }
      } finally {
        articleRequests.delete(key);
      }
    })();
    articleRequests.set(key, request);
    await request;
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
        invalidateArticleCache(a.feed_id);
        void get().loadArticles({ force: true });
        void get().loadFeeds({ force: true });
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
      invalidateArticleCache(get().selectedFeedId ?? undefined);
      void get().loadFeeds({ force: true });
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
      invalidateArticleCache(feedId);
      void get().loadFeeds({ force: true });
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
      invalidateArticleCache(get().selectedFeedId ?? undefined);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveReadingProgress: async (id, progress) => {
    if (!isTauriRuntime()) return;
    const normalized = Math.max(0, Math.min(100, Math.round(progress)));
    try {
      await invoke("rss_set_reading_progress", { id, progress: normalized });
      set((s) => ({
        articles: s.articles.map((a) => (a.id === id ? { ...a, reading_progress: normalized } : a)),
        readingArticles: s.readingArticles.map((a) =>
          a.id === id ? { ...a, reading_progress: normalized } : a,
        ),
        currentArticle:
          s.currentArticle?.id === id
            ? { ...s.currentArticle, reading_progress: normalized }
            : s.currentArticle,
      }));
    } catch {
      // Reading-position persistence is best-effort and must not interrupt reading.
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

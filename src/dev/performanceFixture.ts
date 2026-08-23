import { useStore, type ClipboardEntry } from "../store";
import { useRssStore, type RssArticle, type RssFeed } from "../modules/rss/store";

/**
 * Deterministic, synthetic large-list fixture for localhost CDP profiling.
 * The exact query gate and Vite DEV constant keep this out of normal desktop
 * sessions and production behavior. No real clipboard or RSS content is read.
 */
export function installDevPerformanceFixture(name: string | null): void {
  if (!import.meta.env.DEV || name !== "large-lists") return;

  const now = Date.now();
  const clipboardHistory: ClipboardEntry[] = Array.from({ length: 10_000 }, (_, index) => ({
    id: `perf-clipboard-${index}`,
    text: index % 13 === 0 ? `search-target-${index}` : `clipboard item ${index}`,
    timestamp: new Date(now - index * 60_000).toISOString(),
    pinned: index < 12,
    copy_count: index % 17,
    image_path: null,
    file_path: null,
  }));
  useStore.getState().setClipboardHistory(clipboardHistory);

  const feeds: RssFeed[] = Array.from({ length: 13 }, (_, index) => ({
    id: index + 1,
    url: `https://example.invalid/feed-${index + 1}.xml`,
    title: index === 0 ? "Performance Feed" : `Synthetic Feed ${index + 1}`,
    icon: "",
    last_fetched: Math.floor(now / 1000),
    latest_article_published_at: Math.floor(now / 1000) - index,
    error_count: 0,
    unread_count: 120,
    created_at: Math.floor(now / 1000) - index,
    folder_id: null,
    folder_name: null,
  }));
  const allArticles: RssArticle[] = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1,
    feed_id: 1,
    guid: `perf-article-${index}`,
    title: index % 11 === 0 ? `Latency target ${index}` : `Synthetic article ${index}`,
    summary: `Bounded summary ${index}`,
    content: "",
    author: "Qx performance fixture",
    link: `https://example.invalid/article-${index}`,
    image_url: "",
    is_read: index % 3 === 0,
    is_starred: index % 19 === 0,
    reading_progress: 0,
    published_at: Math.floor(now / 1000) - index * 60,
    created_at: Math.floor(now / 1000) - index * 60,
  }));

  useRssStore.setState({
    view: "feeds",
    feeds,
    folders: [],
    articles: [],
    loading: false,
    error: null,
    loadFeeds: async () => {},
    loadFolders: async () => {},
    loadArticles: async () => {
      const state = useRssStore.getState();
      const query = state.search.trim().toLocaleLowerCase();
      const articles = allArticles.filter((article) => (
        (!query
          || article.title.toLocaleLowerCase().includes(query)
          || article.summary.toLocaleLowerCase().includes(query))
        && (state.filter !== "unread" || !article.is_read)
        && (state.filter !== "starred" || article.is_starred)
      ));
      useRssStore.setState({ articles, error: null });
    },
  });
}

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssArticle } from "./store";
import {
  classifyArticleTime,
  collectArticleImageUrls,
  downloadArticleHtml,
  formatDate,
  sanitizeHtml,
} from "./article-utils";
import { prepareArticleImage, prewarmArticleImages } from "./articleImageCache";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import {
  qxMasterDetailIds,
  qxMasterDetailNavigation,
  qxRegionProps,
  useQxMasterDetailFocus,
} from "../../hooks/useQxMasterDetail";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useSettingsStore } from "../settings/store";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxActionSections } from "../../components/QxActionPanel";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import QxResizableSplit from "../../components/QxResizableSplit";
import QxMediaViewer from "../../components/QxMediaViewer";
import QxReplyList from "../../components/QxReplyList";
import { useArticleReadingProgress } from "./useArticleReadingProgress";
import { useT } from "../../i18n";
import { buildRssRefreshIsland } from "./refreshProgress";
import { getQxDesktopPlatform } from "../../utils/keyboard";
import { isBuiltinModuleEnabled } from "../moduleAvailability";

const PzaiAssistantPanel = lazy(() => import("../p-zai/PzaiAssistantPanel"));

function isDisplayableReaderImage(image: HTMLImageElement): boolean {
  const src = image.getAttribute("src")?.trim() ?? "";
  if (!src || src.startsWith("data:image/gif")) return false;
  const state = image.dataset.qxImageState;
  return state !== "failed" && state !== "loading";
}

function collectVisibleReaderImages(heroSrc: string | null, alt: string): { url: string; alt: string }[] {
  const seen = new Set<string>();
  const images: { url: string; alt: string }[] = [];
  const push = (url: string | null | undefined) => {
    const next = url?.trim() ?? "";
    if (!next || next.startsWith("data:image/gif") || seen.has(next)) return;
    seen.add(next);
    images.push({ url: next, alt });
  };
  push(heroSrc);
  const root = document.getElementById("rss-article-content");
  if (root) {
    for (const image of root.querySelectorAll("img")) {
      if (isDisplayableReaderImage(image)) push(image.getAttribute("src"));
    }
  }
  return images;
}

interface V2exReply {
  id: number;
  content: string;
  author: string;
  created: number;
  floor: number;
  parent_id?: number;
  depth?: number;
  reply_to_author?: string;
}
function formatTime(publishedAt: number): string {
  if (!publishedAt) return "";
  const d = new Date(publishedAt * 1000);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Section {
  key: "today" | "yesterday" | "earlier";
  label: string;
  items: RssArticle[];
}

const RSS_LIST_WIDTH_KEY = "qx:rss:list-width";
const DEFAULT_RSS_LIST_WIDTH = 340;
const MD = qxMasterDetailIds("rss");

export default function ArticleList() {
  const t = useT();
  const useRustImageCache = getQxDesktopPlatform() === "windows";
  const {
    feeds,
    selectedFeedId,
    selectedArticleId,
    articles,
    readingArticles,
    currentArticle,
    refreshProgress,
    selectedIndex,
    setSelectedIndex,
    filter,
    setFilter,
    search,
    setSearch,
    refreshingFeedId,
    loadArticles,
    openArticle,
    markRead,
    markAllRead,
    toggleStar,
    saveReadingProgress,
    refreshFeed,
    refreshAll,
    goBack,
  } = useRssStore();

  const [localQuery, setLocalQuery] = useState("");
  const [lightbox, setLightbox] = useState<{ images: { url: string; alt: string }[]; index: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { focusList, focusDetail } = useQxMasterDetailFocus(shellRef, MD);
  const rss = useSettingsStore((s) => s.settings.rss);
  const pzaiEnabled = useSettingsStore((s) => isBuiltinModuleEnabled("p-zai", s.settings));
  const { bottom_island_mode, image_display_mode, image_fixed_width, article_font_size, article_font_family } = rss;

  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [heroImageSrc, setHeroImageSrc] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [v2exReplies, setV2exReplies] = useState<V2exReply[]>([]);
  const [v2exLoading, setV2exLoading] = useState(false);
  const [pzaiOpen, setPzaiOpen] = useState(false);
  const [pzaiConversationIds, setPzaiConversationIds] = useState<Record<number, string>>({});

  const rememberPzaiConversation = useCallback((articleId: number, conversationId: string) => {
    setPzaiConversationIds((current) => (
      current[articleId] === conversationId
        ? current
        : { ...current, [articleId]: conversationId }
    ));
  }, []);

  useEffect(() => {
    setOriginalContent(null);
    setLoadingOriginal(false);
  }, [currentArticle?.id]);

  const v2exTopicId = useMemo(() => {
    const m = currentArticle?.link?.match(/^https?:\/\/(?:www\.)?v2ex\.com\/t\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [currentArticle?.link]);

  useEffect(() => {
    if (!v2exTopicId) {
      setV2exReplies([]);
      return;
    }
    setV2exLoading(true);
    invoke<V2exReply[]>("v2ex_fetch_topic_replies", { topicId: v2exTopicId })
      .then(setV2exReplies)
      .catch(() => setV2exReplies([]))
      .finally(() => setV2exLoading(false));
  }, [v2exTopicId]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles, selectedFeedId, filter]);

  useEffect(() => {
    setLocalQuery(search);
  }, [search]);

  const feed = useMemo(
    () => feeds.find((f) => f.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId],
  );
  const cleanContent = useMemo(
    () => (currentArticle
      ? sanitizeHtml(
          originalContent ?? currentArticle.content ?? currentArticle.summary,
          currentArticle.link,
          useRustImageCache ? "rust-cache" : "webview",
        )
      : ""),
    [currentArticle, originalContent, useRustImageCache],
  );

  const prewarmArticle = useCallback((article: RssArticle | undefined) => {
    if (!useRustImageCache || !article) return;
    const urls = collectArticleImageUrls(article.content || article.summary, article.link);
    if (article.image_url?.trim()) urls.unshift(article.image_url.trim());
    prewarmArticleImages(urls, article.link);
  }, [useRustImageCache]);
  const articleContentStyle = {
    "--rss-article-font-size": `${article_font_size}px`,
    "--rss-article-line-height": article_font_size > 16 ? "1.7" : "1.55",
    "--rss-article-font-family": article_font_family,
    "--rss-image-width": `${image_fixed_width}px`,
  } as CSSProperties;
  const heroImgStyle: CSSProperties = image_display_mode === "thumb"
    ? {
        width: 72,
        height: 72,
        maxWidth: 72,
        objectFit: "cover" as const,
        marginBottom: 10,
        cursor: "zoom-in",
        display: "block",
        borderRadius: 4,
      }
    : image_display_mode === "fixed"
    ? {
        maxWidth: image_fixed_width,
        width: image_fixed_width,
        height: "auto",
        objectFit: "cover" as const,
        marginBottom: 10,
        cursor: "zoom-in",
        display: "block",
        borderRadius: 4,
      }
    : {
        width: "100%",
        maxHeight: 280,
        objectFit: "cover" as const,
        marginBottom: 10,
        cursor: "zoom-in",
        display: "block",
        borderRadius: 4,
      };
  const sections: Section[] = useMemo(() => {
    const groups: Record<string, RssArticle[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    for (const a of articles) {
      groups[classifyArticleTime(a.published_at)].push(a);
    }
    return (["today", "yesterday", "earlier"] as const)
      .map((k) => ({
        key: k,
        label: {
          today: t("rss.section.today", "Today"),
          yesterday: t("rss.section.yesterday", "Yesterday"),
          earlier: t("rss.section.earlier", "Earlier"),
        }[k],
        items: groups[k],
      }))
      .filter((s) => s.items.length > 0);
  }, [articles, t]);

  const flatIndex = (article: RssArticle): number =>
    articles.findIndex((a) => a.id === article.id);

  useEffect(() => {
    setSelectedIndex(0);
  }, [articles.length, setSelectedIndex]);

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: articles.map((a) => a.id).join("\0"),
  });

  const filterChips: { key: typeof filter; label: string }[] = [
    { key: "all", label: t("common.all", "All") },
    { key: "unread", label: t("rss.unread", "Unread") },
    { key: "starred", label: t("rss.starred", "Starred") },
  ];
  const selectedArticle = articles[selectedIndex];
  const unreadCount = articles.filter((article) => !article.is_read).length;
  const currentIdx = readingArticles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? readingArticles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < readingArticles.length - 1 ? readingArticles[currentIdx + 1] : null;
  const articleProgress = readingArticles.length > 0 && currentIdx >= 0
    ? Math.round(((currentIdx + 1) / readingArticles.length) * 100)
    : 0;

  const scrollPercent = useArticleReadingProgress({
    articleId: currentArticle?.id ?? null,
    storedProgress: currentArticle?.reading_progress ?? 0,
    scrollRef,
    saveProgress: saveReadingProgress,
  });

  const openArticleForReading = useCallback(
    async (id: number, focusReader = false) => {
      const index = articles.findIndex((article) => article.id === id);
      if (index >= 0) {
        setSelectedIndex(index);
        prewarmArticle(articles[index]);
      }
      await openArticle(id);
      window.requestAnimationFrame(() => {
        if (focusReader) focusDetail();
        window.requestAnimationFrame(() => {
          if (focusReader) focusDetail();
        });
      });
    },
    [articles, focusDetail, openArticle, prewarmArticle, setSelectedIndex],
  );

  const closeArticleToList = useCallback(() => {
    goBack();
    window.requestAnimationFrame(focusList);
  }, [focusList, goBack]);

  useEffect(() => {
    prewarmArticle(articles[selectedIndex]);
    prewarmArticle(articles[selectedIndex - 1]);
    prewarmArticle(articles[selectedIndex + 1]);
  }, [articles, prewarmArticle, selectedIndex]);

  useEffect(() => {
    prewarmArticle(currentArticle ?? undefined);
    const nextArticle = readingArticles.findIndex((article) => article.id === currentArticle?.id);
    if (nextArticle >= 0) prewarmArticle(readingArticles[nextArticle + 1]);
  }, [currentArticle, prewarmArticle, readingArticles]);

  useEffect(() => {
    const root = document.getElementById("rss-article-content");
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName !== "IMG") return;
      const src = target.getAttribute("src");
      if (!src) return;
      const images = collectVisibleReaderImages(heroImageSrc, currentArticle?.title || "");
      const index = Math.max(0, images.findIndex((image) => image.url === src));
      setLightbox({
        images: images.length > 0 ? images : [{ url: src, alt: currentArticle?.title || "" }],
        index,
      });
    };
    root.addEventListener("click", onClick);
    if (!useRustImageCache) {
      return () => root.removeEventListener("click", onClick);
    }

    let cancelled = false;
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-qx-remote-src]"));
    let nextImage = 0;
    const loadNext = async () => {
      while (!cancelled) {
        const image = images[nextImage++];
        if (!image) return;
        const url = image.dataset.qxRemoteSrc;
        if (!url) continue;
        image.dataset.qxImageState = "loading";
        try {
          const source = await prepareArticleImage(url, currentArticle?.link);
          if (cancelled || !image.isConnected) return;
          const reveal = () => {
            if (!cancelled && image.isConnected) image.dataset.qxImageState = "loaded";
          };
          const fail = () => {
            if (!cancelled && image.isConnected) image.dataset.qxImageState = "failed";
          };
          image.addEventListener("load", reveal, { once: true });
          image.addEventListener("error", fail, { once: true });
          image.src = source;
          // A decoded shared source can complete synchronously before the
          // browser schedules a load event for this visible element.
          if (image.complete && image.naturalWidth > 0) reveal();
        } catch {
          if (!cancelled && image.isConnected) image.dataset.qxImageState = "failed";
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, images.length) }, () => loadNext()));

    return () => {
      cancelled = true;
      root.removeEventListener("click", onClick);
    };
  }, [cleanContent, currentArticle?.link, currentArticle?.title, heroImageSrc, useRustImageCache]);

  useEffect(() => {
    let cancelled = false;
    setHeroImageSrc(null);
    const url = currentArticle?.image_url?.trim();
    if (!url) return () => {
      cancelled = true;
    };
    if (!useRustImageCache) {
      setHeroImageSrc(url);
      return () => {
        cancelled = true;
      };
    }
    void prepareArticleImage(url, currentArticle?.link)
      .then((source) => {
        if (!cancelled) setHeroImageSrc(source);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentArticle?.image_url, currentArticle?.link, useRustImageCache]);

  useEffect(() => {
    if (!currentArticle) return;
    const index = articles.findIndex((article) => article.id === currentArticle.id);
    if (index >= 0 && index !== selectedIndex) setSelectedIndex(index);
  }, [articles, currentArticle, selectedIndex, setSelectedIndex]);

  const shell = useQxModuleShell({
    leave: goBack,
    esc: {
      inner: {
        active: pzaiOpen || currentArticle !== null || lightbox !== null,
        close: () => {
          if (lightbox) {
            setLightbox(null);
            return;
          }
          if (pzaiOpen) {
            setPzaiOpen(false);
            return;
          }
          closeArticleToList();
        },
      },
      query: {
        active: localQuery.length > 0,
        clear: () => {
          setLocalQuery("");
          setSearch("");
        },
      },
    },
    island: refreshingFeedId != null
      ? buildRssRefreshIsland(refreshProgress, feed?.title, t)
      : currentArticle
        ? {
            label: t("rss.reading", "Reading RSS"),
            detail:
              bottom_island_mode === "index"
                ? t("rss.articleIndex", "{current}/{total} articles")
                    .replace("{current}", String(currentIdx >= 0 ? currentIdx + 1 : 0))
                    .replace("{total}", String(readingArticles.length || 1))
                : `${scrollPercent}%`,
            progress: bottom_island_mode === "index" ? articleProgress : scrollPercent,
          }
        : {
            label: feed?.title || t("rss.articles", "RSS Articles"),
            detail: t("rss.articleSummary", "{articles} articles · {unread} unread · {filter}")
              .replace("{articles}", String(articles.length))
              .replace("{unread}", String(unreadCount))
              .replace("{filter}", filterChips.find((chip) => chip.key === filter)?.label ?? filter),
          },
  });

  const focusArticle = currentArticle ?? selectedArticle;
  const actions = useMemo<QxShellAction[]>(() => {
    const list: QxShellAction[] = [
      {
        id: "read-article",
        label: t("rss.readArticle", "Read Article"),
        kbd: "↵",
        disabled: !focusArticle || Boolean(currentArticle),
        onClick: () => {
          if (focusArticle && !currentArticle) void openArticleForReading(focusArticle.id, true);
        },
      },
      {
        id: "return-to-article-list",
        label: t("rss.returnToArticleList", "Back to Article List"),
        kbd: "↵",
        disabled: !currentArticle,
        onClick: closeArticleToList,
      },
      ...(pzaiEnabled ? [{
        id: "ask-pzai",
        label: t("rss.askPzai", "Ask P仔"),
        disabled: !currentArticle,
        onClick: () => setPzaiOpen(true),
      }] : []),
      {
        id: "toggle-star",
        label: focusArticle?.is_starred
          ? t("rss.unsaveArticle", "Remove Saved Article")
          : t("rss.saveArticle", "Save Article"),
        kbd: "CmdOrCtrl+D",
        disabled: !focusArticle,
        onClick: () => {
          if (focusArticle) void toggleStar(focusArticle.id, !focusArticle.is_starred);
        },
      },
      {
        id: "toggle-read",
        label: focusArticle?.is_read
          ? t("rss.markUnread", "Mark Unread")
          : t("rss.markRead", "Mark Read"),
        disabled: !focusArticle,
        onClick: () => {
          if (focusArticle) void markRead(focusArticle.id, !focusArticle.is_read);
        },
      },
      {
        id: "download-article",
        label: t("rss.downloadArticle", "Download Article"),
        kbd: "CmdOrCtrl+S",
        disabled: !focusArticle,
        onClick: () => {
          if (focusArticle) downloadArticleHtml(focusArticle);
        },
      },
      {
        id: "open-browser",
        label: t("rss.openBrowser", "Open in Browser"),
        disabled: !focusArticle?.link,
        onClick: () => {
          if (focusArticle?.link) void openUrl(focusArticle.link);
        },
      },
      {
        id: "load-original",
        label: originalContent
          ? t("rss.revertFeedContent", "Revert to Feed Content")
          : loadingOriginal
            ? t("common.loading", "Loading...")
            : t("rss.loadFullArticle", "Load Full Article"),
        disabled: !currentArticle?.link || loadingOriginal,
        onClick: () => {
          if (originalContent) {
            setOriginalContent(null);
          } else if (currentArticle?.link) {
            setLoadingOriginal(true);
            void invoke<string>("rss_fetch_original_content", { url: currentArticle.link })
              .then((html) => setOriginalContent(html))
              .catch(() => {})
              .finally(() => setLoadingOriginal(false));
          }
        },
      },
      {
        id: "refresh-feed",
        label: t("rss.refreshFeed", "Refresh Feed"),
        kbd: "CmdOrCtrl+R",
        disabled: selectedFeedId == null || refreshingFeedId != null,
        onClick: () => {
          if (selectedFeedId != null) void refreshFeed(selectedFeedId);
        },
      },
      {
        id: "refresh-all",
        label: t("rss.refreshAll", "Refresh All"),
        kbd: "CmdOrCtrl+Shift+R",
        disabled: refreshingFeedId != null,
        onClick: () => void refreshAll(),
      },
    ];
    if (next) {
      list.push({
        id: "next-article",
        label: t("rss.nextArticle", "Next: {title}").replace(
          "{title}",
          next.title?.slice(0, 40) || t("rss.untitled", "(untitled)"),
        ),
        onClick: () => void openArticleForReading(next.id),
      });
    }
    if (prev) {
      list.push({
        id: "previous-article",
        label: t("rss.previousArticle", "Prev: {title}").replace(
          "{title}",
          prev.title?.slice(0, 40) || t("rss.untitled", "(untitled)"),
        ),
        onClick: () => void openArticleForReading(prev.id),
      });
    }
    return list;
  }, [closeArticleToList, currentArticle, focusArticle, loadingOriginal, markRead, next, openArticleForReading, originalContent, prev, pzaiEnabled, refreshAll, refreshFeed, refreshingFeedId, selectedFeedId, t, toggleStar]);

  const primaryActionId = currentArticle ? "return-to-article-list" : "read-article";
  const articleActionIds = [
    ...(!currentArticle ? ["read-article"] : []),
    ...(currentArticle && pzaiEnabled ? ["ask-pzai"] : []),
    "toggle-star",
    "toggle-read",
    "download-article",
    "open-browser",
    ...(currentArticle ? ["load-original"] : []),
  ];
  const articleActions = actions.filter((action) => action.id !== primaryActionId && articleActionIds.includes(action.id));
  const feedActions = actions.filter((action) => action.id !== primaryActionId
    && ["refresh-feed", "refresh-all"].includes(action.id));
  const navigationActions = actions.filter((action) => action.id !== primaryActionId
    && ["next-article", "previous-article"].includes(action.id));

  const isReading = Boolean(currentArticle);
  const pzaiArticleContext = useMemo(() => (
    currentArticle
      ? {
          id: currentArticle.id,
          title: currentArticle.title,
          link: currentArticle.link,
          author: currentArticle.author,
          content: originalContent ?? currentArticle.content ?? currentArticle.summary,
        }
      : null
  ), [currentArticle, originalContent]);

  return (
    <QxShell
      ref={shellRef}
      title={feed?.title || t("rss.articles", "RSS Articles")}
      islandKey="rss.article-list"
      // List browsing stays dense/solid; open article softens chrome for reading.
      visual={isReading ? "glass" : "solid"}
      className={`qx-content-shell qx-rss-shell${isReading ? " is-reading" : ""}`}
      onKeyDown={shell.onKeyDown}
      navigation={qxMasterDetailNavigation({
        ids: MD,
        index: selectedIndex,
        count: articles.length,
        onChange: setSelectedIndex,
        onOpen: () => {
          const a = articles[selectedIndex];
          if (a) void openArticleForReading(a.id, true);
        },
        onClose: () => {
          if (currentArticle) closeArticleToList();
        },
        pageSize: 8,
        focusList,
        focusDetail,
      })}
      escapeAction={shell.escapeAction}
      search={
        <QxModuleSearch
          value={localQuery}
          autoFocus={!isReading}
          onChange={(next) => {
            setLocalQuery(next);
            setSearch(next);
          }}
          placeholder={feed
            ? t("rss.searchInFeed", "Search in {feed}…").replace("{feed}", feed.title)
            : t("rss.searchArticles", "Search articles...")}
        />
      }
      topbarFilters={[{
        id: "article-state",
        label: t("rss.articleFilter", "Article filter"),
        value: filter,
        options: filterChips.map((chip) => ({
          value: chip.key,
          label: chip.label,
        })),
        onChange: (value) => setFilter(value as typeof filter),
      }]}
      context={
        pzaiOpen && currentArticle && pzaiArticleContext ? (
          <Suspense
            fallback={(
              <div className="qx-pzai-assistant-loading">
                {t("pzai.assistant.preparing", "Preparing article context…")}
              </div>
            )}
          >
            <PzaiAssistantPanel
              key={currentArticle.id}
              article={pzaiArticleContext}
              conversationId={pzaiConversationIds[currentArticle.id]}
              onConversationCreated={rememberPzaiConversation}
              onClose={() => setPzaiOpen(false)}
            />
          </Suspense>
        ) : (
          <aside
            className="qx-action-panel"
            {...qxRegionProps(MD.actions, {
              label: t("rss.articleActions", "Article actions"),
              scroll: true,
            })}
          >
            <QxActionSections
              sections={[
                {
                  id: "article",
                  title: t("rss.article", "Article"),
                  actions: articleActions,
                },
                {
                  id: "refresh",
                  title: t("rss.refresh", "Refresh"),
                  actions: feedActions,
                  showShortcuts: true,
                },
                {
                  id: "navigation",
                  title: t("rss.navigation", "Navigation"),
                  actions: navigationActions,
                  showShortcuts: false,
                },
              ]}
            />
          </aside>
        )
      }
      island={shell.island}
      primaryActionId={primaryActionId}
      actions={actions}
    >
      <QxResizableSplit
        className={`qx-content-split qx-rss-article-split${currentArticle ? " has-detail" : ""}`}
        storageKey={RSS_LIST_WIDTH_KEY}
        defaultLeftWidth={DEFAULT_RSS_LIST_WIDTH}
        minLeftWidth={220}
        minRightWidth={320}
        separatorLabel={t("rss.resizeList", "Resize RSS article list")}
      >
        <div
          ref={listRef}
          className="qx-content-list qx-plugin-list"
          role="listbox"
          aria-label={t("rss.articleList", "Article list")}
          {...qxRegionProps(MD.list, {
            label: t("rss.articleList", "Article list"),
            initial: !isReading,
            scroll: true,
          })}
        >
          {sections.map((section) => (
            <div key={section.key}>
              <div className="qx-section-header">
                <span style={{ flex: 1 }}>{section.label}</span>
                <span>{section.items.length}</span>
                {section.key === "today" && feed && (
                  <button className="qx-command-button ghost" onClick={() => void markAllRead(feed.id)}>
                    {t("rss.markAllRead", "Mark all read")}
                  </button>
                )}
              </div>
              {section.items.map((a) => {
                const idx = flatIndex(a);
                return (
                  <button
                    key={a.id}
                    {...getItemProps(idx, {
                      className: `tall${a.is_read ? " is-read" : " is-unread"}`,
                    })}
                    onClick={() => {
                      setSelectedIndex(idx);
                      void openArticleForReading(a.id);
                    }}
                    type="button"
                  >
                    <span className={`qx-rss-dot${a.is_read ? " is-read" : ""}`} />
                    <span className="qx-list-copy">
                      <span className="qx-list-title">
                        {a.title || t("rss.untitled", "(untitled)")}
                      </span>
                      <span className="qx-list-subtitle">{stripHtml(a.summary).slice(0, 120)}</span>
                    </span>
                    <span className="qx-list-time">
                      {a.reading_progress > 0 && a.reading_progress < 100
                        ? `${Math.round(a.reading_progress)}% · `
                        : ""}
                      {formatTime(a.published_at)}
                      {a.is_starred ? " ★" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {shouldShowQxListLoading(refreshingFeedId != null, articles.length) ? (
            <QxListLoading
              ariaLabel={t("rss.refreshingArticles", "Refreshing articles")}
              label={t("rss.refreshing", "Refreshing...")}
              rows={4}
              variant="tall"
            />
          ) : articles.length === 0 ? (
            <div className="qx-empty-state">
              {t("rss.noArticles", "No articles in this feed.")}
            </div>
          ) : null}
        </div>

        <article
          className="qx-content-detail qx-plugin-detail qx-rss-detail-content qx-rss-reader"
          {...qxRegionProps(MD.detail, {
            label: t("rss.articleReader", "Article reader"),
            initial: isReading,
          })}
          aria-hidden={!isReading}
        >
          {currentArticle ? (
            <>
              <div className="qx-detail-header qx-rss-reader-chrome">
                <div className="qx-rss-reader-chrome-copy">
                  <div className="qx-detail-title">
                    {feed?.title || t("rss.article", "Article")}
                  </div>
                  <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
                </div>
                <span className="qx-badge">
                  {currentArticle.is_starred
                    ? t("rss.starred", "Starred")
                    : currentArticle.is_read
                      ? t("rss.read", "Read")
                      : t("rss.unread", "Unread")}
                </span>
              </div>
              <div ref={scrollRef} className="qx-content-detail-scroll qx-rss-reader-scroll" data-qx-region-scroll>
                <div className="qx-rss-reader-stage" style={articleContentStyle}>
                  {/* Title keep original sizing/weight from Settings font vars — do not restyle. */}
                  <h1
                    style={{
                      fontSize: Math.min(article_font_size + 4, 26),
                      fontWeight: 600,
                      fontFamily: article_font_family,
                      color: "var(--qx-text-primary)",
                      margin: "0 0 8px",
                      lineHeight: 1.3,
                    }}
                  >
                    {currentArticle.title || t("rss.untitled", "(untitled)")}
                  </h1>
                  <div className="qx-content-detail-meta">
                    {currentArticle.author && (
                      <span>
                        {t("rss.byAuthor", "By {author}").replace(
                          "{author}",
                          currentArticle.author,
                        )}
                      </span>
                    )}
                    {currentArticle.is_starred && <span>{t("rss.starred", "Starred")}</span>}
                    <span>
                      {currentArticle.is_read
                        ? t("rss.read", "Read")
                        : t("rss.unread", "Unread")}
                    </span>
                  </div>

                  {heroImageSrc && (
                    <img
                      src={heroImageSrc}
                      alt=""
                      onClick={() => {
                        const images = collectVisibleReaderImages(heroImageSrc, currentArticle.title || "");
                        setLightbox({
                          images: images.length > 0 ? images : [{ url: heroImageSrc, alt: currentArticle.title || "" }],
                          index: 0,
                        });
                      }}
                      className={`qx-rss-reader-hero${image_display_mode === "thumb" ? " is-thumb" : ""}`}
                      style={heroImgStyle}
                    />
                  )}

                  <div
                    id="rss-article-content"
                    className="rss-article-content"
                    data-image-mode={image_display_mode}
                    dangerouslySetInnerHTML={{ __html: cleanContent }}
                  />

                  {v2exTopicId != null && (
                    <QxReplyList
                      title={t("rss.v2exReplies.title", "V2EX Comments")}
                      total={v2exReplies.length}
                      loading={v2exLoading}
                      loadingText={t("rss.v2exReplies.loading", "Loading comments…")}
                      emptyText={t(
                        "rss.v2exReplies.empty",
                        "No comments loaded. Ensure a V2EX token is set in Settings.",
                      )}
                      items={v2exReplies.map((reply) => ({
                        id: String(reply.id),
                        floor: reply.floor,
                        author: reply.author,
                        parentId: reply.parent_id == null ? undefined : String(reply.parent_id),
                        depth: reply.depth,
                        replyToAuthor: reply.reply_to_author,
                        createdAt: formatTime(reply.created),
                        originalPoster: Boolean(
                          currentArticle.author
                            && reply.author === currentArticle.author,
                        ),
                        body: (
                          <span
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.content) }}
                          />
                        ),
                      }))}
                      originalPosterLabel={t("plugins.workbench.replies.op", "OP")}
                    />
                  )}

                  {originalContent && (
                    <div className="qx-rss-original-badge">
                      {t("rss.showingOriginal", "Showing original page content")}
                    </div>
                  )}

                  {next && (
                    <div className="qx-rss-next-article">
                      <div className="qx-rss-next-label">{t("rss.upNext", "Up Next")}</div>
                      <button
                        className="qx-rss-next-link"
                        onClick={() => void openArticleForReading(next.id)}
                        title={next.title || t("rss.untitled", "(untitled)")}
                        type="button"
                      >
                        {next.title || t("rss.untitled", "(untitled)")}
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </>
          ) : (
            <div className="qx-content-detail-empty">
              <div>{t("rss.selectArticle", "Select an article to read")}</div>
              <span>
                {t("rss.articleCountInFeed", "{n} articles in this feed").replace(
                  "{n}",
                  String(articles.length),
                )}
              </span>
            </div>
          )}
        </article>
      </QxResizableSplit>

      <QxMediaViewer
        open={Boolean(lightbox)}
        images={lightbox?.images ?? []}
        initialIndex={lightbox?.index ?? 0}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      />
    </QxShell>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssArticle } from "./store";
import { classifyArticleTime, formatDate, sanitizeHtml } from "./article-utils";
import { useEscBack } from "../../hooks/useEscBack";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { shouldIgnoreBareShortcut } from "../../utils/keyboard";
import { useSettingsStore } from "../settings/store";
import ImageLightbox from "./ImageLightbox";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { SegmentedControl } from "../../components/ui";

interface V2exReply {
  id: number;
  content: string;
  author: string;
  created: number;
  floor: number;
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

const SECTION_LABELS: Record<Section["key"], string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

const RSS_LIST_WIDTH_KEY = "qx:rss:list-width";
const DEFAULT_RSS_LIST_WIDTH = 340;

function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function readStoredWidth(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? stored : fallback;
}

export default function ArticleList() {
  const {
    feeds,
    selectedFeedId,
    selectedArticleId,
    articles,
    readingArticles,
    currentArticle,
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
    refreshFeed,
    goBack,
  } = useRssStore();

  const [localQuery, setLocalQuery] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [listWidth, setListWidth] = useState(() =>
    readStoredWidth(RSS_LIST_WIDTH_KEY, DEFAULT_RSS_LIST_WIDTH),
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rss = useSettingsStore((s) => s.settings.rss);
  const { bottom_island_mode, image_display_mode, image_fixed_width, article_font_size, article_font_family } = rss;

  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [v2exReplies, setV2exReplies] = useState<V2exReply[]>([]);
  const [v2exLoading, setV2exLoading] = useState(false);

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
    () => (currentArticle ? sanitizeHtml(originalContent ?? currentArticle.content ?? currentArticle.summary) : ""),
    [currentArticle, originalContent],
  );
  const articleContentStyle = {
    "--rss-article-font-size": `${article_font_size}px`,
    "--rss-article-line-height": article_font_size > 16 ? "1.7" : "1.55",
    "--rss-article-font-family": article_font_family,
    "--rss-image-width": `${image_fixed_width}px`,
  } as CSSProperties;
  const heroImgStyle: CSSProperties = image_display_mode === "fixed"
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
  // Only the in-content list/detail split is resizable. Shell context width
  // must stay on global --qx-context-w so every module shares one sidebar size.
  const shellStyle = {
    "--qx-rss-list-w": `${listWidth}px`,
  } as CSSProperties;

  const startListResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const split = splitRef.current;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    const min = 220;
    const max = Math.max(min, rect.width - 320);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const update = (clientX: number) => {
      const next = clampWidth(clientX - rect.left, min, max);
      setListWidth(next);
      window.localStorage.setItem(RSS_LIST_WIDTH_KEY, String(next));
    };
    const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const onUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    update(event.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  const nudgeListWidth = useCallback((delta: number) => {
    const split = splitRef.current;
    const rectWidth = split?.getBoundingClientRect().width ?? 980;
    const next = clampWidth(listWidth + delta, 220, Math.max(220, rectWidth - 320));
    setListWidth(next);
    window.localStorage.setItem(RSS_LIST_WIDTH_KEY, String(next));
  }, [listWidth]);

  const onListResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    nudgeListWidth(event.key === "ArrowLeft" ? -24 : 24);
  }, [nudgeListWidth]);

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
      .map((k) => ({ key: k, label: SECTION_LABELS[k], items: groups[k] }))
      .filter((s) => s.items.length > 0);
  }, [articles]);

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
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "starred", label: "Starred" },
  ];
  const selectedArticle = articles[selectedIndex];
  const unreadCount = articles.filter((article) => !article.is_read).length;
  const currentIdx = readingArticles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? readingArticles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < readingArticles.length - 1 ? readingArticles[currentIdx + 1] : null;
  const articleProgress = readingArticles.length > 0 && currentIdx >= 0
    ? Math.round(((currentIdx + 1) / readingArticles.length) * 100)
    : 0;

  const updateScrollProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setScrollPercent(currentArticle ? 100 : 0);
      return;
    }
    setScrollPercent(Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
  }, [currentArticle]);

  const resetArticleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setScrollPercent(0);
  }, []);

  const focusRegion = useCallback((id: string) => {
    shellRef.current
      ?.querySelector<HTMLElement>(`[data-qx-region="${id}"]`)
      ?.focus({ preventScroll: true });
  }, []);

  const openArticleAtTop = useCallback(
    async (id: number, focusReader = false) => {
      const index = articles.findIndex((article) => article.id === id);
      if (index >= 0) setSelectedIndex(index);
      resetArticleScroll();
      await openArticle(id);
      resetArticleScroll();
      window.requestAnimationFrame(() => {
        resetArticleScroll();
        if (focusReader) focusRegion("rss-reader");
        window.requestAnimationFrame(() => {
          resetArticleScroll();
          if (focusReader) focusRegion("rss-reader");
        });
      });
    },
    [articles, focusRegion, openArticle, resetArticleScroll, setSelectedIndex],
  );

  useEffect(() => {
    const root = document.getElementById("rss-article-content");
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "IMG") {
        const src = target.getAttribute("src");
        if (src) setLightbox(src);
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [cleanContent]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollProgress);
    updateScrollProgress();
    return () => el.removeEventListener("scroll", updateScrollProgress);
  }, [updateScrollProgress]);

  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    resetArticleScroll();
    const frame = window.requestAnimationFrame(updateScrollProgress);
    return () => window.cancelAnimationFrame(frame);
  }, [currentArticle?.id, cleanContent, resetArticleScroll, updateScrollProgress]);

  useEffect(() => {
    if (!currentArticle) return;
    const index = articles.findIndex((article) => article.id === currentArticle.id);
    if (index >= 0 && index !== selectedIndex) setSelectedIndex(index);
  }, [articles, currentArticle, selectedIndex, setSelectedIndex]);

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: currentArticle !== null || lightbox !== null,
      close: () => {
        if (lightbox) {
          setLightbox(null);
          return;
        }
        goBack();
      },
    },
    query: {
      active: localQuery.length > 0,
      clear: () => {
        setLocalQuery("");
        setSearch("");
      },
    },
    launcher: goBack,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    const ignoreBare = shouldIgnoreBareShortcut(e.nativeEvent);
    const region = e.target instanceof Element
      ? e.target.closest<HTMLElement>("[data-qx-region]")?.dataset.qxRegion
      : undefined;
    // ↑↓ / Page: QxShell.navigation (regionId rss-list) + useQxListSelection.
    // j/k remain article-reader shortcuts (next/prev while reading).
    switch (e.key) {
      case "j":
        if (ignoreBare || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (currentArticle && next) void openArticleAtTop(next.id);
        else setSelectedIndex(articles.length > 0 ? Math.min(selectedIndex + 1, articles.length - 1) : 0);
        focusRegion("rss-list");
        break;
      case "k":
        if (ignoreBare || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (currentArticle && prev) void openArticleAtTop(prev.id);
        else setSelectedIndex(Math.max(selectedIndex - 1, 0));
        focusRegion("rss-list");
        break;
      case "Enter": {
        if (region === "rss-reader") return;
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a) void openArticleAtTop(a.id, true);
        break;
      }
    }
  };

  const focusArticle = currentArticle ?? selectedArticle;
  const actions = useMemo<QxShellAction[]>(() => {
    const list: QxShellAction[] = [
      {
        label: currentArticle ? "Close Detail" : "Read Article",
        kbd: currentArticle ? "Esc" : "↵",
        disabled: !focusArticle,
        onClick: () => {
          if (currentArticle) goBack();
          else if (focusArticle) void openArticleAtTop(focusArticle.id);
        },
      },
      {
        label: focusArticle?.is_starred ? "Unstar" : "Star",
        kbd: "S",
        disabled: !focusArticle,
        onClick: () => {
          if (focusArticle) void toggleStar(focusArticle.id, !focusArticle.is_starred);
        },
      },
      {
        label: focusArticle?.is_read ? "Mark Unread" : "Mark Read",
        kbd: "U",
        disabled: !focusArticle,
        onClick: () => {
          if (focusArticle) void markRead(focusArticle.id, !focusArticle.is_read);
        },
      },
      {
        label: "Open in Browser",
        kbd: "O",
        disabled: !focusArticle?.link,
        onClick: () => {
          if (focusArticle?.link) void openUrl(focusArticle.link);
        },
      },
      {
        label: originalContent ? "Revert to Feed Content" : loadingOriginal ? "Loading..." : "Load Full Article",
        kbd: "L",
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
        label: "Refresh Feed",
        kbd: "R",
        disabled: selectedFeedId == null,
        onClick: () => {
          if (selectedFeedId != null) void refreshFeed(selectedFeedId);
        },
      },
    ];
    if (next) {
      list.push({
        label: `Next: ${next.title?.slice(0, 40) || "(untitled)"}`,
        kbd: "J",
        onClick: () => void openArticleAtTop(next.id),
      });
    }
    if (prev) {
      list.push({
        label: `Prev: ${prev.title?.slice(0, 40) || "(untitled)"}`,
        kbd: "K",
        onClick: () => void openArticleAtTop(prev.id),
      });
    }
    return list;
  }, [currentArticle, focusArticle, goBack, loadingOriginal, markRead, next, openArticleAtTop, originalContent, prev, refreshFeed, selectedFeedId, toggleStar]);

  const island: BottomIslandContent = refreshingFeedId != null
    ? {
        label: "RSS Syncing",
        detail: feed?.title,
        progress: 55,
        actionLabel: "Pause",
      }
    : currentArticle
    ? {
        label: "Reading RSS",
        detail:
          bottom_island_mode === "index"
            ? `${currentIdx >= 0 ? currentIdx + 1 : 0}/${readingArticles.length || 1} articles`
            : `${scrollPercent}%`,
        progress: bottom_island_mode === "index" ? articleProgress : scrollPercent,
      }
    : {
        label: feed?.title || "RSS Articles",
        detail: `${articles.length} articles · ${unreadCount} unread · ${filter}`,
      };

  const isReading = Boolean(currentArticle);

  return (
    <QxShell
      ref={shellRef}
      title={feed?.title || "RSS Articles"}
      // List browsing stays dense/solid; open article softens chrome for reading.
      visual={isReading ? "glass" : "solid"}
      className={`qx-content-shell qx-rss-shell${isReading ? " is-reading" : ""}`}
      style={shellStyle}
      onKeyDown={onKeyDown}
      navigation={{
        index: selectedIndex,
        count: articles.length,
        regionId: "rss-list",
        onChange: (index) => {
          setSelectedIndex(index);
          focusRegion("rss-list");
        },
        onOpen: () => {
          const a = articles[selectedIndex];
          if (a) void openArticleAtTop(a.id, true);
        },
        onClose: () => {
          if (currentArticle) goBack();
        },
        pageSize: 8,
      }}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <QxModuleSearch
          value={localQuery}
          autoFocus={!isReading}
          onChange={(next) => {
            setLocalQuery(next);
            setSearch(next);
          }}
          placeholder={feed ? `Search in ${feed.title}…` : "Search articles..."}
        />
      }
      trailing={
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={filterChips.map((chip) => ({
            value: chip.key,
            label: chip.label,
          }))}
        />
      }
      context={
        <div
          className="qx-action-panel"
          data-qx-region="rss-actions"
          data-qx-region-label="Article actions"
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-action-title">Article Actions</div>
          {actions.map((action, index) => (
            <button
              key={`${action.label}-${index}`}
              className={`qx-action-item${action.tone === "danger" ? " danger" : ""}`}
              onClick={action.onClick}
              disabled={action.disabled}
              type="button"
            >
              <span>{action.label}</span>
              {action.kbd && <kbd>{action.kbd}</kbd>}
            </button>
          ))}
        </div>
      }
      island={island}
      primaryAction={{
        label: currentArticle?.link ? "Open Original" : selectedArticle ? "Read Article" : "Back",
        kbd: currentArticle?.link ? "O" : selectedArticle ? "↵" : "Esc",
        tone: "primary",
        onClick: () => {
          if (currentArticle?.link) void openUrl(currentArticle.link);
          else if (selectedArticle) void openArticleAtTop(selectedArticle.id);
          else goBack();
        },
      }}
      secondaryAction={{ label: "Actions", kbd: "⌘K" }}
      actionTitle="Article Actions"
      actions={actions}
    >
      <div
        ref={splitRef}
        className={`qx-content-split qx-rss-article-split${currentArticle ? " has-detail" : ""}`}
      >
        <div
          ref={listRef}
          className="qx-content-list qx-plugin-list"
          role="listbox"
          aria-label="Article list"
          data-qx-region="rss-list"
          data-qx-region-label="Article list"
          data-qx-region-initial={isReading ? undefined : "true"}
          data-qx-region-scroll
          tabIndex={-1}
        >
          {sections.map((section) => (
            <div key={section.key}>
              <div className="qx-section-header">
                <span style={{ flex: 1 }}>{section.label}</span>
                <span>{section.items.length}</span>
                {section.key === "today" && feed && (
                  <button className="qx-command-button ghost" onClick={() => void markAllRead(feed.id)}>
                    Mark all read
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
                      void openArticleAtTop(a.id);
                    }}
                    type="button"
                  >
                    <span className={`qx-rss-dot${a.is_read ? " is-read" : ""}`} />
                    <span className="qx-list-copy">
                      <span className="qx-list-title">
                        {a.title || "(untitled)"}
                      </span>
                      <span className="qx-list-subtitle">{stripHtml(a.summary).slice(0, 120)}</span>
                    </span>
                    <span className="qx-list-time">
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
              ariaLabel="Refreshing articles"
              label="Refreshing..."
              rows={4}
              variant="tall"
            />
          ) : articles.length === 0 ? (
            <div className="qx-empty-state">No articles in this feed.</div>
          ) : null}
        </div>

        <div
          className="qx-rss-resize-handle qx-rss-list-resize"
          role="separator"
          aria-label="Resize RSS article list"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={startListResize}
          onKeyDown={onListResizeKeyDown}
          onDoubleClick={() => {
            setListWidth(DEFAULT_RSS_LIST_WIDTH);
            window.localStorage.setItem(RSS_LIST_WIDTH_KEY, String(DEFAULT_RSS_LIST_WIDTH));
          }}
        />

        <article
          className="qx-content-detail qx-plugin-detail qx-rss-detail-content qx-rss-reader"
          data-qx-region="rss-reader"
          data-qx-region-label="Article reader"
          data-qx-region-initial={isReading ? "true" : undefined}
          tabIndex={-1}
        >
          {currentArticle ? (
            <>
              <div className="qx-detail-header qx-rss-reader-chrome">
                <div className="qx-rss-reader-chrome-copy">
                  <div className="qx-detail-title">{feed?.title || "Article"}</div>
                  <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
                </div>
                <span className="qx-badge">
                  {currentArticle.is_starred ? "Starred" : currentArticle.is_read ? "Read" : "Unread"}
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
                    {currentArticle.title || "(untitled)"}
                  </h1>
                  <div className="qx-content-detail-meta">
                    {currentArticle.author && <span>By {currentArticle.author}</span>}
                    {currentArticle.is_starred && <span>Starred</span>}
                    <span>{currentArticle.is_read ? "Read" : "Unread"}</span>
                  </div>

                  {currentArticle.image_url && (
                    <img
                      src={currentArticle.image_url}
                      alt=""
                      onClick={() => setLightbox(currentArticle.image_url)}
                      className="qx-rss-reader-hero"
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
                    <div className="qx-rss-v2ex-comments">
                      <div className="qx-rss-v2ex-header">
                        V2EX Comments {v2exReplies.length > 0 && `(${v2exReplies.length})`}
                      </div>
                      {v2exLoading && (
                        <div className="qx-rss-v2ex-loading">Loading comments...</div>
                      )}
                      {!v2exLoading && v2exReplies.length === 0 && (
                        <div className="qx-rss-v2ex-empty">
                          No comments loaded. Ensure a V2EX token is set in Settings.
                        </div>
                      )}
                      {v2exReplies.map((reply) => (
                        <div key={reply.id} className="qx-rss-v2ex-reply">
                          <div className="qx-rss-v2ex-reply-meta">
                            <span className="qx-rss-v2ex-floor">#{reply.floor}</span>
                            <strong>{reply.author}</strong>
                            <span className="qx-rss-v2ex-time">{formatTime(reply.created)}</span>
                          </div>
                          <div
                            className="qx-rss-v2ex-reply-body"
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.content) }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {originalContent && (
                    <div className="qx-rss-original-badge">Showing original page content</div>
                  )}

                  {next && (
                    <div className="qx-rss-next-article">
                      <div className="qx-rss-next-label">Up Next</div>
                      <button
                        className="qx-rss-next-link"
                        onClick={() => void openArticleAtTop(next.id)}
                        title={next.title || "(untitled)"}
                        type="button"
                      >
                        {next.title || "(untitled)"}
                      </button>
                      <span className="qx-rss-next-kbd">
                        Press <kbd>J</kbd>
                      </span>
                    </div>
                  )}

                  {currentArticle.link && (
                    <div className="qx-content-detail-footer">
                      <button
                        className="qx-command-button"
                        onClick={() => void openUrl(currentArticle.link)}
                        type="button"
                      >
                        Open original
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="qx-content-detail-empty">
              <div>Select an article to read</div>
              <span>{articles.length} articles in this feed</span>
            </div>
          )}
        </article>
      </div>

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </QxShell>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssArticle } from "./store";
import { classifyArticleTime, formatDate, sanitizeHtml } from "./article-utils";
import { useEscBack } from "../../hooks/useEscBack";
import { shouldIgnoreBareShortcut } from "../../utils/keyboard";
import { useSettingsStore } from "../settings/store";
import ImageLightbox from "./ImageLightbox";
import { LoadingLabel, SegmentedControl, Skeleton } from "../../components/ui";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const rss = useSettingsStore((s) => s.settings.rss);
  const { bottom_island_mode, image_display_mode, image_fixed_width, article_font_size, article_font_family } = rss;

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
    () => (currentArticle ? sanitizeHtml(currentArticle.content || currentArticle.summary) : ""),
    [currentArticle],
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

  const openArticleAtTop = useCallback(
    async (id: number) => {
      const index = articles.findIndex((article) => article.id === id);
      if (index >= 0) setSelectedIndex(index);
      resetArticleScroll();
      await openArticle(id);
      resetArticleScroll();
      window.requestAnimationFrame(() => {
        resetArticleScroll();
        window.requestAnimationFrame(resetArticleScroll);
      });
    },
    [articles, openArticle, resetArticleScroll, setSelectedIndex],
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
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(articles.length > 0 ? Math.min(selectedIndex + 1, articles.length - 1) : 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "j":
        if (ignoreBare || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (currentArticle && next) void openArticleAtTop(next.id);
        else setSelectedIndex(articles.length > 0 ? Math.min(selectedIndex + 1, articles.length - 1) : 0);
        break;
      case "k":
        if (ignoreBare || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (currentArticle && prev) void openArticleAtTop(prev.id);
        else setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a) void openArticleAtTop(a.id);
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
  }, [currentArticle, focusArticle, goBack, markRead, next, openArticleAtTop, prev, refreshFeed, selectedFeedId, toggleStar]);

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

  return (
    <QxShell
      title={feed?.title || "RSS Articles"}
      className="qx-content-shell qx-rss-shell"
      onKeyDown={onKeyDown}
      onBack={goBack}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={localQuery}
            autoFocus
            onChange={(e) => {
              setLocalQuery(e.target.value);
              setSearch(e.target.value);
            }}
            placeholder={feed ? `Search in ${feed.title}…` : "Search articles..."}
            className="qx-plugin-search"
          />
        </div>
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
        <aside className="qx-action-panel">
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
        </aside>
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
      <div className={`qx-content-split${currentArticle ? " has-detail" : ""}`}>
        <div className="qx-content-list qx-plugin-list">
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
                const active = idx === selectedIndex;
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelectedIndex(idx);
                      void openArticleAtTop(a.id);
                    }}
                    className={`qx-list-row tall${active ? " is-active" : ""}${a.is_read ? " is-read" : " is-unread"}`}
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
          {articles.length === 0 && (
            <div className="qx-empty-state">
              {refreshingFeedId != null ? <LoadingLabel>Refreshing...</LoadingLabel> : "No articles in this feed."}
            </div>
          )}
          {refreshingFeedId != null && articles.length === 0 && (
            <div className="qx-skeleton-stack" aria-label="Refreshing articles">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="qx-skeleton-row" key={index}>
                  <Skeleton className="qx-skeleton-line short" style={{ width: 8, height: 8, borderRadius: 999 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Skeleton className="qx-skeleton-line long" />
                    <Skeleton className="qx-skeleton-line medium" style={{ marginTop: 8 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <article className="qx-content-detail qx-plugin-detail qx-rss-detail-content">
          {currentArticle ? (
            <>
              <div className="qx-detail-header">
                <div style={{ minWidth: 0 }}>
                  <div className="qx-detail-title">{feed?.title || "Article"}</div>
                  <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
                </div>
                <span className="qx-badge">{currentArticle.is_starred ? "Starred" : currentArticle.is_read ? "Read" : "Unread"}</span>
              </div>
              <div ref={scrollRef} className="qx-content-detail-scroll">
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
                    className="qx-panel-card"
                    style={heroImgStyle}
                  />
                )}

                <div
                  id="rss-article-content"
                  className="rss-article-content"
                  data-image-mode={image_display_mode}
                  dangerouslySetInnerHTML={{ __html: cleanContent }}
                  style={articleContentStyle}
                />

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
                      Press <kbd>J</kbd> or <kbd>⌘K</kbd>
                    </span>
                  </div>
                )}

                {currentArticle.link && (
                  <div className="qx-content-detail-footer">
                    <button className="qx-command-button" onClick={() => void openUrl(currentArticle.link)} type="button">
                      Open original
                    </button>
                  </div>
                )}
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

import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useRssStore } from "./store";
import { useSettingsStore } from "../settings/store";
import { useEscBack } from "../../hooks/useEscBack";
import { shouldIgnoreBareShortcut } from "../../utils/keyboard";
import ImageLightbox from "./ImageLightbox";
import { formatDate, sanitizeHtml } from "./article-utils";

export default function ArticleDetail() {
  const {
    currentArticle,
    feeds,
    selectedArticleId,
    readingArticles,
    openArticle,
    markRead,
    toggleStar,
    goBack,
  } = useRssStore();

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [scrollPercent, setScrollPercent] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rss = useSettingsStore((s) => s.settings.rss);
  const { bottom_island_mode, image_display_mode, image_fixed_width, article_font_size, article_font_family } = rss;

  const feed = useMemo(
    () => (currentArticle ? feeds.find((f) => f.id === currentArticle.feed_id) : null),
    [feeds, currentArticle],
  );

  const cleanContent = useMemo(
    () => (currentArticle ? sanitizeHtml(currentArticle.content || currentArticle.summary) : ""),
    [currentArticle],
  );

  // Click-to-lightbox handler
  useEffect(() => {
    const root = document.getElementById("rss-article-content");
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        const src = target.getAttribute("src");
        if (src) setLightbox(src);
      }
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [cleanContent]);

  const updateScrollProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setScrollPercent(100);
      return;
    }
    setScrollPercent(Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
  }, []);

  const resetArticleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setScrollPercent(0);
  }, []);

  const openArticleAtTop = useCallback(
    async (id: number) => {
      resetArticleScroll();
      await openArticle(id);
      resetArticleScroll();
      window.requestAnimationFrame(() => {
        resetArticleScroll();
        window.requestAnimationFrame(resetArticleScroll);
      });
    },
    [openArticle, resetArticleScroll],
  );

  // Scroll progress tracking
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
    shellRef.current
      ?.querySelector<HTMLElement>('[data-qx-region="rss-reader"]')
      ?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(updateScrollProgress);
    return () => window.cancelAnimationFrame(frame);
  }, [currentArticle?.id, cleanContent, resetArticleScroll, updateScrollProgress]);

  const currentIdx = readingArticles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? readingArticles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < readingArticles.length - 1 ? readingArticles[currentIdx + 1] : null;
  const articleProgress = readingArticles.length > 0 && currentIdx >= 0
    ? Math.round(((currentIdx + 1) / readingArticles.length) * 100)
    : 0;

  // Build actions list used by both context panel and Shell Cmd+K menu.
  const actions = useMemo<QxShellAction[]>(() => {
    const list: QxShellAction[] = [];
    if (currentArticle?.link) {
      list.push({
        label: "Open in Browser",
        kbd: "O",
        onClick: () => void openUrl(currentArticle.link),
      });
    }
    if (currentArticle) {
      list.push({
        label: currentArticle.is_starred ? "Unstar" : "Star",
        kbd: "S",
        onClick: () => void toggleStar(currentArticle.id, !currentArticle.is_starred),
      });
      list.push({
        label: currentArticle.is_read ? "Mark Unread" : "Mark Read",
        kbd: "U",
        onClick: () => void markRead(currentArticle.id, !currentArticle.is_read),
      });
    }
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
  }, [currentArticle, next, prev, openArticleAtTop, toggleStar, markRead]);

  // Cascading Esc: close lightbox → go back. Shell handles Actions menu Esc.
  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: lightbox !== null,
      close: () => {
        setLightbox(null);
      },
    },
    launcher: goBack,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ignoreBare = shouldIgnoreBareShortcut(e.nativeEvent);
    switch (e.key) {
      case "Escape":
        escKeyDown(e);
        break;
      case "j":
        if (!ignoreBare && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (next) void openArticleAtTop(next.id);
        }
        break;
      case "k":
        if (!ignoreBare && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (prev) void openArticleAtTop(prev.id);
        }
        break;
    }
  };

  if (!currentArticle) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-tertiary)",
          fontSize: 12,
        }}
      >
        Article not found
      </div>
    );
  }

  const island: BottomIslandContent = {
    label: "Reading RSS",
    detail:
      bottom_island_mode === "index"
        ? `${currentIdx >= 0 ? currentIdx + 1 : 0}/${readingArticles.length || 1} articles`
        : `${scrollPercent}%`,
    progress: bottom_island_mode === "index" ? articleProgress : scrollPercent,
  };

  // Hero image style based on display mode
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
  const articleContentStyle = {
    "--rss-article-font-size": `${article_font_size}px`,
    "--rss-article-line-height": article_font_size > 16 ? "1.7" : "1.55",
    "--rss-article-font-family": article_font_family,
    "--rss-image-width": `${image_fixed_width}px`,
  } as CSSProperties;

  return (
    <QxShell
      ref={shellRef}
      title={feed?.title || "RSS Detail"}
      onKeyDown={onKeyDown}
      onBack={goBack}
      overlayBottom
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <div className="qx-rss-detail-title">
          <span>{currentArticle.title || "(untitled)"}</span>
        </div>
      }
      context={
        <aside
          className="qx-action-panel"
          data-qx-region="rss-actions"
          data-qx-region-label="Article actions"
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-action-title">Detail Nav</div>
          {actions.map((a, i) => (
            <button key={i} className="qx-action-item" onClick={a.onClick} disabled={a.disabled}>
              <span>{a.label}</span>
              {a.kbd && <kbd>{a.kbd}</kbd>}
            </button>
          ))}
        </aside>
      }
      island={island}
      primaryAction={{
        label: currentArticle.link ? "Open Original" : "Back",
        kbd: currentArticle.link ? "⌘K O" : "Esc",
        tone: "primary",
        onClick: () => {
          if (currentArticle.link) void openUrl(currentArticle.link);
          else goBack();
        },
      }}
      secondaryAction={{
        label: "Actions",
        kbd: "⌘K",
      }}
      actionTitle="Article Actions"
      actions={actions}
    >
      <article
        className="qx-plugin-detail qx-rss-detail-content"
        data-qx-region="rss-reader"
        data-qx-region-label="Article reader"
        data-qx-region-initial="true"
        tabIndex={-1}
      >
        <div className="qx-detail-header">
          <div style={{ minWidth: 0 }}>
            <div className="qx-detail-title">{feed?.title || "Article"}</div>
            <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
          </div>
          <button className="qx-icon-button" onClick={goBack}>List</button>
        </div>
        <div
          ref={scrollRef}
          data-qx-region-scroll
          style={{ flex: 1, overflowY: "auto", padding: "10px 12px 16px", overflowAnchor: "none" }}
        >
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: "var(--qx-text-tertiary)",
              marginBottom: 10,
              paddingBottom: 8,
              borderBottom: "1px solid var(--qx-border-1)",
            }}
          >
            {currentArticle.author && <span>By {currentArticle.author}</span>}
            {currentArticle.is_starred && <span style={{ color: "var(--qx-accent)" }}>Starred</span>}
            {currentArticle.is_read ? (
              <span>Read</span>
            ) : (
              <span style={{ color: "var(--qx-accent)" }}>Unread</span>
            )}
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

          {/* Next article preview */}
          {next && (
            <div className="qx-rss-next-article">
              <div className="qx-rss-next-label">Up Next</div>
              <button
                className="qx-rss-next-link"
                onClick={() => void openArticleAtTop(next.id)}
                title={next.title || "(untitled)"}
              >
                {next.title || "(untitled)"}
              </button>
              <span className="qx-rss-next-kbd">
                Press <kbd>J</kbd> or <kbd>⌘K</kbd>
              </span>
            </div>
          )}

          {currentArticle.link && (
            <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--qx-border-1)" }}>
              <button className="qx-command-button" onClick={() => void openUrl(currentArticle.link)}>
                Open original
              </button>
            </div>
          )}
        </div>
      </article>

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </QxShell>
  );
}

import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useRssStore } from "./store";
import { useSettingsStore } from "../settings/store";
import { useEscBack } from "../../hooks/useEscBack";
import ImageLightbox from "./ImageLightbox";
import { formatDate, sanitizeHtml } from "./article-utils";

interface ActionItem {
  label: string;
  kbd?: string;
  disabled?: boolean;
  onClick: () => void;
}

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
  const [showActions, setShowActions] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
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
    shellRef.current?.focus({ preventScroll: true });
    const frame = window.requestAnimationFrame(updateScrollProgress);
    return () => window.cancelAnimationFrame(frame);
  }, [currentArticle?.id, cleanContent, resetArticleScroll, updateScrollProgress]);

  const currentIdx = readingArticles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? readingArticles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < readingArticles.length - 1 ? readingArticles[currentIdx + 1] : null;
  const articleProgress = readingArticles.length > 0 && currentIdx >= 0
    ? Math.round(((currentIdx + 1) / readingArticles.length) * 100)
    : 0;

  // Build actions list (used by both context panel and Cmd+K menu)
  const actions = useMemo<ActionItem[]>(() => {
    const list: ActionItem[] = [];
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

  const executeAction = useCallback(
    (idx: number) => {
      const a = actions[idx];
      if (a && !a.disabled) {
        a.onClick();
        setShowActions(false);
      }
    },
    [actions],
  );

  // Cascading Esc: close actions menu → close lightbox → go back
  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: showActions || lightbox !== null,
      close: () => {
        if (showActions) setShowActions(false);
        else setLightbox(null);
      },
    },
    launcher: goBack,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Handle Cmd+K to toggle actions menu
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setShowActions((v) => !v);
      setActionIndex(0);
      return;
    }

    // Handle actions menu navigation
    if (showActions) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActionIndex((i) => Math.min(i + 1, actions.length - 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          setActionIndex((i) => Math.max(i - 1, 0));
          return;
        case "Enter":
          e.preventDefault();
          executeAction(actionIndex);
          return;
        case "Escape":
          escKeyDown(e);
          return;
      }
      return;
    }

    // Normal key handling
    switch (e.key) {
      case "Escape":
        escKeyDown(e);
        break;
      case "j":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (next) void openArticleAtTop(next.id);
        }
        break;
      case "k":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (prev) void openArticleAtTop(prev.id);
        }
        break;
      case "s":
        e.preventDefault();
        if (currentArticle) void toggleStar(currentArticle.id, !currentArticle.is_starred);
        break;
      case "u":
        e.preventDefault();
        if (currentArticle) void markRead(currentArticle.id, !currentArticle.is_read);
        break;
      case "o":
        e.preventDefault();
        if (currentArticle?.link) void openUrl(currentArticle.link);
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
        <aside className="qx-action-panel">
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
        kbd: currentArticle.link ? "O" : "Esc",
        tone: "primary",
        onClick: () => {
          if (currentArticle.link) void openUrl(currentArticle.link);
          else goBack();
        },
      }}
      secondaryAction={{
        label: "Actions",
        kbd: "⌘K",
        onClick: () => {
          setShowActions((v) => !v);
          setActionIndex(0);
        },
      }}
    >
      <article className="qx-plugin-detail qx-rss-detail-content">
        <div className="qx-detail-header">
          <div style={{ minWidth: 0 }}>
            <div className="qx-detail-title">{feed?.title || "Article"}</div>
            <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
          </div>
          <button className="qx-icon-button" onClick={goBack}>List</button>
        </div>
        <div
          ref={scrollRef}
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

      {/* Cmd+K Actions Mini Menu */}
      {showActions && (
        <div
          ref={actionsRef}
          className="qx-actions-menu"
          role="menu"
        >
          <div className="qx-actions-menu-title">Article Actions</div>
          {actions.map((a, i) => (
            <button
              key={i}
              role="menuitem"
              className={`qx-actions-menu-item${i === actionIndex ? " is-active" : ""}`}
              onClick={() => executeAction(i)}
              onMouseEnter={() => setActionIndex(i)}
              disabled={a.disabled}
            >
              <span className="qx-actions-menu-label">{a.label}</span>
              {a.kbd && <kbd className="qx-actions-menu-kbd">{a.kbd}</kbd>}
            </button>
          ))}
        </div>
      )}

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </QxShell>
  );
}

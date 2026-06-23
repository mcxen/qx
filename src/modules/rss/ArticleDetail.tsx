import { useEffect, useMemo, useState, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useRssStore } from "./store";
import { useSettingsStore } from "../settings/store";
import ImageLightbox from "./ImageLightbox";
import { formatDate, sanitizeHtml } from "./article-utils";

export default function ArticleDetail() {
  const {
    currentArticle,
    feeds,
    selectedArticleId,
    articles,
    openArticle,
    markRead,
    toggleStar,
    goBack,
  } = useRssStore();

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [scrollPercent, setScrollPercent] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const bottomIslandMode = useSettingsStore((s) => s.settings.rss.bottom_island_mode);

  const feed = useMemo(
    () => (currentArticle ? feeds.find((f) => f.id === currentArticle.feed_id) : null),
    [feeds, currentArticle],
  );

  const cleanContent = useMemo(
    () => (currentArticle ? sanitizeHtml(currentArticle.content || currentArticle.summary) : ""),
    [currentArticle],
  );

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

  // Scroll progress tracking
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight) {
        setScrollPercent(100);
      } else {
        setScrollPercent(Math.round((scrollTop / (scrollHeight - clientHeight)) * 100));
      }
    };
    el.addEventListener("scroll", onScroll);
    // Run once on mount to capture initial state
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const currentIdx = articles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? articles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < articles.length - 1 ? articles[currentIdx + 1] : null;
  const progress = articles.length > 0 && currentIdx >= 0
    ? Math.round(((currentIdx + 1) / articles.length) * 100)
    : 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        goBack();
        break;
      case "j":
        e.preventDefault();
        if (next) void openArticle(next.id);
        break;
      case "k":
        e.preventDefault();
        if (prev) void openArticle(prev.id);
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
      bottomIslandMode === "index"
        ? `${currentIdx + 1}/${articles.length || 1} articles`
        : `${scrollPercent}%`,
    progress: bottomIslandMode === "index" ? progress : scrollPercent,
  };

  return (
    <QxShell
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
          <button className="qx-action-item" onClick={() => currentArticle.link && void openUrl(currentArticle.link)} disabled={!currentArticle.link}>
            <span>Open in Browser</span>
            <kbd>O</kbd>
          </button>
          <button className="qx-action-item" onClick={() => void toggleStar(currentArticle.id, !currentArticle.is_starred)}>
            <span>{currentArticle.is_starred ? "Unstar" : "Star"}</span>
            <kbd>S</kbd>
          </button>
          <button className="qx-action-item" onClick={() => void markRead(currentArticle.id, !currentArticle.is_read)}>
            <span>{currentArticle.is_read ? "Mark Unread" : "Mark Read"}</span>
            <kbd>U</kbd>
          </button>
          <button className="qx-action-item" onClick={() => next && void openArticle(next.id)} disabled={!next}>
            <span>Next Article</span>
            <kbd>J</kbd>
          </button>
          <button className="qx-action-item" onClick={() => prev && void openArticle(prev.id)} disabled={!prev}>
            <span>Previous Article</span>
            <kbd>K</kbd>
          </button>
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
      secondaryAction={{ label: "Actions", kbd: "⌘K" }}
    >
        <article className="qx-plugin-detail qx-rss-detail-content">
          <div className="qx-detail-header">
            <div style={{ minWidth: 0 }}>
              <div className="qx-detail-title">{feed?.title || "Article"}</div>
              <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
            </div>
            <button className="qx-icon-button" onClick={goBack}>List</button>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "10px 12px 16px" }}>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 600,
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
                style={{
                  width: "100%",
                  maxHeight: 280,
                  objectFit: "cover",
                  marginBottom: 10,
                  cursor: "zoom-in",
                  display: "block",
                }}
              />
            )}

            <div
              id="rss-article-content"
              className="rss-article-content"
              dangerouslySetInnerHTML={{ __html: cleanContent }}
              style={{
                fontSize: 13,
                color: "var(--qx-text-primary)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
            />

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

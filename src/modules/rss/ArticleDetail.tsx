import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRssStore } from "./store";
import ImageLightbox from "./ImageLightbox";

function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => el.remove());
  doc.querySelectorAll("a").forEach((el) => {
    const a = el as HTMLAnchorElement;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  doc.querySelectorAll("img").forEach((el) => {
    const img = el as HTMLImageElement;
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.borderRadius = "8px";
    img.style.display = "block";
    img.style.margin = "10px 0";
    img.setAttribute("loading", "lazy");
  });
  doc.querySelectorAll("pre,code").forEach((el) => {
    const h = el as HTMLElement;
    h.style.background = "rgba(0,0,0,0.05)";
    h.style.padding = "2px 6px";
    h.style.borderRadius = "4px";
    h.style.fontSize = "12px";
    h.style.fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace';
  });
  doc.querySelectorAll("pre").forEach((el) => {
    const h = el as HTMLElement;
    h.style.padding = "10px 12px";
    h.style.overflowX = "auto";
  });
  doc.querySelectorAll("h1,h2,h3,h4").forEach((el) => {
    const h = el as HTMLElement;
    h.style.marginTop = "16px";
    h.style.marginBottom = "6px";
    h.style.fontWeight = "600";
  });
  doc.querySelectorAll("p,li").forEach((el) => {
    const h = el as HTMLElement;
    h.style.lineHeight = "1.6";
    h.style.margin = "6px 0";
  });
  doc.querySelectorAll("blockquote").forEach((el) => {
    const h = el as HTMLElement;
    h.style.borderLeft = "3px solid var(--color-accent)";
    h.style.paddingLeft = "12px";
    h.style.color = "var(--color-text-secondary)";
    h.style.margin = "10px 0";
  });
  return doc.body ? doc.body.innerHTML : html;
}

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

  const currentIdx = articles.findIndex((a) => a.id === selectedArticleId);
  const prev = currentIdx > 0 ? articles[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < articles.length - 1 ? articles[currentIdx + 1] : null;

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
          fontSize: 13,
        }}
      >
        Article not found
      </div>
    );
  }

  return (
    <div
      className="qx-raycast"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="qx-plugin-body two-pane">
        <article className="qx-plugin-detail" style={{ borderRight: "1px solid var(--color-border)" }}>
          <div className="qx-detail-header">
            <div style={{ minWidth: 0 }}>
              <div className="qx-detail-title">{feed?.title || "Article"}</div>
              <div className="qx-detail-meta">{formatDate(currentArticle.published_at)}</div>
            </div>
            <button className="qx-icon-button" onClick={goBack}>List</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px" }}>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: "var(--color-text-primary)",
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
                gap: 10,
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              {currentArticle.author && <span>By {currentArticle.author}</span>}
              {currentArticle.is_starred && <span style={{ color: "#eab308" }}>Starred</span>}
              {currentArticle.is_read ? (
                <span>Read</span>
              ) : (
                <span style={{ color: "var(--color-accent)" }}>Unread</span>
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
                  marginBottom: 16,
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
                fontSize: 14,
                color: "var(--color-text-primary)",
                lineHeight: 1.65,
                wordBreak: "break-word",
              }}
            />

            {currentArticle.link && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--color-border)" }}>
                <button className="qx-command-button" onClick={() => void openUrl(currentArticle.link)}>
                  Open original
                </button>
              </div>
            )}
          </div>
        </article>

        <aside className="qx-action-panel">
          <div className="qx-action-title">ActionPanel</div>
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
      </div>

      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

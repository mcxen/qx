import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useRssStore, type RssArticle } from "./store";
import { classifyArticleTime } from "./article-utils";
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
    articles,
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (localQuery) {
          setLocalQuery("");
          setSearch("");
        } else {
          goBack();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, articles.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "j":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, articles.length - 1));
        break;
      case "k":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a) void openArticle(a.id);
        break;
      }
      case "s": {
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a) void toggleStar(a.id, !a.is_starred);
        break;
      }
      case "u": {
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a) void markRead(a.id, !a.is_read);
        break;
      }
      case "o": {
        e.preventDefault();
        const a = articles[selectedIndex];
        if (a?.link) void openUrl(a.link);
        break;
      }
      case "r":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (selectedFeedId != null) void refreshFeed(selectedFeedId);
        }
        break;
    }
  };

  const filterChips: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "starred", label: "Starred" },
  ];
  const selectedArticle = articles[selectedIndex];
  const unreadCount = articles.filter((article) => !article.is_read).length;
  const island: BottomIslandContent = refreshingFeedId != null
    ? {
        label: "RSS Syncing",
        detail: feed?.title,
        progress: 55,
        actionLabel: "Pause",
      }
    : {
        label: feed?.title || "RSS Articles",
        detail: `${articles.length} articles · ${unreadCount} unread · ${filter}`,
      };

  return (
    <QxShell
      title={feed?.title || "RSS Articles"}
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
        <div className="qx-segmented">
          {filterChips.map((c) => {
            const active = c.key === filter;
            return (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={active ? "is-active" : ""}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      }
      context={
        <aside className="qx-action-panel">
          <div className="qx-action-title">Article Actions</div>
          <button
            className="qx-action-item"
            onClick={() => selectedArticle && void openArticle(selectedArticle.id)}
            disabled={!selectedArticle}
          >
            <span>Read Article</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => selectedArticle && void toggleStar(selectedArticle.id, !selectedArticle.is_starred)}
            disabled={!selectedArticle}
          >
            <span>Toggle Star</span>
            <kbd>S</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => selectedArticle && void markRead(selectedArticle.id, !selectedArticle.is_read)}
            disabled={!selectedArticle}
          >
            <span>Toggle Read</span>
            <kbd>U</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => selectedArticle?.link && void openUrl(selectedArticle.link)}
            disabled={!selectedArticle?.link}
          >
            <span>Open in Browser</span>
            <kbd>O</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => {
              if (selectedFeedId != null) void refreshFeed(selectedFeedId);
            }}
            disabled={selectedFeedId == null}
          >
            <span>Refresh Feed</span>
            <kbd>R</kbd>
          </button>
        </aside>
      }
      island={island}
      primaryAction={{
        label: selectedArticle ? "Read Article" : "Back",
        kbd: selectedArticle ? "↵" : "Esc",
        tone: "primary",
        onClick: () => {
          if (selectedArticle) void openArticle(selectedArticle.id);
          else goBack();
        },
      }}
      secondaryAction={{ label: "Actions", kbd: "⌘K" }}
    >
        <div className="qx-plugin-list">
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
                    onClick={() => setSelectedIndex(idx)}
                    onDoubleClick={() => void openArticle(a.id)}
                    className={`qx-list-row tall${active ? " is-active" : ""}${a.is_read ? " is-read" : " is-unread"}`}
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
              {refreshingFeedId != null ? "Refreshing..." : "No articles in this feed."}
            </div>
          )}
        </div>
    </QxShell>
  );
}

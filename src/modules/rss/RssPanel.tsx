import { useEffect, useMemo, useState } from "react";
import { useRssStore, type RssFeed } from "./store";
import AddFeedDialog from "./AddFeedDialog";

function formatRelative(ts: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function FeedIcon({ feed }: { feed: RssFeed }) {
  if (feed.icon) {
    return (
      <img
        src={feed.icon}
        alt=""
        style={{ width: 22, height: 22, borderRadius: 5, flexShrink: 0 }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {(feed.title || "R").slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function RssPanel() {
  const {
    feeds,
    loading,
    error,
    refreshingFeedId,
    selectedIndex,
    setSelectedIndex,
    loadFeeds,
    openFeed,
    refreshFeed,
    refreshAll,
    removeFeed,
  } = useRssStore();

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return feeds;
    return feeds.filter(
      (f) =>
        f.title.toLowerCase().includes(q) || f.url.toLowerCase().includes(q),
    );
  }, [feeds, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, setSelectedIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        if (query) {
          e.preventDefault();
          e.stopPropagation();
          setQuery("");
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) void openFeed(item.id);
        break;
      }
      case "r":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          const item = filtered[selectedIndex];
          if (item) void refreshFeed(item.id);
        }
        break;
      case "R":
        if (e.shiftKey) {
          e.preventDefault();
          void refreshAll();
        }
        break;
      case "n":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          setShowAdd(true);
        }
        break;
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Remove this feed and all its articles?")) {
      void removeFeed(id);
    }
  };

  return (
    <div
      className="qx-raycast"
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="qx-plugin-toolbar">
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search feeds..."
            className="qx-plugin-search"
          />
        </div>
        <button className="qx-command-button" onClick={() => void refreshAll()} title="Refresh all">
          Refresh
        </button>
        <button className="qx-command-button primary" onClick={() => setShowAdd(true)} title="Add feed (N)">
          Add Feed
        </button>
      </div>

      <div className="qx-plugin-body two-pane">
        <div className="qx-plugin-list">
          <div className="qx-section-header">
            <span style={{ flex: 1 }}>Subscriptions</span>
            <span>{filtered.length}</span>
          </div>
          {filtered.map((feed, i) => {
            const active = i === selectedIndex;
            const refreshing = refreshingFeedId === feed.id;
            return (
              <button
                key={feed.id}
                onClick={() => setSelectedIndex(i)}
                onDoubleClick={() => void openFeed(feed.id)}
                className={`qx-list-row${active ? " is-active" : ""}`}
              >
                <FeedIcon feed={feed} />
                <span className="qx-list-copy">
                  <span className="qx-list-title" style={{ fontWeight: 500 }}>
                    {feed.title || feed.url}
                  </span>
                  <span className="qx-list-subtitle">
                    {formatRelative(feed.last_fetched) || "never fetched"}
                    {feed.error_count > 0 ? ` - ${feed.error_count} errors` : ""}
                    {refreshing ? " - refreshing" : ""}
                  </span>
                </span>
                {feed.unread_count > 0 && <span className="qx-badge">{feed.unread_count}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="qx-empty-state">
              {loading ? "Loading feeds..." : "No feeds yet. Press N to add one."}
            </div>
          )}
          {error && (
            <div
              style={{
                margin: "12px 14px",
                padding: "8px 12px",
                fontSize: 12,
                color: "#b91c1c",
                background: "rgba(185,28,28,0.08)",
                borderRadius: "var(--qx-card-radius)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <aside className="qx-action-panel">
          <div className="qx-action-title">ActionPanel</div>
          <button
            className="qx-action-item"
            onClick={() => {
              const item = filtered[selectedIndex];
              if (item) void openFeed(item.id);
            }}
            disabled={!filtered[selectedIndex]}
          >
            <span>View Articles</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => {
              const item = filtered[selectedIndex];
              if (item) void refreshFeed(item.id);
            }}
            disabled={!filtered[selectedIndex]}
          >
            <span>Refresh Feed</span>
            <kbd>R</kbd>
          </button>
          <button className="qx-action-item" onClick={() => setShowAdd(true)}>
            <span>Add Feed</span>
            <kbd>N</kbd>
          </button>
          <button className="qx-action-item" onClick={() => void refreshAll()}>
            <span>Refresh All</span>
          </button>
          <button
            className="qx-action-item danger"
            onClick={() => {
              const item = filtered[selectedIndex];
              if (item) handleDelete(item.id);
            }}
            disabled={!filtered[selectedIndex]}
          >
            <span>Delete Feed</span>
            <kbd>⌘D</kbd>
          </button>
        </aside>
      </div>

      {showAdd && <AddFeedDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}

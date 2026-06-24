import { useEffect, useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useRssStore, type RssFeed } from "./store";
import { useSettingsStore } from "../settings/store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import AddFeedDialog from "./AddFeedDialog";
import EditFeedDialog from "./EditFeedDialog";
import { FeedIcon, formatRelative } from "./rss-components";

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
  const setTab = useStore((state) => state.setTab);
  const showFeedIcons = useSettingsStore((s) => s.settings.rss.show_feed_icons);

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editFeed, setEditFeed] = useState<RssFeed | null>(null);

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

  const selectedFeed = filtered[selectedIndex];
  const unreadCount = feeds.reduce((sum, feed) => sum + feed.unread_count, 0);

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: showAdd || editFeed !== null,
      close: () => {
        setShowAdd(false);
        setEditFeed(null);
      },
    },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setTab("launcher"),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedFeed) void openFeed(selectedFeed.id);
        break;
      case "r":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (selectedFeed) void refreshFeed(selectedFeed.id);
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
      case "e":
        if (!e.metaKey && !e.ctrlKey && selectedFeed) {
          e.preventDefault();
          setEditFeed(selectedFeed);
        }
        break;
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Remove this feed and all its articles?")) {
      void removeFeed(id);
    }
  };

  const island: BottomIslandContent = refreshingFeedId
    ? {
        label: "RSS Syncing",
        detail: refreshingFeedId === -1 ? `${feeds.length} feeds` : selectedFeed?.title,
        progress: refreshingFeedId === -1 ? 42 : 55,
        actionLabel: "Pause",
      }
    : {
        label: "RSS Reader",
        detail: `${feeds.length} feeds · ${unreadCount} unread`,
      };

  return (
    <QxShell
      title="RSS Reader"
      className="qx-rss-shell"
      onKeyDown={onKeyDown}
      search={
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
      }
      trailing={
        <>
          <button className="qx-command-button" onClick={() => void refreshAll()}>
            Refresh
          </button>
          <button className="qx-command-button primary" onClick={() => setShowAdd(true)}>
            Add Feed
          </button>
        </>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Feed Actions</div>
          <button
            className="qx-action-item"
            onClick={() => selectedFeed && void openFeed(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>View Articles</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => selectedFeed && void refreshFeed(selectedFeed.id)}
            disabled={!selectedFeed}
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
            className="qx-action-item"
            onClick={() => selectedFeed && setEditFeed(selectedFeed)}
            disabled={!selectedFeed}
          >
            <span>Edit Feed</span>
            <kbd>E</kbd>
          </button>
          <button
            className="qx-action-item danger"
            onClick={() => selectedFeed && handleDelete(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>Delete Feed</span>
            <kbd>⌘D</kbd>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setTab("launcher") }}
      primaryAction={{
        label: selectedFeed ? "View Articles" : "Add Feed",
        kbd: selectedFeed ? "↵" : "N",
        tone: "primary",
        onClick: () => {
          if (selectedFeed) void openFeed(selectedFeed.id);
          else setShowAdd(true);
        },
      }}
      secondaryAction={{ label: "Actions", kbd: "⌘K" }}
    >
      <div className="qx-plugin-list qx-rss-feed-list">
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
              <FeedIcon feed={feed} showImage={showFeedIcons} />
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
              margin: "8px 10px",
              padding: "6px 8px",
              fontSize: 12,
              color: "var(--qx-danger)",
              background: "var(--qx-danger-border)",
              borderRadius: "var(--qx-card-radius)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {showAdd && <AddFeedDialog onClose={() => setShowAdd(false)} />}
      {editFeed && (
        <EditFeedDialog
          feed={editFeed}
          onClose={() => setEditFeed(null)}
        />
      )}
    </QxShell>
  );
}

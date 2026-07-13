import { useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssFeed } from "./store";
import { useSettingsStore } from "../settings/store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { LoadingLabel, Skeleton } from "../../components/ui";
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
  const shellRef = useRef<HTMLDivElement>(null);

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
    const region = e.target instanceof Element
      ? e.target.closest<HTMLElement>("[data-qx-region]")?.dataset.qxRegion
      : undefined;
    switch (e.key) {
      case "ArrowDown":
        if (region === "rss-feed-actions") return;
        e.preventDefault();
        setSelectedIndex(filtered.length > 0 ? Math.min(selectedIndex + 1, filtered.length - 1) : 0);
        shellRef.current
          ?.querySelector<HTMLElement>('[data-qx-region="rss-feeds"]')
          ?.focus({ preventScroll: true });
        break;
      case "ArrowUp":
        if (region === "rss-feed-actions") return;
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        shellRef.current
          ?.querySelector<HTMLElement>('[data-qx-region="rss-feeds"]')
          ?.focus({ preventScroll: true });
        break;
      case "Enter":
        if (region === "rss-feed-actions") return;
        e.preventDefault();
        if (selectedFeed) void openFeed(selectedFeed.id);
        break;
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Remove this feed and all its articles?")) {
      void removeFeed(id);
    }
  };

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: "View Articles",
      kbd: "↵",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) void openFeed(selectedFeed.id);
      },
    },
    {
      label: "Refresh Feed",
      kbd: "R",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) void refreshFeed(selectedFeed.id);
      },
    },
    {
      label: "Add Feed",
      kbd: "N",
      onClick: () => setShowAdd(true),
    },
    {
      label: "Refresh All",
      onClick: () => void refreshAll(),
    },
    {
      label: "Edit Feed",
      kbd: "E",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) setEditFeed(selectedFeed);
      },
    },
    {
      label: "Delete Feed",
      kbd: "D",
      tone: "danger",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) handleDelete(selectedFeed.id);
      },
    },
  ], [openFeed, refreshAll, refreshFeed, selectedFeed]);

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
      ref={shellRef}
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
        <div
          className="qx-action-panel"
          data-qx-region="rss-feed-actions"
          data-qx-region-label="Feed actions"
          data-qx-region-scroll
          tabIndex={-1}
        >
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
            <kbd>⌘K R</kbd>
          </button>
          <button className="qx-action-item" onClick={() => setShowAdd(true)}>
            <span>Add Feed</span>
            <kbd>⌘K N</kbd>
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
            <kbd>⌘K E</kbd>
          </button>
          <button
            className="qx-action-item danger"
            onClick={() => selectedFeed && handleDelete(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>Delete Feed</span>
            <kbd>⌘K D</kbd>
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
      actionTitle="Feed Actions"
      actions={actions}
    >
      <div
        className="qx-plugin-list qx-rss-feed-list"
        data-qx-region="rss-feeds"
        data-qx-region-label="Feed list"
        data-qx-region-initial="true"
        data-qx-region-scroll
        tabIndex={-1}
      >
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>Subscriptions</span>
          <span>{filtered.length}</span>
        </div>
        {loading && filtered.length === 0 && (
          <div className="qx-skeleton-stack" aria-label="Loading feeds">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="qx-skeleton-row" key={index}>
                <Skeleton className="qx-skeleton-icon" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Skeleton className="qx-skeleton-line long" />
                  <Skeleton className="qx-skeleton-line medium" style={{ marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        )}
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
            {loading ? <LoadingLabel>Loading feeds...</LoadingLabel> : "No feeds yet. Press N to add one."}
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

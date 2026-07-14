import { useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssFeed } from "./store";
import { useSettingsStore } from "../settings/store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { getQxShortcutPreset } from "../../utils/keyboard";
import { LoadingLabel, Skeleton } from "../../components/ui";
import AddFeedDialog from "./AddFeedDialog";
import EditFeedDialog from "./EditFeedDialog";
import { FeedIcon, formatRelative } from "./rss-components";

type FeedSection = {
  key: string;
  title: string;
  folderId: number | null;
  items: RssFeed[];
};

export default function RssPanel() {
  const {
    feeds,
    folders,
    loading,
    error,
    statusMessage,
    refreshingFeedId,
    selectedIndex,
    setSelectedIndex,
    loadFeeds,
    openFeed,
    refreshFeed,
    refreshAll,
    removeFeed,
    createFolder,
    setFeedFolder,
    deleteFolder,
    importOpml,
    exportOpml,
  } = useRssStore();
  const setTab = useStore((state) => state.setTab);
  const showFeedIcons = useSettingsStore((s) => s.settings.rss.show_feed_icons);
  const actionMenuShortcut = getQxShortcutPreset().actionMenu;

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editFeed, setEditFeed] = useState<RssFeed | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const opmlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    const pending = sessionStorage.getItem("qx.rss.pendingSurface");
    if (!pending) return;
    sessionStorage.removeItem("qx.rss.pendingSurface");
    if (pending === "add-feed") setShowAdd(true);
    if (pending === "import-opml") {
      // Defer so file input is mounted.
      window.setTimeout(() => opmlInputRef.current?.click(), 0);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return feeds;
    return feeds.filter(
      (f) =>
        f.title.toLowerCase().includes(q)
        || f.url.toLowerCase().includes(q)
        || (f.folder_name ?? "").toLowerCase().includes(q),
    );
  }, [feeds, query]);

  const sections = useMemo<FeedSection[]>(() => {
    const map = new Map<string, FeedSection>();
    for (const feed of filtered) {
      const folderId = feed.folder_id ?? null;
      const key = folderId == null ? "ungrouped" : `folder:${folderId}`;
      const title = folderId == null ? "Ungrouped" : (feed.folder_name || "Folder");
      if (!map.has(key)) {
        map.set(key, { key, title, folderId, items: [] });
      }
      map.get(key)!.items.push(feed);
    }
    // Preserve backend sort: folders first, then ungrouped.
    return Array.from(map.values());
  }, [filtered]);

  const flatFeeds = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, setSelectedIndex]);

  const selectedFeed = flatFeeds[selectedIndex];
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
        setSelectedIndex(flatFeeds.length > 0 ? Math.min(selectedIndex + 1, flatFeeds.length - 1) : 0);
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

  const handleImportOpml = () => {
    opmlInputRef.current?.click();
  };

  const onOpmlFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      await importOpml(text);
    } catch (err) {
      window.alert(`OPML import failed: ${String(err)}`);
    } finally {
      if (opmlInputRef.current) opmlInputRef.current.value = "";
    }
  };

  const handleExportOpml = async () => {
    try {
      const content = await exportOpml();
      const blob = new Blob([content], { type: "text/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qx-rss-${new Date().toISOString().slice(0, 10)}.opml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(`OPML export failed: ${String(err)}`);
    }
  };

  const handleNewFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await createFolder(name.trim());
  };

  const handleMoveToFolder = async () => {
    if (!selectedFeed) return;
    const choices = [
      "0) Ungrouped",
      ...folders.map((f, i) => `${i + 1}) ${f.name}`),
    ].join("\n");
    const raw = window.prompt(`Move "${selectedFeed.title}" to folder:\n${choices}\n\nEnter number:`);
    if (raw == null) return;
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 0 || n > folders.length) return;
    const folderId = n === 0 ? null : folders[n - 1]?.id ?? null;
    await setFeedFolder(selectedFeed.id, folderId);
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
      label: "New Folder",
      onClick: () => void handleNewFolder(),
    },
    {
      label: "Move to Folder…",
      disabled: !selectedFeed,
      onClick: () => void handleMoveToFolder(),
    },
    {
      label: "Import OPML…",
      onClick: handleImportOpml,
    },
    {
      label: "Export OPML",
      onClick: () => void handleExportOpml(),
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
      label: "Delete Folder",
      disabled: !selectedFeed?.folder_id,
      onClick: () => {
        if (!selectedFeed?.folder_id) return;
        if (window.confirm("Delete this folder? Feeds become ungrouped.")) {
          void deleteFolder(selectedFeed.folder_id);
        }
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
  ], [deleteFolder, openFeed, refreshAll, refreshFeed, selectedFeed, folders]);

  const island: BottomIslandContent = refreshingFeedId
    ? {
        label: "RSS Syncing",
        detail: refreshingFeedId === -1 ? `${feeds.length} feeds` : selectedFeed?.title,
        progress: refreshingFeedId === -1 ? 42 : 55,
      }
    : statusMessage
      ? { label: "RSS", detail: statusMessage, tone: "success" }
    : {
        label: "RSS Reader",
        detail: `${feeds.length} feeds · ${folders.length} folders · ${unreadCount} unread`,
      };

  let flatIndex = 0;

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
            placeholder="Search feeds or folders…"
            className="qx-plugin-search"
          />
        </div>
      }
      trailing={
        <>
          <button className="qx-command-button" type="button" onClick={() => void refreshAll()}>
            Refresh
          </button>
          <button className="qx-command-button primary" type="button" onClick={() => setShowAdd(true)}>
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
            type="button"
            onClick={() => selectedFeed && void openFeed(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>View Articles</span>
            <kbd>↩</kbd>
          </button>
          <button className="qx-action-item" type="button" onClick={handleImportOpml}>
            <span>Import OPML</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => void handleExportOpml()}>
            <span>Export OPML</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => void handleNewFolder()}>
            <span>New Folder</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => void handleMoveToFolder()}
            disabled={!selectedFeed}
          >
            <span>Move to Folder…</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => selectedFeed && setEditFeed(selectedFeed)}
            disabled={!selectedFeed}
          >
            <span>Edit Feed</span>
          </button>
          <button
            className="qx-action-item danger"
            type="button"
            onClick={() => selectedFeed && handleDelete(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>Delete Feed</span>
          </button>
          {selectedFeed && (
            <>
              <div className="qx-action-title">Selected</div>
              <div className="v2ex-context-copy">
                <strong>{selectedFeed.title || selectedFeed.url}</strong>
                <span>{selectedFeed.folder_name || "Ungrouped"}</span>
                <span>{selectedFeed.url}</span>
              </div>
            </>
          )}
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
      secondaryAction={{ label: "Actions", kbd: actionMenuShortcut }}
      actionTitle="Feed Actions"
      actions={actions}
    >
      <input
        ref={opmlInputRef}
        type="file"
        accept=".opml,.xml,text/xml,application/xml"
        style={{ display: "none" }}
        onChange={(event) => void onOpmlFile(event.target.files?.[0] ?? null)}
      />
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
        {sections.map((section) => (
          <div key={section.key}>
            <div className="qx-section-header">
              <span style={{ flex: 1 }}>{section.title}</span>
              <span>{section.items.length}</span>
            </div>
            {section.items.map((feed) => {
              const index = flatIndex++;
              const active = index === selectedIndex;
              const refreshing = refreshingFeedId === feed.id;
              return (
                <button
                  key={feed.id}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
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
                      {feed.error_count > 0 ? ` · ${feed.error_count} errors` : ""}
                      {refreshing ? " · refreshing" : ""}
                    </span>
                  </span>
                  {feed.unread_count > 0 && <span className="qx-badge">{feed.unread_count}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="qx-empty-state">
            {loading
              ? <LoadingLabel>Loading feeds...</LoadingLabel>
              : "No feeds yet. Add a feed or Import OPML (⌘K)."}
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

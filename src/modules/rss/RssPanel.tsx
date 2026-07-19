import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssFeed } from "./store";
import { useSettingsStore } from "../settings/store";
import { useStore } from "../../store";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import AddFeedDialog from "./AddFeedDialog";
import EditFeedDialog from "./EditFeedDialog";
import {
  ImportOpmlDialog,
  NewFolderDialog,
  SetFeedFolderDialog,
} from "./FolderDialogs";
import { FeedIcon, formatRelative } from "./rss-components";

type FeedSection = {
  key: string;
  title: string;
  folderId: number | null;
  items: RssFeed[];
  /** True when folder exists but has no feeds (or none matching search). */
  empty: boolean;
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
    deleteFolder,
    setFeedFolder,
    exportOpml,
  } = useRssStore();
  const setTab = useStore((state) => state.setTab);
  const showFeedIcons = useSettingsStore((s) => s.settings.rss.show_feed_icons);

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImportOpml, setShowImportOpml] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  /** Set-folder dialog targets one subscription (feed.folder_id). */
  const [folderTargetFeed, setFolderTargetFeed] = useState<RssFeed | null>(null);
  const [editFeed, setEditFeed] = useState<RssFeed | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    const pending = sessionStorage.getItem("qx.rss.pendingSurface");
    if (!pending) return;
    sessionStorage.removeItem("qx.rss.pendingSurface");
    if (pending === "add-feed") setShowAdd(true);
    if (pending === "import-opml") setShowImportOpml(true);
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
    const q = query.trim().toLowerCase();

    // Seed every known folder so empty ones still appear.
    for (const folder of folders) {
      if (q && !folder.name.toLowerCase().includes(q)) continue;
      map.set(`folder:${folder.id}`, {
        key: `folder:${folder.id}`,
        title: folder.name,
        folderId: folder.id,
        items: [],
        empty: true,
      });
    }

    for (const feed of filtered) {
      const folderId = feed.folder_id ?? null;
      const key = folderId == null ? "ungrouped" : `folder:${folderId}`;
      const title = folderId == null ? "Ungrouped" : (feed.folder_name || "Folder");
      if (!map.has(key)) {
        map.set(key, { key, title, folderId, items: [], empty: true });
      }
      const section = map.get(key)!;
      section.items.push(feed);
      section.empty = false;
    }

    // Folders first (by folders order), then ungrouped.
    const ordered: FeedSection[] = [];
    for (const folder of folders) {
      const section = map.get(`folder:${folder.id}`);
      if (section) ordered.push(section);
    }
    const ungrouped = map.get("ungrouped");
    if (ungrouped) ordered.push(ungrouped);
    // Any leftover keys (shouldn't happen) append.
    for (const section of map.values()) {
      if (!ordered.includes(section)) ordered.push(section);
    }
    return ordered;
  }, [filtered, folders, query]);

  const flatFeeds = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, setSelectedIndex]);

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: flatFeeds.map((f) => f.id).join("\0"),
  });

  const selectedFeed = flatFeeds[selectedIndex];
  const unreadCount = feeds.reduce((sum, feed) => sum + feed.unread_count, 0);

  const dialogOpen =
    showAdd
    || showImportOpml
    || showNewFolder
    || editFeed !== null
    || folderTargetFeed !== null;

  const leave = useCallback(() => setTab("launcher"), [setTab]);

  const focusFeedList = () => {
    shellRef.current
      ?.querySelector<HTMLElement>('[data-qx-region="rss-feeds"]')
      ?.focus({ preventScroll: true });
  };

  const handleModuleKeys = useCallback((e: React.KeyboardEvent) => {
    // ↑↓: QxShell.navigation + useQxListSelection (is-active + scroll follow).
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (selectedFeed) void openFeed(selectedFeed.id);
      return;
    }
    if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (selectedFeed) {
        e.preventDefault();
        setFolderTargetFeed(selectedFeed);
      }
    }
  }, [openFeed, selectedFeed]);

  const handleDelete = (id: number) => {
    if (window.confirm("Remove this feed and all its articles?")) {
      void removeFeed(id);
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
      onClick: () => setShowNewFolder(true),
    },
    {
      label: "Set Folder…",
      kbd: "F",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) setFolderTargetFeed(selectedFeed);
      },
    },
    {
      label: "Remove from Folder",
      disabled: !selectedFeed?.folder_id,
      onClick: () => {
        if (selectedFeed?.folder_id != null) {
          void setFeedFolder(selectedFeed.id, null);
        }
      },
    },
    {
      label: "Import OPML…",
      onClick: () => setShowImportOpml(true),
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
      label: "Edit Subscription",
      kbd: "E",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) setEditFeed(selectedFeed);
      },
    },
    {
      label: selectedFeed?.folder_name
        ? `Delete Folder “${selectedFeed.folder_name}”`
        : "Delete Folder",
      disabled: !selectedFeed?.folder_id,
      onClick: () => {
        if (!selectedFeed?.folder_id) return;
        const name = selectedFeed.folder_name || "this folder";
        if (
          window.confirm(
            `Delete folder “${name}”? Subscriptions in it become ungrouped (feeds are kept).`,
          )
        ) {
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
  ], [deleteFolder, openFeed, refreshAll, refreshFeed, selectedFeed, setFeedFolder]);

  const shell = useQxModuleShell({
    leave,
    esc: {
      inner: {
        active: dialogOpen,
        close: () => {
          setShowAdd(false);
          setShowImportOpml(false);
          setShowNewFolder(false);
          setEditFeed(null);
          setFolderTargetFeed(null);
        },
      },
      query: { active: query.length > 0, clear: () => setQuery("") },
    },
    onKeyDown: handleModuleKeys,
    island: refreshingFeedId
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
          },
  });

  let flatIndex = 0;

  return (
    <QxShell
      ref={shellRef}
      title="RSS Reader"
      islandKey="rss.feeds"
      className="qx-rss-shell"
      onKeyDown={shell.onKeyDown}
      navigation={{
        index: selectedIndex,
        count: flatFeeds.length,
        regionId: "rss-feeds",
        onChange: (index) => {
          setSelectedIndex(index);
          focusFeedList();
        },
        onOpen: () => {
          if (selectedFeed) void openFeed(selectedFeed.id);
        },
        pageSize: 8,
      }}
      search={
        <QxModuleSearch
          value={query}
          onChange={setQuery}
          placeholder="Search feeds or folders…"
        />
      }
      trailing={
        <>
          <button className="qx-command-button" type="button" onClick={() => setShowImportOpml(true)}>
            Import
          </button>
          <button
            className="qx-command-button"
            type="button"
            title="Create an empty folder"
            onClick={() => setShowNewFolder(true)}
          >
            New Folder
          </button>
          <button
            className="qx-command-button"
            type="button"
            disabled={!selectedFeed}
            title={selectedFeed ? "Set folder for this subscription" : "Select a feed first"}
            onClick={() => selectedFeed && setFolderTargetFeed(selectedFeed)}
          >
            Set Folder
          </button>
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
          <div className="qx-action-title">Subscription</div>
          {selectedFeed ? (
            <div className="v2ex-context-copy" style={{ marginBottom: 8 }}>
              <strong>{selectedFeed.title || selectedFeed.url}</strong>
              <span>
                Folder: {selectedFeed.folder_name || "Ungrouped"}
              </span>
              <span>{selectedFeed.url}</span>
            </div>
          ) : (
            <div className="v2ex-context-copy" style={{ marginBottom: 8 }}>
              <span>Select a feed to set its folder or edit it.</span>
            </div>
          )}
          <button
            className="qx-action-item"
            type="button"
            onClick={() => selectedFeed && void openFeed(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>View Articles</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => setShowNewFolder(true)}
          >
            <span>New Folder</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => selectedFeed && setFolderTargetFeed(selectedFeed)}
            disabled={!selectedFeed}
          >
            <span>Set Folder…</span>
            <kbd>F</kbd>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => selectedFeed && void setFeedFolder(selectedFeed.id, null)}
            disabled={!selectedFeed?.folder_id}
          >
            <span>Remove from Folder</span>
          </button>
          <button
            className="qx-action-item"
            type="button"
            onClick={() => selectedFeed && setEditFeed(selectedFeed)}
            disabled={!selectedFeed}
          >
            <span>Edit Subscription</span>
            <kbd>E</kbd>
          </button>
          <div className="qx-action-title">Library</div>
          <button className="qx-action-item" type="button" onClick={() => setShowImportOpml(true)}>
            <span>Import OPML</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => void handleExportOpml()}>
            <span>Export OPML</span>
          </button>
          <button
            className="qx-action-item danger"
            type="button"
            onClick={() => selectedFeed && handleDelete(selectedFeed.id)}
            disabled={!selectedFeed}
          >
            <span>Delete Feed</span>
          </button>
        </div>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryAction={{
        label: selectedFeed ? "View Articles" : "Add Feed",
        kbd: selectedFeed ? "↵" : "N",
        tone: "primary",
        onClick: () => {
          if (selectedFeed) void openFeed(selectedFeed.id);
          else setShowAdd(true);
        },
      }}
      secondaryAction={shell.secondaryAction}
      actionTitle="Feed Actions"
      actions={actions}
    >
      <div
        ref={listRef}
        className="qx-plugin-list qx-rss-feed-list"
        role="listbox"
        aria-label="Feed list"
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
        {shouldShowQxListLoading(loading, filtered.length) && (
          <QxListLoading
            ariaLabel="Loading feeds"
            label="Loading feeds..."
            rows={5}
            showMeta={false}
          />
        )}
        {sections.map((section) => (
          <div key={section.key}>
            <div className="qx-section-header">
              <span style={{ flex: 1 }}>{section.title}</span>
              <span>
                {section.empty ? "0" : section.items.length}
                {section.folderId != null && section.empty ? " · empty" : ""}
              </span>
              {section.folderId != null && section.empty && (
                <button
                  type="button"
                  className="qx-command-button"
                  style={{ marginLeft: 8, height: 22, fontSize: 11, padding: "0 8px" }}
                  title="Delete empty folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete empty folder “${section.title}”?`)) {
                      void deleteFolder(section.folderId!);
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {section.empty && (
              <div
                className="qx-list-subtitle"
                style={{ padding: "6px 12px 10px", color: "var(--color-text-tertiary)" }}
              >
                Empty folder — select a feed and Set Folder, or Import OPML into this group.
              </div>
            )}
            {section.items.map((feed) => {
              const index = flatIndex++;
              const refreshing = refreshingFeedId === feed.id;
              return (
                <button
                  key={feed.id}
                  type="button"
                  {...getItemProps(index)}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => void openFeed(feed.id)}
                >
                  <FeedIcon feed={feed} showImage={showFeedIcons} />
                  <span className="qx-list-copy">
                    <span className="qx-list-title" style={{ fontWeight: 500 }}>
                      {feed.title || feed.url}
                    </span>
                    <span className="qx-list-subtitle">
                      {feed.folder_name ? `${feed.folder_name} · ` : ""}
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
        {filtered.length === 0 && folders.length === 0 && !loading && (
          <div className="qx-empty-state">
            No feeds yet. Add a subscription, New Folder, or Import OPML.
          </div>
        )}
        {filtered.length === 0 && folders.length > 0 && !loading && query.trim() === "" && (
          <div className="qx-empty-state" style={{ paddingTop: 4 }}>
            No subscriptions yet — folders above are empty until you add or move feeds.
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
      {showNewFolder && <NewFolderDialog onClose={() => setShowNewFolder(false)} />}
      {showImportOpml && <ImportOpmlDialog onClose={() => setShowImportOpml(false)} />}
      {folderTargetFeed && (
        <SetFeedFolderDialog
          feed={folderTargetFeed}
          folders={folders}
          onClose={() => setFolderTargetFeed(null)}
        />
      )}
      {editFeed && (
        <EditFeedDialog
          feed={editFeed}
          onClose={() => setEditFeed(null)}
        />
      )}
    </QxShell>
  );
}

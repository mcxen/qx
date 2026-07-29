import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { useRssStore, type RssFeed } from "./store";
import { useSettingsStore } from "../settings/store";
import { useStore } from "../../store";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { QxActionList } from "../../components/QxActionPanel";
import AddFeedDialog from "./AddFeedDialog";
import EditFeedDialog from "./EditFeedDialog";
import {
  ImportOpmlDialog,
  NewFolderDialog,
  SetFeedFolderDialog,
} from "./FolderDialogs";
import { FeedIcon, formatRelative } from "./rss-components";
import { useT } from "../../i18n";
import { buildRssRefreshIsland } from "./refreshProgress";

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
    refreshProgress,
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
  const t = useT();
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
      const title = folderId == null
        ? t("rss.ungrouped", "Ungrouped")
        : (feed.folder_name || t("rss.folder", "Folder"));
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
  }, [filtered, folders, query, t]);

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
  const localizedStatusMessage = statusMessage?.kind === "importingOpml"
    ? t("rss.importingOpml", "Importing OPML…")
    : statusMessage?.kind === "importedFeeds"
      ? t("rss.importedFeeds", "Imported {n} feeds").replace(
          "{n}",
          String(statusMessage.count),
        )
      : null;

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

  const handleDelete = (id: number) => {
    if (window.confirm(t("rss.removeFeedConfirm", "Remove this feed and all its articles?"))) {
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
      window.alert(
        t("rss.opmlExportFailed", "OPML export failed: {error}").replace(
          "{error}",
          String(err),
        ),
      );
    }
  };

  const actions = useMemo<QxShellAction[]>(() => [
    {
      id: "view-articles",
      label: t("rss.viewArticles", "View Articles"),
      kbd: "↵",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) void openFeed(selectedFeed.id);
      },
    },
    {
      id: "refresh-feed",
      label: t("rss.refreshFeed", "Refresh Feed"),
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) void refreshFeed(selectedFeed.id);
      },
    },
    {
      id: "add-feed",
      label: t("rss.addFeed", "Add Feed"),
      kbd: "↵",
      onClick: () => setShowAdd(true),
    },
    {
      id: "new-folder",
      label: t("rss.newFolder", "New Folder"),
      onClick: () => setShowNewFolder(true),
    },
    {
      id: "set-folder",
      label: t("rss.setFolder", "Set Folder…"),
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) setFolderTargetFeed(selectedFeed);
      },
    },
    {
      id: "remove-folder",
      label: t("rss.removeFromFolder", "Remove from Folder"),
      disabled: !selectedFeed?.folder_id,
      onClick: () => {
        if (selectedFeed?.folder_id != null) {
          void setFeedFolder(selectedFeed.id, null);
        }
      },
    },
    {
      id: "import-opml",
      label: t("rss.importOpml", "Import OPML…"),
      onClick: () => setShowImportOpml(true),
    },
    {
      id: "export-opml",
      label: t("rss.exportOpml", "Export OPML"),
      onClick: () => void handleExportOpml(),
    },
    {
      id: "refresh-all",
      label: t("rss.refreshAll", "Refresh All"),
      onClick: () => void refreshAll(),
    },
    {
      id: "edit-subscription",
      label: t("rss.editSubscription", "Edit Subscription"),
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) setEditFeed(selectedFeed);
      },
    },
    {
      id: "delete-folder",
      label: selectedFeed?.folder_name
        ? t("rss.deleteNamedFolder", "Delete Folder “{name}”").replace(
            "{name}",
            selectedFeed.folder_name,
          )
        : t("rss.deleteFolder", "Delete Folder"),
      disabled: !selectedFeed?.folder_id,
      onClick: () => {
        if (!selectedFeed?.folder_id) return;
        const name = selectedFeed.folder_name || t("rss.thisFolder", "this folder");
        if (
          window.confirm(
            t(
              "rss.deleteFolderConfirm",
              "Delete folder “{name}”? Subscriptions in it become ungrouped (feeds are kept).",
            ).replace("{name}", name),
          )
        ) {
          void deleteFolder(selectedFeed.folder_id);
        }
      },
    },
    {
      id: "delete-feed",
      label: t("rss.deleteFeed", "Delete Feed"),
      tone: "danger",
      disabled: !selectedFeed,
      onClick: () => {
        if (selectedFeed) handleDelete(selectedFeed.id);
      },
    },
  ], [deleteFolder, openFeed, refreshAll, refreshFeed, selectedFeed, setFeedFolder, t]);

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
    island: refreshingFeedId
      ? buildRssRefreshIsland(refreshProgress, selectedFeed?.title, t)
      : localizedStatusMessage
        ? { label: "RSS", detail: localizedStatusMessage, tone: "success" }
        : {
            label: t("rss.reader", "RSS Reader"),
            detail: t("rss.librarySummary", "{feeds} feeds · {folders} folders · {unread} unread")
              .replace("{feeds}", String(feeds.length))
              .replace("{folders}", String(folders.length))
              .replace("{unread}", String(unreadCount)),
          },
  });

  const primaryActionId = selectedFeed ? "view-articles" : "add-feed";
  const subscriptionActions = actions.filter((action) => action.id !== primaryActionId && [
    "view-articles",
    "refresh-feed",
    "set-folder",
    "remove-folder",
    "edit-subscription",
    "delete-folder",
    "delete-feed",
  ].includes(action.id));
  const libraryActions = actions.filter((action) => action.id !== primaryActionId && [
    "add-feed",
    "new-folder",
    "import-opml",
    "export-opml",
    "refresh-all",
  ].includes(action.id));

  let flatIndex = 0;

  return (
    <QxShell
      ref={shellRef}
      title={t("rss.reader", "RSS Reader")}
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
          autoFocus
          onChange={setQuery}
          placeholder={t("rss.searchFeeds", "Search feeds or folders…")}
        />
      }
      context={
        <div
          className="qx-action-panel"
          data-qx-region="rss-feed-actions"
          data-qx-region-label={t("rss.feedActions", "Feed actions")}
          data-qx-region-scroll
          tabIndex={-1}
        >
          <div className="qx-action-title">{t("rss.subscription", "Subscription")}</div>
          {selectedFeed ? (
            <div className="v2ex-context-copy qx-rss-action-summary">
              <strong>{selectedFeed.title || selectedFeed.url}</strong>
              <span>
                {t("rss.folderLabel", "Folder: {name}").replace(
                  "{name}",
                  selectedFeed.folder_name || t("rss.ungrouped", "Ungrouped"),
                )}
              </span>
              <span>{selectedFeed.url}</span>
            </div>
          ) : (
            <div className="v2ex-context-copy qx-rss-action-summary">
              <span>
                {t("rss.selectFeedHint", "Select a feed to set its folder or edit it.")}
              </span>
            </div>
          )}
          <QxActionList actions={subscriptionActions} showShortcuts={false} />
          <div className="qx-action-title">{t("rss.library", "Library")}</div>
          <QxActionList actions={libraryActions} showShortcuts={false} />
        </div>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryActionId={primaryActionId}
      actionMenuEnabled={false}
      actions={actions}
    >
      <div
        ref={listRef}
        className="qx-plugin-list qx-rss-feed-list"
        role="listbox"
        aria-label={t("rss.feedList", "Feed list")}
        data-qx-region="rss-feeds"
        data-qx-region-label={t("rss.feedList", "Feed list")}
        data-qx-region-initial="true"
        data-qx-region-scroll
        tabIndex={-1}
      >
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>{t("rss.subscriptions", "Subscriptions")}</span>
          <span>{filtered.length}</span>
        </div>
        {shouldShowQxListLoading(loading, filtered.length) && (
          <QxListLoading
            ariaLabel={t("rss.loadingFeeds", "Loading feeds")}
            label={t("rss.loadingFeedsEllipsis", "Loading feeds...")}
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
                {section.folderId != null && section.empty
                  ? ` · ${t("rss.empty", "empty")}`
                  : ""}
              </span>
              {section.folderId != null && section.empty && (
                <button
                  type="button"
                  className="qx-command-button"
                  style={{ marginLeft: 8, height: 22, fontSize: 11, padding: "0 8px" }}
                  title={t("rss.deleteEmptyFolder", "Delete empty folder")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        t("rss.deleteEmptyFolderConfirm", "Delete empty folder “{name}”?")
                          .replace("{name}", section.title),
                      )
                    ) {
                      void deleteFolder(section.folderId!);
                    }
                  }}
                >
                  {t("common.delete", "Delete")}
                </button>
              )}
            </div>
            {section.empty && (
              <div
                className="qx-list-subtitle"
                style={{ padding: "6px 12px 10px", color: "var(--color-text-tertiary)" }}
              >
                {t(
                  "rss.emptyFolderHint",
                  "Empty folder — select a feed and Set Folder, or Import OPML into this group.",
                )}
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
                      {formatRelative(feed.last_fetched, t)
                        || t("rss.neverFetched", "never fetched")}
                      {feed.error_count > 0
                        ? ` · ${t("rss.errorCount", "{n} errors").replace(
                            "{n}",
                            String(feed.error_count),
                          )}`
                        : ""}
                      {refreshing ? ` · ${t("rss.refreshing", "refreshing")}` : ""}
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
            {t(
              "rss.noFeeds",
              "No feeds yet. Add a subscription, New Folder, or Import OPML.",
            )}
          </div>
        )}
        {filtered.length === 0 && folders.length > 0 && !loading && query.trim() === "" && (
          <div className="qx-empty-state" style={{ paddingTop: 4 }}>
            {t(
              "rss.noSubscriptions",
              "No subscriptions yet — folders above are empty until you add or move feeds.",
            )}
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

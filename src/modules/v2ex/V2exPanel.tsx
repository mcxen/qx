import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { QxActionList } from "../../components/QxActionPanel";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { LoadingLabel, SegmentedControl } from "../../components/ui";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import {
  qxMasterDetailIds,
  qxMasterDetailNavigation,
  qxRegionProps,
  useQxMasterDetailFocus,
} from "../../hooks/useQxMasterDetail";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useStore } from "../../store";
import { type V2exMode, type V2exReply, type V2exTopic, formatTime } from "./types";
import { sanitizeTopicHtml } from "./V2exDetail";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import BetaBadge from "../../components/BetaBadge";

const MD = qxMasterDetailIds("v2ex");

export default function V2exPanel() {
  const setTab = useStore((state) => state.setTab);
  const [mode, setMode] = useState<V2exMode>("latest");
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<V2exTopic[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewingTopic, setViewingTopic] = useState<V2exTopic | null>(null);
  const [replies, setReplies] = useState<V2exReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [repliesError, setRepliesError] = useState("");
  const topicsRequestId = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { focusList, focusDetail } = useQxMasterDetailFocus(shellRef, MD);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: topics.map((t) => t.id).join("\0"),
  });

  const selectedTopic = topics[selectedIndex] ?? null;

  const loadTopics = async (nextMode = mode, nextQuery = query) => {
    const requestId = ++topicsRequestId.current;
    setLoading(true);
    setError("");
    try {
      const trimmed = nextQuery.trim();
      const result = trimmed
        ? await invoke<V2exTopic[]>("v2ex_search_topics", { query: trimmed })
        : await invoke<V2exTopic[]>("v2ex_fetch_topics", { mode: nextMode });
      if (requestId !== topicsRequestId.current) return;
      setTopics(result);
      setSelectedIndex(0);
    } catch (err) {
      if (requestId !== topicsRequestId.current) return;
      setError(String(err));
      setTopics([]);
      setSelectedIndex(0);
    } finally {
      if (requestId === topicsRequestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    const launch = takePendingModuleLaunch("v2ex");
    const nextMode: V2exMode =
      launch?.surface === "hot" ? "hot" : launch?.surface === "latest" ? "latest" : "latest";
    if (launch?.surface === "hot" || launch?.surface === "latest") {
      setMode(nextMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTopics(mode, query);
    }, query.trim() ? 260 : 80);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query]);

  useEffect(() => {
    setSelectedIndex((index) => Math.max(0, Math.min(index, topics.length - 1)));
  }, [topics.length]);

  useEffect(() => {
    if (viewingTopic && !topics.some((topic) => topic.id === viewingTopic.id)) {
      setViewingTopic(null);
    }
  }, [topics, viewingTopic]);

  useEffect(() => {
    if (!viewingTopic) {
      setReplies([]);
      setRepliesError("");
      return;
    }
    let cancelled = false;
    setRepliesLoading(true);
    setRepliesError("");
    invoke<V2exReply[]>("v2ex_fetch_topic_replies", { topicId: viewingTopic.id })
      .then((result) => {
        if (!cancelled) setReplies(result);
      })
      .catch((err) => {
        if (!cancelled) setRepliesError(String(err));
      })
      .finally(() => {
        if (!cancelled) setRepliesLoading(false);
      });
    return () => { cancelled = true; };
  }, [viewingTopic?.id]);

  const goBack = useCallback(() => setTab("launcher"), [setTab]);
  const openTopicAtIndex = (index: number, focusReader = false) => {
    if (topics.length === 0) {
      setSelectedIndex(0);
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, topics.length - 1));
    const topic = topics[nextIndex];
    setSelectedIndex(nextIndex);
    if (topic) {
      setViewingTopic(topic);
      if (focusReader) {
        window.requestAnimationFrame(() => focusDetail());
      }
    }
  };
  const detailTopic = viewingTopic;
  const contextTopic = detailTopic ?? selectedTopic;
  const cleanTopicContent = useMemo(
    () => (detailTopic ? sanitizeTopicHtml(detailTopic.content) : ""),
    [detailTopic],
  );

  const handleModuleKeys = useCallback((event: React.KeyboardEvent) => {
    // ↑↓ / Page / Home / End: QxShell.navigation + useQxListSelection (paint/scroll).
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (selectedTopic) openTopicAtIndex(selectedIndex, true);
      return;
    }
    if ((event.key === "r" || event.key === "R") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void loadTopics(mode, query);
    }
  }, [mode, query, selectedIndex, selectedTopic]);

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: detailTopic ? "Close Detail" : "View Topic",
      kbd: "Enter",
      disabled: !selectedTopic,
      onClick: () => {
        if (detailTopic) setViewingTopic(null);
        else if (selectedTopic) openTopicAtIndex(selectedIndex);
      },
    },
    {
      label: "Open in Browser",
      kbd: "O",
      disabled: !selectedTopic,
      onClick: () => {
        if (selectedTopic) void openUrl(selectedTopic.url);
      },
    },
    {
      label: "Refresh",
      kbd: "R",
      onClick: () => void loadTopics(mode, query),
    },
    {
      label: mode === "latest" ? "Show Hot" : "Show Latest",
      onClick: () => setMode(mode === "latest" ? "hot" : "latest"),
    },
  ], [detailTopic, mode, query, selectedIndex, selectedTopic]);

  const shell = useQxModuleShell({
    leave: goBack,
    esc: {
      inner: { active: viewingTopic !== null, close: () => setViewingTopic(null) },
      query: { active: query.length > 0, clear: () => setQuery("") },
    },
    onKeyDown: handleModuleKeys,
    islandState: {
      title: "V2EX",
      loading,
      loadingDetail: query.trim() ? "Searching" : "Loading topics",
      error: error || null,
      detail: `${topics.length} topics · ${mode}`,
    },
  });

  const hasDetail = Boolean(detailTopic);

  return (
    <QxShell
      ref={shellRef}
      title="V2EX"
      islandKey="v2ex"
      className="v2ex-shell qx-content-shell"
      onKeyDown={shell.onKeyDown}
      navigation={qxMasterDetailNavigation({
        ids: MD,
        index: selectedIndex,
        count: topics.length,
        // List keys only when list region is active — detail uses content scroll.
        onChange: (index) => setSelectedIndex(index),
        onOpen: () => {
          if (selectedTopic) openTopicAtIndex(selectedIndex, true);
        },
        onClose: () => {
          setViewingTopic(null);
        },
        pageSize: 8,
        focusList,
        focusDetail,
      })}
      escapeAction={shell.escapeAction}
      search={
        <QxModuleSearch
          value={query}
          onChange={setQuery}
          placeholder="Search V2EX topics..."
        />
      }
      trailing={
        <>
          <div className="qx-module-title-with-badge">
            <span>V2EX</span>
            <BetaBadge />
          </div>
          <SegmentedControl
            value={mode}
            onChange={(next) => setMode(next)}
            options={[
              { value: "latest", label: "Latest" },
              { value: "hot", label: "Hot" },
            ]}
          />
          <button className="qx-command-button" onClick={() => void loadTopics(mode, query)} type="button">
            Refresh
          </button>
        </>
      }
      context={
        <aside
          className="qx-action-panel"
          {...qxRegionProps(MD.actions, { label: "Topic actions", scroll: true })}
        >
          <div className="qx-action-title">Topic Actions</div>
          <QxActionList actions={actions.slice(0, 3)} />
          <div className="qx-action-title">Selected</div>
          <div className="v2ex-context-copy">
            {contextTopic ? (
              <>
                <strong>{contextTopic.title}</strong>
                <span>{contextTopic.node || "V2EX"} · {contextTopic.author || "unknown"} · {contextTopic.replies} replies</span>
                <span>{formatTime(contextTopic.last_modified || contextTopic.created)}</span>
              </>
            ) : (
              <span>No topic selected</span>
            )}
          </div>
        </aside>
      }
      island={shell.island}
      primaryAction={{
        label: detailTopic?.url ? "Open Topic" : selectedTopic ? "View Topic" : "Open",
        kbd: detailTopic?.url ? "O" : "Enter",
        disabled: !selectedTopic,
        tone: "primary",
        onClick: () => {
          if (detailTopic?.url) void openUrl(detailTopic.url);
          else if (selectedTopic) openTopicAtIndex(selectedIndex);
        },
      }}
      secondaryAction={shell.secondaryAction}
      actionTitle="V2EX Actions"
      actions={actions}
    >
      <div className={`qx-content-split${hasDetail ? " has-detail" : ""}`}>
        <div
          ref={listRef}
          className="qx-content-list qx-plugin-list"
          role="listbox"
          aria-label="V2EX topics"
          {...qxRegionProps(MD.list, {
            label: "Topic list",
            initial: !hasDetail,
            scroll: true,
          })}
        >
          <div className="qx-section-header">
            <span style={{ flex: 1 }}>{query.trim() ? "Search Results" : mode === "hot" ? "Hot Topics" : "Latest Topics"}</span>
            <span>{loading ? "..." : topics.length}</span>
          </div>
          {topics.map((topic, index) => (
            <button
              key={topic.id}
              {...getItemProps(index, { className: "v2ex-topic-row" })}
              onClick={() => openTopicAtIndex(index, false)}
              type="button"
            >
              <span className="qx-list-icon">{topic.node ? topic.node.slice(0, 1).toUpperCase() : "V"}</span>
              <span className="qx-list-copy">
                <span className="qx-list-title">{topic.title}</span>
                <span className="qx-list-subtitle">
                  {topic.node || "V2EX"} · {topic.author || "unknown"} · {topic.replies} replies
                </span>
              </span>
              <span className="qx-badge">{topic.replies}</span>
            </button>
          ))}
          {shouldShowQxListLoading(loading, topics.length) ? (
            <QxListLoading
              ariaLabel="Loading V2EX topics"
              label="Loading V2EX topics..."
              rows={6}
            />
          ) : topics.length === 0 ? (
            <div className="qx-empty-state">
              {error || (query.trim() ? "No matching topics." : "No topics loaded.")}
            </div>
          ) : null}
        </div>

        <article
          className="qx-content-detail qx-plugin-detail qx-rss-detail-content"
          {...qxRegionProps(MD.detail, {
            label: "Topic reader",
            initial: hasDetail,
          })}
          aria-hidden={!hasDetail}
        >
          {detailTopic ? (
            <>
              <div className="qx-detail-header">
                <div style={{ minWidth: 0 }}>
                  <div className="qx-detail-title">{detailTopic.title}</div>
                  <div className="qx-detail-meta">
                    {detailTopic.node || "V2EX"} · {detailTopic.author || "unknown"} · {formatTime(detailTopic.created)}
                  </div>
                </div>
                <span className="qx-badge">{detailTopic.replies}</span>
              </div>
              <div className="qx-content-detail-scroll" data-qx-region-scroll>
                <h1 className="qx-content-detail-heading">{detailTopic.title}</h1>
                <div className="qx-content-detail-meta">
                  <span>{detailTopic.node || "V2EX"}</span>
                  <span>{detailTopic.author || "unknown"}</span>
                  <span>{detailTopic.replies} replies</span>
                </div>
                <div
                  className="v2ex-detail-content"
                  dangerouslySetInnerHTML={{ __html: cleanTopicContent }}
                />
                <div className="v2ex-replies-section">
                  <div className="v2ex-replies-header">
                    <span>Replies ({detailTopic.replies})</span>
                  </div>
                  {repliesLoading && (
                    <div className="v2ex-replies-hint">
                      <LoadingLabel>Loading replies...</LoadingLabel>
                    </div>
                  )}
                  {repliesError && (
                    <div className="v2ex-replies-hint v2ex-replies-error">{repliesError}</div>
                  )}
                  {!repliesLoading && !repliesError && replies.length === 0 && (
                    <div className="v2ex-replies-hint">No replies yet.</div>
                  )}
                  {replies.map((reply) => (
                    <div key={reply.id} className="v2ex-reply-item">
                      <div className="v2ex-reply-meta">
                        <span className="v2ex-reply-floor">#{reply.floor}</span>
                        <span className="v2ex-reply-author">{reply.author}</span>
                        {reply.author === detailTopic.author && <span className="v2ex-reply-op">OP</span>}
                        <span className="v2ex-reply-time">{formatTime(reply.created)}</span>
                      </div>
                      <div
                        className="v2ex-reply-content v2ex-detail-content"
                        dangerouslySetInnerHTML={{ __html: sanitizeTopicHtml(reply.content) }}
                      />
                    </div>
                  ))}
                </div>
                {detailTopic.url && (
                  <div className="qx-content-detail-footer">
                    <button className="qx-command-button" onClick={() => void openUrl(detailTopic.url)} type="button">
                      Open in Browser
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="qx-content-detail-empty">
              <div>Select a topic to view details</div>
              <span>{topics.length} topics · {mode}</span>
            </div>
          )}
        </article>
      </div>
    </QxShell>
  );
}

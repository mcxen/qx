import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { SegmentedControl } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useStore } from "../../store";
import { type V2exMode, type V2exTopic, formatTime } from "./types";
import { sanitizeTopicHtml } from "./V2exDetail";

export default function V2exPanel() {
  const setTab = useStore((state) => state.setTab);
  const [mode, setMode] = useState<V2exMode>("latest");
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<V2exTopic[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewingTopic, setViewingTopic] = useState<V2exTopic | null>(null);

  const selectedTopic = topics[selectedIndex] ?? null;

  const loadTopics = async (nextMode = mode, nextQuery = query) => {
    setLoading(true);
    setError("");
    try {
      const trimmed = nextQuery.trim();
      const result = trimmed
        ? await invoke<V2exTopic[]>("v2ex_search_topics", { query: trimmed })
        : await invoke<V2exTopic[]>("v2ex_fetch_topics", { mode: nextMode });
      setTopics(result);
      setSelectedIndex(0);
    } catch (err) {
      setError(String(err));
      setTopics([]);
      setSelectedIndex(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTopics(mode, "");
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

  const goBack = () => setTab("launcher");
  const openTopicAtIndex = (index: number) => {
    if (topics.length === 0) {
      setSelectedIndex(0);
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, topics.length - 1));
    const topic = topics[nextIndex];
    setSelectedIndex(nextIndex);
    if (topic) setViewingTopic(topic);
  };
  const detailTopic = viewingTopic;
  const contextTopic = detailTopic ?? selectedTopic;
  const cleanTopicContent = useMemo(
    () => (detailTopic ? sanitizeTopicHtml(detailTopic.content) : ""),
    [detailTopic],
  );

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: { active: viewingTopic !== null, close: () => setViewingTopic(null) },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: goBack,
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    escKeyDown(event);
    if (event.key === "Escape") return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (viewingTopic) openTopicAtIndex(selectedIndex + 1);
        else setSelectedIndex(topics.length > 0 ? Math.min(selectedIndex + 1, topics.length - 1) : 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (viewingTopic) openTopicAtIndex(selectedIndex - 1);
        else setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        if (selectedTopic) openTopicAtIndex(selectedIndex);
        break;
      case "r":
      case "R":
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          void loadTopics(mode, query);
        }
        break;
    }
  };

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

  const island: BottomIslandContent = loading
    ? {
        label: "V2EX",
        detail: query.trim() ? "Searching" : "Loading topics",
      }
    : error
    ? {
        label: "V2EX Error",
        detail: error,
        tone: "danger",
      }
    : {
        label: "V2EX",
        detail: `${topics.length} topics · ${mode}`,
      };

  return (
    <QxShell
      title="V2EX"
      className="v2ex-shell qx-content-shell"
      onKeyDown={onKeyDown}
      onBack={goBack}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search V2EX topics..."
            className="qx-plugin-search"
          />
        </div>
      }
      trailing={
        <>
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
        <aside className="qx-action-panel">
          <div className="qx-action-title">Topic Actions</div>
          <button
            className="qx-action-item"
            disabled={!selectedTopic}
            onClick={() => selectedTopic && openTopicAtIndex(selectedIndex)}
            type="button"
          >
            <span>View Topic</span>
            <kbd>Enter</kbd>
          </button>
          <button
            className="qx-action-item"
            disabled={!selectedTopic}
            onClick={() => selectedTopic && void openUrl(selectedTopic.url)}
            type="button"
          >
            <span>Open in Browser</span>
            <kbd>O</kbd>
          </button>
          <button className="qx-action-item" onClick={() => void loadTopics(mode, query)} type="button">
            <span>Refresh</span>
            <kbd>R</kbd>
          </button>
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
      island={island}
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
      secondaryAction={{ label: "Actions", kbd: "Cmd K" }}
      actionTitle="V2EX Actions"
      actions={actions}
    >
      <div className={`qx-content-split${detailTopic ? " has-detail" : ""}`}>
        <div className="qx-content-list qx-plugin-list">
          <div className="qx-section-header">
            <span style={{ flex: 1 }}>{query.trim() ? "Search Results" : mode === "hot" ? "Hot Topics" : "Latest Topics"}</span>
            <span>{loading ? "..." : topics.length}</span>
          </div>
          {topics.map((topic, index) => (
            <button
              key={topic.id}
              className={`qx-list-row v2ex-topic-row${index === selectedIndex ? " is-active" : ""}`}
              onClick={() => openTopicAtIndex(index)}
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
          {!loading && topics.length === 0 && (
            <div className="qx-empty-state">
              {error || (query.trim() ? "No matching topics." : "No topics loaded.")}
            </div>
          )}
          {loading && topics.length === 0 && (
            <div className="qx-empty-state">Loading V2EX topics...</div>
          )}
        </div>

        <article className="qx-content-detail qx-plugin-detail qx-rss-detail-content">
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
              <div className="qx-content-detail-scroll">
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

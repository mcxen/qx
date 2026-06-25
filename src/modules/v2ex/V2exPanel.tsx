import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { SegmentedControl } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useStore } from "../../store";
import { type V2exMode, type V2exTopic, formatTime } from "./types";
import V2exDetail from "./V2exDetail";

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

  const goBack = () => setTab("launcher");

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
        setSelectedIndex(Math.min(selectedIndex + 1, topics.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        if (selectedTopic) setViewingTopic(selectedTopic);
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
      label: "View Topic",
      kbd: "Enter",
      disabled: !selectedTopic,
      onClick: () => {
        if (selectedTopic) setViewingTopic(selectedTopic);
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
  ], [mode, query, selectedTopic]);

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

  if (viewingTopic) {
    return <V2exDetail topic={viewingTopic} onBack={() => setViewingTopic(null)} />;
  }

  return (
    <QxShell
      title="V2EX"
      className="v2ex-shell"
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
            onClick={() => selectedTopic && setViewingTopic(selectedTopic)}
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
            {selectedTopic ? (
              <>
                <strong>{selectedTopic.title}</strong>
                <span>{selectedTopic.node || "V2EX"} · {selectedTopic.author || "unknown"} · {selectedTopic.replies} replies</span>
                <span>{formatTime(selectedTopic.last_modified || selectedTopic.created)}</span>
              </>
            ) : (
              <span>No topic selected</span>
            )}
          </div>
        </aside>
      }
      island={island}
      primaryAction={{
        label: selectedTopic ? "View Topic" : "Open",
        kbd: "Enter",
        disabled: !selectedTopic,
        tone: "primary",
        onClick: () => {
          if (selectedTopic) setViewingTopic(selectedTopic);
        },
      }}
      secondaryAction={{ label: "Actions", kbd: "Cmd K" }}
      actionTitle="V2EX Actions"
      actions={actions}
    >
      <div className="qx-plugin-list">
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>{query.trim() ? "Search Results" : mode === "hot" ? "Hot Topics" : "Latest Topics"}</span>
          <span>{loading ? "..." : topics.length}</span>
        </div>
        {topics.map((topic, index) => (
          <button
            key={topic.id}
            className={`qx-list-row v2ex-topic-row${index === selectedIndex ? " is-active" : ""}`}
            onClick={() => setSelectedIndex(index)}
            onDoubleClick={() => setViewingTopic(topic)}
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
    </QxShell>
  );
}

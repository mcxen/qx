import { useEffect, useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore } from "./store";

export default function QxAiPanel() {
  const {
    conversations,
    loading,
    error,
    setView,
    selectConversation,
    createConversation,
    deleteConversation,
    loadProviders,
  } = useG4fStore();

  const [query, setQuery] = useState("");

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.name.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  const selectedConv = filtered[selectedIndex];

  const { onKeyDown: escKeyDown } = useEscBack({
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setView("list"),
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
        if (selectedConv) {
          selectConversation(selectedConv.id);
          setView("chat");
        }
        break;
      case "n":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          createConversation();
        }
        break;
      case "s":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          setView("settings");
        }
        break;
    }
  };

  const island: BottomIslandContent = loading
    ? { label: "AI Chat", detail: "Loading providers...", progress: 42 }
    : error
      ? { label: "AI Chat", detail: error, tone: "danger" }
      : {
          label: "AI Chat",
          detail: `${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`,
        };

  return (
    <QxShell
      title="QxAI Chat"
      className="qx-qxai-panel-shell"
      onKeyDown={onKeyDown}
      onBack={() => setView("list")}
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="qx-plugin-search"
          />
        </div>
      }
      trailing={
        <>
          <button className="qx-command-button primary" onClick={() => createConversation()}>
            New Chat
          </button>
          <button className="qx-command-button" onClick={() => setView("settings")}>
            Settings
          </button>
        </>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Actions</div>
          <button
            className="qx-action-item"
            onClick={() => {
              if (selectedConv) {
                selectConversation(selectedConv.id);
                setView("chat");
              }
            }}
            disabled={!selectedConv}
          >
            <span>Open Chat</span>
            <kbd>↩</kbd>
          </button>
          <button className="qx-action-item" onClick={() => createConversation()}>
            <span>New Chat</span>
            <kbd>N</kbd>
          </button>
          <button className="qx-action-item" onClick={() => setView("settings")}>
            <span>Settings</span>
            <kbd>S</kbd>
          </button>
          <button
            className="qx-action-item danger"
            onClick={() => {
              if (selectedConv && window.confirm("Delete this conversation?")) {
                deleteConversation(selectedConv.id);
              }
            }}
            disabled={!selectedConv}
          >
            <span>Delete</span>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
      primaryAction={{
        label: selectedConv ? "Open Chat" : "New Chat",
        kbd: selectedConv ? "↵" : "N",
        tone: "primary",
        onClick: () => {
          if (selectedConv) {
            selectConversation(selectedConv.id);
            setView("chat");
          } else {
            createConversation();
          }
        },
      }}
      secondaryAction={{
        label: "Settings",
        kbd: "S",
        onClick: () => setView("settings"),
      }}
    >
      <div className="qx-plugin-list">
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>Conversations</span>
          <span>{filtered.length}</span>
        </div>
        {filtered.map((conv, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={conv.id}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => {
                selectConversation(conv.id);
                setView("chat");
              }}
              className={`qx-list-row${active ? " is-active" : ""}`}
            >
              <span className="qx-list-copy">
                <span className="qx-list-title">{conv.name}</span>
                <span className="qx-list-subtitle">
                  {conv.provider} · {conv.messages.length} message{conv.messages.length !== 1 ? "s" : ""}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="qx-empty-state">
            {loading ? "Loading..." : "No conversations yet. Press N to start one."}
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
    </QxShell>
  );
}

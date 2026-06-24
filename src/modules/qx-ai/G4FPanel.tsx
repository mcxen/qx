import { useEffect, useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore } from "./store";

export default function G4FPanel() {
  const {
    conversations,
    loading,
    error,
    setView,
    loadProviders,
    createConversation,
    selectConversation,
    deleteConversation,
  } = useG4fStore();
  const setTab = useStore((state) => state.setTab);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const selectedConv = filtered[selectedIndex];

  const { onKeyDown: escKeyDown } = useEscBack({
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
        if (selectedConv) selectConversation(selectedConv.id);
        break;
      case "n":
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          createConversation();
        }
        break;
    }
  };

  const island: BottomIslandContent = loading
    ? { label: "AI Chat", detail: "Loading providers...", progress: 42 }
    : {
        label: "AI Chat",
        detail: `${conversations.length} conversation${conversations.length !== 1 ? "s" : ""}`,
      };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this conversation?")) {
      deleteConversation(id);
    }
  };

  return (
    <QxShell
      title="AI Chat"
      className="qx-g4f-shell"
      onKeyDown={onKeyDown}
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search conversations..."
            className="qx-plugin-search"
          />
        </div>
      }
      trailing={
        <>
          <button
            className="qx-command-button primary"
            onClick={() => createConversation()}
          >
            New Chat
          </button>
        </>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Conversation Actions</div>
          <button
            className="qx-action-item"
            onClick={() => selectedConv && selectConversation(selectedConv.id)}
            disabled={!selectedConv}
          >
            <span>Open Chat</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => createConversation()}
          >
            <span>New Chat</span>
            <kbd>N</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => setView("settings")}
          >
            <span>Settings</span>
            <kbd>S</kbd>
          </button>
          <button
            className="qx-action-item danger"
            onClick={(e) => selectedConv && handleDelete(selectedConv.id, e)}
            disabled={!selectedConv}
          >
            <span>Delete Conversation</span>
            <kbd>⌘D</kbd>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setTab("launcher") }}
      primaryAction={{
        label: selectedConv ? "Open Chat" : "New Chat",
        kbd: selectedConv ? "↵" : "N",
        tone: "primary",
        onClick: () => {
          if (selectedConv) selectConversation(selectedConv.id);
          else createConversation();
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
              onDoubleClick={() => selectConversation(conv.id)}
              className={`qx-list-row${active ? " is-active" : ""}`}
            >
              <span className="qx-list-copy">
                <span className="qx-list-title" style={{ fontWeight: 500 }}>
                  {conv.name}
                </span>
                <span className="qx-list-subtitle">
                  {conv.messages.filter((m) => m.role === "user").length} messages
                  {" · "}
                  {conv.provider || "no provider"}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="qx-empty-state">
            {loading
              ? "Loading..."
              : "No conversations yet. Press N to start one."}
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

import { useEffect, useMemo, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { LoadingLabel, Skeleton } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { formatQxShortcut, getQxShortcutPreset } from "../../utils/keyboard";
import { useStore } from "../../store";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { useG4fStore } from "./store";

export default function QxAiPanel() {
  const setTab = useStore((state) => state.setTab);
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
  const actionMenuShortcut = getQxShortcutPreset().actionMenu;
  const actionMenuLabel = formatQxShortcut(actionMenuShortcut) ?? "⌘K";

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
    setSelectedIndex((index) => {
      if (filtered.length === 0) return 0;
      return Math.max(0, Math.min(index, filtered.length - 1));
    });
  }, [filtered.length]);

  const selectedConv = filtered[selectedIndex];

  const openSelected = () => {
    if (!selectedConv) return;
    selectConversation(selectedConv.id);
    setView("chat");
  };

  const { onKeyDown: escKeyDown } = useEscBack({
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setTab("launcher"),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.defaultPrevented) return;
    // List open: Enter always selects the highlighted conversation (search field may be focused).
    // Do not bind bare letter shortcuts — typing must stay free for search.
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && selectedConv) {
      e.preventDefault();
      openSelected();
    }
  };

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: "Open Chat",
      kbd: "↵",
      disabled: !selectedConv,
      onClick: openSelected,
    },
    {
      label: "New Chat",
      onClick: () => createConversation(),
    },
    {
      label: "Chat Settings",
      onClick: () => setView("settings"),
    },
    {
      label: "Agent & Providers",
      onClick: () => openAgentSettingsTab(),
    },
    {
      label: "Delete",
      tone: "danger",
      disabled: !selectedConv,
      onClick: () => {
        if (selectedConv && window.confirm("Delete this conversation?")) {
          deleteConversation(selectedConv.id);
        }
      },
    },
  ], [createConversation, deleteConversation, selectedConv, setView]);

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
      navigation={{
        index: selectedIndex,
        count: filtered.length,
        onChange: setSelectedIndex,
        onOpen: openSelected,
        pageSize: 8,
      }}
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
        <button className="qx-command-button primary" type="button" onClick={() => createConversation()}>
          New Chat
        </button>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Conversation</div>
          {selectedConv ? (
            <div className="qx-ai-context-summary">
              <div className="qx-ai-context-name">{selectedConv.name}</div>
              <div className="qx-ai-context-meta">
                {selectedConv.provider} · {selectedConv.model}
              </div>
              <div className="qx-ai-context-meta">
                {selectedConv.messages.filter((m) => m.role === "user").length} messages
              </div>
            </div>
          ) : (
            <div className="qx-ai-tool-hint">Select a conversation or create a new chat.</div>
          )}
          <div className="qx-action-title">Quick</div>
          <button className="qx-action-item" type="button" onClick={() => createConversation()}>
            <span>New Chat</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => setView("settings")}>
            <span>Chat Settings</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => openAgentSettingsTab()}>
            <span>Agent & Providers</span>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setTab("launcher") }}
      primaryAction={{
        label: selectedConv ? "Open Chat" : "New Chat",
        kbd: selectedConv ? "↵" : undefined,
        tone: "primary",
        onClick: () => {
          if (selectedConv) openSelected();
          else createConversation();
        },
      }}
      secondaryAction={{
        label: "Actions",
        kbd: actionMenuShortcut,
      }}
      actionTitle="AI Actions"
      actions={actions}
    >
      <div className="qx-plugin-list">
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>Conversations</span>
          <span>{filtered.length}</span>
        </div>
        {loading && filtered.length === 0 && (
          <div className="qx-skeleton-stack" aria-label="Loading AI providers">
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
              type="button"
            >
              <span className="qx-list-copy">
                <span className="qx-list-title">{conv.name}</span>
                <span className="qx-list-subtitle">
                  {conv.provider} · {conv.messages.length} message
                  {conv.messages.length !== 1 ? "s" : ""}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="qx-empty-state">
            {loading ? (
              <LoadingLabel>Loading providers...</LoadingLabel>
            ) : query.trim() ? (
              "No matching conversations."
            ) : (
              `No conversations yet. Use New Chat or Actions (${actionMenuLabel}).`
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
    </QxShell>
  );
}

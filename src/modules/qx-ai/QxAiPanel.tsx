import { useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { QxListLoading, shouldShowQxListLoading } from "../../components/QxListLoading";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { useEscBack } from "../../hooks/useEscBack";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useT } from "../../i18n";
import { formatQxShortcut, getQxShortcutPreset } from "../../utils/keyboard";
import { useStore } from "../../store";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { useG4fStore } from "./store";

export default function QxAiPanel() {
  const t = useT();
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
  const listRef = useRef<HTMLDivElement>(null);

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

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: filtered.map((c) => c.id).join("\0"),
  });

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
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && selectedConv) {
      e.preventDefault();
      openSelected();
    }
  };

  const actions = useMemo<QxShellAction[]>(
    () => [
      {
        label: t("qxai.openChat", "Open Chat"),
        kbd: "↵",
        disabled: !selectedConv,
        onClick: openSelected,
      },
      {
        label: t("qxai.newChat", "New Chat"),
        onClick: () => createConversation(),
      },
      {
        label: t("qxai.chatSettings", "Chat Settings"),
        onClick: () => setView("settings"),
      },
      {
        label: t("qxai.agentProviders", "Agent & Providers"),
        onClick: () => openAgentSettingsTab(),
      },
      {
        label: t("common.delete", "Delete"),
        tone: "danger",
        disabled: !selectedConv,
        onClick: () => {
          if (
            selectedConv
            && window.confirm(t("qxai.deleteConversation", "Delete this conversation?"))
          ) {
            deleteConversation(selectedConv.id);
          }
        },
      },
    ],
    [createConversation, deleteConversation, selectedConv, setView, t],
  );

  const island: BottomIslandContent = loading
    ? {
        label: t("qxai.title", "QxAI Chat"),
        detail: t("qxai.island.loading", "Loading providers…"),
        progress: 42,
      }
    : error
      ? { label: t("qxai.title", "QxAI Chat"), detail: error, tone: "danger" }
      : {
          label: t("qxai.title", "QxAI Chat"),
          detail: t("qxai.island.conversations", "{n} conversations").replace(
            "{n}",
            String(conversations.length),
          ),
        };

  return (
    <QxShell
      title={t("qxai.title", "QxAI Chat")}
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
        <QxModuleSearch
          value={query}
          onChange={setQuery}
          placeholder={t("qxai.searchConversations", "Search conversations…")}
        />
      }
      trailing={
        <button
          className="qx-command-button primary"
          type="button"
          onClick={() => createConversation()}
        >
          {t("qxai.newChat", "New Chat")}
        </button>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">{t("qxai.conversation", "Conversation")}</div>
          {selectedConv ? (
            <div className="qx-ai-context-summary">
              <div className="qx-ai-context-name">{selectedConv.name}</div>
              <div className="qx-ai-context-meta">
                {selectedConv.provider} · {selectedConv.model}
              </div>
              <div className="qx-ai-context-meta">
                {t("qxai.messages", "{n} messages").replace(
                  "{n}",
                  String(selectedConv.messages.filter((m) => m.role === "user").length),
                )}
              </div>
            </div>
          ) : (
            <div className="qx-ai-tool-hint">
              {t("qxai.selectOrCreate", "Select a conversation or create a new chat.")}
            </div>
          )}
          <div className="qx-action-title">{t("qxai.quick", "Quick")}</div>
          <button className="qx-action-item" type="button" onClick={() => createConversation()}>
            <span>{t("qxai.newChat", "New Chat")}</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => setView("settings")}>
            <span>{t("qxai.chatSettings", "Chat Settings")}</span>
          </button>
          <button className="qx-action-item" type="button" onClick={() => openAgentSettingsTab()}>
            <span>{t("qxai.agentProviders", "Agent & Providers")}</span>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setTab("launcher") }}
      primaryAction={{
        label: selectedConv ? t("qxai.openChat", "Open Chat") : t("qxai.newChat", "New Chat"),
        kbd: selectedConv ? "↵" : undefined,
        tone: "primary",
        onClick: () => {
          if (selectedConv) openSelected();
          else createConversation();
        },
      }}
      secondaryAction={{
        label: t("common.actions", "Actions"),
        kbd: actionMenuShortcut,
      }}
      actionTitle={t("qxai.actions", "AI Actions")}
      actions={actions}
    >
      <div ref={listRef} className="qx-plugin-list" role="listbox" aria-label={t("qxai.conversations", "Conversations")}>
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>{t("qxai.conversations", "Conversations")}</span>
          <span>{filtered.length}</span>
        </div>
        {shouldShowQxListLoading(loading, filtered.length) && (
          <QxListLoading
            ariaLabel={t("qxai.loadingProviders", "Loading providers…")}
            label={t("qxai.loadingProviders", "Loading providers…")}
            rows={5}
            showMeta={false}
            showIcon={false}
          />
        )}
        {filtered.map((conv, i) => {
          return (
            <button
              key={conv.id}
              {...getItemProps(i)}
              onClick={() => setSelectedIndex(i)}
              onDoubleClick={() => {
                selectConversation(conv.id);
                setView("chat");
              }}
              type="button"
            >
              <span className="qx-list-copy">
                <span className="qx-list-title">{conv.name}</span>
                <span className="qx-list-subtitle">
                  {conv.provider} ·{" "}
                  {t("qxai.messages", "{n} messages").replace(
                    "{n}",
                    String(conv.messages.length),
                  )}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && !loading && (
          <div className="qx-empty-state">
            {query.trim()
              ? t("qxai.noMatch", "No matching conversations.")
              : t(
                  "qxai.emptyList",
                  "No conversations yet. Use New Chat or Actions ({menu}).",
                ).replace("{menu}", actionMenuLabel)}
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

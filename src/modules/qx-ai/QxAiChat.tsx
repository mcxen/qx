import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Hammer, UserRound } from "lucide-react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { Select } from "../../components/ui";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { isEditableTarget } from "../../utils/keyboard";
import { useSettingsStore } from "../settings/store";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { AiMessageContent } from "./message-rendering";
import { useG4fStore } from "./store";

export default function QxAiChat() {
  const t = useT();
  const {
    conversations,
    currentConversationId,
    streaming,
    streamingConversationId,
    streamedContent,
    streamingSteps,
    error,
    providers,
    setView,
    sendMessage,
    clearMessages,
    deleteConversation,
    createConversation,
    setConversationModel,
    loadProviders,
  } = useG4fStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentSettings = useSettingsStore((state) => state.settings.agent);

  const conv = conversations.find((c) => c.id === currentConversationId);
  const isCurrentConversationStreaming = streaming && streamingConversationId === conv?.id;
  const enabledTools = useMemo(() => {
    if (!agentSettings.agent_mode_enabled || !agentSettings.tools_enabled) return [];
    return [
      agentSettings.memory_tool_enabled && "memory",
      agentSettings.app_search_enabled && "apps",
      agentSettings.file_search_enabled && "files",
      agentSettings.http_fetch_enabled && "http",
      agentSettings.grep_search_enabled && "grep",
      agentSettings.bash_enabled && "bash",
      agentSettings.mcp_enabled && "mcp",
    ].filter(Boolean) as string[];
  }, [agentSettings]);
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === conv?.provider),
    [providers, conv?.provider],
  );
  const activeModels = activeProvider?.models ?? [];
  const canChat = Boolean(
    conv &&
      activeProvider &&
      activeModels.some((model) => model.id === conv.model),
  );

  const leave = useCallback(() => setView("list"), [setView]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isCurrentConversationStreaming || !canChat) return;
    setInput("");
    void sendMessage(trimmed);
  }, [canChat, input, isCurrentConversationStreaming, sendMessage]);

  const handleModuleKeys = useCallback((e: React.KeyboardEvent) => {
    // Enter sends only from the chat field; never steal bare letters like N/S.
    if (
      e.key === "Enter"
      && !e.shiftKey
      && !e.metaKey
      && !e.ctrlKey
      && isEditableTarget(e.target)
    ) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages, streamedContent]);

  useEffect(() => {
    if (providers.length === 0) {
      void loadProviders();
    }
  }, [providers.length, loadProviders]);

  useEffect(() => {
    if (!conv || providers.length === 0 || canChat) return;
    const provider = providers.find((p) => p.id === conv.provider) ?? providers[0];
    setConversationModel(conv.id, provider.id, provider.models[0]?.id ?? "");
  }, [conv, providers, canChat, setConversationModel]);

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: isCurrentConversationStreaming
        ? t("qxai.sending", "Sending…")
        : t("qxai.send", "Send"),
      kbd: "↵",
      disabled: isCurrentConversationStreaming || !input.trim() || !canChat,
      onClick: handleSend,
    },
    {
      label: t("qxai.newChat", "New Chat"),
      onClick: () => createConversation(),
    },
    {
      label: t("qxai.clearMessages", "Clear Messages"),
      disabled: !conv || conv.messages.length === 0,
      onClick: () => clearMessages(),
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
      label: t("qxai.deleteChat", "Delete Chat"),
      tone: "danger",
      disabled: !conv,
      onClick: () => {
        if (
          currentConversationId
          && window.confirm(t("qxai.deleteConversation", "Delete this conversation?"))
        ) {
          deleteConversation(currentConversationId);
          setView("list");
        }
      },
    },
  ], [
    canChat,
    clearMessages,
    conv,
    createConversation,
    currentConversationId,
    deleteConversation,
    handleSend,
    input,
    isCurrentConversationStreaming,
    setView,
    t,
  ]);

  const userMessageCount = conv?.messages.filter((m) => m.role === "user").length ?? 0;

  const island: BottomIslandContent = isCurrentConversationStreaming
    ? {
        label: t("qxai.title", "QxAI Chat"),
        detail: t("qxai.streaming", "Streaming response…"),
        progress: 55,
      }
    : error
      ? { label: t("qxai.title", "QxAI Chat"), detail: error, tone: "danger" }
      : {
          label: t("qxai.title", "QxAI Chat"),
          detail:
            userMessageCount > 0
              ? t("qxai.messages", "{n} messages").replace("{n}", String(userMessageCount))
              : conv?.provider
                ? `${conv.provider} · ${conv.model}`
                : t("qxai.noMessages", "No messages yet"),
        };

  const shell = useQxModuleShell({
    leave,
    esc: {
      query: { active: input.length > 0, clear: () => setInput("") },
    },
    onKeyDown: handleModuleKeys,
    island,
    t,
  });

  const messages = conv?.messages.filter((m) => m.role !== "system") ?? [];

  return (
    <QxShell
      title={conv?.name ?? t("qxai.title", "QxAI Chat")}
      islandKey="qx-ai.chat"
      className="qx-qxai-chat-shell"
      onKeyDown={shell.onKeyDown}
      search={
        <QxModuleSearch
          value={input}
          onChange={setInput}
          onFocus={requestPanelKeyWindow}
          disabled={isCurrentConversationStreaming || !conv}
          placeholder={
            isCurrentConversationStreaming
              ? t("qxai.waitingResponse", "Waiting for response…")
              : t("qxai.typeMessage", "Type a message… (Enter to send)")
          }
        />
      }
      trailing={
        <button className="qx-command-button" type="button" onClick={() => createConversation()}>
          {t("qxai.newChat", "New Chat")}
        </button>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">{t("qxai.model", "Model")}</div>
          {providers.length > 0 && conv ? (
            <>
              <Select
                value={conv.provider}
                options={providers.map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                }))}
                onChange={(provider) => {
                  const nextProvider = providers.find((p) => p.id === provider);
                  setConversationModel(
                    conv.id,
                    provider,
                    nextProvider?.models[0]?.id ?? "",
                  );
                }}
                ariaLabel={t("qxai.provider", "AI Provider")}
                className="qx-inline-select"
              />
              {activeModels.length > 0 ? (
                <Select
                  value={conv.model}
                  options={activeModels.map((model) => ({
                    value: model.id,
                    label: model.name,
                  }))}
                  onChange={(model) => setConversationModel(conv.id, conv.provider, model)}
                  ariaLabel={t("qxai.model", "Model")}
                  className="qx-inline-select"
                />
              ) : (
                <div className="qx-ai-tool-hint">
                  {t("qxai.noModels", "No models available for this provider")}
                </div>
              )}
            </>
          ) : (
            <div className="qx-ai-tool-hint">
              {t(
                "qxai.configureProviders",
                "Configure providers in Settings → AI Agent, or open Chat Settings for defaults.",
              )}
            </div>
          )}

          <div className="qx-action-title">{t("qxai.tools", "Tools")}</div>
          <div className="qx-ai-tool-summary">
            <div className="qx-ai-tool-summary-head">
              <Hammer size={14} />
              <span>
                {enabledTools.length
                  ? t("qxai.tools.enabled", "{n} enabled").replace(
                      "{n}",
                      String(enabledTools.length),
                    )
                  : t("qxai.tools.disabled", "Disabled")}
              </span>
            </div>
            {enabledTools.length > 0 ? (
              <div className="qx-ai-tool-chips">
                {enabledTools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            ) : (
              <div className="qx-ai-tool-hint">
                {!agentSettings.agent_mode_enabled
                  ? t("qxai.tools.enableAgent", "Enable Agent mode in Settings → AI Agent.")
                  : !agentSettings.tools_enabled
                    ? t("qxai.tools.masterOff", "Master tools switch is off in Settings → AI Agent.")
                    : t(
                        "qxai.tools.none",
                        "No individual tools enabled. Configure them in Settings → AI Agent.",
                      )}
              </div>
            )}
            <button
              className="qx-action-item"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => openAgentSettingsTab()}
            >
              <span>{t("qxai.openAgentSettingsShort", "Open Agent Settings")}</span>
            </button>
          </div>
        </div>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryAction={{
        label: isCurrentConversationStreaming ? "…" : t("qxai.send", "Send"),
        kbd: "Enter",
        tone: "primary",
        disabled: isCurrentConversationStreaming || !input.trim() || !canChat,
        onClick: handleSend,
      }}
      secondaryAction={shell.secondaryAction}
      actionTitle="Chat Actions"
      actions={actions}
    >
      <div className="qx-ai-conversation">
        <div className="qx-ai-message-list">
          {messages.map((msg, i) => (
            <div
              key={`${conv?.id ?? "chat"}-${msg.role}-${i}-${msg.content.slice(0, 24)}`}
              className={`qx-ai-message is-${msg.role}`}
            >
              <div className="qx-ai-message-avatar" aria-hidden="true">
                {msg.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}
              </div>
              <div className="qx-ai-message-body">
                <div className="qx-ai-message-meta">
                  {msg.role === "user" ? "You" : conv?.provider || "AI"}
                </div>
                <div className="qx-ai-message-bubble">
                  <AiMessageContent content={msg.content} steps={msg.steps} />
                </div>
              </div>
            </div>
          ))}

          {isCurrentConversationStreaming && (streamedContent || streamingSteps.length > 0) && (
            <div className="qx-ai-message is-assistant">
              <div className="qx-ai-message-avatar" aria-hidden="true">
                <Bot size={14} />
              </div>
              <div className="qx-ai-message-body">
                <div className="qx-ai-message-meta">{conv?.provider || "AI"}</div>
                <div className="qx-ai-message-bubble">
                  <AiMessageContent
                    content={streamedContent}
                    streaming
                    steps={streamingSteps}
                  />
                </div>
              </div>
            </div>
          )}

          {conv && messages.length === 0 && !isCurrentConversationStreaming && (
            <div className="qx-ai-empty-state">
              {conv.provider
                ? `Chatting with ${conv.provider} (${conv.model}). Type a message below.`
                : "No provider selected. Open Chat Settings or Settings → AI Agent."}
            </div>
          )}

          {!conv && (
            <div className="qx-ai-empty-state">
              Select or create a conversation to begin.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </QxShell>
  );
}

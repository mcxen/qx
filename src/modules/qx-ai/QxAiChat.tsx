import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Hammer, UserRound } from "lucide-react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { Select } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useSettingsStore } from "../settings/store";
import { AiMessageContent } from "./message-rendering";
import { useG4fStore } from "./store";

export default function QxAiChat() {
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

  const { onKeyDown: escKeyDown } = useEscBack({
    query: { active: input.length > 0, clear: () => setInput("") },
    launcher: () => setView("list"),
  });

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isCurrentConversationStreaming || !canChat) return;
    setInput("");
    void sendMessage(trimmed);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

  const userMessageCount = conv?.messages.filter((m) => m.role === "user").length ?? 0;

  const island: BottomIslandContent = isCurrentConversationStreaming
    ? { label: "AI Chat", detail: "Streaming response...", progress: 55 }
    : error
      ? { label: "AI Chat", detail: error, tone: "danger" }
      : {
          label: "AI Chat",
          detail:
            userMessageCount > 0
              ? `${userMessageCount} message${userMessageCount !== 1 ? "s" : ""}`
              : conv?.provider
                ? `${conv.provider} · ${conv.model}`
                : "No messages yet",
        };

  const messages = conv?.messages.filter((m) => m.role !== "system") ?? [];

  return (
    <QxShell
      title={conv?.name ?? "AI Chat"}
      className="qx-qxai-chat-shell"
      onKeyDown={onKeyDown}
      onBack={() => setView("list")}
      backLabel="Conversations"
      search={
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={input}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            placeholder={isCurrentConversationStreaming ? "Waiting for response..." : "Type a message... (Enter to send)"}
            className="qx-plugin-search"
            disabled={isCurrentConversationStreaming || !conv}
          />
        </div>
      }
      trailing={
        <button className="qx-command-button" onClick={() => createConversation()}>
          New Chat
        </button>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Model</div>
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
                ariaLabel="AI Provider"
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
                  ariaLabel="AI Model"
                  className="qx-inline-select"
                />
              ) : (
                <div
                  style={{
                    color: "var(--qx-text-tertiary)",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  No models available for this provider.
                </div>
              )}
            </>
          ) : (
            <div
              style={{
                color: "var(--qx-text-tertiary)",
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              Open Settings to load or add providers.
            </div>
          )}

          <div className="qx-action-title">Chat Actions</div>
          <button
            className="qx-action-item"
            onClick={() => clearMessages()}
            disabled={!conv || conv.messages.length === 0}
          >
            <span>Clear Messages</span>
          </button>
          <button className="qx-action-item" onClick={() => setView("settings")}>
            <span>Settings</span>
            <kbd>S</kbd>
          </button>
          <button
            className="qx-action-item danger"
            onClick={() => {
              if (currentConversationId && window.confirm("Delete this conversation?")) {
                deleteConversation(currentConversationId);
                setView("list");
              }
            }}
            disabled={!conv}
          >
            <span>Delete Chat</span>
          </button>

          <div className="qx-action-title">Tools</div>
          <div className="qx-ai-tool-summary">
            <div className="qx-ai-tool-summary-head">
              <Hammer size={14} />
              <span>{enabledTools.length ? `${enabledTools.length} enabled` : "Disabled"}</span>
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
                  ? "Enable Agent mode in Settings > Agent to let the AI call tools."
                  : !agentSettings.tools_enabled
                    ? "Master tools switch is off. Enable it in Settings > Agent."
                    : "No individual tools enabled. Turn some on in Settings > Agent."}
              </div>
            )}
          </div>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
      primaryAction={{
        label: isCurrentConversationStreaming ? "..." : "Send",
        kbd: "Enter",
        tone: "primary",
        disabled: isCurrentConversationStreaming || !input.trim() || !canChat,
        onClick: handleSend,
      }}
      secondaryAction={{
        label: "Settings",
        kbd: "S",
        onClick: () => setView("settings"),
      }}
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
                : "No provider selected. Go to Settings to configure."}
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

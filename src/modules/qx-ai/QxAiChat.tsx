import { useEffect, useRef, useState } from "react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore } from "./store";

export default function QxAiChat() {
  const {
    conversations,
    currentConversationId,
    streaming,
    streamedContent,
    error,
    setView,
    sendMessage,
    clearMessages,
    deleteConversation,
    createConversation,
  } = useG4fStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conv = conversations.find((c) => c.id === currentConversationId);

  const { onKeyDown: escKeyDown } = useEscBack({
    query: { active: input.length > 0, clear: () => setInput("") },
    launcher: () => setView("list"),
  });

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
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

  const userMessageCount = conv?.messages.filter((m) => m.role === "user").length ?? 0;

  const island: BottomIslandContent = streaming
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

  const messageBubble = (_content: string, isUser: boolean) => ({
    maxWidth: "80%",
    padding: "8px 14px",
    borderRadius: "var(--qx-card-radius)",
    background: isUser ? "var(--qx-accent)" : "var(--qx-bg-component-2)",
    color: isUser ? "var(--qx-text-on-accent)" : "var(--qx-text-primary)",
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  });

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
            placeholder={streaming ? "Waiting for response..." : "Type a message... (Enter to send)"}
            className="qx-plugin-search"
            disabled={streaming || !conv}
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
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
      primaryAction={{
        label: streaming ? "..." : "Send",
        kbd: "Enter",
        tone: "primary",
        disabled: streaming || !input.trim(),
        onClick: handleSend,
      }}
      secondaryAction={{
        label: "Settings",
        kbd: "S",
        onClick: () => setView("settings"),
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
          }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                marginBottom: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div style={messageBubble(msg.content, msg.role === "user")}>
                {msg.content}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--qx-text-tertiary)",
                  marginTop: 2,
                  padding: "0 4px",
                }}
              >
                {msg.role === "user" ? "You" : conv?.provider || "AI"}
              </span>
            </div>
          ))}

          {/* Streaming content */}
          {streaming && streamedContent && (
            <div
              style={{
                marginBottom: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  ...messageBubble(streamedContent, false),
                  display: "inline-block",
                }}
              >
                {streamedContent}
                <span className="qx-typing-cursor">|</span>
              </div>
            </div>
          )}

          {/* Empty state */}
          {conv && messages.length === 0 && !streaming && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--qx-text-tertiary)",
                fontSize: 14,
              }}
            >
              {conv.provider
                ? `Chatting with ${conv.provider} (${conv.model}). Type a message below.`
                : "No provider selected. Go to Settings to configure."}
            </div>
          )}

          {!conv && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--qx-text-tertiary)",
                fontSize: 14,
              }}
            >
              Select or create a conversation to begin.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </QxShell>
  );
}

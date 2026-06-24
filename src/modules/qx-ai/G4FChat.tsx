import { useEffect, useRef, useState } from "react";
import QxShell, { type BottomIslandContent } from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore } from "./store";

export default function G4FChat() {
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
    inner: {
      active: false,
      close: () => {},
    },
    query: { active: input.length > 0, clear: () => setInput("") },
    launcher: () => setView("list"),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput("");
    void sendMessage(trimmed);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages, streamedContent]);

  const messageCount = conv?.messages.filter((m) => m.role !== "system").length ?? 0;
  const userMessageCount = conv?.messages.filter((m) => m.role === "user").length ?? 0;

  const island: BottomIslandContent = streaming
    ? {
        label: "AI Chat",
        detail: "Streaming response...",
        progress: 55,
      }
    : error
      ? {
          label: "AI Chat",
          detail: error,
          tone: "danger",
        }
      : {
          label: "AI Chat",
          detail:
            userMessageCount > 0
              ? `${userMessageCount} message${userMessageCount !== 1 ? "s" : ""}`
              : conv?.provider
                ? `${conv.provider} · ${conv.model}`
                : "No messages yet",
        };

  const handleDelete = () => {
    if (!currentConversationId) return;
    if (window.confirm("Delete this conversation?")) {
      deleteConversation(currentConversationId);
      setView("list");
    }
  };

  const handleNewChat = () => {
    createConversation();
  };

  return (
    <QxShell
      title={conv?.name ?? "AI Chat"}
      className="qx-g4f-chat-shell"
      onKeyDown={onKeyDown}
      onBack={() => setView("list")}
      backLabel="Conversations"
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">Chat Actions</div>
          <button
            className="qx-action-item"
            onClick={() => clearMessages()}
            disabled={!conv || conv.messages.length === 0}
          >
            <span>Clear Messages</span>
            <kbd>⌘L</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={handleNewChat}
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
            onClick={handleDelete}
            disabled={!conv}
          >
            <span>Delete Chat</span>
            <kbd>⌘D</kbd>
          </button>
        </div>
      }
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
      primaryAction={{
        label: streaming ? "Streaming..." : "Send",
        kbd: "Enter",
        tone: streaming ? "normal" : "primary",
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
          {conv?.messages
            .filter((m) => m.role !== "system")
            .map((msg, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 12,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "8px 14px",
                    borderRadius: "var(--qx-card-radius, 6px)",
                    background:
                      msg.role === "user"
                        ? "var(--qx-primary, #0066ff)"
                        : "var(--qx-bg-2, #1e1e2e)",
                    color:
                      msg.role === "user"
                        ? "var(--qx-primary-text, #fff)"
                        : "var(--qx-fg, #cdd6f4)",
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--qx-fg-subtle, #6c7086)",
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
                  maxWidth: "80%",
                  padding: "8px 14px",
                  borderRadius: "var(--qx-card-radius, 6px)",
                  background: "var(--qx-bg-2, #1e1e2e)",
                  color: "var(--qx-fg, #cdd6f4)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {streamedContent}
                <span className="qx-typing-cursor">▊</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--qx-fg-subtle, #6c7086)",
                  marginTop: 2,
                  padding: "0 4px",
                }}
              >
                {conv?.provider || "AI"}
              </span>
            </div>
          )}

          {/* Empty state */}
          {conv && messageCount === 0 && !streaming && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--qx-fg-subtle, #6c7086)",
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
                color: "var(--qx-fg-subtle, #6c7086)",
                fontSize: 14,
              }}
            >
              Select or create a conversation to begin.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            borderTop: "1px solid var(--qx-border-1, #313244)",
            padding: "10px 16px",
            display: "flex",
            gap: 8,
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              streaming
                ? "Waiting for response..."
                : "Type a message... (Enter to send)"
            }
            disabled={streaming || !conv}
            autoFocus
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "var(--qx-card-radius, 6px)",
              border: "1px solid var(--qx-border-1, #313244)",
              background: "var(--qx-bg-2, #1e1e2e)",
              color: "var(--qx-fg, #cdd6f4)",
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>
      </div>
    </QxShell>
  );
}

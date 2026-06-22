import { useEffect, useRef, useState } from "react";
import { useRssStore } from "./store";

export default function AddFeedDialog({ onClose }: { onClose: () => void }) {
  const { addFeed, loading } = useRssStore();
  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setLocalError("URL must start with http:// or https://");
      return;
    }
    setLocalError(null);
    try {
      await addFeed(trimmed);
      onClose();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: 440,
          maxWidth: "90vw",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            marginBottom: 4,
          }}
        >
          Add RSS Subscription
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            marginBottom: 14,
          }}
        >
          Paste the feed URL (RSS or Atom).
        </div>
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="https://example.com/feed.xml"
          style={{
            width: "100%",
            height: 36,
            padding: "0 12px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "var(--color-canvas)",
            color: "var(--color-text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        {localError && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "#b91c1c",
              background: "rgba(185,28,28,0.08)",
              borderRadius: 6,
              padding: "6px 10px",
            }}
          >
            {localError}
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={onClose}
            style={{
              height: 32,
              padding: "0 14px",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-surface)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={loading || !url.trim()}
            style={{
              height: 32,
              padding: "0 14px",
              border: "none",
              borderRadius: 8,
              background: "var(--color-accent)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 500,
              cursor: loading || !url.trim() ? "default" : "pointer",
              opacity: !url.trim() || loading ? 0.6 : 1,
            }}
          >
            {loading ? "Adding…" : "Add Feed"}
          </button>
        </div>
      </div>
    </div>
  );
}

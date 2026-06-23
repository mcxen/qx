import { useEffect, useRef, useState } from "react";
import { useRssStore } from "./store";
import { Modal } from "../../components/ui";

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
    <Modal
      title="Add RSS Subscription"
      subtitle="Paste the feed URL (RSS or Atom)."
      onClose={onClose}
    >
      <input
        ref={inputRef}
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="https://example.com/feed.xml"
        className="qx-inline-input"
        style={{ width: "100%" }}
      />
      {localError && <div className="qx-modal-error">{localError}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          onClick={() => void submit()}
          disabled={loading || !url.trim()}
        >
          {loading ? "Adding…" : "Add Feed"}
        </button>
      </div>
    </Modal>
  );
}

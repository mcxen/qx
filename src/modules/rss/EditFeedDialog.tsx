import { useEffect, useRef, useState } from "react";
import { useRssStore, type RssFeed } from "./store";
import { Modal } from "../../components/ui";

export default function EditFeedDialog({
  feed,
  onClose,
}: {
  feed: RssFeed;
  onClose: () => void;
}) {
  const { updateFeed, loading } = useRssStore();
  const [url, setUrl] = useState(feed.url);
  const [title, setTitle] = useState(feed.title);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setLocalError("URL cannot be empty");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setLocalError("URL must start with http:// or https://");
      return;
    }
    setLocalError(null);
    try {
      await updateFeed(feed.id, trimmedUrl, title.trim());
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
      title="Edit RSS Subscription"
      onClose={onClose}
    >
      <div className="qx-modal-field">
        <label className="qx-modal-field-label">Feed URL</label>
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
      </div>
      <div className="qx-modal-field">
        <label className="qx-modal-field-label">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Feed name"
          className="qx-inline-input"
          style={{ width: "100%" }}
        />
      </div>
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
          {loading ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

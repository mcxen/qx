import { useEffect, useMemo, useRef, useState } from "react";
import { useRssStore, type RssFeed } from "./store";
import { LoadingLabel, Modal, Select } from "../../components/ui";

const UNGROUPED = "none";

export default function EditFeedDialog({
  feed,
  onClose,
}: {
  feed: RssFeed;
  onClose: () => void;
}) {
  const { updateFeed, setFeedFolder, folders, loading } = useRssStore();
  const [url, setUrl] = useState(feed.url);
  const [title, setTitle] = useState(feed.title);
  const [folderChoice, setFolderChoice] = useState(
    feed.folder_id == null ? UNGROUPED : String(feed.folder_id),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const folderOptions = useMemo(
    () => [
      { value: UNGROUPED, label: "Ungrouped" },
      ...folders.map((f) => ({ value: String(f.id), label: f.name })),
    ],
    [folders],
  );

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
      const nextFolder =
        folderChoice === UNGROUPED ? null : Number(folderChoice);
      const prevFolder = feed.folder_id ?? null;
      const nextId =
        nextFolder != null && Number.isFinite(nextFolder) ? nextFolder : null;
      if (nextId !== prevFolder) {
        await setFeedFolder(feed.id, nextId);
      }
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
    <Modal title="Edit subscription" subtitle="URL, title, and folder for this feed only." onClose={onClose}>
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
      <div className="qx-modal-field">
        <label className="qx-modal-field-label">Folder</label>
        <Select
          value={folderChoice}
          options={folderOptions}
          onChange={setFolderChoice}
          ariaLabel="Folder for this feed"
        />
      </div>
      {localError && <div className="qx-modal-error">{localError}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          onClick={() => void submit()}
          disabled={loading || !url.trim()}
        >
          {loading ? <LoadingLabel>Save</LoadingLabel> : "Save"}
        </button>
      </div>
    </Modal>
  );
}

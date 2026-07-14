import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingLabel, Modal, Select } from "../../components/ui";
import { useRssStore, type RssFeed, type RssFolder } from "./store";

const NEW_FOLDER_VALUE = "__new__";
const UNGROUPED_VALUE = "none";

/**
 * Folder groups subscriptions (feed.folder_id). Empty folders are valid —
 * create first, assign feeds later. Per-feed dialogs still target one feed.
 */

/** Create a folder with zero feeds (shows as empty section in the list). */
export function NewFolderDialog({ onClose }: { onClose: () => void }) {
  const createFolder = useRssStore((s) => s.createFolder);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder = await createFolder(trimmed);
      if (!folder) {
        setError(useRssStore.getState().error || "Could not create folder");
        setBusy(false);
        return;
      }
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New Folder"
      subtitle="Empty folders are fine — add or move subscriptions into them later."
      onClose={onClose}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Folder name"
        className="qx-inline-input"
        style={{ width: "100%" }}
      />
      {error && <div className="qx-modal-error">{error}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
        >
          {busy ? <LoadingLabel>Create</LoadingLabel> : "Create"}
        </button>
      </div>
    </Modal>
  );
}

/** Set / clear / create-and-assign folder for a single feed. */
export function SetFeedFolderDialog({
  feed,
  folders,
  onClose,
}: {
  feed: RssFeed;
  folders: RssFolder[];
  onClose: () => void;
}) {
  const setFeedFolder = useRssStore((s) => s.setFeedFolder);
  const createFolder = useRssStore((s) => s.createFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(
    feed.folder_id == null ? UNGROUPED_VALUE : String(feed.folder_id),
  );
  const [newName, setNewName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (choice === NEW_FOLDER_VALUE) nameRef.current?.focus();
  }, [choice]);

  const options = useMemo(
    () => [
      { value: UNGROUPED_VALUE, label: "Ungrouped" },
      ...folders.map((f) => ({
        value: String(f.id),
        label: `${f.name}${f.feed_count > 0 ? ` (${f.feed_count})` : ""}`,
      })),
      { value: NEW_FOLDER_VALUE, label: "＋ New folder & put this feed in it…" },
    ],
    [folders],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (choice === NEW_FOLDER_VALUE) {
        const trimmed = newName.trim();
        if (!trimmed) {
          setError("Folder name is required");
          setBusy(false);
          return;
        }
        const folder = await createFolder(trimmed);
        if (!folder) {
          setError(useRssStore.getState().error || "Could not create folder");
          setBusy(false);
          return;
        }
        await setFeedFolder(feed.id, folder.id);
      } else if (choice === UNGROUPED_VALUE) {
        await setFeedFolder(feed.id, null);
      } else {
        const folderId = Number(choice);
        if (!Number.isFinite(folderId)) {
          setError("Invalid folder");
          setBusy(false);
          return;
        }
        await setFeedFolder(feed.id, folderId);
      }
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Set folder for subscription"
      subtitle={feed.title || feed.url}
      onClose={onClose}
    >
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45 }}>
        Folders only group individual feeds in the list. Pick an existing folder,
        ungroup, or create a new folder and put <strong>this</strong> feed in it.
      </p>
      <Select
        value={choice}
        options={options}
        onChange={setChoice}
        ariaLabel="Folder for this feed"
        className="qx-rss-folder-select"
      />
      {choice === NEW_FOLDER_VALUE && (
        <div className="qx-modal-field" style={{ marginTop: 10 }}>
          <label className="qx-modal-field-label">New folder name</label>
          <input
            ref={nameRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Tech, News"
            className="qx-inline-input"
            style={{ width: "100%" }}
          />
        </div>
      )}
      {error && <div className="qx-modal-error">{error}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || (choice === NEW_FOLDER_VALUE && !newName.trim())}
          onClick={() => void submit()}
        >
          {busy ? <LoadingLabel>Save</LoadingLabel> : "Save"}
        </button>
      </div>
    </Modal>
  );
}

/** File input + paste — hidden file inputs often fail in Tauri panels. */
export function ImportOpmlDialog({ onClose }: { onClose: () => void }) {
  const importOpml = useRssStore((s) => s.importOpml);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const runImport = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Paste OPML XML or choose a file");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await importOpml(trimmed);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      await runImport(content);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal
      title="Import OPML"
      subtitle="OPML folders become feed groups; each outline is one subscription."
      onClose={onClose}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".opml,.xml,text/xml,application/xml,text/plain"
        style={{ display: "none" }}
        onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
      />
      <button
        className="qx-command-button"
        type="button"
        style={{ width: "100%", marginBottom: 10 }}
        onClick={() => fileRef.current?.click()}
        disabled={busy}
      >
        Choose OPML file…
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'<?xml version="1.0"?>\n<opml>…</opml>'}
        className="qx-inline-input"
        rows={8}
        style={{ width: "100%", resize: "vertical", fontFamily: "var(--qx-font-mono)", fontSize: 12 }}
      />
      {error && <div className="qx-modal-error">{error}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void runImport(text)}
        >
          {busy ? <LoadingLabel>Import</LoadingLabel> : "Import"}
        </button>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingLabel, Modal, Select } from "../../components/ui";
import { useRssStore, type RssFeed, type RssFolder } from "./store";
import { useT } from "../../i18n";

const NEW_FOLDER_VALUE = "__new__";
const UNGROUPED_VALUE = "none";

/**
 * Folder groups subscriptions (feed.folder_id). Empty folders are valid —
 * create first, assign feeds later. Per-feed dialogs still target one feed.
 */

/** Create a folder with zero feeds (shows as empty section in the list). */
export function NewFolderDialog({ onClose }: { onClose: () => void }) {
  const createFolder = useRssStore((s) => s.createFolder);
  const t = useT();
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
      setError(t("rss.folderNameRequired", "Folder name is required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder = await createFolder(trimmed);
      if (!folder) {
        setError(
          useRssStore.getState().error
          || t("rss.createFolderFailed", "Could not create folder"),
        );
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
      title={t("rss.newFolder", "New Folder")}
      subtitle={t(
        "rss.newFolderHint",
        "Empty folders are fine — add or move subscriptions into them later.",
      )}
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
        placeholder={t("rss.folderName", "Folder name")}
        className="qx-inline-input"
        style={{ width: "100%" }}
      />
      {error && <div className="qx-modal-error">{error}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
        >
          {busy
            ? <LoadingLabel>{t("common.create", "Create")}</LoadingLabel>
            : t("common.create", "Create")}
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
  const t = useT();
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
      { value: UNGROUPED_VALUE, label: t("rss.ungrouped", "Ungrouped") },
      ...folders.map((f) => ({
        value: String(f.id),
        label: `${f.name}${f.feed_count > 0 ? ` (${f.feed_count})` : ""}`,
      })),
      {
        value: NEW_FOLDER_VALUE,
        label: t("rss.newFolderAndAssign", "＋ New folder & put this feed in it…"),
      },
    ],
    [folders, t],
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (choice === NEW_FOLDER_VALUE) {
        const trimmed = newName.trim();
        if (!trimmed) {
          setError(t("rss.folderNameRequired", "Folder name is required"));
          setBusy(false);
          return;
        }
        const folder = await createFolder(trimmed);
        if (!folder) {
          setError(
            useRssStore.getState().error
            || t("rss.createFolderFailed", "Could not create folder"),
          );
          setBusy(false);
          return;
        }
        await setFeedFolder(feed.id, folder.id);
      } else if (choice === UNGROUPED_VALUE) {
        await setFeedFolder(feed.id, null);
      } else {
        const folderId = Number(choice);
        if (!Number.isFinite(folderId)) {
          setError(t("rss.invalidFolder", "Invalid folder"));
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
      title={t("rss.setFolderForSubscription", "Set folder for subscription")}
      subtitle={feed.title || feed.url}
      onClose={onClose}
    >
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45 }}>
        {t(
          "rss.folderGroupingHint",
          "Folders only group individual feeds in the list. Pick an existing folder, ungroup, or create a new folder and put this feed in it.",
        )}
      </p>
      <Select
        value={choice}
        options={options}
        onChange={setChoice}
        ariaLabel={t("rss.folderForFeed", "Folder for this feed")}
        className="qx-rss-folder-select"
      />
      {choice === NEW_FOLDER_VALUE && (
        <div className="qx-modal-field" style={{ marginTop: 10 }}>
          <label className="qx-modal-field-label">
            {t("rss.newFolderName", "New folder name")}
          </label>
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
            placeholder={t("rss.folderNameExample", "e.g. Tech, News")}
            className="qx-inline-input"
            style={{ width: "100%" }}
          />
        </div>
      )}
      {error && <div className="qx-modal-error">{error}</div>}
      <div className="qx-modal-actions">
        <button className="qx-command-button" type="button" onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || (choice === NEW_FOLDER_VALUE && !newName.trim())}
          onClick={() => void submit()}
        >
          {busy
            ? <LoadingLabel>{t("common.save", "Save")}</LoadingLabel>
            : t("common.save", "Save")}
        </button>
      </div>
    </Modal>
  );
}

/** File input + paste — hidden file inputs often fail in Tauri panels. */
export function ImportOpmlDialog({ onClose }: { onClose: () => void }) {
  const importOpml = useRssStore((s) => s.importOpml);
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const endExternalInteraction = () => {
    void invoke("floating_set_external_interaction_active", { active: false }).catch(() => {});
  };

  useEffect(() => {
    const input = fileRef.current;
    if (!input) return;
    const handleCancel = () => endExternalInteraction();
    input.addEventListener("cancel", handleCancel);
    return () => {
      input.removeEventListener("cancel", handleCancel);
      endExternalInteraction();
    };
  }, []);

  const runImport = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(t("rss.opmlRequired", "Paste OPML XML or choose a file"));
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
    try {
      if (!file) return;
      const content = await file.text();
      setText(content);
      await runImport(content);
    } catch (e) {
      setError(String(e));
    } finally {
      endExternalInteraction();
    }
  };

  const chooseFile = async () => {
    await invoke("floating_set_external_interaction_active", { active: true }).catch(() => {});
    fileRef.current?.click();
  };

  return (
    <Modal
      title={t("rss.importOpmlShort", "Import OPML")}
      subtitle={t(
        "rss.importOpmlHint",
        "OPML folders become feed groups; each outline is one subscription.",
      )}
      onClose={() => {
        if (busy) return;
        endExternalInteraction();
        onClose();
      }}
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
        onClick={() => void chooseFile()}
        disabled={busy}
      >
        {t("rss.chooseOpmlFile", "Choose OPML file…")}
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
          {t("common.cancel", "Cancel")}
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void runImport(text)}
        >
          {busy
            ? <LoadingLabel>{t("common.import", "Import")}</LoadingLabel>
            : t("common.import", "Import")}
        </button>
      </div>
    </Modal>
  );
}

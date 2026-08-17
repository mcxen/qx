import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  File,
  Folder,
  FolderInput,
  History,
  PenLine,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import QxResizableSplit from "../../components/QxResizableSplit";
import { Button, Input, LoadingSpinner } from "../../components/ui";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useLocale, useT } from "../../i18n";
import {
  performFileSelectionOperation,
  type FileOperationResult,
  type FileSelectionSnapshot,
} from "../../system";
import { useStore } from "../../store";
import FileQuickPreview from "./FileQuickPreview";
import {
  clearRecentFiles,
  loadRecentFiles,
  recordRecentFile,
  type RecentFileEntry,
} from "./recentFiles";
import { useFileManagerSelection } from "./useFileManagerSelection";

type Operation = "rename" | "collect" | "compress" | "extract";

function defaultName(
  operation: Operation,
  snapshot: FileSelectionSnapshot,
  folderName: string,
  archiveName: string,
): string {
  if (operation === "rename") return snapshot.items[0]?.name ?? "";
  if (operation === "collect") return folderName;
  if (operation === "compress") {
    return snapshot.items.length === 1 ? `${snapshot.items[0].name}.zip` : archiveName;
  }
  return "";
}

export default function FileActionsPanel() {
  const t = useT();
  const locale = useLocale();
  const setTab = useStore((state) => state.setTab);
  const listRef = useRef<HTMLDivElement>(null);
  const { snapshot, loading, error, setError } = useFileManagerSelection();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [operation, setOperation] = useState<Operation>("collect");
  const [name, setName] = useState(() => t("fileActions.defaultFolder", "New Folder"));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FileOperationResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RecentFileEntry[]>(loadRecentFiles);
  const clearHistory = () => {
    setHistory([]);
    clearRecentFiles();
  };

  useEffect(() => {
    if (snapshot.items.length === 0) setPreviewOpen(false);
    setSelectedIndex((current) => Math.max(0, Math.min(current, snapshot.items.length - 1)));
  }, [snapshot.items.length, snapshot.revision]);

  const chooseOperation = useCallback((next: Operation) => {
    setOperation(next);
    setName(defaultName(
      next,
      snapshot,
      t("fileActions.defaultFolder", "New Folder"),
      t("fileActions.defaultArchive", "Archive.zip"),
    ));
    setError(null);
    setResult(null);
  }, [snapshot, t]);

  const selected = snapshot.items[selectedIndex] ?? null;
  useEffect(() => {
    if (!selected || historyOpen) return;
    setHistory(recordRecentFile(selected));
  }, [historyOpen, selected?.path]);
  const togglePreview = useCallback(() => {
    if (selected?.exists) {
      setHistoryOpen(false);
      setPreviewOpen((open) => !open);
    }
  }, [selected]);
  const canExtract = snapshot.items.length > 0
    && snapshot.items.every((item) => item.kind === "file" && item.name.toLowerCase().endsWith(".zip"));
  const canRun = snapshot.revision > 0
    && snapshot.items.length > 0
    && !historyOpen
    && !running
    && (operation === "extract" ? canExtract : Boolean(name.trim()))
    && (operation !== "rename" || snapshot.items.length === 1);

  const run = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const request = operation === "rename"
        ? { revision: snapshot.revision, operation, path: snapshot.items[0].path, name: name.trim() } as const
        : operation === "extract"
          ? { revision: snapshot.revision, operation } as const
          : { revision: snapshot.revision, operation, name: name.trim() } as const;
      const next = await performFileSelectionOperation(request);
      setResult(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRunning(false);
    }
  }, [canRun, name, operation, snapshot]);

  const shell = useQxModuleShell({
    leave: () => setTab("launcher"),
    esc: {
      inner: { active: previewOpen || historyOpen, close: () => previewOpen ? setPreviewOpen(false) : setHistoryOpen(false) },
    },
    islandState: {
      title: t("fileActions.title", "File Actions"),
      loading: loading || running,
      error,
      count: snapshot.items.length,
      detail: previewOpen
        ? t("filePreview.quickPreview", "Quick Preview")
        : historyOpen
          ? t("fileActions.history", "History")
        : running
        ? t("fileActions.running", "Working…")
        : t("fileActions.selectedCount", "{n} selected").replace("{n}", String(snapshot.items.length)),
    },
  });

  const actions = useMemo<QxShellAction[]>(() => [
    {
      id: "toggle-preview",
      label: previewOpen
        ? t("filePreview.close", "Close Preview")
        : t("filePreview.quickPreview", "Quick Preview"),
      kbd: "Space",
      disabled: historyOpen || !selected?.exists,
      onClick: togglePreview,
    },
    {
      id: "run-operation",
      label: running
        ? t("fileActions.running", "Working…")
        : t("fileActions.run", "Run Operation"),
      kbd: "Enter",
      disabled: !canRun,
      onClick: () => void run(),
    },
    {
      id: "choose-rename",
      label: t("fileActions.rename", "Rename"),
      disabled: snapshot.items.length !== 1,
      onClick: () => chooseOperation("rename"),
    },
    {
      id: "choose-collect",
      label: t("fileActions.collect", "Move into New Folder"),
      onClick: () => chooseOperation("collect"),
    },
    {
      id: "choose-compress",
      label: t("fileActions.compress", "Compress to ZIP"),
      onClick: () => chooseOperation("compress"),
    },
    {
      id: "choose-extract",
      label: t("fileActions.extract", "Extract ZIP Archives"),
      disabled: !canExtract,
      onClick: () => chooseOperation("extract"),
    },
  ], [canExtract, canRun, chooseOperation, historyOpen, previewOpen, run, running, selected?.exists, snapshot.items.length, t, togglePreview]);

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${snapshot.revision}:${snapshot.items.length}`,
  });

  const operationOptions = [
    { id: "rename" as const, icon: PenLine, label: t("fileActions.rename", "Rename"), disabled: snapshot.items.length !== 1 },
    { id: "collect" as const, icon: FolderInput, label: t("fileActions.collect", "Move into New Folder"), disabled: false },
    { id: "compress" as const, icon: Archive, label: t("fileActions.compress", "Compress to ZIP"), disabled: false },
    { id: "extract" as const, icon: ArchiveRestore, label: t("fileActions.extract", "Extract ZIP Archives"), disabled: !canExtract },
  ];

  return (
    <QxShell
      title={t("fileActions.title", "File Actions")}
      trailing={<Button type="button" size="sm" variant={historyOpen ? "secondary" : "outline"} disabled={running} onClick={() => { setPreviewOpen(false); setHistoryOpen((open) => !open); }}>{historyOpen ? <SlidersHorizontal size={14} aria-hidden="true" /> : <History size={14} aria-hidden="true" />}{historyOpen ? t("fileActions.operations", "Operations") : t("fileActions.history", "History")}</Button>}
      islandKey="file-actions"
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      island={shell.island}
      actions={actions}
      primaryActionId="run-operation"
      actionTitle={t("fileActions.actions", "File Actions")}
      navigation={{
        index: selectedIndex,
        count: snapshot.items.length,
        onChange: setSelectedIndex,
      }}
      className="qx-file-actions-shell"
    >
      <QxResizableSplit
        className="qx-file-actions-split"
        storageKey="qx.fileActions.selectionWidth"
        defaultLeftWidth={320}
        minLeftWidth={240}
        minRightWidth={380}
        separatorLabel={t("fileActions.resize", "Resize selected files list")}
      >
        <section
          ref={listRef}
          className="qx-content-list qx-file-actions-list"
          role="listbox"
          aria-label={t("fileActions.selection", "Selected files")}
        >
          <div className="qx-section-header">
            <span>{t("fileActions.selection", "Selected files")}</span>
            <span>{snapshot.items.length}</span>
          </div>
          {loading ? (
            <div className="qx-file-actions-empty"><LoadingSpinner /></div>
          ) : snapshot.items.length === 0 ? (
            <div className="qx-file-actions-empty">
              <Folder size={28} aria-hidden="true" />
              <strong>{t("fileActions.empty", "No Finder or Explorer selection")}</strong>
              <span>{t("fileActions.emptyHint", "Hide Qx, select files or folders, then summon Qx again.")}</span>
            </div>
          ) : snapshot.items.map((item, index) => {
            const Icon = item.kind === "folder" ? Folder : File;
            return (
              <button
                type="button"
                key={item.path}
                {...getItemProps(index, { className: "qx-file-actions-row" })}
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => {
                  setSelectedIndex(index);
                  if (item.exists) setPreviewOpen(true);
                }}
                title={item.path}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="qx-file-actions-row-copy">
                  <strong>{item.name}</strong>
                  <small>{item.parent}</small>
                </span>
                {!item.exists ? <TriangleAlert size={15} aria-label={t("fileActions.missing", "Missing")} /> : null}
              </button>
            );
          })}
        </section>

        {historyOpen ? (
          <main className="qx-file-actions-workspace">
            <header className="qx-file-actions-workspace-head">
              <div><h2>{t("fileActions.history", "History")}</h2><p>{t("fileActions.historyHint", "The five most recently selected or previewed files, newest first.")}</p></div>
              {history.length ? <Button type="button" size="sm" variant="outline" onClick={clearHistory}><Trash2 size={14} aria-hidden="true" />{t("fileActions.clearHistory", "Clear")}</Button> : null}
            </header>
            <section className="qx-file-actions-editor">
              {history.length ? history.map((entry) => {
                const EntryIcon = entry.kind === "folder" ? Folder : File;
                return <div className="qx-file-actions-notice" key={entry.path}><EntryIcon size={16} aria-hidden="true" /><span><strong>{entry.name}</strong><br />{entry.parent}<br /><small>{t("fileActions.viewedAt", "Viewed {time}").replace("{time}", new Date(entry.viewedAtMs).toLocaleString(locale))}</small></span></div>;
              }) : <div className="qx-file-actions-empty"><History size={28} aria-hidden="true" /><strong>{t("fileActions.noHistory", "No recently viewed files")}</strong></div>}
            </section>
          </main>
        ) : previewOpen && selected ? (
          <FileQuickPreview revision={snapshot.revision} index={selectedIndex} item={selected} />
        ) : <main className="qx-file-actions-workspace">
          <header className="qx-file-actions-workspace-head">
            <div>
              <h2>{t("fileActions.operation", "Choose an operation")}</h2>
              <p>{selected?.path ?? t("fileActions.operationHint", "Operations apply to the complete selection on the left.")}</p>
            </div>
          </header>

          <div className="qx-file-actions-operations">
            {operationOptions.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.id}
                  type="button"
                  variant={operation === option.id ? "secondary" : "outline"}
                  disabled={option.disabled}
                  className={operation === option.id ? "is-active" : ""}
                  onClick={() => chooseOperation(option.id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {option.label}
                </Button>
              );
            })}
          </div>

          <section className="qx-file-actions-editor">
            <div className="qx-file-actions-editor-copy">
              <h3>{operationOptions.find((option) => option.id === operation)?.label}</h3>
              <p>
                {operation === "rename"
                  ? t("fileActions.renameHint", "Enter the complete new name for the selected item.")
                  : operation === "collect"
                    ? t("fileActions.collectHint", "Creates a sibling folder and moves the complete selection into it.")
                    : operation === "compress"
                      ? t("fileActions.compressHint", "Creates a ZIP beside the selected items without changing the originals.")
                      : t("fileActions.extractHint", "Each ZIP is extracted into a new sibling folder. Unsafe archive paths are rejected.")}
              </p>
            </div>
            {operation !== "extract" ? (
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={operation === "compress"
                  ? t("fileActions.defaultArchive", "Archive.zip")
                  : t("fileActions.name", "Name")}
                aria-label={t("fileActions.name", "Name")}
                disabled={running}
              />
            ) : null}
            {operation === "rename" && snapshot.items.length !== 1 ? (
              <div className="qx-file-actions-notice" role="status">
                <TriangleAlert size={16} aria-hidden="true" />
                {t("fileActions.renameOne", "Select exactly one item to rename.")}
              </div>
            ) : null}
            {operation === "extract" && !canExtract ? (
              <div className="qx-file-actions-notice" role="status">
                <TriangleAlert size={16} aria-hidden="true" />
                {t("fileActions.extractZipOnly", "All selected items must be ZIP archives.")}
              </div>
            ) : null}
            {error ? <div className="qx-file-actions-notice is-error" role="alert"><TriangleAlert size={16} />{error}</div> : null}
            {result ? (
              <div className="qx-file-actions-notice is-success" role="status">
                <CheckCircle2 size={16} aria-hidden="true" />
                {t("fileActions.complete", "Operation complete: {n} item(s)").replace("{n}", String(result.affectedCount))}
              </div>
            ) : null}
            <Button type="button" disabled={!canRun} onClick={() => void run()}>
              {running ? <LoadingSpinner size={16} /> : null}
              {running ? t("fileActions.running", "Working…") : t("fileActions.run", "Run Operation")}
            </Button>
          </section>
        </main>}
      </QxResizableSplit>
    </QxShell>
  );
}

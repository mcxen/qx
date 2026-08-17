import { invoke } from "@tauri-apps/api/core";
import { File, Folder, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QxResizableSplit from "../../components/QxResizableSplit";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { LoadingSpinner } from "../../components/ui";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import FileQuickPreview from "./FileQuickPreview";
import { recordRecentFile } from "./recentFiles";
import { useFileManagerSelection } from "./useFileManagerSelection";

export default function QxPreviewPanel() {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const listRef = useRef<HTMLDivElement>(null);
  const { snapshot, loading, error } = useFileManagerSelection();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, snapshot.items.length - 1)));
  }, [snapshot.items.length, snapshot.revision]);

  const selected = snapshot.items[selectedIndex] ?? null;
  useEffect(() => {
    if (selected) recordRecentFile(selected);
  }, [selected?.path]);
  const closePreview = useCallback(() => {
    void invoke("floating_hide_restore_focus").catch(() => setTab("launcher"));
  }, [setTab]);
  const shell = useQxModuleShell({
    leave: () => setTab("launcher"),
    islandState: {
      title: t("filePreview.qxPreview", "QxPreview"),
      loading,
      error,
      count: snapshot.items.length,
      detail: selected?.name ?? t("filePreview.noSelection", "No selected file"),
    },
  });
  const actions = useMemo<QxShellAction[]>(() => [{
    id: "close-preview",
    label: t("filePreview.closeWindow", "Close Preview"),
    kbd: "Space",
    onClick: closePreview,
  }], [closePreview, t]);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${snapshot.revision}:${snapshot.items.length}`,
  });

  return (
    <QxShell
      title={t("filePreview.qxPreview", "QxPreview")}
      islandKey="file-preview"
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      island={shell.island}
      actions={actions}
      actionTitle={t("filePreview.actions", "Preview Actions")}
      navigation={{ index: selectedIndex, count: snapshot.items.length, onChange: setSelectedIndex }}
      className="qx-file-actions-shell qx-file-preview-shell"
    >
      <QxResizableSplit
        className="qx-file-actions-split"
        storageKey="qx.filePreview.selectionWidth"
        defaultLeftWidth={280}
        minLeftWidth={220}
        minRightWidth={420}
        separatorLabel={t("filePreview.resize", "Resize selected files list")}
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
              <strong>{t("filePreview.noSelection", "No selected file")}</strong>
              <span>{t("filePreview.selectionHint", "Select files in Finder or File Explorer, then use the QxPreview shortcut again.")}</span>
            </div>
          ) : snapshot.items.map((item, index) => {
            const Icon = item.kind === "folder" ? Folder : File;
            return (
              <button
                type="button"
                key={item.path}
                {...getItemProps(index, { className: "qx-file-actions-row" })}
                onClick={() => setSelectedIndex(index)}
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
        {selected ? (
          <FileQuickPreview revision={snapshot.revision} index={selectedIndex} item={selected} />
        ) : (
          <main className="qx-file-preview">
            <div className="qx-file-preview-state">
              <File size={32} aria-hidden="true" />
              <strong>{t("filePreview.noSelection", "No selected file")}</strong>
            </div>
          </main>
        )}
      </QxResizableSplit>
    </QxShell>
  );
}

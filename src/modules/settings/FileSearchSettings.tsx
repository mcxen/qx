import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  SettingsCard,
  Toggle,
} from "../../components/ui";
import { useT } from "../../i18n";
import { normalizeFileSearchCategories } from "../../search/fileCategories";
import { useSettingsStore, type FileSearchCategory } from "./store";

function newCategory(): FileSearchCategory {
  return {
    id: typeof crypto.randomUUID === "function"
      ? `custom-${crypto.randomUUID()}`
      : `custom-${Date.now()}`,
    label: "",
    extensions: [],
  };
}

export default function FileSearchSettings() {
  const t = useT();
  const { settings, patch } = useSettingsStore();
  const categories = useMemo(
    () => normalizeFileSearchCategories(settings.file_search.categories),
    [settings.file_search.categories],
  );
  const [draft, setDraft] = useState<FileSearchCategory | null>(null);
  const [extensionsDraft, setExtensionsDraft] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const saveCategories = (next: FileSearchCategory[]) => {
    patch("file_search", { categories: normalizeFileSearchCategories(next) });
  };

  const moveCategory = (id: string, offset: number) => {
    const from = categories.findIndex((category) => category.id === id);
    const to = Math.max(0, Math.min(categories.length - 1, from + offset));
    if (from < 0 || from === to) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveCategories(next);
  };

  const openEditor = (category: FileSearchCategory) => {
    setDraft({ ...category, extensions: [...category.extensions] });
    setExtensionsDraft(category.extensions.join(", "));
  };

  const commitDraft = () => {
    if (!draft?.label.trim()) return;
    const nextDraft: FileSearchCategory = {
      ...draft,
      label: draft.label.trim(),
      extensions: draft.catch_all || draft.include_folders
        ? []
        : extensionsDraft
            .split(/[\s,;]+/)
            .map((extension) => extension.trim().replace(/^\.+/, "").toLowerCase())
            .filter(Boolean),
    };
    const exists = categories.some((category) => category.id === nextDraft.id);
    saveCategories(exists
      ? categories.map((category) => category.id === nextDraft.id ? nextDraft : category)
      : [...categories.filter((category) => !category.catch_all), nextDraft, ...categories.filter((category) => category.catch_all)]);
    setDraft(null);
  };

  const removeCategory = (category: FileSearchCategory) => {
    if (category.catch_all) return;
    if (!window.confirm(t(
      "fileSearch.categories.deleteConfirm",
      "Delete this file category? Its files will move to Other Files.",
    ))) return;
    saveCategories(categories.filter((item) => item.id !== category.id));
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("fileSearch.categories.title", "File Type Order")}
        description={t(
          "fileSearch.categories.desc",
          "Drag categories into search priority order. Results inside each category are newest first.",
        )}
        trailing={(
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => openEditor(newCategory())}
          >
            <Plus size={13} aria-hidden="true" />
            {t("fileSearch.categories.add", "Add Category")}
          </Button>
        )}
      >
        <div className="qx-file-category-settings-list">
          {categories.map((category, index) => (
            <div
              key={category.id}
              className={`qx-file-category-setting-row${draggedId === category.id ? " is-dragging" : ""}`}
              draggable
              onDragStart={() => setDraggedId(category.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedId || draggedId === category.id) return;
                const from = categories.findIndex((item) => item.id === draggedId);
                const to = categories.findIndex((item) => item.id === category.id);
                if (from < 0 || to < 0) return;
                const next = [...categories];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                saveCategories(next);
                setDraggedId(null);
              }}
            >
              <span className="qx-file-category-drag" aria-hidden="true">
                <GripVertical size={14} strokeWidth={2} />
              </span>
              <div className="qx-file-category-setting-copy">
                <div className="qx-settings-row-title">
                  {t(`fileSearch.category.${category.id}`, category.label)}
                </div>
                <div className="qx-settings-row-description">
                  {category.catch_all
                    ? t("fileSearch.categories.otherHint", "Unmatched file types")
                    : category.include_folders
                      ? t("fileSearch.categories.foldersHint", "Folders")
                      : category.extensions.map((extension) => `.${extension}`).join(" · ")}
                </div>
              </div>
              <div className="qx-file-category-setting-actions">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("fileSearch.categories.moveUp", "Move up")}
                  disabled={index === 0}
                  onClick={() => moveCategory(category.id, -1)}
                >
                  <ArrowUp size={13} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("fileSearch.categories.moveDown", "Move down")}
                  disabled={index === categories.length - 1}
                  onClick={() => moveCategory(category.id, 1)}
                >
                  <ArrowDown size={13} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("fileSearch.categories.edit", "Edit category")}
                  onClick={() => openEditor(category)}
                >
                  <Pencil size={13} />
                </Button>
                {!category.catch_all && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("fileSearch.categories.delete", "Delete category")}
                    onClick={() => removeCategory(category)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="qx-file-category-dialog">
          <DialogHeader>
            <DialogTitle>{t("fileSearch.categories.editorTitle", "File Category")}</DialogTitle>
            <DialogDescription>
              {t(
                "fileSearch.categories.editorDesc",
                "Choose a label and the file extensions included in this group.",
              )}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="qx-file-category-editor">
              <label>
                <span>{t("fileSearch.categories.name", "Name")}</span>
                <Input
                  autoFocus
                  value={draft.label}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              </label>
              {!draft.catch_all && (
                <label className="qx-file-category-folder-toggle">
                  <span>
                    <strong>{t("fileSearch.categories.matchFolders", "Match folders")}</strong>
                    <small>{t("fileSearch.categories.matchFoldersDesc", "Use this category for directory results.")}</small>
                  </span>
                  <Toggle
                    value={Boolean(draft.include_folders)}
                    onChange={(include_folders) => setDraft({ ...draft, include_folders })}
                  />
                </label>
              )}
              {!draft.catch_all && !draft.include_folders && (
                <label>
                  <span>{t("fileSearch.categories.extensions", "Extensions")}</span>
                  <Input
                    value={extensionsDraft}
                    placeholder={t("fileSearch.categories.extensionsPlaceholder", "xlsx, xls, csv")}
                    onChange={(event) => setExtensionsDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitDraft();
                    }}
                  />
                </label>
              )}
              <div className="qx-file-category-editor-actions">
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  {t("common.cancel", "Cancel")}
                </Button>
                <Button type="button" disabled={!draft.label.trim()} onClick={commitDraft}>
                  {t("common.save", "Save")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Row,
  SettingsCard,
  Toggle,
} from "../../components/ui";
import { useT } from "../../i18n";
import { normalizeFileSearchCategories } from "../../search/fileCategories";
import {
  MODULE_SEARCH_LABELS,
  MODULE_SEARCH_MODULE_IDS,
  useSettingsStore,
  type FileSearchCategory,
  type ModuleSearchModuleId,
} from "./store";
import { isBuiltinModuleEnabled } from "../moduleAvailability";

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
  const moduleSearch = settings.module_search;
  const categories = useMemo(
    () => normalizeFileSearchCategories(settings.file_search.categories),
    [settings.file_search.categories],
  );
  const [draft, setDraft] = useState<FileSearchCategory | null>(null);
  const [extensionsDraft, setExtensionsDraft] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const pointerDragRef = useRef<{ id: string; pointerId: number } | null>(null);

  const saveCategories = (next: FileSearchCategory[]) => {
    patch("file_search", { categories: normalizeFileSearchCategories(next) });
  };

  const moveCategory = (id: string, offset: number) => {
    const from = categories.findIndex((category) => category.id === id);
    const to = Math.max(0, Math.min(categories.length - 1, from + offset));
    if (from < 0 || from === to || categories[from]?.catch_all) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveCategories(next);
  };

  const reorderCategory = (sourceId: string, targetId: string | null) => {
    if (!targetId || sourceId === targetId) return;
    const from = categories.findIndex((category) => category.id === sourceId);
    const to = categories.findIndex((category) => category.id === targetId);
    if (from < 0 || to < 0 || categories[from]?.catch_all) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    const targetIndex = next.findIndex((category) => category.id === targetId);
    next.splice(Math.max(0, targetIndex), 0, moved);
    saveCategories(next);
  };

  useEffect(() => {
    if (!draggedId) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-file-category-id]");
      const targetId = target?.dataset.fileCategoryId ?? null;
      if (targetId && targetId !== draggedId) setDropTargetId(targetId);
      event.preventDefault();
    };
    const finish = () => {
      const sourceId = pointerDragRef.current?.id ?? draggedId;
      reorderCategory(sourceId, dropTargetId);
      pointerDragRef.current = null;
      setDraggedId(null);
      setDropTargetId(null);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [categories, draggedId, dropTargetId]);

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
        title={t("appearance.moduleSearch.title", "Launcher Search Sources")}
        description={t(
          "general.moduleSearch.desc",
          "Choose which built-in modules contribute commands and dynamic results (clipboard, feeds, sessions, macros) to launcher search. Off by default so a fresh install stays focused on apps and files.",
        )}
      >
        <Row
          title={t("general.moduleSearch.enabled", "Enable module search")}
          description={t(
            "general.moduleSearch.enabled.desc",
            "Master switch, off by default. When on, only the modules enabled below appear in launcher search.",
          )}
        >
          <Toggle
            value={moduleSearch.enabled}
            onChange={(value) =>
              patch("module_search", { ...moduleSearch, enabled: value })
            }
          />
        </Row>
        {MODULE_SEARCH_MODULE_IDS.map((id) => {
          const meta = MODULE_SEARCH_LABELS[id];
          const on = moduleSearch.modules[id] !== false;
          const moduleEnabled = isBuiltinModuleEnabled(id, settings);
          return (
            <Row
              key={id}
              title={t(`general.moduleSearch.${id}`, meta.title)}
              description={t(`general.moduleSearch.${id}.desc`, meta.hint)}
            >
              <Toggle
                value={moduleEnabled && on}
                disabled={!moduleSearch.enabled || !moduleEnabled}
                onChange={(value) =>
                  patch("module_search", {
                    ...moduleSearch,
                    modules: {
                      ...moduleSearch.modules,
                      [id]: value,
                    } as Partial<Record<ModuleSearchModuleId, boolean>>,
                  })
                }
              />
            </Row>
          );
        })}
      </SettingsCard>

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
              data-file-category-id={category.id}
              className={`qx-file-category-setting-row${draggedId === category.id ? " is-dragging" : ""}${dropTargetId === category.id ? " is-drop-target" : ""}`}
            >
              <span
                className="qx-file-category-drag"
                role="button"
                tabIndex={category.catch_all ? -1 : 0}
                aria-label={t("fileSearch.categories.drag", "Drag to reorder")}
                onPointerDown={(event) => {
                  if (category.catch_all || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  pointerDragRef.current = { id: category.id, pointerId: event.pointerId };
                  setDraggedId(category.id);
                  setDropTargetId(null);
                }}
              >
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
                  disabled={index === 0 || category.catch_all}
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

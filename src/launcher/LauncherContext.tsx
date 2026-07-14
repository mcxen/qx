import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import SearchAliasTagEditor from "../components/SearchAliasTagEditor";
import { Button, Input, Select } from "../components/ui";
import { useT } from "../i18n";
import { useDisplayName } from "../search/appDisplay";
import type { AppEntry, HistoryEntry, SearchHistoryEntry } from "../store";
import { DEFAULT_SETTINGS, type QuickEntryConfig, useSettingsStore } from "../modules/settings/store";
import {
  metadataForKey,
  metadataKeyForEntry,
} from "../search/searchMetadata";
import {
  createQuickEntry,
  localizeQuickEntry,
  QUICK_ENTRY_TARGETS,
  sanitizeQuickEntries,
} from "./quickEntries";
import type { QuickEntry } from "./types";

function ContextSection({
  title,
  children,
  spacing = false,
}: {
  title: string;
  children: ReactNode;
  spacing?: boolean;
}) {
  return (
    <>
      <div className={`qx-context-title${spacing ? " has-spacing" : ""}`}>
        {title}
      </div>
      {children}
    </>
  );
}

function ContextEntry({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button className="qx-context-entry" onClick={onClick} type="button">
      <span className="qx-context-entry-title">{title}</span>
      <span className="qx-context-entry-subtitle">{subtitle}</span>
    </button>
  );
}

export default function LauncherContext({
  quickEntries,
  recentLaunches,
  recentSearches,
  query,
  onSearchSelect,
  selectedItem,
}: {
  quickEntries: QuickEntry[];
  recentLaunches: HistoryEntry[];
  recentSearches: SearchHistoryEntry[];
  query: string;
  onSearchSelect: (query: string) => void;
  selectedItem: AppEntry | null;
}) {
  const t = useT();
  const getDisplayName = useDisplayName();
  const { settings, patch, patchSearchMetadata } = useSettingsStore();
  const [editingQuickEntries, setEditingQuickEntries] = useState(false);
  const selectedMetadataKey = metadataKeyForEntry(selectedItem ?? { name: "", path: "", icon: "" });
  const selectedMetadata = metadataForKey(settings, selectedMetadataKey);
  const canEditMetadata = Boolean(selectedItem && selectedMetadataKey);
  const quickEntryDrafts = sanitizeQuickEntries(settings.quick_entries);
  const patchQuickEntries = (entries: QuickEntryConfig[]) => patch("quick_entries", entries);
  const updateQuickEntry = (id: string, changes: Partial<QuickEntryConfig>) => {
    patchQuickEntries(
      quickEntryDrafts.map((entry) => {
        if (entry.id !== id) return entry;
        const target = changes.target
          ? QUICK_ENTRY_TARGETS.find((item) => item.value === changes.target)
          : null;
        return {
          ...entry,
          ...changes,
          title: changes.target && target && entry.title === QUICK_ENTRY_TARGETS.find((item) => item.value === entry.target)?.label
            ? target.label
            : changes.title ?? entry.title,
          subtitle: changes.target && target && entry.subtitle === QUICK_ENTRY_TARGETS.find((item) => item.value === entry.target)?.subtitle
            ? target.subtitle
            : changes.subtitle ?? entry.subtitle,
        };
      }),
    );
  };
  const removeQuickEntry = (id: string) => {
    patchQuickEntries(quickEntryDrafts.filter((entry) => entry.id !== id));
  };

  return (
    <div className="qx-launcher-context">
      <ContextSection title={t("launcher.quickEntries", "Quick Entries")}>
        <div className="qx-context-section-actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditingQuickEntries((value) => !value)}
            title={
              editingQuickEntries
                ? t("launcher.done", "Done")
                : t("launcher.editQuickEntries", "Edit quick entries")
            }
          >
            {editingQuickEntries ? <Check size={14} /> : <Pencil size={14} />}
          </Button>
        </div>
        {editingQuickEntries ? (
          <div className="qx-quick-entry-editor">
            {quickEntryDrafts.map((entry) => (
              <div className="qx-quick-entry-edit-row" key={entry.id}>
                <div className="qx-quick-entry-edit-fields">
                  <Input
                    value={entry.title}
                    aria-label={t("launcher.quickEntryTitle", "Quick entry title")}
                    onChange={(event) => updateQuickEntry(entry.id, { title: event.target.value })}
                  />
                  <Input
                    value={entry.subtitle}
                    aria-label={t("launcher.quickEntrySubtitle", "Quick entry subtitle")}
                    onChange={(event) => updateQuickEntry(entry.id, { subtitle: event.target.value })}
                  />
                  <Select
                    value={entry.target}
                    options={QUICK_ENTRY_TARGETS.map((target) => ({
                      value: target.value,
                      label: t(target.titleKey, target.label),
                    }))}
                    ariaLabel={t("launcher.quickEntryTarget", "Quick entry target")}
                    onChange={(target) => updateQuickEntry(entry.id, { target })}
                  />
                </div>
                <div className="qx-quick-entry-edit-actions">
                  <Button
                    type="button"
                    size="icon"
                    variant={entry.enabled ? "secondary" : "ghost"}
                    onClick={() => updateQuickEntry(entry.id, { enabled: !entry.enabled })}
                    title={entry.enabled ? t("launcher.enabled", "Enabled") : t("launcher.disabled", "Disabled")}
                  >
                    {entry.enabled ? <Check size={14} /> : <X size={14} />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeQuickEntry(entry.id)}
                    title={t("launcher.removeQuickEntry", "Remove quick entry")}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
            <div className="qx-quick-entry-editor-footer">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => patchQuickEntries([...quickEntryDrafts, createQuickEntry()])}
              >
                <Plus size={14} />
                {t("launcher.add", "Add")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => patchQuickEntries(DEFAULT_SETTINGS.quick_entries)}
              >
                <RotateCcw size={14} />
                {t("launcher.reset", "Reset")}
              </Button>
            </div>
          </div>
        ) : (
          quickEntries.map((entry) => {
            const labels = localizeQuickEntry(entry, t);
            return (
              <ContextEntry
                key={entry.id}
                title={labels.title}
                subtitle={labels.subtitle}
                onClick={entry.onClick}
              />
            );
          })
        )}
      </ContextSection>

      {recentLaunches.length > 0 && (
        <ContextSection title={t("launcher.recent", "Recent")} spacing>
          {recentLaunches.map((entry) => (
            <ContextEntry
              key={`launch-${entry.id}`}
              title={entry.name}
              subtitle={entry.timestamp}
              onClick={() => {
                invoke("open_app", { path: entry.path }).catch(() => {});
                getCurrentWindow().hide().catch(() => {});
              }}
            />
          ))}
        </ContextSection>
      )}

      {recentSearches.length > 0 && !query && (
        <ContextSection title={t("launcher.recentSearches", "Recent Searches")} spacing>
          {recentSearches.map((entry) => (
            <ContextEntry
              key={`search-${entry.id}`}
              title={entry.query}
              subtitle={entry.timestamp}
              onClick={() => onSearchSelect(entry.query)}
            />
          ))}
        </ContextSection>
      )}

      {canEditMetadata && selectedMetadataKey && (
        <ContextSection title={t("launcher.aliasesTags", "Aliases & Tags")} spacing>
          <div className="qx-context-editor">
            <div className="qx-context-editor-title">
              {selectedItem ? getDisplayName(selectedItem) : ""}
            </div>
            <SearchAliasTagEditor
              compact
              entry={selectedMetadata}
              onChange={(next) => patchSearchMetadata(selectedMetadataKey, next)}
            />
          </div>
        </ContextSection>
      )}
    </div>
  );
}

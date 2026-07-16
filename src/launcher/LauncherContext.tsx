import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Pencil, Plus, RotateCcw, Star, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
import { usePluginRegistry } from "../plugin/registry";
import {
  buildQuickEntryTargetOptions,
  createQuickEntry,
  isQuickEntryAlreadyAdded,
  localizeQuickEntry,
  parsePluginQuickEntryTarget,
  pluginQuickEntryTarget,
  quickEntryFromAppEntry,
  QUICK_ENTRY_TARGETS,
  sanitizeQuickEntries,
} from "./quickEntries";
import type { QuickEntry } from "./types";
import BetaBadge from "../components/BetaBadge";

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
  beta = false,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  beta?: boolean;
}) {
  return (
    <button className="qx-context-entry" onClick={onClick} type="button">
      <span className="qx-context-entry-title qx-module-title-with-badge">
        <span>{title}</span>
        {beta && <BetaBadge />}
      </span>
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
  const plugins = usePluginRegistry((state) => state.plugins);
  const [editingQuickEntries, setEditingQuickEntries] = useState(false);
  const selectedMetadataKey = metadataKeyForEntry(selectedItem ?? { name: "", path: "", icon: "" });
  const selectedMetadata = metadataForKey(settings, selectedMetadataKey);
  const canEditMetadata = Boolean(selectedItem && selectedMetadataKey);
  const quickEntryDrafts = sanitizeQuickEntries(settings.quick_entries);
  const targetOptions = useMemo(
    () => buildQuickEntryTargetOptions(plugins, t),
    [plugins, t],
  );
  const selectOptions = useMemo(() => {
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    let lastGroup = "";
    for (const option of targetOptions) {
      const group = option.group || "";
      if (group && group !== lastGroup) {
        if (options.length > 0) {
          options.push({ value: `---divider---${group}`, label: group, disabled: true });
        }
        lastGroup = group;
      }
      const isPlugin = Boolean(parsePluginQuickEntryTarget(option.value));
      options.push({
        value: option.value,
        label: isPlugin ? `🔌 ${option.label}` : option.label,
      });
    }
    // Ensure current draft targets remain selectable even if plugin was disabled mid-edit.
    for (const entry of quickEntryDrafts) {
      if (!options.some((option) => option.value === entry.target && !option.disabled)) {
        options.push({
          value: entry.target,
          label: entry.title || entry.target,
        });
      }
    }
    return options;
  }, [targetOptions, quickEntryDrafts]);

  const patchQuickEntries = (entries: QuickEntryConfig[]) => patch("quick_entries", entries);
  const updateQuickEntry = (id: string, changes: Partial<QuickEntryConfig>) => {
    patchQuickEntries(
      quickEntryDrafts.map((entry) => {
        if (entry.id !== id) return entry;
        const nextTarget = changes.target ?? entry.target;
        const targetMeta = targetOptions.find((item) => item.value === nextTarget);
        const prevMeta = targetOptions.find((item) => item.value === entry.target);
        const titleLockedToDefault =
          !entry.title
          || entry.title === prevMeta?.label
          || QUICK_ENTRY_TARGETS.some((item) => item.value === entry.target && item.label === entry.title);
        const subtitleLockedToDefault =
          !entry.subtitle
          || entry.subtitle === prevMeta?.subtitle
          || QUICK_ENTRY_TARGETS.some((item) => item.value === entry.target && item.subtitle === entry.subtitle);
        return {
          ...entry,
          ...changes,
          title:
            changes.target && targetMeta && titleLockedToDefault
              ? targetMeta.label
              : changes.title ?? entry.title,
          subtitle:
            changes.target && targetMeta && subtitleLockedToDefault
              ? targetMeta.subtitle
              : changes.subtitle ?? entry.subtitle,
        };
      }),
    );
  };
  const removeQuickEntry = (id: string) => {
    patchQuickEntries(quickEntryDrafts.filter((entry) => entry.id !== id));
  };

  const selectedQuickTarget = selectedItem
    ? quickEntryFromAppEntry(selectedItem, plugins)?.target
    : null;
  const canAddSelectedQuick =
    Boolean(selectedQuickTarget)
    && !isQuickEntryAlreadyAdded(settings.quick_entries, selectedQuickTarget!);

  const addSelectedAsQuickEntry = () => {
    if (!selectedItem) return;
    const entry = quickEntryFromAppEntry(selectedItem, plugins);
    if (!entry) return;
    if (isQuickEntryAlreadyAdded(settings.quick_entries, entry.target)) return;
    patchQuickEntries([...quickEntryDrafts, entry]);
    setEditingQuickEntries(true);
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
                    options={selectOptions}
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
                onClick={() => {
                  const firstPlugin = plugins.find(
                    (plugin) => plugin.enabled && !plugin.id.startsWith("builtin:"),
                  );
                  const target = firstPlugin
                    ? pluginQuickEntryTarget(firstPlugin.id)
                    : QUICK_ENTRY_TARGETS[0].value;
                  patchQuickEntries([...quickEntryDrafts, createQuickEntry(target, plugins)]);
                }}
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
            {plugins.some((plugin) => plugin.enabled && !plugin.id.startsWith("builtin:")) ? (
              <div className="qx-context-editor-title" style={{ marginTop: 4, opacity: 0.75 }}>
                {t(
                  "launcher.quickEntries.pluginsHint",
                  "Installed plugins appear in the target list — pick one after Import / marketplace install.",
                )}
              </div>
            ) : (
              <div className="qx-context-editor-title" style={{ marginTop: 4, opacity: 0.75 }}>
                {t(
                  "launcher.quickEntries.noPluginsHint",
                  "Install a plugin under Settings → Extensions to pin it here as a quick app.",
                )}
              </div>
            )}
          </div>
        ) : (
          quickEntries.map((entry) => {
            const labels = localizeQuickEntry(entry, t, plugins);
            return (
              <ContextEntry
                key={entry.id}
                title={labels.title}
                subtitle={labels.subtitle}
                beta={entry.beta}
                onClick={entry.onClick}
              />
            );
          })
        )}
        {canAddSelectedQuick && selectedItem && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            style={{ marginTop: 8, width: "100%" }}
            onClick={addSelectedAsQuickEntry}
          >
            <Star size={14} />
            {t("launcher.addSelectedQuickEntry", "Add “{name}” to Quick Entries")
              .replace("{name}", getDisplayName(selectedItem))}
          </Button>
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

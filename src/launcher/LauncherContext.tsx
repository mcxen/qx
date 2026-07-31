import { Check, ChevronDown, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import SearchAliasTagEditor from "../components/SearchAliasTagEditor";
import { Button, Select } from "../components/ui";
import { useLocale, useT } from "../i18n";
import { useDisplayName } from "../search/appDisplay";
import type { AppEntry } from "../store";
import { useSettingsStore } from "../modules/settings/store";
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
  quickEntryFromAppEntry,
  sanitizeQuickEntries,
} from "./quickEntries";
import type { QuickEntry } from "./types";
import BetaBadge from "../components/BetaBadge";

function ContextSection({
  title,
  children,
  spacing = false,
  collapsible = false,
  collapsed = false,
  onToggle,
  headerActions,
  contentId,
}: {
  title: string;
  children: ReactNode;
  spacing?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  headerActions?: ReactNode;
  contentId?: string;
}) {
  return (
    <section className={collapsible ? "qx-context-collapsible-section" : undefined}>
      <div className={`qx-context-title${spacing ? " has-spacing" : ""}${collapsible ? " qx-context-title-row" : ""}`}>
        {collapsible ? (
          <button
            type="button"
            className="qx-context-section-toggle"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={onToggle}
          >
            <span>{title}</span>
            <ChevronDown aria-hidden="true" size={14} className={collapsed ? "is-collapsed" : ""} />
          </button>
        ) : <span>{title}</span>}
        {headerActions}
      </div>
      {(!collapsible || !collapsed) && (contentId ? <div id={contentId}>{children}</div> : children)}
    </section>
  );
}

function ContextEntry({
  title,
  subtitle,
  onClick,
  beta = false,
  compact = false,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  beta?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      className={`qx-context-entry${compact ? " is-compact" : ""}`}
      onClick={onClick}
      type="button"
    >
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
  allModules,
  selectedItem,
}: {
  quickEntries: QuickEntry[];
  allModules: QuickEntry[];
  selectedItem: AppEntry | null;
}) {
  const t = useT();
  const locale = useLocale();
  const getDisplayName = useDisplayName();
  const { settings, patch, patchSearchMetadata } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
  const [editingQuickEntries, setEditingQuickEntries] = useState(false);
  const [quickEntryTarget, setQuickEntryTarget] = useState("");
  const [quickEntriesCollapsed, setQuickEntriesCollapsed] = useState(false);
  const [allModulesCollapsed, setAllModulesCollapsed] = useState(false);
  const selectedMetadataKey = metadataKeyForEntry(selectedItem ?? { name: "", path: "", icon: "" });
  const selectedMetadata = metadataForKey(settings, selectedMetadataKey);
  const canEditMetadata = Boolean(selectedItem && selectedMetadataKey);
  const quickEntryDrafts = sanitizeQuickEntries(settings.quick_entries);
  const targetOptions = useMemo(
    () => buildQuickEntryTargetOptions(plugins, t, locale),
    [plugins, t, locale],
  );
  const availableQuickEntryOptions = useMemo(() => {
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    let lastGroup = "";
    for (const option of targetOptions) {
      if (isQuickEntryAlreadyAdded(quickEntryDrafts, option.value)) continue;
      const group = option.group || "";
      if (group && group !== lastGroup) {
        if (options.length > 0) {
          options.push({ value: `---divider---${group}`, label: group, disabled: true });
        }
        lastGroup = group;
      }
      options.push({
        value: option.value,
        label: option.label,
      });
    }
    return options;
  }, [targetOptions, quickEntryDrafts]);

  const patchQuickEntries = (entries: typeof quickEntryDrafts) => patch("quick_entries", entries);
  const removeQuickEntry = (id: string) => patchQuickEntries(quickEntryDrafts.filter((entry) => entry.id !== id));

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
      <ContextSection
        title={t("launcher.quickEntries", "Quick Entries")}
        collapsible
        collapsed={quickEntriesCollapsed}
        onToggle={() => setQuickEntriesCollapsed((value) => !value)}
        contentId="qx-launcher-quick-entries"
        headerActions={(
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
        )}
      >
        {editingQuickEntries ? (
          <div className="qx-quick-entry-editor">
            {quickEntryDrafts.map((entry) => {
              const labels = localizeQuickEntry(entry, t, plugins, locale);
              return (
                <div className="qx-quick-entry-simple-row" key={entry.id}>
                  <span>{labels.title}</span>
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
              );
            })}
            {availableQuickEntryOptions.length > 0 && (
              <div className="qx-quick-entry-add-row">
                <Select
                  value={quickEntryTarget || availableQuickEntryOptions[0].value}
                  options={availableQuickEntryOptions}
                  ariaLabel={t("launcher.quickEntryTarget", "Quick entry target")}
                  onChange={setQuickEntryTarget}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const target = quickEntryTarget || availableQuickEntryOptions[0]?.value;
                    if (!target) return;
                    patchQuickEntries([...quickEntryDrafts, createQuickEntry(target, plugins)]);
                    setQuickEntryTarget("");
                  }}
                >
                  <Plus size={14} />
                  {t("launcher.add", "Add")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          quickEntries.map((entry) => {
            const labels = localizeQuickEntry(entry, t, plugins, locale);
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

      {allModules.length > 0 && (
        <section className="qx-context-collapsible-section">
          <button
            type="button"
            className="qx-context-title qx-context-section-toggle has-spacing"
            aria-expanded={!allModulesCollapsed}
            aria-controls="qx-launcher-all-modules"
            title={
              allModulesCollapsed
                ? t("launcher.expandAllModules", "Expand all modules")
                : t("launcher.collapseAllModules", "Collapse all modules")
            }
            onClick={() => setAllModulesCollapsed((value) => !value)}
          >
            <span>{t("launcher.allModules", "All Modules")}</span>
            <span className="qx-context-section-toggle-trailing">
              <span className="qx-context-section-count">{allModules.length}</span>
              <ChevronDown
                aria-hidden="true"
                size={14}
                className={allModulesCollapsed ? "is-collapsed" : ""}
              />
            </span>
          </button>
          {!allModulesCollapsed && (
            <div id="qx-launcher-all-modules" className="qx-context-collapsible-content">
              {allModules.map((entry) => (
                <ContextEntry
                  key={entry.id}
                  title={entry.title}
                  subtitle={entry.subtitle}
                  beta={entry.beta}
                  compact
                  onClick={entry.onClick}
                />
              ))}
            </div>
          )}
        </section>
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

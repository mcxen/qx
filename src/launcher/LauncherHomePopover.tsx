import { invoke } from "@tauri-apps/api/core";
import { Check, MoreHorizontal, Pin, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "../components/ui";
import { useDisplayName } from "../search/appDisplay";
import { isEntryPinned, metadataForKey, metadataKeyForEntry } from "../search/searchMetadata";
import { useLocale, useT } from "../i18n";
import type { AppEntry } from "../store";
import type { HomeDashboardWidgetId } from "../modules/settings/store";
import { useSettingsStore } from "../modules/settings/store";
import { toggleLauncherEntryPin, isManageableLauncherEntry } from "./entryManage";
import { LauncherAppIcon } from "../ResultsList";

type PinFilter = "all" | "apps" | "modules";

function isModuleEntry(entry: AppEntry): boolean {
  return entry.path.startsWith("__qx:");
}

function isPinnable(entry: AppEntry): boolean {
  return isManageableLauncherEntry(entry) && !entry.path.startsWith("__qx:cmd:");
}

function mergeEntries(entries: AppEntry[]): AppEntry[] {
  const map = new Map<string, AppEntry>();
  for (const entry of entries) {
    if (!isPinnable(entry) || map.has(entry.path)) continue;
    map.set(entry.path, entry);
  }
  return [...map.values()];
}

export interface LauncherHomePopoverProps {
  entries: AppEntry[];
  homeWidgets: HomeDashboardWidgetId[];
  widgetOptions: Array<{ id: HomeDashboardWidgetId; title: string; description: string }>;
  onToggleWidget: (id: HomeDashboardWidgetId, enabled: boolean) => void;
}

export default function LauncherHomePopover({
  entries,
  homeWidgets,
  widgetOptions,
  onToggleWidget,
}: LauncherHomePopoverProps) {
  const t = useT();
  const locale = useLocale();
  const getDisplayName = useDisplayName();
  const { settings, patchSearchMetadata } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PinFilter>("all");
  const [catalog, setCatalog] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadApps = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const rows = await invoke<AppEntry[]>("search_apps", { query: search });
      setCatalog(rows.filter((entry) => (entry.kind ?? "app") === "app"));
    } catch {
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setFilter("all");
      return;
    }
    void loadApps("");
    const focus = window.requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focus);
  }, [loadApps, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadApps(query.trim()), query.trim() ? 120 : 0);
    return () => window.clearTimeout(timer);
  }, [loadApps, open, query]);

  const moduleEntries = useMemo(
    () => entries.filter(isModuleEntry),
    [entries],
  );
  const allEntries = useMemo(
    () => mergeEntries([...catalog, ...entries, ...moduleEntries]),
    [catalog, entries, moduleEntries],
  );
  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale === "zh-CN" ? "zh-CN" : "en-US");
    return allEntries.filter((entry) => {
      if (filter === "apps" && isModuleEntry(entry)) return false;
      if (filter === "modules" && !isModuleEntry(entry)) return false;
      if (!needle) return true;
      const text = [getDisplayName(entry), entry.name, entry.subtitle, entry.path]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(locale === "zh-CN" ? "zh-CN" : "en-US");
      return text.includes(needle);
    });
  }, [allEntries, filter, getDisplayName, locale, query]);
  const pinnedEntries = useMemo(
    () => allEntries.filter((entry) => isEntryPinned(settings, metadataKeyForEntry(entry))),
    [allEntries, settings],
  );

  const togglePin = (entry: AppEntry) => {
    const metadataKey = metadataKeyForEntry(entry);
    if (!metadataKey) return;
    const current = useSettingsStore.getState();
    toggleLauncherEntryPin(
      current.settings,
      metadataKey,
      metadataForKey(current.settings, metadataKey),
      patchSearchMetadata,
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="qx-launcher-home-menu-trigger"
          aria-label={t("launcher.home.configure", "Configure home")}
          title={t("launcher.home.configure", "Configure home")}
        >
          <MoreHorizontal size={16} strokeWidth={2.2} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="left"
        sideOffset={10}
        className="qx-launcher-home-popover"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
      >
        <div className="qx-launcher-home-popover-header">
          <div>
            <strong>{t("launcher.home.configure", "Configure home")}</strong>
            <span>{t("launcher.home.configureHint", "Pin entries and choose dashboard cards")}</span>
          </div>
          <Pin size={15} aria-hidden="true" />
        </div>

        <div className="qx-launcher-home-popover-section">
          <div className="qx-launcher-home-popover-section-title">
            <span>{t("launcher.home.pinnedEntries", "Pinned entries")}</span>
            <span>{pinnedEntries.length}</span>
          </div>
          <div className="qx-launcher-home-popover-search">
            <Search size={14} aria-hidden="true" />
            <Input
              ref={searchRef}
              value={query}
              type="search"
              placeholder={t("launcher.home.searchEntries", "Search apps and modules…")}
              aria-label={t("launcher.home.searchEntries", "Search apps and modules…")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="qx-launcher-home-filter" role="tablist" aria-label={t("launcher.home.entryFilter", "Entry type")}>
            {(["all", "apps", "modules"] as PinFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
              >
                {t(`launcher.home.filter.${value}`, value === "all" ? "All" : value === "apps" ? "Apps" : "Modules")}
              </button>
            ))}
          </div>
          <div className="qx-launcher-home-entry-list" role="listbox" aria-label={t("launcher.home.pinnedEntries", "Pinned entries")}>
            {loading && filteredEntries.length === 0 ? (
              <div className="qx-launcher-home-entry-empty">{t("launcher.home.loadingEntries", "Loading apps and modules…")}</div>
            ) : filteredEntries.length === 0 ? (
              <div className="qx-launcher-home-entry-empty">{t("launcher.home.noEntryMatch", "No matching apps or modules")}</div>
            ) : (
              filteredEntries.slice(0, 80).map((entry) => {
                const key = metadataKeyForEntry(entry);
                const pinned = isEntryPinned(settings, key);
                const label = getDisplayName(entry);
                return (
                  <div className={`qx-launcher-home-entry${pinned ? " is-pinned" : ""}`} key={entry.path} role="option" aria-selected={pinned}>
                    <LauncherAppIcon item={entry} label={label} />
                    <span className="qx-launcher-home-entry-copy">
                      <strong>{label}</strong>
                      <small>{entry.subtitle || (isModuleEntry(entry) ? t("launcher.home.module", "Module") : entry.path)}</small>
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant={pinned ? "secondary" : "ghost"}
                      className="qx-launcher-home-entry-action"
                      aria-label={pinned ? t("launcher.unpinApp", "Unpin from top") : t("launcher.pinApp", "Pin to top")}
                      title={pinned ? t("launcher.unpinApp", "Unpin from top") : t("launcher.pinApp", "Pin to top")}
                      onClick={() => togglePin(entry)}
                    >
                      {pinned ? <Check size={14} /> : <Pin size={14} />}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="qx-launcher-home-popover-section qx-launcher-home-widgets-section">
          <div className="qx-launcher-home-popover-section-title">
            <span>{t("launcher.home.components", "Home Components")}</span>
          </div>
          <div className="qx-launcher-home-widget-list">
            {widgetOptions.map((option) => (
              <label key={option.id} className="qx-launcher-home-widget-row">
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
                <Switch
                  checked={homeWidgets.includes(option.id)}
                  aria-label={option.title}
                  onCheckedChange={(enabled) => onToggleWidget(option.id, enabled)}
                />
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

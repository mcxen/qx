import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShortcutRecorder from "../../components/ShortcutRecorder";
import {
  LinkButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { pickDisplayName, useDisplayName } from "../../search/appDisplay";
import { appMetadataKey } from "../../search/searchMetadata";
import type { AppEntry } from "../../store";
import {
  countEnabledGlobalShortcuts,
  formatQxShortcut,
  getDefaultQxHostShortcuts,
  globalShortcutIssue,
} from "../../utils/keyboard";
import {
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  useSettingsStore,
} from "./store";

const DEFAULT_HOST_SHORTCUTS = getDefaultQxHostShortcuts();
const DEFAULT_GLOBAL_KEYS: Record<string, string> = {
  toggle_launcher: DEFAULT_HOST_SHORTCUTS.toggleLauncher,
  toggle_window: DEFAULT_HOST_SHORTCUTS.toggleWindow,
  clipboard: "Alt+V",
  record_gif: "Alt+G",
  capture_screenshot: "Alt+Shift+S",
  recapture_last_region: "Alt+Shift+R",
  toggle_capture_controls: "Alt+Shift+C",
  rss: "Alt+R",
  tray_open_main: "Alt+Shift+O",
  tray_keep_visible: "Alt+Shift+K",
  tray_settings: "Alt+Shift+,",
  tray_hide_main: "Alt+Shift+H",
  tray_status_memory: "",
  tray_status_network: "",
  tray_status_cpu: "",
};

type DraftAppShortcut = {
  id: string;
  path: string;
  name: string;
  icon: string;
  display_name?: string;
};

function isNativeAppEntry(item: AppEntry): boolean {
  return (item.kind ?? "app") === "app" && !!item.path && !item.path.startsWith("__qx:");
}

function appShortcutLabelFromId(id: string, locale: string, catalog: AppEntry[]): string {
  if (!id.startsWith("app:")) return id;
  const path = id.slice("app:".length);
  const hit = catalog.find((app) => app.path === path);
  if (hit) return pickDisplayName(hit, locale);
  const leaf = path.split(/[\\/]/).pop() || path;
  return leaf.replace(/\.app$/i, "");
}

function AppPickerIcon({ icon, label }: { icon: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const canUseImage = Boolean(icon) && !failed && !icon.startsWith("builtin:") && !icon.startsWith("plugin:");
  const imageSrc = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(icon) ? convertFileSrc(icon) : icon;
  const fallback = label.trim().slice(0, 1).toUpperCase() || "A";

  useEffect(() => {
    setFailed(false);
  }, [icon]);

  return (
    <span className="qx-app-shortcut-picker-icon" aria-hidden="true">
      {canUseImage ? (
        <img src={imageSrc} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="qx-app-shortcut-picker-icon-fallback">{fallback}</span>
      )}
    </span>
  );
}

function AppShortcutAddPopover({
  open,
  onOpenChange,
  boundIds,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boundIds: Set<string>;
  onPick: (app: AppEntry) => void;
}) {
  const t = useT();
  const getDisplayName = useDisplayName();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const loadApps = useCallback(async (search: string) => {
    setLoading(true);
    setLoadError(false);
    try {
      const rows = await invoke<AppEntry[]>("search_apps", { query: search });
      setApps(rows.filter(isNativeAppEntry));
    } catch {
      setApps([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    void loadApps("");
    const id = window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, loadApps]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void loadApps(query.trim());
    }, query.trim() ? 120 : 0);
    return () => window.clearTimeout(handle);
  }, [open, query, loadApps]);

  const filtered = useMemo(() => {
    // search_apps already ranks by query; keep native apps only (already filtered).
    return apps;
  }, [apps]);

  useEffect(() => {
    setActiveIndex((prev) => {
      if (filtered.length === 0) return 0;
      return Math.min(prev, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, filtered]);

  const pickAt = (index: number) => {
    const app = filtered[index];
    if (!app) return;
    onPick(app);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="qx-command-button qx-app-shortcut-add-btn"
          aria-expanded={open}
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>{t("shortcuts.apps.add", "Add application")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="qx-app-shortcut-picker"
        role="listbox"
        aria-label={t("shortcuts.apps.pickerTitle", "Choose an application")}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Keep Esc local to the picker — do not cascade into shell hide.
          event.preventDefault();
          onOpenChange(false);
        }}
      >
        <div className="qx-app-shortcut-picker-title">
          {t("shortcuts.apps.pickerTitle", "Choose an application")}
        </div>
        <input
          ref={searchRef}
          className="qx-app-shortcut-picker-search"
          type="search"
          value={query}
          placeholder={t("shortcuts.apps.searchPlaceholder", "Search apps…")}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex((i) => Math.max(i - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              pickAt(activeIndex);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onOpenChange(false);
              return;
            }
            // Typing must not reach shell list/search handlers.
            event.stopPropagation();
          }}
        />
        <div className="qx-app-shortcut-picker-scroll">
          {loading && filtered.length === 0 ? (
            <div className="qx-app-shortcut-picker-empty">
              {t("shortcuts.apps.loading", "Loading apps…")}
            </div>
          ) : loadError ? (
            <div className="qx-app-shortcut-picker-empty">
              {t("shortcuts.apps.loadFailed", "Could not load applications.")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="qx-app-shortcut-picker-empty">
              {t("shortcuts.apps.noMatch", "No matching applications.")}
            </div>
          ) : (
            filtered.map((app, index) => {
              const id = appMetadataKey(app.path);
              const bound = boundIds.has(id);
              const label = getDisplayName(app);
              return (
                <button
                  key={app.path}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`qx-app-shortcut-picker-item${index === activeIndex ? " is-active" : ""}${bound ? " is-bound" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pickAt(index)}
                >
                  <AppPickerIcon icon={app.icon} label={label} />
                  <span className="qx-app-shortcut-picker-item-copy">
                    <span className="qx-app-shortcut-picker-item-title">{label}</span>
                    {bound && (
                      <span className="qx-app-shortcut-picker-item-badge">
                        {t("shortcuts.apps.alreadyBound", "Bound")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ShortcutSettings() {
  const t = useT();
  const locale = useLocale();
  const { settings, patchShortcut, patchAppShortcut } = useSettingsStore();
  const shortcuts = settings.shortcuts;
  const counts = countEnabledGlobalShortcuts(shortcuts, settings.app_shortcuts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<DraftAppShortcut | null>(null);
  const [catalog, setCatalog] = useState<AppEntry[]>([]);
  const draftRowRef = useRef<HTMLDivElement>(null);

  const appShortcutEntries = Object.entries(settings.app_shortcuts)
    .filter(([, binding]) => Boolean(binding?.key?.trim()))
    .sort(([a], [b]) =>
      appShortcutLabelFromId(a, locale, catalog).localeCompare(
        appShortcutLabelFromId(b, locale, catalog),
      ),
    );

  const boundIds = useMemo(
    () => new Set(Object.keys(settings.app_shortcuts).filter((id) => {
      const key = settings.app_shortcuts[id]?.key?.trim();
      return Boolean(key);
    })),
    [settings.app_shortcuts],
  );

  // Warm catalog once for nicer labels (display_name) without blocking the page.
  useEffect(() => {
    let cancelled = false;
    void invoke<AppEntry[]>("search_apps", { query: "" })
      .then((rows) => {
        if (!cancelled) setCatalog(rows.filter(isNativeAppEntry));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    draftRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [draft?.id]);

  const handlePickApp = (app: AppEntry) => {
    const id = appMetadataKey(app.path);
    setPickerOpen(false);
    // Stay inside Settings: never launch the app, only draft a binding.
    setDraft({
      id,
      path: app.path,
      name: app.name,
      icon: app.icon,
      display_name: app.display_name,
    });
  };

  return (
    <div className="qx-settings-page">
      <div className="qx-settings-hint" style={{ marginBottom: 12, fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45 }}>
        {t(
          "shortcuts.hint",
          "Global shortcuts work while Qx is in the background. Current Window is enabled by default; Launcher Search and module shortcuts remain off until you enable them.",
        )}
      </div>
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.group} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--color-text-tertiary)",
              textTransform: "uppercase",
              padding: "8px 0 4px",
            }}
          >
            {t(`shortcuts.group.${group.group}`, group.group)}
          </div>
          {group.ids.map((id) => {
            const binding = shortcuts[id];
            const label = t(`shortcuts.label.${id}`, SHORTCUT_LABELS[id] ?? id);
            const issueCode = globalShortcutIssue(binding, counts);
            const issue = issueCode
              ? t(
                `shortcuts.issue.${issueCode}`,
                issueCode === "reserved"
                  ? "Reserved by the operating system (for example Cmd/Ctrl+Space)."
                  : issueCode === "invalid"
                    ? "Invalid shortcut."
                    : "This shortcut is already used by another global action.",
              )
              : null;
            return (
              <div
                key={id}
                className="qx-settings-row"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {label}
                  </div>
                  {issue && (
                    <div style={{ fontSize: 11, color: "var(--qx-danger)", marginTop: 2 }}>
                      {issue}
                    </div>
                  )}
                  {id === "toggle_launcher" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.toggle_launcher", "Show Qx on Launcher and focus search; press again to hide.")}
                    </div>
                  )}
                  {id === "toggle_window" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.toggle_window", "Show or hide Qx while preserving the current module and view.")}
                    </div>
                  )}
                  {(id === "capture_screenshot" || id === "record_gif") && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.capture", "Start area selection immediately on the display under the pointer.")}
                    </div>
                  )}
                  {id === "toggle_capture_controls" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.captureIsland", "Show or hide the floating screenshot and recording toolbar.")}
                    </div>
                  )}
                  {id !== "toggle_launcher" && id !== "toggle_window" && id !== "capture_screenshot" && id !== "record_gif" && id !== "toggle_capture_controls" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.module", "Open this module; press again on the same module to hide Qx.")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => patchShortcut(id, { enabled: !binding?.enabled })}
                    className="qx-command-button"
                    style={{ height: 26, color: binding?.enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                    title={t("shortcuts.toggleEnabled", "Toggle enabled")}
                  >
                    {binding?.enabled ? t("shortcuts.on", "On") : t("shortcuts.off", "Off")}
                  </button>
                  <ShortcutRecorder
                    initial={binding?.key ?? ""}
                    conflict={Boolean(issue)}
                    onCommit={(b) => patchShortcut(id, b)}
                    onCancel={() => {}}
                  />
                  <LinkButton
                    onClick={() => {
                      patchShortcut(id, {
                        key: DEFAULT_GLOBAL_KEYS[id] ?? "",
                        // Primary window toggle is forced on by reset; modules stay user-chosen.
                        enabled: id === "toggle_window" ? true : (binding?.enabled ?? false),
                      });
                    }}
                    title={t("shortcuts.reset", "Reset to default key")}
                  >
                    ↺
                  </LinkButton>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ marginBottom: 16 }}>
        <div className="qx-app-shortcut-section-header">
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--color-text-tertiary)",
              textTransform: "uppercase",
              padding: "8px 0 4px",
            }}
          >
            {t("shortcuts.group.apps", "Applications")}
          </div>
          <AppShortcutAddPopover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            boundIds={boundIds}
            onPick={handlePickApp}
          />
        </div>

        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45, padding: "0 0 8px" }}>
          {t(
            "shortcuts.apps.help",
            "Add an app here or right-click one in the launcher. The global shortcut launches that app without leaving other windows unexpectedly.",
          )}
        </div>

        {draft && (
          <div ref={draftRowRef} className="qx-settings-row qx-app-shortcut-draft-row">
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <AppPickerIcon icon={draft.icon} label={draft.name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {pickDisplayName(
                    {
                      name: draft.name,
                      display_name: draft.display_name,
                      path: draft.path,
                      icon: draft.icon,
                    },
                    locale,
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                  {t("shortcuts.apps.recordHint", "Press a shortcut to bind this app.")}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <ShortcutRecorder
                key={draft.id}
                initial={settings.app_shortcuts[draft.id]?.key ?? ""}
                conflict={false}
                autoStart
                onCommit={(b) => {
                  if (!b.key.trim()) {
                    setDraft(null);
                    return;
                  }
                  patchAppShortcut(draft.id, {
                    ...b,
                    enabled: true,
                  });
                  setDraft(null);
                }}
                onCancel={() => setDraft(null)}
              />
              <LinkButton
                onClick={() => setDraft(null)}
                title={t("launcher.removeShortcut", "Remove shortcut")}
              >
                ×
              </LinkButton>
            </div>
          </div>
        )}

        {appShortcutEntries.length === 0 && !draft ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45, padding: "4px 0 8px" }}>
            {t(
              "shortcuts.apps.empty",
              "No app shortcuts yet. Click Add application to choose an app and record a global shortcut.",
            )}
          </div>
        ) : (
          appShortcutEntries.map(([id, binding]) => {
            // Hide the saved row while drafting a re-bind for the same app.
            if (draft?.id === id) return null;
            const issueCode = globalShortcutIssue(binding, counts);
            const issue = issueCode
              ? t(
                `shortcuts.issue.${issueCode}`,
                issueCode === "reserved"
                  ? "Reserved by the operating system (for example Cmd/Ctrl+Space)."
                  : issueCode === "invalid"
                    ? "Invalid shortcut."
                    : "This shortcut is already used by another global action.",
              )
              : null;
            return (
              <div key={id} className="qx-settings-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {appShortcutLabelFromId(id, locale, catalog)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    {t("shortcuts.desc.app", "Global shortcut to launch this application.")}
                    {binding.key ? ` · ${formatQxShortcut(binding.key)}` : ""}
                  </div>
                  {issue && (
                    <div style={{ fontSize: 11, color: "var(--qx-danger)", marginTop: 2 }}>
                      {issue}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => patchAppShortcut(id, { enabled: !binding.enabled })}
                    className="qx-command-button"
                    style={{ height: 26, color: binding.enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                    title={t("shortcuts.toggleEnabled", "Toggle enabled")}
                  >
                    {binding.enabled ? t("shortcuts.on", "On") : t("shortcuts.off", "Off")}
                  </button>
                  <ShortcutRecorder
                    initial={binding.key ?? ""}
                    conflict={Boolean(issue)}
                    onCommit={(b) =>
                      patchAppShortcut(id, {
                        ...b,
                        enabled: b.key.trim() ? (b.enabled ?? true) : false,
                      })
                    }
                    onCancel={() => {}}
                  />
                  <LinkButton
                    onClick={() => patchAppShortcut(id, { key: "", enabled: false })}
                    title={t("launcher.removeShortcut", "Remove shortcut")}
                  >
                    ×
                  </LinkButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

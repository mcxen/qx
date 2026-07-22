import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Clipboard,
  Database,
  Folder,
  History,
  RefreshCw,
  Rss,
  Trash2,
} from "lucide-react";
import { Button, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

interface StoragePath {
  path: string;
  exists: boolean;
}

interface StorageCacheTarget {
  id: string;
  module: string;
  label: string;
  paths: StoragePath[];
  bytes: number;
  files: number;
}

interface StorageBucket {
  id: string;
  label: string;
  paths: StoragePath[];
  bytes: number;
  files: number;
  clearable: boolean;
}

interface StorageOverview {
  total_bytes: number;
  reclaimable_bytes: number;
  cache_targets: StorageCacheTarget[];
  buckets: StorageBucket[];
  warnings: string[];
}

interface StorageClearResult {
  cleared_bytes: number;
  cleared_files: number;
  cleared_records?: number;
  warnings?: string[];
}

interface CleanupAction {
  id: string;
  icon: LucideIcon;
  command: string;
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
}

const BUCKET_LABEL_KEYS: Record<string, string> = {
  cache: "about.storage.cache",
  files: "about.storage.files",
  databases: "about.storage.databases",
  clipboard: "about.storage.clipboard",
  plugins: "about.storage.plugins",
  "plugin-data": "about.storage.pluginData",
  settings: "about.storage.settings",
};

const CACHE_LABEL_KEYS: Record<string, string> = {
  "application-icons": "about.storage.cacheTarget.applicationIcons",
  "rss-icons": "about.storage.cacheTarget.rssIcons",
  "clipboard-previews": "about.storage.cacheTarget.clipboardPreviews",
  "v2ex-responses": "about.storage.cacheTarget.v2ex",
  "weather-response": "about.storage.cacheTarget.weather",
  "marketplace-archives": "about.storage.cacheTarget.marketplace",
  "update-packages": "about.storage.cacheTarget.updates",
  "ocr-models": "about.storage.cacheTarget.ocr",
  "file-search-index": "about.storage.cacheTarget.fileSearch",
  "screen-capture-temp": "about.storage.cacheTarget.screenCapture",
};

const CACHE_DESCRIPTION_KEYS: Record<string, string> = {
  "application-icons": "about.storage.cacheTarget.applicationIcons.desc",
  "rss-icons": "about.storage.cacheTarget.rssIcons.desc",
  "clipboard-previews": "about.storage.cacheTarget.clipboardPreviews.desc",
  "v2ex-responses": "about.storage.cacheTarget.v2ex.desc",
  "weather-response": "about.storage.cacheTarget.weather.desc",
  "marketplace-archives": "about.storage.cacheTarget.marketplace.desc",
  "update-packages": "about.storage.cacheTarget.updates.desc",
  "ocr-models": "about.storage.cacheTarget.ocr.desc",
  "file-search-index": "about.storage.cacheTarget.fileSearch.desc",
  "screen-capture-temp": "about.storage.cacheTarget.screenCapture.desc",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function shortenPath(path: string): string {
  const unixHome = path.match(/^\/Users\/[^/]+/u)?.[0];
  if (unixHome) return `~${path.slice(unixHome.length)}`;
  const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+/u)?.[0];
  if (windowsHome) return `~${path.slice(windowsHome.length)}`;
  return path;
}

export default function StorageSettingsCard() {
  const t = useT();
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const loadStorage = async (showBusy = true) => {
    try {
      if (showBusy) setBusy((current) => current ?? "refresh");
      const overview = await invoke<StorageOverview>("qx_storage_overview");
      setStorage(overview);
    } catch (error) {
      setStatus(String(error));
    } finally {
      if (showBusy) setBusy(null);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStorage(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const cleanupActions = useMemo<CleanupAction[]>(() => [
    {
      id: "files",
      icon: Folder,
      command: "qx_storage_clear_files",
      title: t("about.storage.cleanup.files", "Generated Files"),
      description: t(
        "about.storage.cleanup.files.desc",
        "Qx screenshots, video recordings, and GIF files in the output folder.",
      ),
      confirm: t(
        "about.storage.confirmFiles",
        "Delete Qx screenshots, recordings, and GIF files from the output folder?",
      ),
      danger: true,
    },
    {
      id: "clipboard",
      icon: Clipboard,
      command: "qx_storage_clear_clipboard",
      title: t("about.storage.cleanup.clipboard", "Clipboard Attachments"),
      description: t(
        "about.storage.cleanup.clipboard.desc",
        "Stored clipboard images. Text history is preserved, but image previews become unavailable.",
      ),
      confirm: t(
        "about.storage.confirmClipboard",
        "Delete stored clipboard images? Text history will be preserved.",
      ),
    },
    {
      id: "clipboard-history",
      icon: Trash2,
      command: "qx_storage_clear_clipboard_history",
      title: t("about.storage.cleanup.clipboardHistory", "Clipboard History"),
      description: t(
        "about.storage.cleanup.clipboardHistory.desc",
        "All clipboard text entries, image entries, and stored attachments.",
      ),
      confirm: t(
        "about.storage.confirmClipboardHistory",
        "Delete all clipboard history, including text entries and stored images?",
      ),
      danger: true,
    },
    {
      id: "launcher-history",
      icon: History,
      command: "qx_storage_clear_launcher_history",
      title: t("about.storage.cleanup.launcherHistory", "Launcher History"),
      description: t(
        "about.storage.cleanup.launcherHistory.desc",
        "Recent launches and search suggestions used by the launcher.",
      ),
      confirm: t(
        "about.storage.confirmLauncherHistory",
        "Clear recent launches and search suggestion history?",
      ),
    },
    {
      id: "rss-cache",
      icon: Rss,
      command: "qx_storage_clear_rss_cache",
      title: t("about.storage.cleanup.rssCache", "RSS Offline Articles"),
      description: t(
        "about.storage.cleanup.rssCache.desc",
        "Non-starred RSS articles. Feed subscriptions, icons, and starred items stay.",
      ),
      confirm: t(
        "about.storage.confirmRssCache",
        "Delete non-starred RSS offline articles while keeping feeds and starred items?",
      ),
    },
  ], [t]);

  const formatResult = (result: StorageClearResult): string => {
    const parts: string[] = [];
    if (result.cleared_bytes > 0) parts.push(formatBytes(result.cleared_bytes));
    if (result.cleared_files > 0) {
      parts.push(`${result.cleared_files} ${t("about.storage.files.unit", "files")}`);
    }
    if ((result.cleared_records ?? 0) > 0) {
      parts.push(`${result.cleared_records} ${t("about.storage.records.unit", "records")}`);
    }
    return parts.length
      ? t("about.storage.clearedDetailed", "Cleared {items}.").replace("{items}", parts.join(" / "))
      : t("about.storage.clearedNothing", "Nothing to clear.");
  };

  const runCleanup = async ({
    id,
    command,
    confirm,
    title,
    args,
  }: {
    id: string;
    command: string;
    confirm: string;
    title: string;
    args?: Record<string, unknown>;
  }) => {
    if (!window.confirm(confirm)) return;
    try {
      setBusy(id);
      setStatus("");
      const result = await invoke<StorageClearResult>(command, args);
      const warningText = result.warnings?.length
        ? ` ${t("about.storage.warnings", "Some entries were skipped:")} ${result.warnings.join("; ")}`
        : "";
      setStatus(`${title}: ${formatResult(result)}${warningText}`);
      await loadStorage(false);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(null);
    }
  };

  const totalBytes = storage?.total_bytes ?? 0;
  const reclaimableBytes = storage?.reclaimable_bytes ?? 0;
  const warnings = storage?.warnings ?? [];

  return (
    <>
      <SettingsCard
        title={t("about.storage", "Storage")}
        trailing={<div className="qx-storage-total">{formatBytes(totalBytes)}</div>}
      >
        <div className="qx-storage-panel" aria-label={t("about.storage", "Storage")}>
          <div className="qx-storage-summary">
            <div>
              <strong>{formatBytes(reclaimableBytes)}</strong>
              <span>{t("about.storage.reclaimable", "rebuildable module cache")}</span>
            </div>
            <div className="qx-storage-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadStorage()}
                disabled={busy !== null}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {busy === "refresh"
                  ? t("about.storage.refreshing", "Refreshing...")
                  : t("about.storage.refresh", "Refresh")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void runCleanup({
                  id: "all-cache",
                  command: "qx_storage_clear_cache",
                  title: t("about.storage.clearAllCaches", "All Module Caches"),
                  confirm: t(
                    "about.storage.confirmAllCaches",
                    "Clear every rebuildable module cache listed below? Settings, history, generated files, and plugin data stay.",
                  ),
                })}
                disabled={busy !== null || reclaimableBytes <= 0}
              >
                <Archive size={14} aria-hidden="true" />
                {busy === "all-cache"
                  ? t("about.storage.clearing", "Clearing...")
                  : t("about.storage.clearAllCaches", "Clear All Caches")}
              </Button>
            </div>
          </div>

          {status && <div className="qx-storage-status">{status}</div>}
          {warnings.length > 0 && (
            <div className="qx-storage-status is-danger">
              {t("about.storage.warnings", "Some entries were skipped:")} {warnings.join("; ")}
            </div>
          )}

          <div className="qx-storage-section-heading">
            <Database size={14} aria-hidden="true" />
            <span>{t("about.storage.moduleCaches", "Module Caches")}</span>
          </div>
          <div className="qx-module-cache-list">
            {(storage?.cache_targets ?? []).map((target) => {
              const label = t(CACHE_LABEL_KEYS[target.id] ?? `about.storage.cacheTarget.${target.id}`, target.label);
              const description = t(
                CACHE_DESCRIPTION_KEYS[target.id] ?? `about.storage.cacheTarget.${target.id}.desc`,
                target.module,
              );
              const targetBusy = busy === `cache:${target.id}`;
              return (
                <div className="qx-module-cache-row" key={target.id}>
                  <div className="qx-module-cache-main">
                    <div className="qx-module-cache-title">
                      <strong>{label}</strong>
                      <span>{target.module}</span>
                    </div>
                    <div className="qx-module-cache-description">{description}</div>
                    {target.paths.length > 0 && (
                      <div className="qx-storage-paths">
                        {target.paths.map((entry) => (
                          <div
                            className={`qx-storage-path${entry.exists ? "" : " is-missing"}`}
                            key={entry.path}
                            title={entry.path}
                          >
                            {shortenPath(entry.path)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="qx-module-cache-side">
                    <div className="qx-storage-meta">
                      <span>{formatBytes(target.bytes)}</span>
                      <span>{target.files} {t("about.storage.files.unit", "files")}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runCleanup({
                        id: `cache:${target.id}`,
                        command: "qx_storage_clear_cache_target",
                        args: { targetId: target.id },
                        title: label,
                        confirm: t(
                          "about.storage.confirmModuleCache",
                          "Clear the rebuildable cache for {module}?",
                        ).replace("{module}", label),
                      })}
                      disabled={busy !== null || (target.bytes <= 0 && target.files <= 0)}
                    >
                      {targetBusy
                        ? t("about.storage.clearing", "Clearing...")
                        : t("about.storage.clean", "Clean")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t("about.storage.dataAndHistory", "Data, History & Locations")}>
        <div className="qx-storage-panel">
          <div className="qx-cleanup-list" aria-label={t("about.storage.cleanup", "Cleanup Targets")}>
            {cleanupActions.map((action) => {
              const Icon = action.icon;
              const actionBusy = busy === action.id;
              return (
                <div className={`qx-cleanup-item${action.danger ? " is-danger" : ""}`} key={action.id}>
                  <span className="qx-cleanup-icon" aria-hidden="true">
                    <Icon size={16} strokeWidth={2.1} />
                  </span>
                  <div className="qx-cleanup-copy">
                    <div className="qx-cleanup-title">{action.title}</div>
                    <div className="qx-cleanup-desc">{action.description}</div>
                  </div>
                  <Button
                    variant={action.danger ? "destructive" : "outline"}
                    size="sm"
                    onClick={() => void runCleanup(action)}
                    disabled={busy !== null}
                  >
                    {actionBusy
                      ? t("about.storage.clearing", "Clearing...")
                      : t("about.storage.clean", "Clean")}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="qx-storage-list">
            {(storage?.buckets ?? []).map((bucket) => {
              const label = t(BUCKET_LABEL_KEYS[bucket.id] ?? `about.storage.${bucket.id}`, bucket.label);
              return (
                <div className="qx-storage-row" key={bucket.id}>
                  <span className={`qx-storage-dot bucket-${bucket.id}`} aria-hidden="true" />
                  <div className="qx-storage-copy">
                    <div className="qx-storage-name">{label}</div>
                    <div className="qx-storage-paths">
                      {bucket.paths.map((entry) => (
                        <div
                          className={`qx-storage-path${entry.exists ? "" : " is-missing"}`}
                          key={entry.path}
                          title={entry.path}
                        >
                          {shortenPath(entry.path)}
                          {!entry.exists && (
                            <span className="qx-storage-path-tag">
                              {t("about.storage.missing", "missing")}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="qx-storage-row-side">
                    <div className="qx-storage-meta">
                      <span>{formatBytes(bucket.bytes)}</span>
                      <span>{bucket.files} {t("about.storage.files.unit", "files")}</span>
                    </div>
                    <div className="qx-storage-row-actions">
                      {bucket.paths.filter((entry) => entry.path.length > 0).map((entry) => (
                        <button
                          key={entry.path}
                          className="qx-icon-button"
                          onClick={() => void open(entry.path)}
                          disabled={!entry.exists}
                          type="button"
                          title={entry.path}
                        >
                          {t("about.storage.open", "Open")}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SettingsCard>
    </>
  );
}

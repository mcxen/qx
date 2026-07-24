import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Archive, RefreshCw } from "lucide-react";
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
  description?: string;
  paths: StoragePath[];
  bytes: number;
  files: number;
  records?: number;
}

interface StorageOverview {
  reclaimable_bytes: number;
  cache_targets: StorageCacheTarget[];
  warnings: string[];
}

interface StorageClearResult {
  cleared_bytes: number;
  cleared_files: number;
  cleared_records?: number;
  warnings?: string[];
}

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

export default function StorageSettings() {
  const t = useT();
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  const loadStorage = async (showBusy = true) => {
    try {
      if (showBusy) setBusy((current) => current ?? "refresh");
      setFailed(false);
      const overview = await invoke<StorageOverview>("qx_storage_overview");
      setStorage(overview);
    } catch (error) {
      setFailed(true);
      setStatus(String(error));
    } finally {
      if (showBusy) setBusy(null);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStorage(), 120);
    return () => window.clearTimeout(timer);
  }, []);

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
      setFailed(false);
      const result = await invoke<StorageClearResult>(command, args);
      const warningText = result.warnings?.length
        ? ` ${t("about.storage.warnings", "Some entries were skipped:")} ${result.warnings.join("; ")}`
        : "";
      setStatus(`${title}: ${formatResult(result)}${warningText}`);
      await loadStorage(false);
    } catch (error) {
      setFailed(true);
      setStatus(String(error));
    } finally {
      setBusy(null);
    }
  };

  const targets = storage?.cache_targets ?? [];
  const warnings = storage?.warnings ?? [];
  const reclaimableBytes = storage?.reclaimable_bytes ?? 0;

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("storage.modules.title", "Module Storage")}
        description={t(
          "storage.modules.desc",
          "Rebuildable storage registered by built-in modules and extensions.",
        )}
      >
        <div className="qx-storage-toolbar">
          <div className="qx-storage-toolbar-copy">
            <strong>{formatBytes(reclaimableBytes)}</strong>
            <span>{t("storage.reclaimable", "Total rebuildable module storage")}</span>
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

        {status && (
          <div className={`qx-storage-status${failed ? " is-danger" : ""}`}>
            {status}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="qx-storage-status is-danger">
            {t("about.storage.warnings", "Some entries were skipped:")} {warnings.join("; ")}
          </div>
        )}

        <div
          className="qx-storage-table"
          role="table"
          aria-label={t("storage.modules.title", "Module Storage")}
        >
          <div className="qx-storage-table-header" role="row">
            <span role="columnheader">{t("storage.column.module", "Module")}</span>
            <span role="columnheader">{t("storage.column.size", "Size")}</span>
            <span role="columnheader">{t("storage.column.items", "Items")}</span>
            <span role="columnheader">{t("storage.column.action", "Action")}</span>
          </div>

          {targets.map((target) => {
            const label = t(
              CACHE_LABEL_KEYS[target.id] ?? `about.storage.cacheTarget.${target.id}`,
              target.label,
            );
            const description = t(
              CACHE_DESCRIPTION_KEYS[target.id] ?? `about.storage.cacheTarget.${target.id}.desc`,
              target.description || target.module,
            );
            const targetBusy = busy === `cache:${target.id}`;
            const itemCount = (target.records ?? 0) > 0
              ? `${target.records} ${t("about.storage.records.unit", "records")}`
              : `${target.files} ${t("about.storage.files.unit", "files")}`;
            return (
              <div className="qx-storage-table-row" role="row" key={target.id}>
                <div className="qx-storage-module-cell" role="cell">
                  <div className="qx-storage-module-title">
                    <strong>{label}</strong>
                    <span>{target.module}</span>
                  </div>
                  <div className="qx-storage-module-description">{description}</div>
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
                <div className="qx-storage-value-cell" role="cell">
                  <span className="qx-storage-mobile-label">
                    {t("storage.column.size", "Size")}
                  </span>
                  <strong>{formatBytes(target.bytes)}</strong>
                </div>
                <div className="qx-storage-value-cell" role="cell">
                  <span className="qx-storage-mobile-label">
                    {t("storage.column.items", "Items")}
                  </span>
                  <span>{itemCount}</span>
                </div>
                <div className="qx-storage-action-cell" role="cell">
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
                    disabled={busy !== null || (
                      target.bytes <= 0
                      && target.files <= 0
                      && (target.records ?? 0) <= 0
                    )}
                  >
                    {targetBusy
                      ? t("about.storage.clearing", "Clearing...")
                      : t("about.storage.clean", "Clean")}
                  </Button>
                </div>
              </div>
            );
          })}

          {storage && targets.length === 0 && (
            <div className="qx-storage-empty">
              {t("storage.empty", "No module storage is currently registered.")}
            </div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import type { LucideIcon } from "lucide-react";
import { Archive, Clipboard, Folder, History, RefreshCw, Rss, Trash2 } from "lucide-react";
import { Button, Row, SettingsCard } from "../../components/ui";
import GifText from "../../components/gif-text";
import { useT } from "../../i18n";

const RELEASES_URL = "https://github.com/mcxen/qx/releases";

interface StoragePath {
  path: string;
  exists: boolean;
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
  buckets: StorageBucket[];
  warnings: string[];
}

interface StorageClearResult {
  cleared_bytes: number;
  cleared_files: number;
  cleared_records?: number;
  warnings?: string[];
}

interface QxUpdateInfo {
  available: boolean;
  current_version: string;
  latest_version: string | null;
  release_url: string | null;
  asset_name: string | null;
  asset_url: string | null;
  sha256: string | null;
  size: number | null;
  notes: string | null;
  can_install: boolean;
  install_reason: string | null;
}

interface QxUpdateInstallResult {
  version: string;
  staged_app: string;
  target_app: string;
  helper_path: string;
  message: string;
}

type ClearKind =
  | "cache"
  | "files"
  | "clipboard"
  | "clipboard-history"
  | "launcher-history"
  | "rss-cache"
  | "reclaimable";
type BusyKind = ClearKind | "refresh";

const BUCKET_LABEL_KEYS: Record<string, string> = {
  cache: "about.storage.cache",
  files: "about.storage.files",
  databases: "about.storage.databases",
  clipboard: "about.storage.clipboard",
  plugins: "about.storage.plugins",
  settings: "about.storage.settings",
};

interface CleanupAction {
  id: ClearKind;
  icon: LucideIcon;
  command: string;
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
}

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
  const home = "/Users/";
  if (path.startsWith(home)) {
    const rest = path.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) return `~${rest.slice(slash)}`;
  }
  return path;
}

export default function AboutPanel() {
  const t = useT();
  const [version, setVersion] = useState<string>("");
  const [latest, setLatest] = useState<string | null>(null);
  const [latestUrl, setLatestUrl] = useState<string>(RELEASES_URL);
  const [updateInfo, setUpdateInfo] = useState<QxUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [storageBusy, setStorageBusy] = useState<BusyKind | null>(null);
  const [storageStatus, setStorageStatus] = useState("");

  const loadStorage = async () => {
    try {
      setStorageBusy((current) => current ?? "refresh");
      const overview = await invoke<StorageOverview>("qx_storage_overview");
      setStorage(overview);
    } catch (e) {
      setStorageStatus(String(e));
    } finally {
      setStorageBusy(null);
    }
  };

  const loadUpdateInfo = async (visible: boolean) => {
    if (visible) {
      setChecking(true);
      setStatus("");
    }
    try {
      const info = await invoke<QxUpdateInfo>("qx_update_check");
      setUpdateInfo(info);
      setVersion(info.current_version || "unknown");
      setLatest(info.latest_version ? `v${info.latest_version}` : null);
      setLatestUrl(info.release_url || RELEASES_URL);
      if (visible) {
        if (!info.available) {
          setStatus(t("about.upToDate", "You're on the latest version."));
        } else if (info.can_install) {
          setStatus(
            t("about.latestReady", "Latest release is v{version}. Ready to download and install.")
              .replace("{version}", String(info.latest_version ?? "")),
          );
        } else {
          setStatus(
            info.install_reason
              || t("about.latestIs", "Latest release is v{version}.")
                .replace("{version}", String(info.latest_version ?? "")),
          );
        }
      }
    } catch (e) {
      if (visible) {
        setStatus(
          t("about.checkFailed", "Update check failed: {message}").replace("{message}", String(e)),
        );
      }
      setUpdateInfo(null);
      setLatest(null);
    } finally {
      if (visible) setChecking(false);
    }
  };

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));

    const storageTimer = window.setTimeout(() => {
      void loadStorage();
    }, 120);
    const updateTimer = window.setTimeout(() => {
      void loadUpdateInfo(false);
    }, 700);

    return () => {
      window.clearTimeout(storageTimer);
      window.clearTimeout(updateTimer);
    };
  }, []);

  const handleCheckUpdate = async () => {
    await loadUpdateInfo(true);
  };

  const handleInstallUpdate = async () => {
    setInstalling(true);
    setStatus("");
    try {
      const result = await invoke<QxUpdateInstallResult>("qx_update_download_and_install");
      setStatus(result.message);
    } catch (e) {
      setStatus(
        t("about.installFailed", "Update install failed: {message}").replace("{message}", String(e)),
      );
    } finally {
      setInstalling(false);
    }
  };

  const handleOpenReleases = () => {
    void open(latestUrl || RELEASES_URL);
  };

  const cleanupActions: CleanupAction[] = [
    {
      id: "cache",
      icon: Archive,
      command: "qx_storage_clear_cache",
      title: t("about.storage.cleanup.cache", "Rebuildable Cache"),
      description: t(
        "about.storage.cleanup.cache.desc",
        "App icons, OCR models, and temporary recording folders.",
      ),
      confirm: t(
        "about.storage.confirmCache",
        "Clear reusable caches? App icons and OCR models can be rebuilt or downloaded again.",
      ),
    },
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
        "Delete Qx screen recordings and GIF files from the output folder?",
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
        "Cached clipboard images and pasteboard snapshots. Text history is preserved.",
      ),
      confirm: t(
        "about.storage.confirmClipboard",
        "Delete cached clipboard images? Text history is preserved.",
      ),
    },
    {
      id: "clipboard-history",
      icon: Trash2,
      command: "qx_storage_clear_clipboard_history",
      title: t("about.storage.cleanup.clipboardHistory", "Clipboard History"),
      description: t(
        "about.storage.cleanup.clipboardHistory.desc",
        "All clipboard text entries, image entries, and cached attachments.",
      ),
      confirm: t(
        "about.storage.confirmClipboardHistory",
        "Delete all clipboard history, including text entries and cached images?",
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
        "Non-starred RSS articles. Feed subscriptions and starred items stay.",
      ),
      confirm: t(
        "about.storage.confirmRssCache",
        "Delete non-starred RSS offline articles while keeping feeds and starred items?",
      ),
    },
    {
      id: "reclaimable",
      icon: RefreshCw,
      command: "qx_storage_clear_reclaimable",
      title: t("about.storage.cleanup.reclaimable", "All Cache & History"),
      description: t(
        "about.storage.cleanup.reclaimable.desc",
        "Rebuildable cache plus clipboard, launcher, and RSS history. Generated files are not removed.",
      ),
      confirm: t(
        "about.storage.confirmReclaimable",
        "Clear all cache and history? Generated files, plugins, and settings will remain.",
      ),
      danger: true,
    },
  ];

  const formatStorageClearResult = (result: StorageClearResult): string => {
    const parts: string[] = [];
    if (result.cleared_bytes > 0) parts.push(formatBytes(result.cleared_bytes));
    if (result.cleared_files > 0) {
      parts.push(
        `${result.cleared_files} ${t("about.storage.files.unit", "files")}`,
      );
    }
    if ((result.cleared_records ?? 0) > 0) {
      parts.push(
        `${result.cleared_records} ${t("about.storage.records.unit", "records")}`,
      );
    }
    if (parts.length === 0) return t("about.storage.clearedNothing", "Nothing to clear.");
    return t("about.storage.clearedDetailed", "Cleared {items}.").replace(
      "{items}",
      parts.join(" / "),
    );
  };

  const clearStorage = async (kind: ClearKind) => {
    const action = cleanupActions.find((item) => item.id === kind);
    if (!action) return;
    if (!window.confirm(action.confirm)) return;
    try {
      setStorageBusy(kind);
      setStorageStatus("");
      const result = await invoke<StorageClearResult>(action.command);
      const warningText = result.warnings?.length
        ? ` ${t("about.storage.warnings", "Some entries were skipped:")} ${result.warnings.join("; ")}`
        : "";
      setStorageStatus(`${action.title}: ${formatStorageClearResult(result)}${warningText}`);
      await loadStorage();
    } catch (e) {
      setStorageStatus(String(e));
    } finally {
      setStorageBusy(null);
    }
  };

  const totalBytes = storage?.total_bytes ?? 0;
  const warnings = storage?.warnings ?? [];

  return (
    <div className="qx-settings-page">
      <div className="qx-about-gif-text">
        <GifText
          text="QxSTART"
          containerClassName="qx-about-gif-text-frame"
        />
      </div>

      <SettingsCard
        title={t("about.aboutCard.title", "About Qx")}>
        <Row
          title={t("about.appName", "Qx")}
          description={t(
            "about.appTagline",
            "A keyboard-driven productivity launcher for macOS.",
          )}
        >
          <span style={{ color: "var(--qx-text-secondary)" }}>v{version || "..."}</span>
        </Row>

        <Row
          title={t("about.latestRelease", "Latest Release")}
          description={t(
            "about.latestRelease.desc",
            "Most recent version published on GitHub.",
          )}
        >
          <span style={{ color: "var(--qx-text-secondary)" }}>
            {latest ?? t("about.unableToFetch", "Unable to fetch")}
          </span>
        </Row>

        <Row
          title={t("about.checkUpdates", "Check for Updates")}
          description={
            updateInfo?.available && updateInfo.can_install
              ? t("about.checkUpdates.ready", "Download {name} and restart Qx.").replace(
                "{name}",
                updateInfo.asset_name ?? t("about.latestRelease", "the latest release"),
              )
              : t("about.checkUpdates.idle", "Check the latest GitHub release.")
          }
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => void handleCheckUpdate()}
              disabled={checking || installing}
              className="qx-command-button"
            >
              {checking
                ? t("about.checking", "Checking...")
                : t("about.checkNow", "Check Now")}
            </button>
            {updateInfo?.available && updateInfo.can_install && (
              <button
                onClick={() => void handleInstallUpdate()}
                disabled={checking || installing}
                className="qx-command-button primary"
              >
                {installing
                  ? t("about.downloading", "Downloading...")
                  : t("about.downloadInstall", "Download & Install")}
              </button>
            )}
          </div>
        </Row>

        {status && (
          <Row title={t("about.updateStatus", "Update Status")} description={status}>
            <span />
          </Row>
        )}

        <Row
          title={t("about.githubReleases", "GitHub Releases")}
          description={t(
            "about.githubReleases.desc",
            "View all releases and release notes.",
          )}
        >
          <button onClick={handleOpenReleases} className="qx-command-button">
            {t("about.openReleases", "Open Releases")}
          </button>
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("about.storage", "Storage")}
        trailing={<div className="qx-storage-total">{formatBytes(totalBytes)}</div>}
      >
        <div className="qx-storage-panel" aria-label={t("about.storage", "Storage")}>
          <div className="qx-storage-rainbow" aria-hidden="true">
            {(storage?.buckets ?? []).map((bucket) => {
              const width = totalBytes > 0 ? Math.max((bucket.bytes / totalBytes) * 100, bucket.bytes > 0 ? 2 : 0) : 0;
              return (
                <span
                  key={bucket.id}
                  className={`qx-storage-slice bucket-${bucket.id}`}
                  style={{ width: `${width}%` }}
                />
              );
            })}
          </div>

          <div className="qx-storage-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadStorage()}
              disabled={storageBusy !== null}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {storageBusy === "refresh" ? t("about.storage.refreshing", "Refreshing...") : t("about.storage.refresh", "Refresh")}
            </Button>
          </div>

          {storageStatus && <div className="qx-storage-status">{storageStatus}</div>}
          {warnings.length > 0 && (
            <div className="qx-storage-status">
              {t("about.storage.warnings", "Some entries were skipped:")} {warnings.join("; ")}
            </div>
          )}

          <div className="qx-cleanup-list" aria-label={t("about.storage.cleanup", "Cleanup Targets")}>
            {cleanupActions.map((action) => {
              const Icon = action.icon;
              const busy = storageBusy === action.id;
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
                    onClick={() => void clearStorage(action.id)}
                    disabled={storageBusy !== null}
                  >
                    {busy ? t("about.storage.clearing", "Clearing...") : t("about.storage.clean", "Clean")}
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="qx-storage-list">
            {(storage?.buckets ?? []).map((bucket) => {
              const label = t(
                BUCKET_LABEL_KEYS[bucket.id] ?? `about.storage.${bucket.id}`,
                bucket.label,
              );
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
                      <span>
                        {bucket.files} {t("about.storage.files.unit", "files")}
                      </span>
                    </div>
                    <div className="qx-storage-row-actions">
                      {bucket.paths
                        .filter((entry) => entry.path.startsWith("/"))
                        .map((entry) => (
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
    </div>
  );
}

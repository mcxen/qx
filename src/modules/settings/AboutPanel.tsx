import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-shell";
import { Row, SettingsCard } from "../../components/ui";
import GifText from "../../components/gif-text";
import { useT } from "../../i18n";

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
}

type ClearKind = "cache" | "files" | "clipboard";
type BusyKind = ClearKind | "refresh";

const BUCKET_LABELS: Record<string, string> = {
  cache: "Cache",
  files: "Files",
  databases: "Databases",
  clipboard: "Clipboard",
  plugins: "Plugins",
  settings: "Settings",
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
  const [checking, setChecking] = useState(false);
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

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));

    fetch("https://api.github.com/repos/mcxen/qx/releases/latest")
      .then((res) => res.json())
      .then((data) => {
        const tag = typeof data.tag_name === "string" ? data.tag_name : null;
        setLatest(tag);
      })
      .catch(() => setLatest(null));
    void loadStorage();
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setStatus("");
    try {
      const update = await check();
      if (update) {
        setStatus(`Downloading ${update.version}...`);
        await update.downloadAndInstall();
        setStatus("Update installed. Restart Qx to apply it.");
      } else {
        setStatus("You're on the latest version.");
      }
    } catch (e) {
      setStatus(`Update check failed: ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const handleOpenReleases = () => {
    void open("https://github.com/mcxen/qx/releases");
  };

  const clearStorage = async (kind: ClearKind) => {
    const messageMap: Record<ClearKind, string> = {
      cache: t(
        "about.storage.confirmCache",
        "Clear reusable caches? App icons and OCR models can be rebuilt or downloaded again.",
      ),
      files: t(
        "about.storage.confirmFiles",
        "Delete Qx GIF recordings from the output folder?",
      ),
      clipboard: t(
        "about.storage.confirmClipboard",
        "Delete cached clipboard images? Text history is preserved.",
      ),
    };
    if (!window.confirm(messageMap[kind])) return;
    try {
      setStorageBusy(kind);
      setStorageStatus("");
      const commandMap: Record<ClearKind, string> = {
        cache: "qx_storage_clear_cache",
        files: "qx_storage_clear_files",
        clipboard: "qx_storage_clear_clipboard",
      };
      const result = await invoke<StorageClearResult>(commandMap[kind]);
      setStorageStatus(
        t("about.storage.cleared", "Cleared {size} across {count} files.")
          .replace("{size}", formatBytes(result.cleared_bytes))
          .replace("{count}", String(result.cleared_files)),
      );
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
        title={t("about.aboutCard.title", "About Qx")}
        description={t(
          "about.aboutCard.desc",
          "Version, release, and update status.",
        )}
      >
        <Row title="Qx" description="A keyboard-driven productivity launcher for macOS.">
          <span style={{ color: "var(--qx-text-secondary)" }}>v{version || "..."}</span>
        </Row>

        <Row
          title="Latest Release"
          description="Most recent version published on GitHub."
        >
          <span style={{ color: "var(--qx-text-secondary)" }}>
            {latest ?? "Unable to fetch"}
          </span>
        </Row>

        <Row title="Check for Updates" description="Manually check and install an available update.">
          <button
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="qx-command-button primary"
          >
            {checking ? "Checking..." : "Check Now"}
          </button>
        </Row>

        {status && (
          <Row title="Update Status" description={status}>
            <span />
          </Row>
        )}

        <Row title="GitHub Releases" description="View all releases and release notes.">
          <button onClick={handleOpenReleases} className="qx-command-button">
            Open Releases
          </button>
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("about.storage", "Storage")}
        description={t(
          "about.storage.desc",
          "View Qx local storage and clear generated cache or files.",
        )}
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
            <button
              className="qx-command-button"
              onClick={() => void loadStorage()}
              disabled={storageBusy !== null}
            >
              {storageBusy === "refresh" ? t("about.storage.refreshing", "Refreshing...") : t("about.storage.refresh", "Refresh")}
            </button>
            <button
              className="qx-command-button"
              onClick={() => void clearStorage("cache")}
              disabled={storageBusy !== null}
            >
              {storageBusy === "cache" ? t("about.storage.clearing", "Clearing...") : t("about.storage.clearCache", "Clear Cache")}
            </button>
            <button
              className="qx-command-button"
              onClick={() => void clearStorage("clipboard")}
              disabled={storageBusy !== null}
            >
              {storageBusy === "clipboard" ? t("about.storage.clearing", "Clearing...") : t("about.storage.clearClipboard", "Clear Clipboard")}
            </button>
            <button
              className="qx-command-button danger"
              onClick={() => void clearStorage("files")}
              disabled={storageBusy !== null}
            >
              {storageBusy === "files" ? t("about.storage.clearing", "Clearing...") : t("about.storage.clearFiles", "Clear Files")}
            </button>
          </div>

          {storageStatus && <div className="qx-storage-status">{storageStatus}</div>}
          {warnings.length > 0 && (
            <div className="qx-storage-status">
              {t("about.storage.warnings", "Some entries were skipped:")} {warnings.join("; ")}
            </div>
          )}

          <div className="qx-storage-list">
            {(storage?.buckets ?? []).map((bucket) => {
              const label = t(`about.storage.${bucket.id}`, BUCKET_LABELS[bucket.id] ?? bucket.label);
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

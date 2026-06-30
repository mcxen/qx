import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-shell";
import { Row } from "../../components/ui";
import GifText from "../../components/gif-text";
import { useT } from "../../i18n";

interface StorageBucket {
  id: string;
  label: string;
  path: string;
  bytes: number;
  files: number;
  clearable: boolean;
}

interface StorageOverview {
  total_bytes: number;
  buckets: StorageBucket[];
}

interface StorageClearResult {
  cleared_bytes: number;
  cleared_files: number;
}

const BUCKET_LABELS: Record<string, string> = {
  cache: "Cache",
  files: "Files",
  databases: "Databases",
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

export default function AboutPanel() {
  const t = useT();
  const [version, setVersion] = useState<string>("");
  const [latest, setLatest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [storageBusy, setStorageBusy] = useState<"cache" | "files" | "refresh" | null>(null);
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

  const clearStorage = async (kind: "cache" | "files") => {
    const message =
      kind === "cache"
        ? t("about.storage.confirmCache", "Clear reusable caches? App icons and OCR models can be rebuilt or downloaded again.")
        : t("about.storage.confirmFiles", "Delete Qx GIF recordings from the output folder?");
    if (!window.confirm(message)) return;
    try {
      setStorageBusy(kind);
      setStorageStatus("");
      const command = kind === "cache" ? "qx_storage_clear_cache" : "qx_storage_clear_files";
      const result = await invoke<StorageClearResult>(command);
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

  return (
    <div className="qx-settings-page">
      <div className="qx-about-gif-text">
        <GifText
          text="QxSTART"
          gif="https://assets.amarn.me/gif-text.gif"
          containerClassName="qx-about-gif-text-frame"
        />
      </div>

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

      <div className="qx-storage-panel" aria-label={t("about.storage", "Storage")}>
        <div className="qx-storage-header">
          <div>
            <div className="qx-settings-row-title">{t("about.storage", "Storage")}</div>
            <div className="qx-settings-row-description">
              {t("about.storage.desc", "View Qx local storage and clear generated cache or files.")}
            </div>
          </div>
          <div className="qx-storage-total">{formatBytes(totalBytes)}</div>
        </div>

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
            className="qx-command-button danger"
            onClick={() => void clearStorage("files")}
            disabled={storageBusy !== null}
          >
            {storageBusy === "files" ? t("about.storage.clearing", "Clearing...") : t("about.storage.clearFiles", "Clear Files")}
          </button>
        </div>

        {storageStatus && <div className="qx-storage-status">{storageStatus}</div>}

        <div className="qx-storage-list">
          {(storage?.buckets ?? []).map((bucket) => {
            const label = t(`about.storage.${bucket.id}`, BUCKET_LABELS[bucket.id] ?? bucket.label);
            const canOpenPath = bucket.path.startsWith("/");
            return (
              <div className="qx-storage-row" key={bucket.id}>
                <span className={`qx-storage-dot bucket-${bucket.id}`} aria-hidden="true" />
                <div className="qx-storage-copy">
                  <div className="qx-storage-name">{label}</div>
                  <div className="qx-storage-path">{bucket.path}</div>
                </div>
                <div className="qx-storage-meta">
                  <span>{formatBytes(bucket.bytes)}</span>
                  <span>{bucket.files} files</span>
                </div>
                {canOpenPath && (
                  <button className="qx-icon-button" onClick={() => void open(bucket.path)} type="button">
                    Open
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

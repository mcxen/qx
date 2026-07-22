import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { Row, SettingsCard } from "../../components/ui";
import GifText from "../../components/gif-text";
import { useT } from "../../i18n";
import StorageSettingsCard from "./StorageSettingsCard";

const RELEASES_URL = "https://github.com/mcxen/qx/releases";

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

export default function AboutPanel() {
  const t = useT();
  const [version, setVersion] = useState<string>("");
  const [latest, setLatest] = useState<string | null>(null);
  const [latestUrl, setLatestUrl] = useState<string>(RELEASES_URL);
  const [updateInfo, setUpdateInfo] = useState<QxUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<string>("");

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

    const updateTimer = window.setTimeout(() => {
      void loadUpdateInfo(false);
    }, 700);

    return () => {
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

      <StorageSettingsCard />
    </div>
  );
}

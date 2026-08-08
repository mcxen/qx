import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { Button, Row, Select, SettingsCard } from "../../components/ui";
import GifText from "../../components/gif-text";
import { useT } from "../../i18n";
import { useSettingsStore, type GeneralSettings } from "./store";

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
  source: string;
}

/** Immediate ack — download runs in the background until install/restart. */
interface QxUpdateStartResult {
  started: boolean;
  alreadyRunning: boolean;
  message: string;
}

export default function AboutPanel() {
  const t = useT();
  const { settings, patch } = useSettingsStore();
  const updateSource: GeneralSettings["update_source"] =
    settings.general.update_source === "cnb" || settings.general.update_source === "github"
      ? settings.general.update_source
      : "auto";
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
      const info = await invoke<QxUpdateInfo>("qx_update_check", { source: updateSource });
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
  }, []);

  // Silent refresh on mount and whenever the user switches update source.
  useEffect(() => {
    const updateTimer = window.setTimeout(() => {
      void loadUpdateInfo(false);
    }, 400);

    return () => {
      window.clearTimeout(updateTimer);
    };
  }, [updateSource]);

  const handleCheckUpdate = async () => {
    await loadUpdateInfo(true);
  };

  const handleInstallUpdate = async () => {
    // Do not hold Settings/About open on a long invoke — download must not
    // freeze the main app. Progress lives in the floating update window.
    setInstalling(true);
    setStatus("");
    try {
      const result = await invoke<QxUpdateStartResult>("qx_update_download_and_install", {
        source: updateSource,
      });
      setStatus(
        result.message
          || (result.alreadyRunning
            ? t("about.updateAlreadyRunning", "An update is already in progress.")
            : t(
              "about.updateStarted",
              "Download started. Keep using Qx — when ready, click Install & Restart in the progress window.",
            )),
      );
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
            "A keyboard-driven productivity launcher for macOS and Windows.",
          )}
        >
          <span style={{ color: "var(--qx-text-secondary)" }}>v{version || "..."}</span>
        </Row>

        <Row
          title={t("about.updateSource", "Update Source")}
          description={t(
            "about.updateSource.desc",
            "Used by Check for Updates, Download, and Automatic Updates. Automatic compares CNB and GitHub, then uses the newest valid release.",
          )}
        >
          <Select
            value={updateSource}
            onChange={(value) => patch("general", {
              ...settings.general,
              update_source: value as GeneralSettings["update_source"],
            })}
            ariaLabel={t("about.updateSource", "Update Source")}
            options={[
              { value: "auto", label: t("about.updateSource.auto", "Automatic") },
              { value: "cnb", label: t("about.updateSource.cnb", "CNB mirror") },
              { value: "github", label: t("about.updateSource.github", "GitHub") },
            ]}
          />
        </Row>

        <Row
          title={t("about.latestRelease", "Latest Release")}
          description={t(
            "about.latestRelease.desc",
            "Newest version from the selected update source.",
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
              ? t(
                "about.checkUpdates.ready",
                "Download {name}, then Install & Restart when you are ready.",
              ).replace(
                "{name}",
                updateInfo.asset_name ?? t("about.latestRelease", "the latest release"),
              )
              : t("about.checkUpdates.idle", "Check for the latest release from the selected source.")
          }
        >
          <div className="qx-settings-row-actions">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void handleCheckUpdate()}
              disabled={checking || installing}
            >
              {checking
                ? t("about.checking", "Checking...")
                : t("about.checkNow", "Check Now")}
            </Button>
            {updateInfo?.available && updateInfo.can_install && (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleInstallUpdate()}
                disabled={checking || installing}
              >
                {installing
                  ? t("about.downloading", "Downloading...")
                  : t("about.downloadUpdate", "Download Update")}
              </Button>
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
            "View all releases and release notes on GitHub.",
          )}
        >
          <Button type="button" size="sm" variant="secondary" onClick={handleOpenReleases}>
            {t("about.openReleases", "Open Releases")}
          </Button>
        </Row>
      </SettingsCard>
    </div>
  );
}

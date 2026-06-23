import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { open } from "@tauri-apps/plugin-shell";
import { Row } from "../../components/ui";

export default function AboutPanel() {
  const [version, setVersion] = useState<string>("");
  const [latest, setLatest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string>("");

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

  return (
    <div className="qx-settings-page">
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
    </div>
  );
}

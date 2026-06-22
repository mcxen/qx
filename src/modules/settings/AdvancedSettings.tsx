import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="qx-settings-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="qx-settings-row-title">{title}</div>
        {description && (
          <div className="qx-settings-row-description">{description}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: value ? "var(--color-accent)" : "var(--color-surface-active)",
        position: "relative",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
        }}
      />
    </button>
  );
}

export default function AdvancedSettings() {
  const { settings, patch, importFrom, exportTo } = useSettingsStore();
  const adv = settings.advanced;
  const [busy, setBusy] = useState<string | null>(null);
  const [ioPath, setIoPath] = useState("");

  const handleImport = async () => {
    if (!ioPath.trim()) return;
    try {
      setBusy("import");
      await importFrom(ioPath.trim());
      setIoPath("");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    if (!ioPath.trim()) return;
    try {
      setBusy("export");
      await exportTo(ioPath.trim());
      setIoPath("");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const clearCache = async () => {
    try {
      setBusy("clear");
      await invoke("clear_clipboard_history");
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="qx-settings-page">
      <Row title="Log Level" description="Verbosity of the Qx diagnostic log.">
        <select
          value={adv.log_level}
          onChange={(e) => patch("advanced", { ...adv, log_level: e.target.value })}
          className="qx-inline-input"
        >
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
      </Row>
      <Row title="Developer Mode" description="Show DevTools and verbose diagnostics.">
        <Toggle
          value={adv.dev_mode}
          onChange={(v) => patch("advanced", { ...adv, dev_mode: v })}
        />
      </Row>
      <Row
        title="Import / Export Configuration"
        description="Enter an absolute path. Import loads settings from JSON; Export writes current settings to JSON."
      >
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={ioPath}
            onChange={(e) => setIoPath(e.target.value)}
            placeholder="/path/to/qx-settings.json"
            style={{
              width: 220,
            }}
            className="qx-inline-input"
          />
          <button
            onClick={handleImport}
            disabled={busy === "import" || !ioPath.trim()}
            className="qx-command-button"
          >
            {busy === "import" ? "…" : "Import"}
          </button>
          <button
            onClick={handleExport}
            disabled={busy === "export" || !ioPath.trim()}
            className="qx-command-button"
          >
            {busy === "export" ? "…" : "Export"}
          </button>
        </div>
      </Row>
      <Row
        title="Clear Cache & History"
        description="Wipe clipboard history and cached screenshots."
      >
        <button
          onClick={clearCache}
          disabled={busy === "clear"}
          className="qx-command-button danger"
        >
          {busy === "clear" ? "Clearing…" : "Clear"}
        </button>
      </Row>
    </div>
  );
}

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";
import { usePluginRegistry } from "../../plugin/registry";
import { Row, Toggle, Select, Input } from "../../components/ui";
import { useT } from "../../i18n";

export default function AdvancedSettings() {
  const { settings, patch, importFrom, exportTo } = useSettingsStore();
  const { devWatcherActive, startDevWatcher, stopDevWatcher, refresh } = usePluginRegistry();
  const t = useT();
  const adv = settings.advanced;
  const [busy, setBusy] = useState<string | null>(null);
  const [ioPath, setIoPath] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [scaffoldMsg, setScaffoldMsg] = useState("");

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

  const handleScaffold = async () => {
    if (!pluginName.trim()) return;
    try {
      setBusy("scaffold");
      const dir = await invoke<string>("scaffold_plugin", {
        name: pluginName.trim().toLowerCase().replace(/\s+/g, "-"),
        outputDir: "~/.qx/plugins",
      });
      setScaffoldMsg(t("advanced.pluginCreated", "Plugin created at: {path}").replace("{path}", dir));
      setPluginName("");
      await refresh();
    } catch (e) {
      setScaffoldMsg(t("advanced.error", "Error: {message}").replace("{message}", String(e)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="qx-settings-page">
      <Row title={t("advanced.logLevel", "Log Level")} description={t("advanced.logLevel.desc", "Verbosity of the Qx diagnostic log.")}>
        <Select
          value={adv.log_level}
          onChange={(v) => patch("advanced", { ...adv, log_level: v })}
          options={[
            { value: "error", label: t("advanced.log.error", "Error") },
            { value: "warn", label: t("advanced.log.warn", "Warn") },
            { value: "info", label: t("advanced.log.info", "Info") },
            { value: "debug", label: t("advanced.log.debug", "Debug") },
          ]}
        />
      </Row>
      <Row title={t("advanced.devMode", "Developer Mode")} description={t("advanced.devMode.desc", "Show DevTools and verbose diagnostics.")}>
        <Toggle
          value={adv.dev_mode}
          onChange={(v) => patch("advanced", { ...adv, dev_mode: v })}
        />
      </Row>
      <Row
        title={t("advanced.networkProxy", "Network Proxy")}
        description={t("advanced.networkProxy.desc", "Route marketplace index and plugin downloads through an HTTP, HTTPS, or SOCKS proxy.")}
      >
        <Toggle
          value={adv.network_proxy_enabled}
          onChange={(v) => patch("advanced", { ...adv, network_proxy_enabled: v })}
        />
        <div className="qx-settings-input-wrap">
          <Input
            type="text"
            value={adv.network_proxy_url}
            onChange={(e) => patch("advanced", { ...adv, network_proxy_url: e.target.value })}
            placeholder="http://127.0.0.1:7890"
            disabled={!adv.network_proxy_enabled}
          />
        </div>
      </Row>
      <Row
        title={t("advanced.importExport", "Import / Export Configuration")}
        description={t("advanced.importExport.desc", "Enter an absolute path. Import loads settings from JSON; Export writes current settings to JSON.")}
      >
        <div className="qx-settings-input-wrap">
          <Input
            type="text"
            value={ioPath}
            onChange={(e) => setIoPath(e.target.value)}
            placeholder="/path/to/qx-settings.json"
          />
        </div>
        <button
          onClick={handleImport}
          disabled={busy === "import" || !ioPath.trim()}
          className="qx-command-button"
        >
          {busy === "import" ? "…" : t("advanced.import", "Import")}
        </button>
        <button
          onClick={handleExport}
          disabled={busy === "export" || !ioPath.trim()}
          className="qx-command-button"
        >
          {busy === "export" ? "…" : t("advanced.export", "Export")}
        </button>
      </Row>
      <Row
        title={t("advanced.clearCache", "Clear Cache & History")}
        description={t("advanced.clearCache.desc", "Wipe clipboard history and reusable caches.")}
      >
        <button
          onClick={clearCache}
          disabled={busy === "clear"}
          className="qx-command-button danger"
        >
          {busy === "clear" ? t("advanced.clearing", "Clearing…") : t("advanced.clear", "Clear")}
        </button>
      </Row>

      {/* ── Developer Tools ── */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: "var(--qx-text-tertiary)",
          textTransform: "uppercase",
          padding: "16px 0 6px",
          borderTop: "1px solid var(--qx-border-1)",
          marginTop: 12,
        }}
      >
        {t("advanced.developerTools", "Developer Tools")}
      </div>

      <Row
        title={t("advanced.createPlugin", "Create Plugin (qx init)")}
        description={t("advanced.createPlugin.desc", "Generate a new plugin scaffold with manifest.json, index.js, and README.")}
      >
        <div className="qx-settings-input-wrap" style={{ maxWidth: 160 }}>
          <Input
            type="text"
            value={pluginName}
            onChange={(e) => setPluginName(e.target.value)}
            placeholder="my-plugin"
          />
        </div>
        <button
          onClick={handleScaffold}
          disabled={busy === "scaffold" || !pluginName.trim()}
          className="qx-command-button primary"
        >
          {busy === "scaffold" ? t("advanced.creating", "Creating…") : t("advanced.create", "Create")}
        </button>
      </Row>
      {scaffoldMsg && (
        <div
          style={{
            fontSize: 12,
            color: scaffoldMsg.startsWith("Error") ? "var(--qx-danger)" : "var(--qx-text-secondary)",
            padding: "4px 0 8px",
          }}
        >
          {scaffoldMsg}
        </div>
      )}

      <Row
        title={t("advanced.hotReload", "Dev Mode Hot Reload")}
        description={t("advanced.hotReload.desc", "Auto-refresh plugins every 3 seconds while developing.")}
      >
        <button
          onClick={() => (devWatcherActive ? stopDevWatcher() : startDevWatcher())}
          className={`qx-command-button${devWatcherActive ? " danger" : ""}`}
        >
          {devWatcherActive ? t("advanced.stopWatching", "Stop Watching") : t("advanced.startWatching", "Start Watching")}
        </button>
      </Row>

      <Row
        title={t("advanced.reloadPlugins", "Reload Plugins")}
        description={t("advanced.reloadPlugins.desc", "Manually rescan and reload all installed plugins.")}
      >
        <button onClick={() => refresh()} className="qx-command-button">
          {t("advanced.reloadNow", "Reload Now")}
        </button>
      </Row>
    </div>
  );
}

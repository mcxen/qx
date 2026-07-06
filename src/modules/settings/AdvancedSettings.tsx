import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";
import { usePluginRegistry } from "../../plugin/registry";
import { Button, Row, Toggle, Select, Input, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

interface StorageClearResult {
  cleared_bytes: number;
  cleared_files: number;
  cleared_records?: number;
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

export default function AdvancedSettings() {
  const { settings, patch, importFrom, exportTo } = useSettingsStore();
  const { devWatcherActive, startDevWatcher, stopDevWatcher, refresh } = usePluginRegistry();
  const t = useT();
  const adv = settings.advanced;
  const [busy, setBusy] = useState<string | null>(null);
  const [ioPath, setIoPath] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [scaffoldMsg, setScaffoldMsg] = useState("");
  const [clearMsg, setClearMsg] = useState("");

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
    if (
      !window.confirm(
        t(
          "advanced.clearCache.confirm",
          "Clear rebuildable cache plus clipboard, launcher, and RSS history? Generated files, plugins, and settings will remain.",
        ),
      )
    ) {
      return;
    }
    try {
      setBusy("clear");
      setClearMsg("");
      const result = await invoke<StorageClearResult>("qx_storage_clear_reclaimable");
      const parts = [
        result.cleared_bytes > 0 ? formatBytes(result.cleared_bytes) : "",
        result.cleared_files > 0
          ? `${result.cleared_files} ${t("about.storage.files.unit", "files")}`
          : "",
        (result.cleared_records ?? 0) > 0
          ? `${result.cleared_records} ${t("about.storage.records.unit", "records")}`
          : "",
      ].filter(Boolean);
      setClearMsg(
        parts.length > 0
          ? t("about.storage.clearedDetailed", "Cleared {items}.").replace("{items}", parts.join(" / "))
          : t("about.storage.clearedNothing", "Nothing to clear."),
      );
    } catch (e) {
      setClearMsg(t("advanced.error", "Error: {message}").replace("{message}", String(e)));
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
      <SettingsCard
        title={t("advanced.diagnostics.title", "Diagnostics")}
        description={t("advanced.diagnostics.desc", "Tune logging and developer diagnostics for troubleshooting.")}
      >
        <Row
          title={t("advanced.logLevel", "Log Level")}
          description={t("advanced.logLevel.desc", "Verbosity of the Qx diagnostic log.")}
        >
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
        <Row
          title={t("advanced.devMode", "Developer Mode")}
          description={t("advanced.devMode.desc", "Show DevTools and verbose diagnostics.")}
        >
          <Toggle
            value={adv.dev_mode}
            onChange={(v) => patch("advanced", { ...adv, dev_mode: v })}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("advanced.network.title", "Network")}
        description={t("advanced.network.desc", "Configure proxy access for marketplace, plugins, app updates, and network tools.")}
      >
        <Row
          title={t("advanced.networkProxy", "Network Proxy")}
          description={t("advanced.networkProxy.desc", "Route Qx network requests through an HTTP, HTTPS, or SOCKS proxy.")}
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
      </SettingsCard>

      <SettingsCard
        title={t("advanced.config.title", "Configuration Files")}
        description={t("advanced.config.desc", "Import or export the current settings JSON from a trusted local path.")}
      >
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleImport}
            disabled={busy === "import" || !ioPath.trim()}
          >
            {busy === "import" ? "..." : t("advanced.import", "Import")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={busy === "export" || !ioPath.trim()}
          >
            {busy === "export" ? "..." : t("advanced.export", "Export")}
          </Button>
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("advanced.maintenance.title", "Maintenance")}
        description={t("advanced.maintenance.desc", "Clear generated state without removing plugins, files, or user settings.")}
      >
        <Row
          title={t("advanced.clearCache", "Clear Cache & History")}
          description={t("advanced.clearCache.desc", "Wipe clipboard history and reusable caches.")}
        >
          <Button
            variant="destructive"
            size="sm"
            onClick={clearCache}
            disabled={busy === "clear"}
          >
            {busy === "clear" ? t("advanced.clearing", "Clearing...") : t("advanced.clear", "Clear")}
          </Button>
        </Row>
        {clearMsg && (
          <div className="qx-settings-inline-status">
            {clearMsg}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("advanced.developerTools", "Developer Tools")}
        description={t("advanced.developerTools.desc", "Create, reload, and watch local plugin projects while building extensions.")}
      >
        <Row
          title={t("advanced.createPlugin", "Create Plugin (qx init)")}
          description={t("advanced.createPlugin.desc", "Generate a new plugin scaffold with manifest.json, index.js, and README.")}
        >
          <div className="qx-settings-input-wrap qx-settings-input-wrap--narrow">
            <Input
              type="text"
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              placeholder="my-plugin"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleScaffold}
            disabled={busy === "scaffold" || !pluginName.trim()}
          >
            {busy === "scaffold" ? t("advanced.creating", "Creating...") : t("advanced.create", "Create")}
          </Button>
        </Row>
        {scaffoldMsg && (
          <div className={`qx-settings-inline-status${scaffoldMsg.startsWith("Error") ? " is-danger" : ""}`}>
            {scaffoldMsg}
          </div>
        )}

        <Row
          title={t("advanced.hotReload", "Dev Mode Hot Reload")}
          description={t("advanced.hotReload.desc", "Auto-refresh plugins every 3 seconds while developing.")}
        >
          <Button
            type="button"
            variant={devWatcherActive ? "destructive" : "secondary"}
            size="sm"
            onClick={() => (devWatcherActive ? stopDevWatcher() : startDevWatcher())}
          >
            {devWatcherActive ? t("advanced.stopWatching", "Stop Watching") : t("advanced.startWatching", "Start Watching")}
          </Button>
        </Row>

        <Row
          title={t("advanced.reloadPlugins", "Reload Plugins")}
          description={t("advanced.reloadPlugins.desc", "Manually rescan and reload all installed plugins.")}
        >
          <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>
            {t("advanced.reloadNow", "Reload Now")}
          </Button>
        </Row>
      </SettingsCard>
    </div>
  );
}

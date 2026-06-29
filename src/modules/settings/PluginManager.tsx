import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Download,
  ExternalLink,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { usePluginRegistry } from "../../plugin/registry";
import { BUILTIN_SETTINGS_KEYS } from "../../plugin/builtin";
import { useSettingsStore } from "./store";
import { LoadingLabel, Skeleton, Toggle, SegmentedControl, Row, Select } from "../../components/ui";
import { useT } from "../../i18n";
import type {
  InstalledPlugin,
  PluginIndexEntry,
  PluginPreference,
} from "../../plugin/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Tab = "installed" | "browse";
type InstalledFilter = "all" | "builtin" | "external" | "enabled" | "disabled";
type StatusTone = "success" | "danger" | "neutral";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const isBuiltin = (p: InstalledPlugin) => p.id.startsWith("builtin:");
const normalizeSearch = (value: string) => value.trim().toLowerCase();

function pluginMatchesQuery(plugin: InstalledPlugin, query: string) {
  if (!query) return true;
  return [
    plugin.id,
    plugin.name,
    plugin.version,
    plugin.author,
    plugin.description,
    ...(plugin.manifest?.keywords ?? []),
    ...(plugin.manifest?.permissions ?? plugin.permissions ?? []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function marketplaceEntryMatchesQuery(entry: PluginIndexEntry, query: string) {
  if (!query) return true;
  return [
    entry.id,
    entry.name,
    entry.version,
    entry.author,
    entry.description,
    entry.min_app_version,
    ...(entry.required_permissions ?? []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="qx-badge">{children}</span>;
}

function StatusMessage({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return <div className={`qx-plugin-status is-${tone}`}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Preference form field                                              */
/* ------------------------------------------------------------------ */

function PreferenceField({
  pref,
  value,
  onChange,
}: {
  pref: PluginPreference;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  switch (pref.type) {
    case "boolean":
      return (
        <Toggle
          value={Boolean(value)}
          onChange={(v) => onChange(v)}
        />
      );

    case "select":
      return (
        <Select
          value={String(value ?? "")}
          options={pref.options ?? []}
          ariaLabel={pref.label}
          className="qx-inline-select"
          onChange={(next) => onChange(next)}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className="qx-inline-input"
          style={{ width: 100 }}
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );

    case "password":
      return (
        <input
          type="password"
          className="qx-inline-input"
          style={{ width: 200 }}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default: // "string"
      return (
        <input
          type="text"
          className="qx-inline-input"
          style={{ width: 200 }}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Plugin detail panel                                                */
/* ------------------------------------------------------------------ */

function PluginDetail({
  plugin,
  onToggle,
  onUninstall,
}: {
  plugin: InstalledPlugin;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  const builtin = isBuiltin(plugin);
  const preferences = plugin.manifest?.preferences ?? [];
  const permissions = plugin.manifest?.permissions ?? plugin.permissions ?? [];
  const settingsKey = builtin ? BUILTIN_SETTINGS_KEYS[plugin.id] : undefined;
  const { settings, patch } = useSettingsStore();

  /* ---- preference values ---- */
  const [prefValues, setPrefValues] = useState<Record<string, string | number | boolean>>({});
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const prefValuesRef = useRef<Record<string, string | number | boolean>>({});
  const loadTokenRef = useRef(0);

  // Compute defaults from preference definitions.
  const computeDefaults = useCallback(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const p of preferences) {
      defaults[p.id] = p.default ?? (p.type === "boolean" ? false : p.type === "number" ? 0 : "");
    }
    return defaults;
  }, [preferences]);

  // Load preferences whenever the selected plugin changes.
  useEffect(() => {
    if (preferences.length === 0) {
      setPrefValues({});
      prefValuesRef.current = {};
      setPrefsLoaded(true);
      return;
    }

    const token = ++loadTokenRef.current;
    setPrefsLoaded(false);
    const defaults = computeDefaults();

    if (settingsKey) {
      // Built-in module: read from global settings store.
      const storeSection = (settings as unknown as Record<string, Record<string, unknown>>)[settingsKey] ?? {};
      const next: Record<string, string | number | boolean> = {};
      for (const p of preferences) {
        next[p.id] = (storeSection[p.id] as string | number | boolean) ?? defaults[p.id];
      }
      if (token !== loadTokenRef.current) return;
      prefValuesRef.current = next;
      setPrefValues(next);
      setPrefsLoaded(true);
      return;
    }

    // External plugin: read from plugin_preferences_get.
    (async () => {
      try {
        const saved = await invoke<Record<string, string | number | boolean>>(
          "plugin_preferences_get",
          { id: plugin.id },
        );
        if (token !== loadTokenRef.current) return;
        const next = { ...defaults, ...saved };
        prefValuesRef.current = next;
        setPrefValues(next);
      } catch {
        if (token !== loadTokenRef.current) return;
        prefValuesRef.current = defaults;
        setPrefValues(defaults);
      } finally {
        if (token === loadTokenRef.current) setPrefsLoaded(true);
      }
    })();
  }, [plugin.id, settingsKey, settings, computeDefaults]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrefChange = useCallback(
    async (prefId: string, value: string | number | boolean) => {
      const next = { ...prefValuesRef.current, [prefId]: value };
      prefValuesRef.current = next;
      setPrefValues(next);
      setPrefsBusy(true);

      if (settingsKey) {
        // Built-in module: write to global settings store.
        const storeSection = (settings as unknown as Record<string, Record<string, unknown>>)[settingsKey] ?? {};
        patch(settingsKey as any, { ...storeSection, [prefId]: value });
        setPrefsBusy(false);
        return;
      }

      // External plugin: write to plugin_preferences_set.
      try {
        await invoke("plugin_preferences_set", { id: plugin.id, values: next });
      } catch (err) {
        console.error("Failed to save preference", err);
      } finally {
        setPrefsBusy(false);
      }
    },
    [plugin.id, settingsKey, settings, patch],
  );

  return (
    <div className="qx-plugin-detail-panel">
      {/* Header */}
      <div className="qx-plugin-detail-title">
        {plugin.name}
      </div>

      <div className="qx-plugin-badges">
        <Badge>v{plugin.version}</Badge>
        {builtin ? <Badge>Built-in</Badge> : <Badge>External</Badge>}
        <Badge>{plugin.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      {/* Author */}
      {plugin.author && (
        <div className="qx-plugin-meta">
          by {plugin.author}
        </div>
      )}

      {/* Description */}
      {plugin.description && (
        <div className="qx-plugin-description">
          {plugin.description}
        </div>
      )}

      {/* Path */}
      <div className="qx-plugin-path">
        {plugin.path}
      </div>

      {/* Enable / Disable */}
      <div style={{ marginTop: 12 }}>
        <Row title="Enabled" description={builtin ? "Built-in modules are always enabled." : "Toggle this plugin on or off."}>
          <Toggle value={plugin.enabled} onChange={onToggle} disabled={builtin} />
        </Row>
      </div>

      {/* Permissions */}
      {permissions.length > 0 && (
        <div className="qx-plugin-section">
          <div className="qx-plugin-section-title">Permissions</div>
          <ul className="qx-plugin-permissions">
            {permissions.map((perm) => (
              <li key={perm}>{perm}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Preferences */}
      {preferences.length > 0 && prefsLoaded && (
        <div className="qx-plugin-section">
          <div className="qx-plugin-section-title">
            Preferences
            {prefsBusy && (
              <span className="qx-plugin-saving">
                Saving...
              </span>
            )}
          </div>
          {preferences.map((pref) => (
            <Row
              key={pref.id}
              title={pref.label}
              description={pref.description}
            >
              <PreferenceField
                pref={pref}
                value={prefValues[pref.id] ?? pref.default ?? ""}
                onChange={(v) => handlePrefChange(pref.id, v)}
              />
            </Row>
          ))}

          {/* V2EX token link */}
          {settingsKey === "v2ex" && (
            <button
              className="qx-command-button"
              onClick={() => void openUrl("https://v2ex.com/settings/tokens")}
              type="button"
            >
              <ExternalLink size={13} aria-hidden="true" />
              Get Token
            </button>
          )}
        </div>
      )}

      {/* Uninstall */}
      {!builtin && (
        <button
          className="qx-command-button danger"
          onClick={onUninstall}
        >
          <Trash2 size={13} aria-hidden="true" />
          Uninstall
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Marketplace / Browse tab                                           */
/* ------------------------------------------------------------------ */

function MarketplaceTab({
  installedIds,
  onInstallComplete,
}: {
  installedIds: Set<string>;
  onInstallComplete: () => void;
}) {
  const [entries, setEntries] = useState<PluginIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<{ tone: StatusTone; message: string } | null>(null);

  const filteredEntries = useMemo(() => {
    const q = normalizeSearch(searchQuery);
    return entries.filter((entry) => marketplaceEntryMatchesQuery(entry, q));
  }, [entries, searchQuery]);

  const selectedEntry = useMemo(() => {
    if (selectedId) {
      const selected = filteredEntries.find((entry) => entry.id === selectedId);
      if (selected) return selected;
    }
    return filteredEntries[0] ?? null;
  }, [filteredEntries, selectedId]);

  const fetchIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInstallStatus(null);
    try {
      const index = await invoke<{ schema_version: number; plugins: PluginIndexEntry[] }>(
        "fetch_plugin_index",
      );
      setEntries(index.plugins);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIndex();
  }, [fetchIndex]);

  const handleInstall = async (entry: PluginIndexEntry) => {
    setInstallingId(entry.id);
    setInstallStatus(null);
    try {
      const result = await invoke<{ path: string }>("download_plugin", {
        url: entry.download_url,
      });
      await invoke("install_plugin", { path: result.path });
      onInstallComplete();
      setInstallStatus({ tone: "success", message: `${entry.name} installed.` });
    } catch (err) {
      console.error("Marketplace install failed", err);
      setInstallStatus({ tone: "danger", message: `Install failed: ${String(err)}` });
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) {
    return (
      <div className="qx-marketplace">
        <div className="qx-skeleton-stack" aria-label="Loading marketplace">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="qx-skeleton-row" key={index}>
              <Skeleton className="qx-skeleton-icon" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton className="qx-skeleton-line long" />
                <Skeleton className="qx-skeleton-line medium" style={{ marginTop: 8 }} />
              </div>
              <Skeleton className="qx-skeleton-line short" style={{ width: 56 }} />
            </div>
          ))}
        </div>
        <div className="qx-empty-state">
          <LoadingLabel>Loading marketplace...</LoadingLabel>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="qx-empty-state">
        <div>Failed to load marketplace.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>{error}</div>
        <button className="qx-command-button" onClick={fetchIndex} style={{ marginTop: 8 }}>
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="qx-empty-state">No plugins available in the marketplace.</div>;
  }

  return (
    <div className="qx-marketplace">
      {/* Search input */}
      <div className="qx-plugin-list-toolbar">
        <div className="qx-plugin-search-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search marketplace plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="qx-inline-input"
          />
        </div>
        <button className="qx-command-button" onClick={fetchIndex} disabled={loading}>
          {loading ? <LoadingLabel>Refresh</LoadingLabel> : (
            <>
              <RefreshCw size={13} aria-hidden="true" />
              Refresh
            </>
          )}
        </button>
      </div>

      {installStatus && <StatusMessage tone={installStatus.tone}>{installStatus.message}</StatusMessage>}

      <div className="qx-plugin-library-body">
        <div className="qx-plugin-library-list">
          {filteredEntries.length === 0 && searchQuery.trim() ? (
            <div className="qx-empty-state">No plugins match "{searchQuery}"</div>
          ) : (
            filteredEntries.map((entry) => {
              const active = entry.id === selectedEntry?.id;
              const alreadyInstalled = installedIds.has(entry.id);
              const installing = installingId === entry.id;

              return (
                <button
                  key={entry.id}
                  className={`qx-plugin-library-item${active ? " is-active" : ""}`}
                  onClick={() => setSelectedId(entry.id)}
                  type="button"
                >
                  <div className="qx-plugin-list-main">
                    <div className="qx-plugin-list-title">{entry.name}</div>
                    <div className="qx-plugin-list-meta">
                      v{entry.version}
                      {entry.author ? ` · ${entry.author}` : ""}
                      {entry.size_bytes ? ` · ${formatBytes(entry.size_bytes)}` : ""}
                    </div>
                    {entry.description && (
                      <div className="qx-plugin-list-desc">{entry.description}</div>
                    )}
                  </div>
                  {alreadyInstalled && <PackageCheck size={14} aria-label="Installed" />}
                  {installing && <Download className="qx-loading-spinner" size={14} aria-label="Installing" />}
                </button>
              );
            })
          )}
        </div>

        <div className="qx-plugin-library-detail">
          {selectedEntry ? (
            <>
              <div className="qx-plugin-detail-title">{selectedEntry.name}</div>
              <div className="qx-plugin-badges">
                <Badge>v{selectedEntry.version}</Badge>
                {selectedEntry.author && <Badge>{selectedEntry.author}</Badge>}
                {selectedEntry.size_bytes && <Badge>{formatBytes(selectedEntry.size_bytes)}</Badge>}
              </div>
              {selectedEntry.description && (
                <div className="qx-plugin-description">{selectedEntry.description}</div>
              )}
              <div className="qx-plugin-section">
                <div className="qx-plugin-section-title">Install</div>
                <button
                  className="qx-command-button primary"
                  disabled={installedIds.has(selectedEntry.id) || installingId === selectedEntry.id}
                  onClick={() => handleInstall(selectedEntry)}
                >
                  {installedIds.has(selectedEntry.id) ? (
                    <PackageCheck size={13} aria-hidden="true" />
                  ) : installingId === selectedEntry.id ? (
                    <Download className="qx-loading-spinner" size={13} aria-hidden="true" />
                  ) : (
                    <PackagePlus size={13} aria-hidden="true" />
                  )}
                  {installedIds.has(selectedEntry.id)
                    ? "Installed"
                    : installingId === selectedEntry.id
                      ? "Installing..."
                      : "Install"}
                </button>
              </div>
              {selectedEntry.required_permissions && selectedEntry.required_permissions.length > 0 && (
                <div className="qx-plugin-section">
                  <div className="qx-plugin-section-title">Required permissions</div>
                  <div className="qx-plugin-badges">
                    {selectedEntry.required_permissions.map((p) => (
                      <Badge key={p}>{p}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {(selectedEntry.updated_at || selectedEntry.min_app_version || selectedEntry.checksum_sha256) && (
                <div className="qx-plugin-section">
                  <div className="qx-plugin-section-title">Metadata</div>
                  <div className="qx-plugin-info-grid">
                    {selectedEntry.updated_at && (
                      <>
                        <span>Updated</span>
                        <span>{formatDate(selectedEntry.updated_at)}</span>
                      </>
                    )}
                    {selectedEntry.min_app_version && (
                      <>
                        <span>Min Qx</span>
                        <span>{selectedEntry.min_app_version}</span>
                      </>
                    )}
                    {selectedEntry.checksum_sha256 && (
                      <>
                        <span>SHA256</span>
                        <span>{selectedEntry.checksum_sha256}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="qx-empty-state">Select a plugin to view details</div>
          )}
        </div>
      </div>
    </div>
  );
}

function filterInstalledPlugin(plugin: InstalledPlugin, filter: InstalledFilter) {
  switch (filter) {
    case "builtin":
      return isBuiltin(plugin);
    case "external":
      return !isBuiltin(plugin);
    case "enabled":
      return plugin.enabled;
    case "disabled":
      return !plugin.enabled;
    default:
      return true;
  }
}

function InstalledPluginRow({
  plugin,
  active,
  onSelect,
  onToggle,
}: {
  plugin: InstalledPlugin;
  active: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`qx-plugin-library-item${active ? " is-active" : ""}`}
      type="button"
    >
      <div className="qx-plugin-list-main">
        <div className="qx-plugin-list-title">{plugin.name}</div>
        <div className="qx-plugin-list-meta">
          v{plugin.version}
          {isBuiltin(plugin) ? " · Built-in" : plugin.author ? ` · ${plugin.author}` : ""}
        </div>
        {plugin.description && <div className="qx-plugin-list-desc">{plugin.description}</div>}
      </div>
      <span onClick={(e) => e.stopPropagation()}>
        <Toggle
          value={plugin.enabled}
          onChange={onToggle}
          disabled={isBuiltin(plugin)}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main PluginManager                                                 */
/* ------------------------------------------------------------------ */

export default function PluginManager() {
  const t = useT();
  const { plugins, install, uninstall, setEnabled, refresh, loaded, loading } =
    usePluginRegistry();
  const [tab, setTab] = useState<Tab>("installed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archivePath, setArchivePath] = useState("");
  const [archiveUrl, setArchiveUrl] = useState("");
  const [raycastUrl, setRaycastUrl] = useState("");
  const [busy, setBusy] = useState<"path" | "url" | "raycast" | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");
  const [importExpanded, setImportExpanded] = useState(false);

  /* Keep selection valid when the plugin list changes. */
  useEffect(() => {
    if (!selectedId && plugins.length > 0) {
      setSelectedId(plugins[0].id);
      return;
    }
    if (selectedId && !plugins.find((p) => p.id === selectedId)) {
      setSelectedId(plugins[0]?.id ?? null);
    }
  }, [plugins, selectedId]);

  /* Trigger a load if the registry hasn't been populated yet. */
  useEffect(() => {
    if (!loaded && !loading) {
      void refresh();
    }
  }, [loaded, loading, refresh]);

  /* ---- actions ---- */

  const handleInstallFromPath = async () => {
    const trimmed = archivePath.trim();
    if (!trimmed) return;
    setBusy("path");
    setInstallStatus(null);
    try {
      await install(trimmed);
      setArchivePath("");
      setInstallStatus(t("plugins.installComplete", "Plugin installed."));
    } catch (err) {
      console.error("Plugin install failed", err);
      setInstallStatus(t("plugins.installFailed", "Install failed: {message}").replace("{message}", String(err)));
    } finally {
      setBusy(null);
    }
  };

  const handleInstallFromUrl = async () => {
    const trimmed = archiveUrl.trim();
    if (!trimmed) return;
    setBusy("url");
    setInstallStatus(null);
    try {
      await invoke("install_plugin_from_url", { url: trimmed });
      await refresh();
      setArchiveUrl("");
      setInstallStatus(t("plugins.installComplete", "Plugin installed."));
    } catch (err) {
      console.error("Plugin URL install failed", err);
      setInstallStatus(t("plugins.installFailed", "Install failed: {message}").replace("{message}", String(err)));
    } finally {
      setBusy(null);
    }
  };

  const handleInstallFromRaycast = async () => {
    const trimmed = raycastUrl.trim();
    if (!trimmed) return;
    setBusy("raycast");
    setInstallStatus(null);
    try {
      await invoke("install_raycast_extension_from_url", { url: trimmed });
      await refresh();
      setRaycastUrl("");
      setInstallStatus(t("plugins.installComplete", "Plugin installed."));
    } catch (err) {
      console.error("Raycast extension install failed", err);
      setInstallStatus(t("plugins.installFailed", "Install failed: {message}").replace("{message}", String(err)));
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (plugin: InstalledPlugin) => {
    try {
      await setEnabled(plugin.id, !plugin.enabled);
    } catch (err) {
      console.error("Toggle failed", err);
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      await uninstall(id);
    } catch (err) {
      console.error("Uninstall failed", err);
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh();
    } catch (err) {
      console.error("Rescan failed", err);
    }
  };

  /* ---- derived ---- */

  const selected = plugins.find((p) => p.id === selectedId) ?? null;
  const installedIds = new Set(plugins.map((p) => p.id));
  const filteredPlugins = useMemo(() => {
    const q = normalizeSearch(installedQuery);
    return plugins.filter((plugin) => filterInstalledPlugin(plugin, installedFilter) && pluginMatchesQuery(plugin, q));
  }, [plugins, installedFilter, installedQuery]);
  const selectedPlugin = filteredPlugins.find((p) => p.id === selected?.id) ?? filteredPlugins[0] ?? null;

  /* ---- render ---- */

  return (
    <div className="qx-plugin-manager">
      {/* Top bar: tab switcher + actions */}
      <div className="qx-plugin-manager-top">
        <div className="qx-plugin-manager-actions">
          <SegmentedControl
            value={tab}
            options={[
              { value: "installed", label: "Installed" },
              { value: "browse", label: "Browse" },
            ]}
            onChange={setTab}
          />
          <button className="qx-command-button" onClick={handleRefresh} title="Rescan plugins">
            <RefreshCw size={13} aria-hidden="true" />
            Rescan
          </button>
        </div>

        {/* Install-from-path row (only on Installed tab) */}
        {tab === "installed" && (
          <div className="qx-plugin-import-box">
            <button
              type="button"
              className="qx-plugin-import-header"
              onClick={() => setImportExpanded((v) => !v)}
              aria-expanded={importExpanded}
            >
              <ChevronRight
                size={14}
                className={`qx-plugin-import-chevron${importExpanded ? " is-open" : ""}`}
                aria-hidden="true"
              />
              <div className="qx-plugin-import-copy">
                <div className="qx-plugin-import-title">
                  {t("plugins.importArchive", "Import Plugin Archive")}
                </div>
                <div className="qx-plugin-import-desc">
                  {t(
                    "plugins.importArchive.desc",
                    "Install a .zip or .qx-plugin package from disk, or paste a GitHub release/source archive URL.",
                  )}
                </div>
              </div>
            </button>
            {importExpanded && (
              <>
                <div className="qx-plugin-import-row">
                  <input
                    type="text"
                    value={archivePath}
                    onChange={(e) => setArchivePath(e.target.value)}
                    placeholder={t("plugins.localArchive.placeholder", "Local archive path, e.g. ~/Downloads/plugin.zip")}
                    className="qx-inline-input"
                  />
                  <button
                    className="qx-command-button"
                    onClick={handleInstallFromPath}
                    disabled={busy !== null || !archivePath.trim()}
                  >
                    {busy === "path" ? t("plugins.installing", "Installing...") : t("plugins.installLocal", "Install Local")}
                  </button>
                </div>
                <div className="qx-plugin-import-row">
                  <input
                    type="url"
                    value={archiveUrl}
                    onChange={(e) => setArchiveUrl(e.target.value)}
                    placeholder={t("plugins.githubArchive.placeholder", "GitHub repo, release asset, or archive ZIP URL")}
                    className="qx-inline-input"
                  />
                  <button
                    className="qx-command-button"
                    onClick={handleInstallFromUrl}
                    disabled={busy !== null || !archiveUrl.trim()}
                  >
                    {busy === "url" ? t("plugins.downloading", "Downloading...") : t("plugins.installUrl", "Install URL")}
                  </button>
                </div>
                <div className="qx-plugin-import-row">
                  <input
                    type="url"
                    value={raycastUrl}
                    onChange={(e) => setRaycastUrl(e.target.value)}
                    placeholder="Raycast extension URL, e.g. https://github.com/raycast/extensions/tree/<ref>/extensions/system-information"
                    className="qx-inline-input"
                  />
                  <button
                    className="qx-command-button"
                    onClick={handleInstallFromRaycast}
                    disabled={busy !== null || !raycastUrl.trim()}
                  >
                    {busy === "raycast" ? "Converting..." : "Install Raycast"}
                  </button>
                </div>
                {installStatus && <div className="qx-plugin-import-status">{installStatus}</div>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Content area */}
      {tab === "installed" ? (
        <div className="qx-marketplace">
          <div className="qx-plugin-list-toolbar">
            <div className="qx-plugin-search-wrap">
              <Search size={14} aria-hidden="true" />
              <input
                type="text"
                value={installedQuery}
                onChange={(e) => setInstalledQuery(e.target.value)}
                placeholder="Search installed plugins..."
                className="qx-inline-input"
              />
            </div>
            <SegmentedControl
              value={installedFilter}
              options={[
                { value: "all", label: "All" },
                { value: "builtin", label: "Built-in" },
                { value: "external", label: "External" },
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" },
              ]}
              onChange={setInstalledFilter}
            />
          </div>
          <div className="qx-plugin-library-body">
          {/* Plugin list */}
          <div className="qx-plugin-library-list">
            {filteredPlugins.map((p) => (
              <InstalledPluginRow
                key={p.id}
                plugin={p}
                active={p.id === selectedPlugin?.id}
                onSelect={() => setSelectedId(p.id)}
                onToggle={() => handleToggle(p)}
              />
            ))}
            {plugins.length === 0 ? (
              <div className="qx-empty-state">No plugins installed</div>
            ) : filteredPlugins.length === 0 && (
              <div className="qx-empty-state">
                No plugins match "{installedQuery || installedFilter}"
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="qx-plugin-library-detail">
            {selectedPlugin ? (
              <PluginDetail
                plugin={selectedPlugin}
                onToggle={() => handleToggle(selectedPlugin)}
                onUninstall={() => handleUninstall(selectedPlugin.id)}
              />
            ) : (
              <div className="qx-empty-state">Select a plugin to view details</div>
            )}
          </div>
          </div>
        </div>
      ) : (
        <MarketplaceTab
          installedIds={installedIds}
          onInstallComplete={handleRefresh}
        />
      )}
    </div>
  );
}

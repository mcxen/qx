import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePluginRegistry } from "../../plugin/registry";
import { Toggle, SegmentedControl, Row, Select } from "../../components/ui";
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const isBuiltin = (p: InstalledPlugin) => p.id.startsWith("builtin:");

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="qx-badge">{children}</span>;
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

  /* ---- preference values ---- */
  const [prefValues, setPrefValues] = useState<Record<string, string | number | boolean>>({});
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const prefValuesRef = useRef<Record<string, string | number | boolean>>({});
  const loadTokenRef = useRef(0);

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

    (async () => {
      try {
        const saved = await invoke<Record<string, string | number | boolean>>(
          "plugin_preferences_get",
          { id: plugin.id },
        );
        if (token !== loadTokenRef.current) return; // stale
        // Merge saved values over defaults.
        const defaults: Record<string, string | number | boolean> = {};
        for (const p of preferences) {
          defaults[p.id] = p.default ?? (p.type === "boolean" ? false : p.type === "number" ? 0 : "");
        }
        const next = { ...defaults, ...saved };
        prefValuesRef.current = next;
        setPrefValues(next);
      } catch {
        if (token !== loadTokenRef.current) return;
        // Fall back to defaults.
        const defaults: Record<string, string | number | boolean> = {};
        for (const p of preferences) {
          defaults[p.id] = p.default ?? (p.type === "boolean" ? false : p.type === "number" ? 0 : "");
        }
        prefValuesRef.current = defaults;
        setPrefValues(defaults);
      } finally {
        if (token === loadTokenRef.current) setPrefsLoaded(true);
      }
    })();
  }, [plugin.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrefChange = useCallback(
    async (prefId: string, value: string | number | boolean) => {
      const next = { ...prefValuesRef.current, [prefId]: value };
      prefValuesRef.current = next;
      setPrefValues(next);
      setPrefsBusy(true);
      try {
        await invoke("plugin_preferences_set", { id: plugin.id, values: next });
      } catch (err) {
        console.error("Failed to save preference", err);
      } finally {
        setPrefsBusy(false);
      }
    },
    [plugin.id],
  );

  return (
    <div style={{ padding: 10, overflowY: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--qx-text-primary)" }}>
        {plugin.name}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <Badge>v{plugin.version}</Badge>
        {builtin ? <Badge>Built-in</Badge> : <Badge>External</Badge>}
        <Badge>{plugin.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      {/* Author */}
      {plugin.author && (
        <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)", marginTop: 6 }}>
          by {plugin.author}
        </div>
      )}

      {/* Description */}
      {plugin.description && (
        <div
          style={{
            fontSize: 13,
            color: "var(--qx-text-secondary)",
            marginTop: 8,
            lineHeight: 1.4,
          }}
        >
          {plugin.description}
        </div>
      )}

      {/* Path */}
      <div
        style={{
          fontSize: 11,
          color: "var(--qx-text-tertiary)",
          marginTop: 8,
          fontFamily: "var(--qx-font-mono)",
          wordBreak: "break-all",
        }}
      >
        {plugin.path}
      </div>

      {/* Enable / Disable */}
      <div style={{ marginTop: 12 }}>
        <Row title="Enabled" description="Toggle this plugin on or off.">
          <Toggle value={plugin.enabled} onChange={onToggle} />
        </Row>
      </div>

      {/* Permissions */}
      {permissions.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--qx-text-secondary)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Permissions</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {permissions.map((perm) => (
              <li key={perm}>{perm}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Preferences */}
      {preferences.length > 0 && prefsLoaded && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 12,
              color: "var(--qx-text-secondary)",
              marginBottom: 6,
            }}
          >
            Preferences
            {prefsBusy && (
              <span
                style={{
                  fontWeight: 400,
                  fontSize: 11,
                  color: "var(--qx-text-tertiary)",
                  marginLeft: 6,
                }}
              >
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
        </div>
      )}

      {/* Uninstall */}
      {!builtin && (
        <button
          className="qx-command-button danger"
          onClick={onUninstall}
          style={{ marginTop: 12 }}
        >
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

  const fetchIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    try {
      const result = await invoke<{ path: string }>("download_plugin", {
        url: entry.download_url,
      });
      await invoke("install_plugin", { path: result.path });
      onInstallComplete();
    } catch (err) {
      console.error("Marketplace install failed", err);
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) {
    return <div className="qx-empty-state">Loading marketplace...</div>;
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
    <div style={{ overflowY: "auto", flex: 1 }}>
      {/* Search input */}
      <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--qx-border-1)" }}>
        <input
          type="text"
          placeholder="Search marketplace plugins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid var(--qx-border-2)",
            background: "var(--qx-bg-component-2)",
            color: "var(--qx-text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
      </div>
      {(() => {
        const filtered = entries
          .filter((entry) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            return (
              entry.name.toLowerCase().includes(q) ||
              entry.id.toLowerCase().includes(q) ||
              (entry.description && entry.description.toLowerCase().includes(q)) ||
              (entry.author && entry.author.toLowerCase().includes(q))
            );
          });
        if (filtered.length === 0 && searchQuery.trim()) {
          return (
            <div className="qx-empty-state" style={{ padding: 24, textAlign: "center" }}>
              No plugins match "{searchQuery}"
            </div>
          );
        }
        return filtered.map((entry) => {
        const alreadyInstalled = installedIds.has(entry.id);
        const installing = installingId === entry.id;

        return (
          <div
            key={entry.id}
            className="qx-settings-row"
            style={{ gap: 8, alignItems: "flex-start" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--qx-text-primary)" }}>
                {entry.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--qx-text-tertiary)", marginTop: 2 }}>
                v{entry.version}
                {entry.author ? ` · ${entry.author}` : ""}
                {entry.size_bytes
                  ? ` · ${(entry.size_bytes / 1024).toFixed(0)} KB`
                  : ""}
              </div>
              {entry.description && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--qx-text-secondary)",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  {entry.description}
                </div>
              )}
              {entry.required_permissions && entry.required_permissions.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                    marginTop: 4,
                  }}
                >
                  {entry.required_permissions.map((p) => (
                    <Badge key={p}>{p}</Badge>
                  ))}
                </div>
              )}
            </div>
            <button
              className="qx-command-button"
              disabled={alreadyInstalled || installing}
              onClick={() => handleInstall(entry)}
              style={{ flexShrink: 0 }}
            >
              {alreadyInstalled ? "Installed" : installing ? "Installing..." : "Install"}
            </button>
          </div>
        );
      });
    })()}
    </div>
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

  /* ---- render ---- */

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Top bar: tab switcher + actions */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--qx-border-1)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SegmentedControl
            value={tab}
            options={[
              { value: "installed", label: "Installed" },
              { value: "browse", label: "Browse" },
            ]}
            onChange={setTab}
          />
          <div style={{ flex: 1 }} />
          <button className="qx-command-button" onClick={handleRefresh} title="Rescan plugins">
            Rescan
          </button>
        </div>

        {/* Install-from-path row (only on Installed tab) */}
        {tab === "installed" && (
          <div className="qx-plugin-import-box">
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
          </div>
        )}
      </div>

      {/* Content area */}
      {tab === "installed" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Plugin list */}
          <div
            style={{ flex: 1, overflowY: "auto", borderRight: "1px solid var(--qx-border-1)" }}
          >
            {plugins.map((p) => {
              const active = p.id === selectedId;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`qx-settings-nav-item${active ? " is-active" : ""}`}
                  style={{ borderBottom: "1px solid var(--qx-border-1)" }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--qx-text-primary)",
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--qx-text-tertiary)",
                        marginTop: 2,
                      }}
                    >
                      v{p.version}
                      {isBuiltin(p) ? " · Built-in" : ""}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Toggle value={p.enabled} onChange={() => handleToggle(p)} />
                  </div>
                </div>
              );
            })}
            {plugins.length === 0 && (
              <div className="qx-empty-state">No plugins installed</div>
            )}
          </div>

          {/* Detail panel */}
          <div style={{ width: 280, flexShrink: 0, overflowY: "auto" }}>
            {selected ? (
              <PluginDetail
                plugin={selected}
                onToggle={() => handleToggle(selected)}
                onUninstall={() => handleUninstall(selected.id)}
              />
            ) : (
              <div className="qx-empty-state">Select a plugin to view details</div>
            )}
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

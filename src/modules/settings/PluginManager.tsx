import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  ChevronRight,
  Clipboard,
  CloudSun,
  Command,
  Download,
  ExternalLink,
  FileText,
  Keyboard,
  MessageCircle,
  MonitorPlay,
  PackageCheck,
  PackagePlus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Rss,
  Search,
  Trash2,
} from "lucide-react";
import { usePluginRegistry } from "../../plugin/registry";
import { resolvePluginAssetUrl } from "../../plugin/runtime";
import { BUILTIN_SETTINGS_KEYS } from "../../plugin/builtin";
import {
  DEFAULT_SETTINGS,
  SHORTCUT_LABELS,
  useSettingsStore,
  type SearchMetadataEntry,
  type ShortcutBinding,
} from "./store";
import SearchAliasTagEditor from "../../components/SearchAliasTagEditor";
import ShortcutRecorder from "../../components/ShortcutRecorder";
import {
  Badge,
  Button,
  Input,
  LoadingLabel,
  Row,
  SegmentedControl,
  Select,
  SettingsCard,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
} from "../../components/ui";
import { useT } from "../../i18n";
import {
  metadataForKey,
  metadataMatchesQuery,
  moduleMetadataKey,
  pluginMetadataKey,
} from "../../search/searchMetadata";
import type {
  InstalledPlugin,
  PluginCompatibilityStatus,
  PluginIndexEntry,
  PluginPlatform,
  PluginPlatformCompatibility,
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
const BUILTIN_PLUGIN_ICONS: Record<string, LucideIcon> = {
  "builtin:clipboard": Clipboard,
  "builtin:qx-ai": Bot,
  "builtin:screencap": MonitorPlay,
  "builtin:rss": Rss,
  "builtin:v2ex": MessageCircle,
  "builtin:macros": Keyboard,
  "builtin:documents": FileText,
  "builtin:weather": CloudSun,
};
const BUILTIN_PLUGIN_SHORTCUTS: Record<string, string[]> = {
  "builtin:clipboard": ["clipboard"],
  "builtin:rss": ["rss"],
  "builtin:screencap": ["record_gif"],
};
const PLATFORM_LABELS: Record<PluginPlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

function compatibilityLabel(status: PluginCompatibilityStatus): string {
  switch (status) {
    case "supported":
      return "Supported";
    case "partial":
      return "Partial";
    case "mac-only":
      return "Mac Only";
    default:
      return "Unsupported";
  }
}

function compatibilityBadgeVariant(status: PluginCompatibilityStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "supported") return "default";
  if (status === "partial") return "secondary";
  if (status === "mac-only") return "outline";
  return "destructive";
}

function currentPlatform(): PluginPlatform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  return "linux";
}

function fallbackLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "P";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function PluginAssetImage({
  plugin,
  asset,
  className,
  fallback,
}: {
  plugin: InstalledPlugin;
  asset?: string;
  className: string;
  fallback?: string;
}) {
  const [src, setSrc] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    setFailed(false);
    if (!asset || isBuiltin(plugin)) return;
    void resolvePluginAssetUrl(plugin.id, asset).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, plugin.id, asset]);

  if (isBuiltin(plugin)) {
    const BuiltinIcon = BUILTIN_PLUGIN_ICONS[plugin.id] ?? Puzzle;
    const size = className.includes("detail") ? 22 : 17;
    return (
      <span className={`${className} is-builtin-icon`}>
        <BuiltinIcon size={size} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }

  if (!src || failed) {
    return <span className={`${className} is-fallback`}>{fallbackLabel(fallback || plugin.name)}</span>;
  }
  return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

function CompatibilityList({
  title,
  items,
}: {
  title: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="qx-plugin-compat-list">
      <div className="qx-plugin-compat-list-title">{title}</div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PlatformCompatibilityBlock({
  platform,
  compatibility,
  active,
}: {
  platform: PluginPlatform;
  compatibility: PluginPlatformCompatibility;
  active: boolean;
}) {
  return (
    <div className={`qx-plugin-compat-platform${active ? " is-active" : ""}`}>
      <div className="qx-plugin-compat-head">
        <div className="qx-plugin-compat-platform-name">{PLATFORM_LABELS[platform]}</div>
        <Badge variant={compatibilityBadgeVariant(compatibility.status)}>
          {compatibilityLabel(compatibility.status)}
        </Badge>
      </div>
      <CompatibilityList title="Available" items={compatibility.features} />
      <CompatibilityList title="Degraded" items={compatibility.degraded} />
      <CompatibilityList title="Unavailable" items={compatibility.unsupported} />
      <CompatibilityList title="Notes" items={compatibility.notes} />
    </div>
  );
}

function RaycastCompatibilityReport({ plugin }: { plugin: InstalledPlugin }) {
  const report = plugin.manifest?.raycast?.platformCompatibility;
  if (!report) return null;
  const activePlatform = currentPlatform();
  const entries = (["macos", "windows", "linux"] as PluginPlatform[])
    .map((platform) => ({ platform, compatibility: report[platform] }))
    .filter((entry): entry is { platform: PluginPlatform; compatibility: PluginPlatformCompatibility } => Boolean(entry.compatibility));
  if (entries.length === 0) return null;
  const active = report[activePlatform] ?? entries[0].compatibility;
  return (
    <SettingsCard
      title="Raycast Compatibility"
      description={`Current platform: ${compatibilityLabel(active.status)}. Converted Raycast extensions can be partially available when some macOS APIs do not map to this platform.`}
    >
      <div className="qx-plugin-compat-grid">
        {entries.map(({ platform, compatibility }) => (
          <PlatformCompatibilityBlock
            key={platform}
            platform={platform}
            compatibility={compatibility}
            active={platform === activePlatform}
          />
        ))}
      </div>
    </SettingsCard>
  );
}

function pluginMatchesQuery(
  plugin: InstalledPlugin,
  query: string,
  searchMetadata: Record<string, SearchMetadataEntry>,
) {
  if (!query) return true;
  const builtinModuleId = plugin.id.startsWith("builtin:") ? plugin.id.slice("builtin:".length) : null;
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
    .some((value) => String(value).toLowerCase().includes(query)) ||
    metadataMatchesQuery(searchMetadata[pluginMetadataKey(plugin.id)], query) ||
    (builtinModuleId ? metadataMatchesQuery(searchMetadata[moduleMetadataKey(builtinModuleId)], query) : false);
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

function shortcutCounts(
  shortcuts: Record<string, ShortcutBinding>,
  appShortcuts: Record<string, ShortcutBinding>,
) {
  const counts: Record<string, number> = {};
  [...Object.values(shortcuts), ...Object.values(appShortcuts)].forEach((binding) => {
    if (binding.enabled && binding.key) {
      counts[binding.key] = (counts[binding.key] || 0) + 1;
    }
  });
  return counts;
}

function shortcutHasConflict(binding: ShortcutBinding | undefined, counts: Record<string, number>) {
  return Boolean(binding?.enabled && binding.key && counts[binding.key] > 1);
}

function ShortcutKey({ value }: { value?: string }) {
  return <span className="qx-extension-shortcut-key">{value?.trim() || "None"}</span>;
}

function ExtensionCommandsCard({ plugin }: { plugin: InstalledPlugin }) {
  const commands = plugin.manifest?.commands ?? [];
  if (commands.length === 0) return null;
  return (
    <SettingsCard
      title="Commands"
      description="Launcher commands exposed by this extension."
    >
      <div className="qx-extension-command-list">
        {commands.map((command) => (
          <div key={command.name} className="qx-extension-command-row">
            <span className="qx-extension-command-icon" aria-hidden="true">
              <Command size={14} strokeWidth={2} />
            </span>
            <div className="qx-extension-command-copy">
              <div className="qx-extension-command-title">{command.title || command.name}</div>
              {(command.description || command.keywords?.length) && (
                <div className="qx-extension-command-description">
                  {command.description || command.keywords?.slice(0, 5).join(", ")}
                </div>
              )}
            </div>
            {command.mode && <Badge variant="outline">{command.mode}</Badge>}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
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
        <Input
          type="number"
          value={String(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ maxWidth: 120 }}
        />
      );

    case "password":
      return (
        <Input
          type="password"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      );

    default: // "string"
      return (
        <Input
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      );
  }
}

function ExtensionShortcutsCard({ plugin }: { plugin: InstalledPlugin }) {
  const { settings, patchShortcut } = useSettingsStore();
  const builtinShortcutIds = BUILTIN_PLUGIN_SHORTCUTS[plugin.id] ?? [];
  const manifestShortcuts = plugin.manifest?.shortcuts ?? [];
  const counts = useMemo(
    () => shortcutCounts(settings.shortcuts, settings.app_shortcuts),
    [settings.shortcuts, settings.app_shortcuts],
  );

  if (builtinShortcutIds.length === 0 && manifestShortcuts.length === 0) return null;

  return (
    <SettingsCard
      title="Shortcuts"
      description={isBuiltin(plugin)
        ? "Global shortcuts for this built-in extension."
        : "Shortcuts declared by this extension manifest."}
    >
      {builtinShortcutIds.map((id) => {
        const binding = settings.shortcuts[id] ?? DEFAULT_SETTINGS.shortcuts[id] ?? { key: "", enabled: true };
        const conflict = shortcutHasConflict(binding, counts);
        const defaultBinding = DEFAULT_SETTINGS.shortcuts[id] ?? { key: "", enabled: true };
        return (
          <Row
            key={id}
            title={SHORTCUT_LABELS[id] ?? id}
            description={conflict ? "Conflict: this shortcut is used by another action." : "Available from anywhere in Qx."}
          >
            <div className="qx-extension-shortcut-control">
              <Toggle
                value={binding.enabled}
                onChange={(enabled) => patchShortcut(id, { enabled })}
              />
              <ShortcutRecorder
                initial={binding.key}
                conflict={conflict}
                onCommit={(next) => patchShortcut(id, next)}
                onCancel={() => {}}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="qx-extension-shortcut-reset"
                onClick={() => patchShortcut(id, defaultBinding)}
                title="Reset shortcut"
              >
                <RotateCcw size={13} aria-hidden="true" />
              </Button>
            </div>
          </Row>
        );
      })}

      {manifestShortcuts.map((shortcut) => {
        const command = plugin.manifest?.commands?.find((item) => item.name === shortcut.command);
        return (
          <Row
            key={`${shortcut.command}-${shortcut.key}`}
            title={command?.title ?? shortcut.command}
            description={shortcut.enabled === false ? "Declared by the plugin, currently disabled." : "Declared by the plugin manifest."}
          >
            <div className="qx-extension-shortcut-control">
              <Badge variant={shortcut.enabled === false ? "outline" : "secondary"}>
                {shortcut.enabled === false ? "Disabled" : "Manifest"}
              </Badge>
              <ShortcutKey value={shortcut.key} />
            </div>
          </Row>
        );
      })}
    </SettingsCard>
  );
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
  const iconAsset = plugin.manifest?.icon;
  const screenshots = plugin.manifest?.screenshots ?? [];
  const settingsKey = builtin ? BUILTIN_SETTINGS_KEYS[plugin.id] : undefined;
  const { settings, patch, patchSearchMetadata } = useSettingsStore();
  const builtinModuleId = builtin ? plugin.id.slice("builtin:".length) : null;
  const aliasMetadataKey = builtinModuleId ? moduleMetadataKey(builtinModuleId) : pluginMetadataKey(plugin.id);
  const aliasMetadata = metadataForKey(settings, aliasMetadataKey);

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
      <div className="qx-plugin-detail-header">
        <PluginAssetImage
          plugin={plugin}
          asset={iconAsset}
          className="qx-plugin-detail-icon"
          fallback={plugin.name}
        />
        <div className="qx-plugin-detail-heading">
          <div className="qx-plugin-detail-title">
            {plugin.name}
          </div>
          {plugin.author && (
            <div className="qx-plugin-meta">
              by {plugin.author}
            </div>
          )}
        </div>
      </div>

      <div className="qx-plugin-badges">
        <Badge variant="secondary">v{plugin.version}</Badge>
        {builtin ? <Badge variant="secondary">Built-in</Badge> : <Badge variant="secondary">External</Badge>}
        <Badge variant={plugin.enabled ? "default" : "outline"}>{plugin.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

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

      {!builtin && screenshots.length > 0 && (
        <SettingsCard title="Screenshots" description="Preview images bundled with this plugin.">
          <div className="qx-plugin-screenshot-grid">
            {screenshots.map((screenshot) => (
              <PluginAssetImage
                key={screenshot}
                plugin={plugin}
                asset={screenshot}
                className="qx-plugin-screenshot"
                fallback="Preview"
              />
            ))}
          </div>
        </SettingsCard>
      )}

      {!builtin && <RaycastCompatibilityReport plugin={plugin} />}

      <SettingsCard
        title="Status"
        description={builtin ? "Built-in modules are always enabled." : "Toggle this plugin on or off."}
      >
        <Row title="Enabled">
          <Toggle value={plugin.enabled} onChange={onToggle} disabled={builtin} />
        </Row>
      </SettingsCard>

      <ExtensionCommandsCard plugin={plugin} />

      <ExtensionShortcutsCard plugin={plugin} />

      <SettingsCard
        title="Search Aliases & Tags"
        description="Add names or tags that should make this module appear in Launcher search."
      >
        <SearchAliasTagEditor
          entry={aliasMetadata}
          onChange={(next) => patchSearchMetadata(aliasMetadataKey, next)}
        />
      </SettingsCard>

      {permissions.length > 0 && (
        <SettingsCard title="Permissions" description="Capabilities declared by this plugin.">
          <ul className="qx-plugin-permissions">
            {permissions.map((perm) => (
              <li key={perm}>{perm}</li>
            ))}
          </ul>
        </SettingsCard>
      )}

      {preferences.length > 0 && prefsLoaded && (
        <SettingsCard
          title="Preferences"
          description={prefsBusy ? "Saving…" : "Configure plugin-specific options."}
        >
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

          {settingsKey === "v2ex" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openUrl("https://v2ex.com/settings/tokens")}
            >
              <ExternalLink size={13} aria-hidden="true" />
              Get Token
            </Button>
          )}
        </SettingsCard>
      )}

      {!builtin && (
        <Button variant="destructive" size="sm" onClick={onUninstall}>
          <Trash2 size={13} aria-hidden="true" />
          Uninstall
        </Button>
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
        <Button variant="outline" size="sm" onClick={fetchIndex} style={{ marginTop: 8 }}>
          Retry
        </Button>
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
          <Input
            type="text"
            placeholder="Search marketplace plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="qx-plugin-search-input"
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchIndex} disabled={loading}>
          {loading ? <LoadingLabel>Refresh</LoadingLabel> : (
            <>
              <RefreshCw size={13} aria-hidden="true" />
              Refresh
            </>
          )}
        </Button>
      </div>

      {installStatus && (
        <div className={`qx-plugin-status is-${installStatus.tone}`}>
          {installStatus.message}
        </div>
      )}

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
                <Badge variant="secondary">v{selectedEntry.version}</Badge>
                {selectedEntry.author && <Badge variant="secondary">{selectedEntry.author}</Badge>}
                {selectedEntry.size_bytes && <Badge variant="secondary">{formatBytes(selectedEntry.size_bytes)}</Badge>}
              </div>
              {selectedEntry.description && (
                <div className="qx-plugin-description">{selectedEntry.description}</div>
              )}
              <SettingsCard title="Install">
                <Button
                  variant={installedIds.has(selectedEntry.id) ? "outline" : "default"}
                  size="sm"
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
                </Button>
              </SettingsCard>
              {selectedEntry.required_permissions && selectedEntry.required_permissions.length > 0 && (
                <SettingsCard title="Required permissions">
                  <div className="qx-plugin-badges">
                    {selectedEntry.required_permissions.map((p) => (
                      <Badge key={p} variant="secondary">{p}</Badge>
                    ))}
                  </div>
                </SettingsCard>
              )}
              {(selectedEntry.updated_at || selectedEntry.min_app_version || selectedEntry.checksum_sha256) && (
                <SettingsCard title="Metadata">
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
                </SettingsCard>
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
}: {
  plugin: InstalledPlugin;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`qx-plugin-library-item${active ? " is-active" : ""}`}
      type="button"
    >
      <PluginAssetImage
        plugin={plugin}
        asset={plugin.manifest?.icon}
        className="qx-plugin-list-icon"
        fallback={plugin.name}
      />
      <div className="qx-plugin-list-main">
        <div className="qx-plugin-list-title">{plugin.name}</div>
        <div className="qx-plugin-list-meta">
          v{plugin.version}
          {isBuiltin(plugin) ? " · Built-in" : plugin.author ? ` · ${plugin.author}` : ""}
        </div>
        {plugin.description && <div className="qx-plugin-list-desc">{plugin.description}</div>}
      </div>
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
  const searchMetadata = useSettingsStore((state) => state.settings.search_metadata);
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
    return plugins.filter((plugin) => filterInstalledPlugin(plugin, installedFilter) && pluginMatchesQuery(plugin, q, searchMetadata));
  }, [plugins, installedFilter, installedQuery, searchMetadata]);
  const selectedPlugin = filteredPlugins.find((p) => p.id === selected?.id) ?? filteredPlugins[0] ?? null;

  /* ---- render ---- */

  return (
    <Tabs
      value={tab}
      onValueChange={(value: string) => setTab(value as Tab)}
      className="qx-plugin-manager"
    >
      <div className="qx-plugin-manager-top">
        <div className="qx-plugin-manager-actions">
          <TabsList>
            <TabsTrigger value="installed">Installed</TabsTrigger>
            <TabsTrigger value="browse">Browse</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={handleRefresh} title="Rescan plugins">
            <RefreshCw size={13} aria-hidden="true" />
            Rescan
          </Button>
        </div>
      </div>

      <TabsContent value="installed" className="qx-marketplace">
        <SettingsCard
          title={t("plugins.importArchive", "Import Plugin Archive")}
          description={t(
            "plugins.importArchive.desc",
            "Install a .zip or .qx-plugin package from disk, or paste a GitHub release/source archive URL.",
          )}
          trailing={
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
            </button>
          }
        >
          {importExpanded && (
            <div className="qx-plugin-import-stack">
              <div className="qx-plugin-import-row">
                <Input
                  type="text"
                  value={archivePath}
                  onChange={(e) => setArchivePath(e.target.value)}
                  placeholder={t("plugins.localArchive.placeholder", "Local archive path, e.g. ~/Downloads/plugin.zip")}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstallFromPath}
                  disabled={busy !== null || !archivePath.trim()}
                >
                  {busy === "path" ? t("plugins.installing", "Installing...") : t("plugins.installLocal", "Install Local")}
                </Button>
              </div>
              <div className="qx-plugin-import-row">
                <Input
                  type="url"
                  value={archiveUrl}
                  onChange={(e) => setArchiveUrl(e.target.value)}
                  placeholder={t("plugins.githubArchive.placeholder", "GitHub repo, release asset, or archive ZIP URL")}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstallFromUrl}
                  disabled={busy !== null || !archiveUrl.trim()}
                >
                  {busy === "url" ? t("plugins.downloading", "Downloading...") : t("plugins.installUrl", "Install URL")}
                </Button>
              </div>
              <div className="qx-plugin-import-row">
                <Input
                  type="url"
                  value={raycastUrl}
                  onChange={(e) => setRaycastUrl(e.target.value)}
                  placeholder="Raycast extension URL, e.g. https://github.com/raycast/extensions/tree/<ref>/extensions/system-information"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstallFromRaycast}
                  disabled={busy !== null || !raycastUrl.trim()}
                >
                  {busy === "raycast" ? "Converting..." : "Install Raycast"}
                </Button>
              </div>
              {installStatus && <div className="qx-plugin-import-status">{installStatus}</div>}
            </div>
          )}
        </SettingsCard>

        <div className="qx-plugin-list-toolbar">
          <div className="qx-plugin-search-wrap">
            <Search size={14} aria-hidden="true" />
            <Input
              type="text"
              value={installedQuery}
              onChange={(e) => setInstalledQuery(e.target.value)}
              placeholder="Search installed plugins..."
              className="qx-plugin-search-input"
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
      </TabsContent>

      <TabsContent value="browse" className="qx-marketplace">
        <MarketplaceTab
          installedIds={installedIds}
          onInstallComplete={handleRefresh}
        />
      </TabsContent>
    </Tabs>
  );
}

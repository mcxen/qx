import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpCircle,
  Command,
  Download,
  ExternalLink,
  PackageCheck,
  PackagePlus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { usePluginRegistry } from "../../../plugin/registry";
import { resolvePluginAssetUrl } from "../../../plugin/runtime";
import { BUILTIN_SETTINGS_KEYS } from "../../../plugin/builtin";
import {
  DEFAULT_PLUGIN_REGISTRIES,
  DEFAULT_SETTINGS,
  SHORTCUT_LABELS,
  useSettingsStore,
  type PluginRegistrySource,
  type SearchMetadataEntry,
  type ShortcutBinding,
} from "../store";
import SearchAliasTagEditor from "../../../components/SearchAliasTagEditor";
import ShortcutRecorder from "../../../components/ShortcutRecorder";
import {
  countEnabledGlobalShortcuts,
  formatQxShortcut,
  globalShortcutHasConflict,
  globalShortcutIssue,
} from "../../../utils/keyboard";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
} from "../../../components/ui";
import { useLocale, useT, type Locale } from "../../../i18n";
import {
  metadataForKey,
  metadataMatchesQuery,
  moduleMetadataKey,
  pluginMetadataKey,
} from "../../../search/searchMetadata";
import type {
  InstalledPlugin,
  PluginCompatibilityStatus,
  PluginIndexEntry,
  PluginIndexSourceStatus,
  PluginPlatform,
  PluginPlatformCompatibility,
  PluginPreference,
} from "../../../plugin/types";
import { marketplaceEntryKey } from "../../../plugin/types";
import { currentPluginPlatform } from "../../../plugin/platform";
import {
  localizeMarketplaceEntryDescription,
  localizeMarketplaceEntryName,
  localizePluginDescription,
  localizePluginName,
  type TranslateFn,
} from "../../../plugin/pluginLabels";
import InstalledModuleCard from "./InstalledModuleCard";
import { BUILTIN_PLUGIN_ICONS, isPluginUpdateAvailable } from "./helpers";
import BetaBadge from "../../../components/BetaBadge";
import PluginBackgroundBadge from "../../../components/PluginBackgroundBadge";
import {
  isBetaModule,
  isConfigurableBuiltinModule,
  normalizeBuiltinModuleId,
  type ConfigurableBuiltinModuleId,
} from "../../catalog";
import { isBuiltinModuleEnabled } from "../../moduleAvailability";

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
const BUILTIN_PLUGIN_SHORTCUTS: Record<string, string[]> = {
  "builtin:clipboard": ["clipboard"],
  "builtin:rss": ["rss"],
  "builtin:screencap": ["capture_screenshot", "record_gif", "toggle_capture_controls"],
};
const PLATFORM_LABELS: Record<PluginPlatform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

type Translate = (key: string, fallback: string) => string;

function compatibilityLabel(status: PluginCompatibilityStatus, t: Translate): string {
  switch (status) {
    case "supported":
      return t("plugins.compat.supported", "Supported");
    case "partial":
      return t("plugins.compat.partial", "Partial");
    case "mac-only":
      return t("plugins.compat.macOnly", "Mac Only");
    default:
      return t("plugins.compat.unsupported", "Unsupported");
  }
}

function compatibilityBadgeVariant(status: PluginCompatibilityStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "supported") return "default";
  if (status === "partial") return "secondary";
  if (status === "mac-only") return "outline";
  return "destructive";
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
  t,
}: {
  platform: PluginPlatform;
  compatibility: PluginPlatformCompatibility;
  active: boolean;
  t: Translate;
}) {
  return (
    <div className={`qx-plugin-compat-platform${active ? " is-active" : ""}`}>
      <div className="qx-plugin-compat-head">
        <div className="qx-plugin-compat-platform-name">{PLATFORM_LABELS[platform]}</div>
        <Badge variant={compatibilityBadgeVariant(compatibility.status)}>
          {compatibilityLabel(compatibility.status, t)}
        </Badge>
      </div>
      <CompatibilityList title={t("plugins.compat.available", "Available")} items={compatibility.features} />
      <CompatibilityList title={t("plugins.compat.degraded", "Degraded")} items={compatibility.degraded} />
      <CompatibilityList title={t("plugins.compat.unavailable", "Unavailable")} items={compatibility.unsupported} />
      <CompatibilityList title={t("plugins.compat.notes", "Notes")} items={compatibility.notes} />
    </div>
  );
}

function RaycastCompatibilityReport({ plugin }: { plugin: InstalledPlugin }) {
  const t = useT();
  const report = plugin.manifest?.raycast?.platformCompatibility;
  if (!report) return null;
  const activePlatform = currentPluginPlatform();
  const entries = (["macos", "windows", "linux"] as PluginPlatform[])
    .map((platform) => ({ platform, compatibility: report[platform] }))
    .filter((entry): entry is { platform: PluginPlatform; compatibility: PluginPlatformCompatibility } => Boolean(entry.compatibility));
  if (entries.length === 0) return null;
  const active = report[activePlatform] ?? entries[0].compatibility;
  return (
    <SettingsCard
      title={t("plugins.compat.title", "Raycast Compatibility")}
      description={t(
        "plugins.compat.desc",
        "Current platform: {status}. Converted Raycast extensions can be partially available when some macOS APIs do not map to this platform.",
      ).replace("{status}", compatibilityLabel(active.status, t))}
    >
      <div className="qx-plugin-compat-grid">
        {entries.map(({ platform, compatibility }) => (
          <PlatformCompatibilityBlock
            key={platform}
            platform={platform}
            compatibility={compatibility}
            active={platform === activePlatform}
            t={t}
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
  t: TranslateFn,
  locale: Locale,
) {
  if (!query) return true;
  const builtinModuleId = plugin.id.startsWith("builtin:") ? plugin.id.slice("builtin:".length) : null;
  return [
    plugin.id,
    plugin.name,
    localizePluginName(plugin, t, locale),
    plugin.version,
    plugin.author,
    plugin.description,
    localizePluginDescription(plugin, t, locale),
    ...(plugin.manifest?.keywords ?? []),
    ...(plugin.manifest?.permissions ?? plugin.permissions ?? []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query)) ||
    metadataMatchesQuery(searchMetadata[pluginMetadataKey(plugin.id)], query) ||
    (builtinModuleId ? metadataMatchesQuery(searchMetadata[moduleMetadataKey(builtinModuleId)], query) : false);
}

function marketplaceEntryMatchesQuery(
  entry: PluginIndexEntry,
  query: string,
  t: TranslateFn,
) {
  if (!query) return true;
  return [
    entry.id,
    entry.name,
    localizeMarketplaceEntryName(entry, t),
    entry.version,
    entry.author,
    entry.description,
    localizeMarketplaceEntryDescription(entry, t),
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

function shortcutHasConflict(
  binding: ShortcutBinding | undefined,
  counts: ReturnType<typeof countEnabledGlobalShortcuts>,
) {
  return globalShortcutHasConflict(binding, counts);
}

function ShortcutKey({ value }: { value?: string }) {
  const t = useT();
  return (
    <span className="qx-extension-shortcut-key">
      {formatQxShortcut(value?.trim()) || t("plugins.shortcut.none", "None")}
    </span>
  );
}

function ExtensionCommandsCard({ plugin }: { plugin: InstalledPlugin }) {
  const t = useT();
  const commands = plugin.manifest?.commands ?? [];
  if (commands.length === 0) return null;
  return (
    <SettingsCard
      title={t("plugins.commands", "Commands")}
    >
      <div className="qx-extension-command-list">
        {commands.map((command) => (
          <div key={command.name} className="qx-extension-command-row">
            <span className="qx-extension-command-icon" aria-hidden="true">
              <Command size={14} strokeWidth={2} />
            </span>
            <div className="qx-extension-command-copy">
              <div className="qx-extension-command-title qx-module-title-with-badge">
                <span>{command.title || command.name}</span>
                {command.mode === "no-view" && command.interval ? (
                  <PluginBackgroundBadge
                    pluginId={plugin.id}
                    commandName={command.name}
                    compact
                  />
                ) : null}
              </div>
              {command.interval ? (
                <div className="qx-extension-command-description">
                  {t("plugins.background.interval", "Interval {n}").replace(
                    "{n}",
                    String(command.interval),
                  )}
                </div>
              ) : null}
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

/** Multi-line prefs: explicit `textarea`, or string lists described as one-per-line. */
function isMultilinePreference(pref: PluginPreference): boolean {
  if (pref.type === "textarea") return true;
  if (pref.type !== "string") return false;
  if (typeof pref.default === "string" && pref.default.includes("\n")) return true;
  const desc = `${pref.description ?? ""} ${pref.label ?? ""}`.toLowerCase();
  return (
    desc.includes("one per line")
    || desc.includes("per line")
    || desc.includes("每行")
    || desc.includes("一行一个")
    || desc.includes("newline")
  );
}

function localizePreference(
  plugin: InstalledPlugin,
  pref: PluginPreference,
  t: Translate,
): PluginPreference {
  if (plugin.id !== "builtin:screencap") return pref;
  const key = `plugins.screencap.preference.${pref.id}`;
  return {
    ...pref,
    label: t(`${key}.label`, pref.label),
    description: pref.description ? t(`${key}.desc`, pref.description) : pref.description,
    options: pref.options?.map((option) => ({
      ...option,
      label: t(`${key}.option.${option.value}`, option.label),
    })),
  };
}

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
        <div className="qx-settings-input-wrap qx-settings-input-wrap--narrow">
          <Input
            type="number"
            value={String(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );

    case "password":
      return (
        <div className="qx-settings-input-wrap">
          <Input
            type="password"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      );

    case "textarea":
      return (
        <div className="qx-settings-textarea-wrap">
          <textarea
            className="qx-shadcn-textarea"
            value={String(value ?? "")}
            rows={typeof pref.rows === "number" && pref.rows > 0 ? pref.rows : 4}
            placeholder={pref.placeholder || undefined}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            aria-label={pref.label}
          />
        </div>
      );

    default: // "string" — promote list-like strings to textarea
      if (isMultilinePreference(pref)) {
        return (
          <div className="qx-settings-textarea-wrap">
            <textarea
              className="qx-shadcn-textarea"
              value={String(value ?? "")}
              rows={typeof pref.rows === "number" && pref.rows > 0 ? pref.rows : 4}
              placeholder={pref.placeholder || undefined}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              aria-label={pref.label}
            />
          </div>
        );
      }
      return (
        <div className="qx-settings-input-wrap">
          <Input
            type="text"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={pref.placeholder || undefined}
          />
        </div>
      );
  }
}

function ExtensionShortcutsCard({ plugin }: { plugin: InstalledPlugin }) {
  const t = useT();
  const { settings, patchShortcut } = useSettingsStore();
  const builtinShortcutIds = BUILTIN_PLUGIN_SHORTCUTS[plugin.id] ?? [];
  const manifestShortcuts = plugin.manifest?.shortcuts ?? [];
  const counts = useMemo(
    () => countEnabledGlobalShortcuts(settings.shortcuts, settings.app_shortcuts),
    [settings.shortcuts, settings.app_shortcuts],
  );

  if (builtinShortcutIds.length === 0 && manifestShortcuts.length === 0) return null;

  return (
    <SettingsCard
      title={t("shortcuts.extension.title", "Shortcuts")}
    >
      {builtinShortcutIds.map((id) => {
        const binding = settings.shortcuts[id] ?? DEFAULT_SETTINGS.shortcuts[id] ?? { key: "", enabled: true };
        const conflict = shortcutHasConflict(binding, counts);
        const issueCode = globalShortcutIssue(binding, counts);
        const issue = issueCode
          ? t(
            `shortcuts.issue.${issueCode}`,
            issueCode === "reserved"
              ? "Reserved by the operating system (for example Cmd/Ctrl+Space)."
              : issueCode === "invalid"
                ? "Invalid shortcut."
                : "This shortcut is already used by another global action.",
          )
          : null;
        const defaultBinding = DEFAULT_SETTINGS.shortcuts[id] ?? { key: "", enabled: true };
        return (
          <Row
            key={id}
            title={t(`shortcuts.label.${id}`, SHORTCUT_LABELS[id] ?? id)}
            description={issue ?? undefined}
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
                title={t("plugins.shortcut.reset", "Reset shortcut")}
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
            description={undefined}
          >
            <div className="qx-extension-shortcut-control">
              <Badge variant={shortcut.enabled === false ? "outline" : "secondary"}>
                {shortcut.enabled === false
                  ? t("plugins.badge.disabled", "Disabled")
                  : t("plugins.shortcut.manifest", "Manifest")}
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
  const t = useT();
  const locale = useLocale();
  const builtin = isBuiltin(plugin);
  const configurableBuiltin = isConfigurableBuiltinModule(plugin.id);
  const preferences = plugin.manifest?.preferences ?? [];
  const permissions = plugin.manifest?.permissions ?? plugin.permissions ?? [];
  const iconAsset = plugin.manifest?.icon;
  const screenshots = plugin.manifest?.screenshots ?? [];
  const settingsKey = builtin ? BUILTIN_SETTINGS_KEYS[plugin.id] : undefined;
  const { settings, patch, patchSearchMetadata } = useSettingsStore();
  const builtinModuleId = builtin ? plugin.id.slice("builtin:".length) : null;
  const aliasMetadataKey = builtinModuleId ? moduleMetadataKey(builtinModuleId) : pluginMetadataKey(plugin.id);
  const aliasMetadata = metadataForKey(settings, aliasMetadataKey);
  const displayName = localizePluginName(plugin, t, locale);
  const displayDescription = localizePluginDescription(plugin, t, locale);

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
      const normalizedValue = settingsKey === "screencap"
        && (prefId === "fps" || prefId === "capture_delay_seconds")
        ? Number(value)
        : value;
      const next = { ...prefValuesRef.current, [prefId]: normalizedValue };
      prefValuesRef.current = next;
      setPrefValues(next);
      setPrefsBusy(true);

      if (settingsKey) {
        // Built-in module: write to global settings store.
        const storeSection = (settings as unknown as Record<string, Record<string, unknown>>)[settingsKey] ?? {};
        patch(settingsKey as any, { ...storeSection, [prefId]: normalizedValue });
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
          fallback={displayName}
        />
        <div className="qx-plugin-detail-heading">
          <div className="qx-plugin-detail-title qx-module-title-with-badge">
            <span>{displayName}</span>
            {isBetaModule(plugin.id) && <BetaBadge />}
            {plugin.enabled && <PluginBackgroundBadge pluginId={plugin.id} />}
          </div>
          {plugin.author && (
            <div className="qx-plugin-meta">
              {t("plugins.authorBy", "by {author}").replace("{author}", plugin.author)}
            </div>
          )}
        </div>
        <div className="qx-plugin-detail-header-actions">
          <span className="qx-plugin-detail-toggle-label">
            {t("modules.enabled", "Enable module")}
          </span>
          <Toggle
            value={plugin.enabled}
            onChange={onToggle}
            disabled={builtin && !configurableBuiltin}
            ariaLabel={t("modules.enabled", "Enable module")}
          />
        </div>
      </div>

      <div className="qx-plugin-badges">
        <Badge variant="secondary">v{plugin.version}</Badge>
        {builtin
          ? <Badge variant="secondary">{t("plugins.badge.builtin", "Built-in")}</Badge>
          : <Badge variant="secondary">{t("plugins.badge.external", "External")}</Badge>}
        <Badge variant={plugin.enabled ? "default" : "outline"}>
          {plugin.enabled
            ? t("plugins.badge.enabled", "Enabled")
            : t("plugins.badge.disabled", "Disabled")}
        </Badge>
      </div>

      {displayDescription ? (
        <div className="qx-plugin-description">{displayDescription}</div>
      ) : null}

      {!builtin && screenshots.length > 0 && (
        <SettingsCard
          title={t("plugins.screenshots", "Screenshots")}
          description={t("plugins.screenshots.desc", "Preview images bundled with this plugin.")}
        >
          <div className="qx-plugin-screenshot-grid">
            {screenshots.map((screenshot) => (
              <PluginAssetImage
                key={screenshot}
                plugin={plugin}
                asset={screenshot}
                className="qx-plugin-screenshot"
                fallback={t("plugins.preview", "Preview")}
              />
            ))}
          </div>
        </SettingsCard>
      )}

      {!builtin && <RaycastCompatibilityReport plugin={plugin} />}

      <ExtensionShortcutsCard plugin={plugin} />

      <SettingsCard
        title={t("plugins.aliasesTags", "Search Aliases & Tags")}
      >
        <SearchAliasTagEditor
          entry={aliasMetadata}
          onChange={(next) => patchSearchMetadata(aliasMetadataKey, next)}
        />
      </SettingsCard>

      {permissions.length > 0 && (
        <SettingsCard
          title={t("plugins.permissions", "Permissions")}
        >
          <ul className="qx-plugin-permissions">
            {permissions.map((perm) => (
              <li key={perm}>{perm}</li>
            ))}
          </ul>
        </SettingsCard>
      )}

      {preferences.length > 0 && prefsLoaded && (
        <SettingsCard
          title={t("plugins.preferences", "Preferences")}
          description={prefsBusy ? t("plugins.preferences.saving", "Saving…") : undefined}
        >
          {preferences.map((pref) => {
            const localizedPref = localizePreference(plugin, pref, t);
            return (
              <Row
                key={pref.id}
                title={localizedPref.label}
                description={localizedPref.description}
                stacked={isMultilinePreference(localizedPref) || localizedPref.type === "textarea"}
              >
                <PreferenceField
                  pref={localizedPref}
                  value={prefValues[pref.id] ?? pref.default ?? ""}
                  onChange={(v) => handlePrefChange(pref.id, v)}
                />
              </Row>
            );
          })}

          {settingsKey === "v2ex" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openUrl("https://v2ex.com/settings/tokens")}
            >
              <ExternalLink size={13} aria-hidden="true" />
              {t("plugins.getToken", "Get Token")}
            </Button>
          )}
        </SettingsCard>
      )}

      <ExtensionCommandsCard plugin={plugin} />

      {!builtin && (
        <Button
          variant="destructive"
          size="sm"
          className="qx-plugin-uninstall-button"
          onClick={onUninstall}
        >
          <Trash2 size={13} aria-hidden="true" />
          {t("plugins.uninstall", "Uninstall")}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Marketplace / Browse tab                                           */
/* ------------------------------------------------------------------ */

function MarketplaceTab({
  installedVersions,
  onInstallComplete,
}: {
  installedVersions: Map<string, string>;
  onInstallComplete: () => void | Promise<void>;
}) {
  const t = useT();
  const { settings, patch } = useSettingsStore();
  const registries = settings.plugin_registries?.length
    ? settings.plugin_registries
    : DEFAULT_PLUGIN_REGISTRIES;
  const [entries, setEntries] = useState<PluginIndexEntry[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<PluginIndexSourceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** `all` or a registry source id */
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [installStatus, setInstallStatus] = useState<{ tone: StatusTone; message: string } | null>(null);

  const filteredEntries = useMemo(() => {
    const q = normalizeSearch(searchQuery);
    return entries.filter((entry) => {
      if (sourceFilter !== "all" && (entry.source_id || "") !== sourceFilter) return false;
      return marketplaceEntryMatchesQuery(entry, q, t);
    });
  }, [entries, searchQuery, sourceFilter, t]);

  const selectedEntry = useMemo(() => {
    if (selectedKey) {
      const selected = filteredEntries.find((entry) => marketplaceEntryKey(entry) === selectedKey);
      if (selected) return selected;
    }
    return filteredEntries[0] ?? null;
  }, [filteredEntries, selectedKey]);

  /** Same plugin id may exist on multiple libraries — offer install source choice. */
  const alternateSources = useMemo(() => {
    if (!selectedEntry) return [] as PluginIndexEntry[];
    return entries.filter(
      (entry) =>
        entry.id === selectedEntry.id
        && marketplaceEntryKey(entry) !== marketplaceEntryKey(selectedEntry),
    );
  }, [entries, selectedEntry]);

  const fetchIndex = useCallback(async (sourceId?: string) => {
    setLoading(true);
    setError(null);
    setInstallStatus(null);
    try {
      const index = await invoke<{
        schema_version: number;
        plugins: PluginIndexEntry[];
        sources?: PluginIndexSourceStatus[];
      }>("fetch_plugin_index", {
        sourceId: sourceId && sourceId !== "all" ? sourceId : null,
      });
      setEntries(index.plugins);
      setSourceStatuses(index.sources ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const registriesSignature = useMemo(
    () =>
      registries
        .map((r) => `${r.id}\0${r.enabled ? 1 : 0}\0${r.index_url}`)
        .join("\n"),
    [registries],
  );

  useEffect(() => {
    void fetchIndex(sourceFilter === "all" ? undefined : sourceFilter);
  }, [fetchIndex, sourceFilter, registriesSignature]);

  const handleInstall = async (entry: PluginIndexEntry, mode: "install" | "upgrade" | "reinstall") => {
    const key = marketplaceEntryKey(entry);
    setInstallingKey(key);
    setInstallStatus(null);
    try {
      const path = await invoke<string>("download_plugin", {
        url: entry.download_url,
      });
      await invoke("install_plugin", { path });
      await onInstallComplete();
      const messageKey =
        mode === "upgrade"
          ? "plugins.upgradedNamed"
          : mode === "reinstall"
            ? "plugins.reinstalledNamed"
            : "plugins.installedNamed";
      const fallback =
        mode === "upgrade"
          ? "{name} updated to v{version}."
          : mode === "reinstall"
            ? "{name} reinstalled."
            : "{name} installed.";
      const sourceSuffix = entry.source_name
        ? ` · ${t("plugins.marketplace.fromSource", "from {source}").replace("{source}", entry.source_name)}`
        : "";
      setInstallStatus({
        tone: "success",
        message: t(messageKey, fallback)
          .replace("{name}", localizeMarketplaceEntryName(entry, t))
          .replace("{version}", entry.version) + sourceSuffix,
      });
    } catch (err) {
      console.error("Marketplace install failed", err);
      setInstallStatus({
        tone: "danger",
        message: t("plugins.installFailed", "Install failed: {message}").replace("{message}", String(err)),
      });
    } finally {
      setInstallingKey(null);
    }
  };

  const saveRegistries = (next: PluginRegistrySource[]) => {
    const cleaned = next
      .map((entry) => ({
        id: entry.id.trim() || `registry-${Date.now().toString(36)}`,
        name: entry.name.trim() || entry.index_url.trim() || "Library",
        index_url: entry.index_url.trim(),
        enabled: entry.enabled !== false,
      }))
      .filter((entry) => entry.index_url);
    patch(
      "plugin_registries",
      cleaned.length > 0 ? cleaned : DEFAULT_PLUGIN_REGISTRIES.map((entry) => ({ ...entry })),
    );
  };

  const sourceFilterOptions = useMemo(() => {
    const fromSettings = registries
      .filter((r) => r.enabled)
      .map((r) => ({ value: r.id, label: r.name || r.index_url }));
    const fromStatus = sourceStatuses
      .filter((s) => !fromSettings.some((r) => r.value === s.id))
      .map((s) => ({ value: s.id, label: s.name || s.id }));
    return [
      { value: "all", label: t("plugins.marketplace.allLibraries", "All libraries") },
      ...fromSettings,
      ...fromStatus,
    ];
  }, [registries, sourceStatuses, t]);

  const librariesDialog = (
    <Dialog open={librariesOpen} onOpenChange={setLibrariesOpen}>
      <DialogContent style={{ width: "min(520px, calc(100vw - 40px))" }}>
        <DialogHeader>
          <DialogTitle>{t("plugins.libraries.title", "Plugin libraries")}</DialogTitle>
          <DialogDescription>
            {t(
              "plugins.libraries.desc",
              "Add mirrors or private catalogs. Qx merges enabled libraries so you can install when GitHub is slow.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="qx-plugin-libraries-editor">
          {registries.map((registry, index) => (
            <div className="qx-plugin-library-row" key={`${registry.id}-${index}`}>
              <Input
                value={registry.name}
                placeholder={t("plugins.libraries.name", "Name")}
                onChange={(e) => {
                  const next = registries.map((item, i) =>
                    i === index ? { ...item, name: e.target.value } : item,
                  );
                  saveRegistries(next);
                }}
              />
              <Input
                value={registry.index_url}
                placeholder="https://…/index.json"
                onChange={(e) => {
                  const next = registries.map((item, i) =>
                    i === index ? { ...item, index_url: e.target.value } : item,
                  );
                  saveRegistries(next);
                }}
              />
              <Toggle
                value={registry.enabled}
                onChange={(enabled) => {
                  const next = registries.map((item, i) =>
                    i === index ? { ...item, enabled } : item,
                  );
                  saveRegistries(next);
                }}
                ariaLabel={t("plugins.libraries.enabled", "Enabled")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={registries.length <= 1}
                onClick={() => saveRegistries(registries.filter((_, i) => i !== index))}
              >
                <Trash2 size={13} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="qx-modal-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                saveRegistries([
                  ...registries,
                  {
                    id: `mirror-${Date.now().toString(36)}`,
                    name: t("plugins.libraries.newMirror", "New mirror"),
                    index_url: "",
                    enabled: true,
                  },
                ])
              }
            >
              {t("plugins.libraries.add", "Add library")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                saveRegistries(DEFAULT_PLUGIN_REGISTRIES.map((entry) => ({ ...entry })))
              }
            >
              {t("plugins.libraries.reset", "Reset defaults")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setLibrariesOpen(false)}>
              {t("launcher.done", "Done")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
  const marketplaceToolbar = (
    <div className="qx-plugin-list-toolbar qx-plugin-marketplace-toolbar">
      <div className="qx-plugin-marketplace-query">
        <div className="qx-plugin-search-wrap">
          <Search size={14} aria-hidden="true" />
          <Input
            type="text"
            placeholder={t("plugins.marketplace.search", "Search marketplace plugins...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="qx-plugin-search-input"
          />
        </div>
        <div className="qx-plugin-source-filter">
          <Select
            value={sourceFilter}
            options={sourceFilterOptions}
            ariaLabel={t("plugins.marketplace.libraryFilter", "Plugin library")}
            onChange={(next) => setSourceFilter(next)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="qx-plugin-libraries-button"
          onClick={() => setLibrariesOpen(true)}
        >
          <PackagePlus size={13} aria-hidden="true" />
          <span>{t("plugins.libraries.manage", "Sources")}</span>
        </Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void fetchIndex(sourceFilter === "all" ? undefined : sourceFilter)}
        disabled={loading}
      >
        {loading ? (
          <LoadingLabel>{t("plugins.marketplace.refresh", "Refresh")}</LoadingLabel>
        ) : (
          <>
            <RefreshCw size={13} aria-hidden="true" />
            {error
              ? t("plugins.marketplace.retry", "Retry")
              : t("plugins.marketplace.refresh", "Refresh")}
          </>
        )}
      </Button>
    </div>
  );

  if (loading && entries.length === 0) {
    return (
      <div className="qx-marketplace">
        {marketplaceToolbar}
        {librariesDialog}
        <div className="qx-skeleton-stack" aria-label={t("plugins.marketplace.loadingAria", "Loading marketplace")}>
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
          <LoadingLabel>{t("plugins.marketplace.loading", "Loading marketplace...")}</LoadingLabel>
        </div>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="qx-marketplace">
        {marketplaceToolbar}
        {librariesDialog}
        <div className="qx-empty-state">
          <div>{t("plugins.marketplace.failed", "Failed to load marketplace.")}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="qx-marketplace">
        {marketplaceToolbar}
        {librariesDialog}
        <div className="qx-empty-state">
          {t("plugins.marketplace.empty", "No plugins available in the marketplace.")}
        </div>
      </div>
    );
  }

  return (
    <div className="qx-marketplace">
      {librariesDialog}
      {marketplaceToolbar}

      {sourceStatuses.length > 0 && (
        <div className="qx-plugin-source-status" aria-live="polite">
          {sourceStatuses.map((source) => (
            <Badge
              key={source.id}
              variant={source.ok ? "secondary" : "destructive"}
              title={source.error || source.index_url}
            >
              {source.name}
              {source.ok
                ? ` · ${source.plugin_count}`
                : ` · ${t("plugins.libraries.failed", "failed")}`}
            </Badge>
          ))}
        </div>
      )}

      {installStatus && (
        <div className={`qx-plugin-status is-${installStatus.tone}`}>
          {installStatus.message}
        </div>
      )}

      <div className="qx-plugin-library-body">
        <div className="qx-plugin-library-list">
          {filteredEntries.length === 0 && searchQuery.trim() ? (
            <div className="qx-empty-state">
              {t("plugins.marketplace.noMatch", "No plugins match “{query}”").replace(
                "{query}",
                searchQuery,
              )}
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const key = marketplaceEntryKey(entry);
              const active = selectedEntry
                ? marketplaceEntryKey(selectedEntry) === key
                : false;
              const installedVersion = installedVersions.get(entry.id);
              const alreadyInstalled = installedVersion != null;
              const updateAvailable = isPluginUpdateAvailable(installedVersion, entry.version);
              const installing = installingKey === key;

              return (
                <button
                  key={key}
                  className={`qx-plugin-library-item${active ? " is-active" : ""}`}
                  onClick={() => setSelectedKey(key)}
                  type="button"
                >
                  <div className="qx-plugin-list-main">
                    <div className="qx-plugin-list-title">
                      {localizeMarketplaceEntryName(entry, t)}
                      {entry.source_name ? (
                        <Badge variant="secondary" className="qx-plugin-source-badge">
                          {entry.source_name}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="qx-plugin-list-meta">
                      v{entry.version}
                      {alreadyInstalled && installedVersion !== entry.version
                        ? ` · ${t("plugins.marketplace.localVersion", "local v{version}").replace("{version}", installedVersion)}`
                        : ""}
                      {entry.author ? ` · ${entry.author}` : ""}
                      {entry.size_bytes ? ` · ${formatBytes(entry.size_bytes)}` : ""}
                    </div>
                    {(() => {
                      const desc = localizeMarketplaceEntryDescription(entry, t);
                      return desc ? <div className="qx-plugin-list-desc">{desc}</div> : null;
                    })()}
                  </div>
                  {updateAvailable && !installing && (
                    <ArrowUpCircle
                      size={14}
                      aria-label={t("plugins.marketplace.updateAvailable", "Update available")}
                    />
                  )}
                  {alreadyInstalled && !updateAvailable && !installing && (
                    <PackageCheck
                      size={14}
                      aria-label={t("plugins.marketplace.installed", "Installed")}
                    />
                  )}
                  {installing && (
                    <Download
                      className="qx-loading-spinner"
                      size={14}
                      aria-label={t("plugins.marketplace.installing", "Installing")}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="qx-plugin-library-detail">
          {selectedEntry ? (
            <>
              <div className="qx-plugin-detail-title">
                {localizeMarketplaceEntryName(selectedEntry, t)}
              </div>
              <div className="qx-plugin-badges">
                <Badge variant="secondary">v{selectedEntry.version}</Badge>
                {selectedEntry.source_name && (
                  <Badge variant="default">
                    {t("plugins.marketplace.source", "Library")}: {selectedEntry.source_name}
                  </Badge>
                )}
                {selectedEntry.author && <Badge variant="secondary">{selectedEntry.author}</Badge>}
                {selectedEntry.size_bytes && <Badge variant="secondary">{formatBytes(selectedEntry.size_bytes)}</Badge>}
                {isPluginUpdateAvailable(installedVersions.get(selectedEntry.id), selectedEntry.version) && (
                  <Badge variant="default">
                    {t("plugins.marketplace.updateAvailable", "Update available")}
                  </Badge>
                )}
              </div>
              {(() => {
                const desc = localizeMarketplaceEntryDescription(selectedEntry, t);
                return desc ? <div className="qx-plugin-description">{desc}</div> : null;
              })()}
              <SettingsCard title={t("plugins.marketplace.install", "Install")}>
                {(() => {
                  const installedVersion = installedVersions.get(selectedEntry.id);
                  const alreadyInstalled = installedVersion != null;
                  const updateAvailable = isPluginUpdateAvailable(installedVersion, selectedEntry.version);
                  const installing = installingKey === marketplaceEntryKey(selectedEntry);
                  const busyLabel = updateAvailable
                    ? t("plugins.marketplace.updating", "Updating...")
                    : alreadyInstalled
                      ? t("plugins.marketplace.reinstalling", "Reinstalling...")
                      : t("plugins.marketplace.installing", "Installing...");
                  const actionLabel = updateAvailable
                    ? t("plugins.marketplace.update", "Update to v{version}").replace(
                        "{version}",
                        selectedEntry.version,
                      )
                    : alreadyInstalled
                      ? t("plugins.marketplace.reinstall", "Reinstall")
                      : t("plugins.marketplace.install", "Install");
                  const mode: "install" | "upgrade" | "reinstall" = updateAvailable
                    ? "upgrade"
                    : alreadyInstalled
                      ? "reinstall"
                      : "install";
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {alreadyInstalled && (
                        <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
                          {updateAvailable
                            ? t(
                                "plugins.marketplace.updateHint",
                                "Installed v{local} → marketplace v{market}. Preferences and plugin data are kept.",
                              )
                                .replace("{local}", installedVersion ?? "")
                                .replace("{market}", selectedEntry.version)
                            : t(
                                "plugins.marketplace.reinstallHint",
                                "Installed v{version}. Reinstall replaces the package and keeps preferences/data.",
                              ).replace("{version}", installedVersion ?? selectedEntry.version)}
                        </div>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <Button
                          variant={alreadyInstalled && !updateAvailable ? "outline" : "default"}
                          size="sm"
                          disabled={installing}
                          onClick={() => void handleInstall(selectedEntry, mode)}
                        >
                          {installing ? (
                            <Download className="qx-loading-spinner" size={13} aria-hidden="true" />
                          ) : updateAvailable ? (
                            <ArrowUpCircle size={13} aria-hidden="true" />
                          ) : alreadyInstalled ? (
                            <RotateCcw size={13} aria-hidden="true" />
                          ) : (
                            <PackagePlus size={13} aria-hidden="true" />
                          )}
                          {installing ? busyLabel : actionLabel}
                        </Button>
                        {alreadyInstalled && !updateAvailable && (
                          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                            {t("plugins.marketplace.installed", "Installed")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </SettingsCard>
              {alternateSources.length > 0 && (
                <SettingsCard title={t("plugins.marketplace.otherSources", "Other libraries")}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="qx-plugin-list-desc">
                      {t(
                        "plugins.marketplace.otherSources.desc",
                        "This plugin is also listed elsewhere. Pick a library to download from.",
                      )}
                    </div>
                    {alternateSources.map((alt) => {
                      const altKey = marketplaceEntryKey(alt);
                      const installingAlt = installingKey === altKey;
                      return (
                        <div
                          key={altKey}
                          className="qx-plugin-library-alt-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="qx-plugin-list-title">
                              {alt.source_name || alt.source_id || t("plugins.marketplace.source", "Library")}
                            </div>
                            <div className="qx-plugin-list-meta">v{alt.version}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={installingAlt || installingKey != null}
                            onClick={() => {
                              setSelectedKey(altKey);
                              const installedVersion = installedVersions.get(alt.id);
                              const alreadyInstalled = installedVersion != null;
                              const updateAvailable = isPluginUpdateAvailable(
                                installedVersion,
                                alt.version,
                              );
                              const mode: "install" | "upgrade" | "reinstall" = updateAvailable
                                ? "upgrade"
                                : alreadyInstalled
                                  ? "reinstall"
                                  : "install";
                              void handleInstall(alt, mode);
                            }}
                          >
                            {installingAlt
                              ? t("plugins.marketplace.installing", "Installing...")
                              : t("plugins.marketplace.installFrom", "Install from here")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </SettingsCard>
              )}
              {selectedEntry.required_permissions && selectedEntry.required_permissions.length > 0 && (
                <SettingsCard title={t("plugins.marketplace.requiredPerms", "Required permissions")}>
                  <div className="qx-plugin-badges">
                    {selectedEntry.required_permissions.map((p) => (
                      <Badge key={p} variant="secondary">{p}</Badge>
                    ))}
                  </div>
                </SettingsCard>
              )}
              {(selectedEntry.updated_at
                || selectedEntry.min_app_version
                || selectedEntry.checksum_sha256
                || selectedEntry.source_index_url) && (
                <SettingsCard title={t("plugins.marketplace.metadata", "Metadata")}>
                  <div className="qx-plugin-info-grid">
                    {selectedEntry.source_name && (
                      <>
                        <span>{t("plugins.marketplace.source", "Library")}</span>
                        <span>{selectedEntry.source_name}</span>
                      </>
                    )}
                    {selectedEntry.source_index_url && (
                      <>
                        <span>{t("plugins.marketplace.sourceUrl", "Index URL")}</span>
                        <span style={{ wordBreak: "break-all" }}>{selectedEntry.source_index_url}</span>
                      </>
                    )}
                    {selectedEntry.updated_at && (
                      <>
                        <span>{t("plugins.marketplace.updated", "Updated")}</span>
                        <span>{formatDate(selectedEntry.updated_at)}</span>
                      </>
                    )}
                    {selectedEntry.min_app_version && (
                      <>
                        <span>{t("plugins.marketplace.minQx", "Min Qx")}</span>
                        <span>{selectedEntry.min_app_version}</span>
                      </>
                    )}
                    {selectedEntry.checksum_sha256 && (
                      <>
                        <span>{t("plugins.marketplace.sha256", "SHA256")}</span>
                        <span>{selectedEntry.checksum_sha256}</span>
                      </>
                    )}
                  </div>
                </SettingsCard>
              )}
            </>
          ) : (
            <div className="qx-empty-state">
              {t("plugins.marketplace.select", "Select a plugin to view details")}
            </div>
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

/* ------------------------------------------------------------------ */
/*  Main PluginManager                                                 */
/* ------------------------------------------------------------------ */

export default function PluginManager() {
  const t = useT();
  const locale = useLocale();
  const { plugins, install, uninstall, setEnabled, refresh, loaded, loading } =
    usePluginRegistry();
  const searchMetadata = useSettingsStore((state) => state.settings.search_metadata);
  const pluginDisplay = useSettingsStore((state) => state.settings.plugin_display);
  const builtinModules = useSettingsStore((state) => state.settings.builtin_modules);
  const patchSettings = useSettingsStore((state) => state.patch);
  const [tab, setTab] = useState<Tab>("installed");
  /** Open config dialog for this installed module id (null = closed). */
  const [configId, setConfigId] = useState<string | null>(null);
  const [archivePath, setArchivePath] = useState("");
  const [archiveUrl, setArchiveUrl] = useState("");
  const [raycastUrl, setRaycastUrl] = useState("");
  const [busy, setBusy] = useState<"path" | "url" | "raycast" | null>(null);
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [installedQuery, setInstalledQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>("all");
  const [importExpanded, setImportExpanded] = useState(false);

  /* Close dialog if the configured plugin disappears. */
  useEffect(() => {
    if (configId && !plugins.find((p) => p.id === configId)) {
      setConfigId(null);
    }
  }, [plugins, configId]);

  // Raycast "Configure Extension" can request the exact plugin card after
  // navigation lands on Settings → Extensions.
  useEffect(() => {
    try {
      const pendingPluginId = sessionStorage.getItem("qx.settings.focusPluginId");
      if (!pendingPluginId) return;
      sessionStorage.removeItem("qx.settings.focusPluginId");
      if (plugins.some((plugin) => plugin.id === pendingPluginId)) {
        setConfigId(pendingPluginId);
      }
    } catch {
      /* ignore */
    }
  }, [plugins]);

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
    if (isConfigurableBuiltinModule(plugin.id)) {
      const id = normalizeBuiltinModuleId(plugin.id) as ConfigurableBuiltinModuleId;
      patchSettings("builtin_modules", {
        ...builtinModules,
        modules: {
          ...builtinModules.modules,
          [id]: !plugin.enabled,
        },
      });
      return;
    }
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

  const displayPlugins = useMemo(
    () => plugins.map((plugin) => plugin.id.startsWith("builtin:")
      ? { ...plugin, enabled: isBuiltinModuleEnabled(plugin.id) }
      : plugin),
    [builtinModules, plugins],
  );
  const installedVersions = useMemo(() => {
    const map = new Map<string, string>();
    for (const plugin of displayPlugins) {
      if (plugin.id.startsWith("builtin:")) continue;
      map.set(plugin.id, plugin.version || "0.0.0");
    }
    return map;
  }, [displayPlugins]);
  const filteredPlugins = useMemo(() => {
    const q = normalizeSearch(installedQuery);
    return displayPlugins
      .filter((plugin) => filterInstalledPlugin(plugin, installedFilter)
        && pluginMatchesQuery(plugin, q, searchMetadata, t, locale))
      .slice()
      .sort((a, b) => localizePluginName(a, t, locale)
        .localeCompare(localizePluginName(b, t, locale), locale === "zh-CN" ? "zh-CN" : "en"));
  }, [displayPlugins, installedFilter, installedQuery, locale, searchMetadata, t]);
  const configPlugin = displayPlugins.find((p) => p.id === configId) ?? null;

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
            <TabsTrigger value="installed">{t("plugins.tabs.installed", "Installed")}</TabsTrigger>
            <TabsTrigger value="browse">{t("plugins.tabs.browse", "Browse")}</TabsTrigger>
          </TabsList>
          <div className="qx-plugin-manager-tools">
            {tab === "installed" && (
              <div
                className="qx-plugin-display-toggle"
                title={t(
                  "plugins.raycastActions.desc",
                  "Show secondary actions on converted Raycast items. Narrow panels hide them automatically.",
                )}
              >
                <span>{t("plugins.raycastActions", "Raycast Actions")}</span>
                <Toggle
                  value={pluginDisplay.raycast_action_panel}
                  ariaLabel={t("plugins.raycastActions", "Raycast Actions")}
                  onChange={(raycast_action_panel) => patchSettings("plugin_display", {
                    ...pluginDisplay,
                    raycast_action_panel,
                  })}
                />
              </div>
            )}
            {tab === "installed" && (
              <Button variant="outline" size="sm" onClick={() => setImportExpanded(true)}>
                <PackagePlus size={13} aria-hidden="true" />
                {t("plugins.import", "Import")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh} title={t("plugins.rescan.desc", "Rescan plugins")}>
              <RefreshCw size={13} aria-hidden="true" />
              {t("plugins.rescan", "Rescan")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={importExpanded} onOpenChange={setImportExpanded}>
        <DialogContent className="qx-plugin-import-dialog">
          <DialogHeader>
            <DialogTitle>{t("plugins.importArchive", "Import Plugin Archive")}</DialogTitle>
            <DialogDescription>
              {t(
                "plugins.importArchive.desc",
                "Install a .zip or .qx-plugin package from disk, or paste a GitHub release/source archive URL.",
              )}
            </DialogDescription>
          </DialogHeader>
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
                placeholder={t("plugins.raycastUrl.placeholder", "Raycast extension GitHub URL")}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleInstallFromRaycast}
                disabled={busy !== null || !raycastUrl.trim()}
              >
                {busy === "raycast" ? t("plugins.converting", "Converting...") : t("plugins.installRaycast", "Install Raycast")}
              </Button>
            </div>
            <div className="qx-plugin-import-status">
              {t(
                "plugins.raycastFrozen",
                "Legacy converter · maintenance paused. Maintained plugins should be rebuilt from source against Qx protocols.",
              )}
            </div>
            {installStatus && <div className="qx-plugin-import-status">{installStatus}</div>}
          </div>
        </DialogContent>
      </Dialog>

      <TabsContent value="installed" className="qx-marketplace qx-plugin-installed-tab">
        <div className="qx-plugin-list-toolbar">
          <div className="qx-plugin-search-wrap">
            <Search size={14} aria-hidden="true" />
            <Input
              type="text"
              value={installedQuery}
              onChange={(e) => setInstalledQuery(e.target.value)}
              placeholder={t("plugins.searchInstalled", "Search installed modules...")}
              className="qx-plugin-search-input"
            />
          </div>
          <SegmentedControl
            value={installedFilter}
            options={[
              { value: "all", label: t("plugins.filter.all", "All") },
              { value: "builtin", label: t("plugins.filter.builtin", "Built-in") },
              { value: "external", label: t("plugins.filter.external", "External") },
              { value: "enabled", label: t("plugins.filter.enabled", "Enabled") },
              { value: "disabled", label: t("plugins.filter.disabled", "Disabled") },
            ]}
            onChange={setInstalledFilter}
          />
        </div>

        {displayPlugins.length === 0 ? (
          <div className="qx-empty-state">
            {loading ? t("plugins.loadingModules", "Loading modules...") : t("plugins.noModules", "No modules installed")}
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="qx-empty-state">
            {t("plugins.noMatches", "No modules match “{query}”").replace("{query}", installedQuery || installedFilter)}
          </div>
        ) : (
          <div className="qx-ext-card-list" role="list">
            {(() => {
              const builtins = filteredPlugins.filter((p) => isBuiltin(p));
              const externals = filteredPlugins.filter((p) => !isBuiltin(p));
              const sections: Array<{ key: string; label: string; items: typeof filteredPlugins }> = [];
              if (builtins.length > 0) {
                sections.push({
                  key: "builtin",
                  label: t("plugins.filter.builtin", "Built-in"),
                  items: builtins,
                });
              }
              if (externals.length > 0) {
                sections.push({
                  key: "external",
                  label: t("plugins.filter.external", "External"),
                  items: externals,
                });
              }
              // Single section (e.g. filter=external only): skip noisy headings.
              const showHeadings = sections.length > 1;
              return sections.map((section) => (
                <div key={section.key} className="qx-ext-card-group" role="group" aria-label={section.label}>
                  {showHeadings && (
                    <div className="qx-ext-card-section">{section.label}</div>
                  )}
                  {section.items.map((plugin) => (
                    <div key={plugin.id} role="listitem">
                      <InstalledModuleCard
                        plugin={plugin}
                        onOpen={() => setConfigId(plugin.id)}
                      />
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        )}

        <Dialog open={Boolean(configPlugin)} onOpenChange={(open) => { if (!open) setConfigId(null); }}>
          <DialogContent className="qx-plugin-config-dialog">
            {configPlugin && (
              <>
                <DialogHeader>
                  <DialogTitle className="qx-module-title-with-badge">
                    <span>{configPlugin.name}</span>
                    {isBetaModule(configPlugin.id) && <BetaBadge />}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    {t("plugins.configureDialog.description", "Configure this module.")}
                  </DialogDescription>
                </DialogHeader>
                <PluginDetail
                  plugin={configPlugin}
                  onToggle={() => void handleToggle(configPlugin)}
                  onUninstall={() => {
                    void handleUninstall(configPlugin.id);
                    setConfigId(null);
                  }}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      </TabsContent>

      <TabsContent value="browse" className="qx-marketplace">
        <MarketplaceTab
          installedVersions={installedVersions}
          onInstallComplete={handleRefresh}
        />
      </TabsContent>
    </Tabs>
  );
}

import type { Locale } from "../i18n";
import type { AppEntry } from "../store";
import {
  bestMatchTier,
  MatchTier,
  type MatchTierValue,
} from "./rankResults";
import {
  builtinModuleIdFromPluginId,
  localizePluginCommandTitle,
  localizePluginPanelTitle,
  type PluginLabelSource,
  type TranslateFn,
} from "../plugin/pluginLabels";
import { buildPluginSearchTerms } from "../plugin/pluginSearchMetadata";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "../plugin/types";

export interface PluginSearchProviderInput {
  query: string;
  plugins: readonly InstalledPlugin[];
  commands: readonly RegisteredCommand[];
  panels: Readonly<Record<string, RegisteredPanel>>;
  locale: Locale;
  t: TranslateFn;
  /** Built-in modules can be disabled from Settings → Module Search. */
  isModuleSearchEnabled?: (moduleId: string) => boolean;
  /** User aliases/tags remain an independent metadata match source. */
  matchesMetadata?: (pluginId: string, moduleId: string | null) => boolean;
}

export interface PluginRegistrySearchSnapshot {
  commands: readonly RegisteredCommand[];
  panels: Readonly<Record<string, RegisteredPanel>>;
  plugins: readonly InstalledPlugin[];
}

function pluginLabelSource(
  plugin: InstalledPlugin | undefined,
  pluginId: string,
  fallbackName: string,
): PluginLabelSource {
  return plugin ?? { id: pluginId, name: fallbackName || pluginId };
}

function isRegisteredPluginAvailable(pluginId: string, plugin: InstalledPlugin | undefined): boolean {
  // Built-ins register before the installed-plugin scan. External orphaned
  // registrations must not survive a removal/rescan as executable results.
  return plugin ? plugin.enabled : pluginId.startsWith("builtin:");
}

function moduleIsAllowed(
  moduleId: string | null,
  isModuleSearchEnabled: PluginSearchProviderInput["isModuleSearchEnabled"],
): boolean {
  return !moduleId || !isModuleSearchEnabled || isModuleSearchEnabled(moduleId);
}

function matchingTier(
  query: string,
  terms: string[],
  metadataMatch: boolean,
): MatchTierValue {
  const tier = bestMatchTier(query, ...terms);
  if (tier < MatchTier.none) return tier;
  // Settings aliases/tags are intentionally a fallback source. Keep those
  // rows visible without pretending that metadata-only matches are exact.
  return metadataMatch ? MatchTier.contains : tier;
}

function panelSearchEntry(
  pluginId: string,
  panel: RegisteredPanel,
  plugin: InstalledPlugin | undefined,
  input: PluginSearchProviderInput,
): AppEntry | null {
  const moduleId = builtinModuleIdFromPluginId(pluginId);
  if (!moduleIsAllowed(moduleId, input.isModuleSearchEnabled)) return null;
  if (!isRegisteredPluginAvailable(pluginId, plugin)) return null;

  const source = pluginLabelSource(plugin, pluginId, panel.pluginName || panel.title);
  const localizedName = localizePluginPanelTitle(source, panel, input.t, input.locale);
  const metadataMatch = input.matchesMetadata?.(pluginId, moduleId) ?? false;
  const terms = buildPluginSearchTerms({
    pluginId,
    pluginName: panel.pluginName || plugin?.name || pluginId,
    pluginDescription: plugin?.description,
    manifest: plugin?.manifest,
    panel,
  });
  const matchScore = matchingTier(input.query, [localizedName, ...terms], metadataMatch);
  if (matchScore >= MatchTier.none) return null;

  return {
    name: localizedName,
    display_name: localizedName,
    path: moduleId ? `__qx:${moduleId}` : `__qx:plugin:${pluginId}`,
    icon: panel.icon || plugin?.manifest?.icon || `builtin:${pluginId}`,
    kind: "command",
    moduleId: moduleId ?? undefined,
    matchScore,
  };
}

function commandSearchEntry(
  command: RegisteredCommand,
  plugin: InstalledPlugin | undefined,
  input: PluginSearchProviderInput,
): AppEntry | null {
  const moduleId = builtinModuleIdFromPluginId(command.pluginId);
  if (!moduleIsAllowed(moduleId, input.isModuleSearchEnabled)) return null;
  if (!isRegisteredPluginAvailable(command.pluginId, plugin)) return null;

  const source = pluginLabelSource(plugin, command.pluginId, command.pluginName);
  const localizedName = localizePluginCommandTitle(source, command, input.t, input.locale);
  const metadataMatch = input.matchesMetadata?.(command.pluginId, moduleId) ?? false;
  const terms = buildPluginSearchTerms({
    pluginId: command.pluginId,
    pluginName: command.pluginName || plugin?.name || command.pluginId,
    pluginDescription: plugin?.description,
    manifest: plugin?.manifest,
    command,
  });
  const matchScore = matchingTier(input.query, [localizedName, ...terms], metadataMatch);
  if (matchScore >= MatchTier.none) return null;

  return {
    name: localizedName,
    display_name: localizedName,
    path: `__qx:cmd:${command.pluginId}:${command.name}`,
    icon: command.icon || command.pluginIcon || plugin?.manifest?.icon || `builtin:${command.pluginId}`,
    kind: "command",
    moduleId: moduleId ?? undefined,
    matchScore,
  };
}

/**
 * Search only registered plugin surfaces and commands.
 *
 * The registry is the compatibility boundary: disabled/incompatible plugins
 * never reach this provider, and a panel-less plugin never gets a synthetic
 * root row. This function only projects in-memory metadata and never starts a
 * plugin runtime or performs I/O.
 */
export function searchPluginEntries(input: PluginSearchProviderInput): AppEntry[] {
  const query = input.query.trim();
  if (!query) return [];

  const pluginById = new Map(input.plugins.map((plugin) => [plugin.id, plugin]));
  const entries: AppEntry[] = [];
  for (const [pluginId, panel] of Object.entries(input.panels)) {
    const entry = panelSearchEntry(pluginId, panel, pluginById.get(pluginId), {
      ...input,
      query,
    });
    if (entry) entries.push(entry);
  }
  for (const command of input.commands) {
    const entry = commandSearchEntry(command, pluginById.get(command.pluginId), {
      ...input,
      query,
    });
    if (entry) entries.push(entry);
  }
  return entries;
}

function stableLocaleMap(values?: Record<string, string> | null): Array<[string, string]> {
  return Object.entries(values ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function stableManifestMetadata(plugin: InstalledPlugin): unknown {
  const manifest = plugin.manifest;
  if (!manifest) return null;
  return {
    name: manifest.name,
    description: manifest.description ?? "",
    names: stableLocaleMap(manifest.names),
    descriptions: stableLocaleMap(manifest.descriptions),
    keywords: [...(manifest.keywords ?? [])],
    panel: manifest.panel
      ? {
          title: manifest.panel.title ?? "",
          titles: stableLocaleMap(manifest.panel.titles),
          keywords: [...(manifest.panel.keywords ?? [])],
        }
      : null,
  };
}

function stableCommandMetadata(command: RegisteredCommand): unknown {
  return {
    pluginId: command.pluginId,
    pluginName: command.pluginName,
    name: command.name,
    title: command.title,
    titles: stableLocaleMap(command.titles),
    description: command.description ?? "",
    descriptions: stableLocaleMap(command.descriptions),
    keywords: [...(command.keywords ?? [])],
  };
}

function stablePanelMetadata(panel: RegisteredPanel): unknown {
  return {
    pluginId: panel.pluginId,
    pluginName: panel.pluginName,
    title: panel.title,
    keywords: [...panel.keywords],
  };
}

/**
 * Stable, narrow subscription key for launcher-relevant plugin metadata.
 * Background activity, worker identity and runtime callbacks are excluded so
 * those updates cannot restart an active launcher query.
 */
export function pluginSearchMetadataFingerprint(
  snapshot: PluginRegistrySearchSnapshot,
): string {
  const registeredIds = new Set<string>([
    ...snapshot.commands.map((command) => command.pluginId),
    ...Object.keys(snapshot.panels),
  ]);
  const plugins = snapshot.plugins
    .filter((plugin) => registeredIds.has(plugin.id))
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      enabled: plugin.enabled,
      manifest: stableManifestMetadata(plugin),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const commands = snapshot.commands
    .map(stableCommandMetadata)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const panels = Object.values(snapshot.panels)
    .map(stablePanelMetadata)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({ commands, panels, plugins });
}

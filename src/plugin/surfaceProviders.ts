import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  PluginLocale,
  PluginSurfaceProviderDeclaration,
  PluginSurfaceProviderTarget,
} from "./types";
import type { TrayProviderConfig } from "../modules/settings/store";

export interface DisplayBrightnessProviderItem {
  id: string;
  name: string;
  backend: string;
  current?: number | null;
  max: number;
  rawCurrent?: number | null;
  rawMax?: number | null;
  isBuiltin: boolean;
  supported: boolean;
  error?: string | null;
}

export interface RssDashboardArticle {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  link: string;
  publishedAt: number;
}

export interface RssDashboardSnapshot {
  unreadCount: number;
  articles: RssDashboardArticle[];
  generatedAt: number;
}

export interface ResolvedSurfaceProvider {
  key: string;
  pluginId: string;
  pluginName: string;
  declaration: PluginSurfaceProviderDeclaration;
  title: string;
}

export interface LightweightSurfaceProviderAdapter<TSnapshot, TMutation = never> {
  read: () => Promise<TSnapshot>;
  write?: (mutation: TMutation) => Promise<void>;
}

/**
 * Hardware brightness should not be driven by a series of large jumps while a
 * pointer is moving. The host and lightweight surfaces use this same step
 * policy; a plugin panel can mirror it inside its own runtime.
 */
export const BRIGHTNESS_RAMP_INTERVAL_MS = 28;

export function nextBrightnessRampValue(current: number, target: number): number {
  const from = Math.max(0, Math.min(100, Math.round(current)));
  const to = Math.max(0, Math.min(100, Math.round(target)));
  const distance = Math.abs(to - from);
  if (distance === 0) return from;
  const step = distance > 24 ? 3 : distance > 8 ? 2 : 1;
  return from + Math.sign(to - from) * Math.min(step, distance);
}

export function providerKey(pluginId: string, providerId: string): string {
  return `${pluginId}:${providerId}`;
}

export function dashboardProviderWidgetId(key: string): `provider:${string}` {
  return `provider:${key}`;
}

export function resolveSurfaceProviders(
  plugins: readonly InstalledPlugin[],
  surface: PluginSurfaceProviderTarget,
  locale: PluginLocale,
): ResolvedSurfaceProvider[] {
  return plugins.flatMap((plugin) => {
    if (!plugin.enabled) return [];
    return (plugin.manifest?.surfaceProviders ?? [])
      .filter((provider) => provider.surfaces.includes(surface))
      .map((declaration) => ({
        key: providerKey(plugin.id, declaration.id),
        pluginId: plugin.id,
        pluginName: plugin.name,
        declaration,
        title: declaration.titles?.[locale]
          || declaration.title
          || plugin.manifest?.names?.[locale]
          || plugin.name,
      }));
  });
}

export function orderedEnabledProviders(
  providers: readonly ResolvedSurfaceProvider[],
  configured: readonly TrayProviderConfig[],
): ResolvedSurfaceProvider[] {
  const byKey = new Map(providers.map((provider) => [provider.key, provider]));
  const explicit = configured
    .filter((item) => item.enabled)
    .map((item) => byKey.get(item.id))
    .filter((provider): provider is ResolvedSurfaceProvider => Boolean(provider));
  const configuredKeys = new Set(configured.map((item) => item.id));
  const defaults = providers.filter(
    (provider) => !configuredKeys.has(provider.key) && provider.declaration.defaultEnabled === true,
  );
  return [...explicit, ...defaults];
}

export const surfaceProviderAdapters = {
  "system.display-brightness": {
    read: () => invoke<DisplayBrightnessProviderItem[]>("display_brightness_list"),
    write: ({ id, value }: { id: string; value: number }) => invoke<void>("display_brightness_set", {
      displayId: id,
      value: Math.round(Math.min(100, Math.max(0, value))),
    }),
  } satisfies LightweightSurfaceProviderAdapter<
    DisplayBrightnessProviderItem[],
    { id: string; value: number }
  >,
  "rss.unread-latest": {
    read: () => invoke<RssDashboardSnapshot>("rss_dashboard_snapshot", { limit: 6 }),
  } satisfies LightweightSurfaceProviderAdapter<RssDashboardSnapshot>,
} as const;

export async function readDisplayBrightnessProvider(): Promise<DisplayBrightnessProviderItem[]> {
  return surfaceProviderAdapters["system.display-brightness"].read();
}

export async function writeDisplayBrightnessProvider(id: string, value: number): Promise<void> {
  await surfaceProviderAdapters["system.display-brightness"].write({ id, value });
}

export async function readRssDashboardProvider(): Promise<RssDashboardSnapshot> {
  return surfaceProviderAdapters["rss.unread-latest"].read();
}

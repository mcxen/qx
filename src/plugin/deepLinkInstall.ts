/**
 * Browser → Qx deep-link install protocol.
 *
 * Supported URLs (custom scheme `qx://`):
 *
 *   qx://plugins/install?url=https%3A%2F%2F…%2Fbrew.qx-plugin
 *   qx://plugins/install?id=brew
 *   qx://plugins/install?id=brew&index=https%3A%2F%2F…%2Findex.json
 *   qx://install?url=…          (short alias)
 *   qx://install-plugin?url=…   (legacy alias)
 *
 * Only `https:` package URLs are accepted. Install still runs the host
 * marketplace path (checksum / permissions / min_app_version / platforms).
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { showPluginInstallStatus } from "../island";
import { openSettings } from "../modules/settings/openSettings";
import { marketplaceEntrySupportsPlatform } from "./platform";
import type { InstalledPlugin, PluginIndex, PluginIndexEntry } from "./types";
import { usePluginRegistry } from "./registry";

export type PluginInstallIntent =
  | { kind: "url"; downloadUrl: string; idHint?: string }
  | { kind: "id"; id: string; indexUrl?: string };

const HANDLED_SCHEMES = new Set(["qx"]);

/** Build a store-compatible deep link for a package URL or marketplace id. */
export function buildPluginInstallDeepLink(opts: {
  url?: string;
  id?: string;
  index?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.url?.trim()) params.set("url", opts.url.trim());
  if (opts.id?.trim()) params.set("id", opts.id.trim());
  if (opts.index?.trim()) params.set("index", opts.index.trim());
  const query = params.toString();
  return query ? `qx://plugins/install?${query}` : "qx://plugins/install";
}

export function parsePluginInstallDeepLink(raw: string): PluginInstallIntent | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!HANDLED_SCHEMES.has(parsed.protocol.replace(/:$/, "").toLowerCase())) {
    return null;
  }

  // Accept host-style (qx://plugins/install) and path-style (qx:///plugins/install)
  const host = (parsed.hostname || "").toLowerCase();
  const path = `${host}${parsed.pathname}`.replace(/\/+/g, "/").replace(/^\/|\/$/g, "").toLowerCase();
  const action = path || "";

  const isInstall =
    action === "plugins/install"
    || action === "plugin/install"
    || action === "install"
    || action === "install-plugin"
    || action === "marketplace/install"
    || parsed.searchParams.get("action") === "install";

  if (!isInstall) return null;

  const downloadUrl = firstParam(parsed, ["url", "download_url", "package"]);
  const id = firstParam(parsed, ["id", "plugin", "plugin_id"]);
  const indexUrl = firstParam(parsed, ["index", "index_url", "source"]);

  if (downloadUrl) {
    const safe = validateHttpsPackageUrl(downloadUrl);
    if (!safe) return null;
    return { kind: "url", downloadUrl: safe, idHint: id || undefined };
  }

  if (id) {
    return {
      kind: "id",
      id: id.trim(),
      indexUrl: indexUrl ? validateHttpsUrl(indexUrl) || undefined : undefined,
    };
  }

  return null;
}

function firstParam(url: URL, keys: string[]): string | null {
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function validateHttpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function validateHttpsPackageUrl(raw: string): string | null {
  const u = validateHttpsUrl(raw);
  if (!u) return null;
  // Prefer real package archives; still allow query-stripped github raw paths
  // that end with .qx-plugin or contain one in the path.
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith(".qx-plugin") || path.includes(".qx-plugin")) return u;
    // Allow generic https for mirrored CDN paths without extension; host
    // install still verifies zip structure.
    return u;
  } catch {
    return null;
  }
}

async function resolveDownloadUrl(intent: PluginInstallIntent): Promise<{
  downloadUrl: string;
  entry?: PluginIndexEntry;
}> {
  if (intent.kind === "url") {
    return { downloadUrl: intent.downloadUrl };
  }

  const index = await invoke<PluginIndex>("fetch_plugin_index", {
    sourceId: null,
    forceRefresh: false,
  });
  const matches = (index.plugins || []).filter((p) => p.id === intent.id);
  if (matches.length === 0) {
    throw new Error(`Plugin “${intent.id}” was not found in configured marketplaces.`);
  }

  // Prefer an entry whose download_url is already https; if the deep link
  // named a specific index host, prefer matching source.
  let entry = matches[0];
  const indexUrl = intent.indexUrl;
  if (indexUrl) {
    let indexHost = "";
    try {
      indexHost = new URL(indexUrl).host;
    } catch {
      indexHost = "";
    }
    const base = indexUrl.replace(/\/index\.json$/i, "");
    const preferred = matches.find(
      (p) =>
        (indexHost && p.source_index_url?.includes(indexHost))
        || (p.download_url?.startsWith(base) ?? false),
    );
    if (preferred) entry = preferred;
  }

  if (!marketplaceEntrySupportsPlatform(entry)) {
    const platforms = (entry.platforms || []).join(" · ") || "—";
    throw new Error(
      `Plugin “${entry.name || intent.id}” only supports ${platforms} and cannot be installed on this system.`,
    );
  }

  const downloadUrl = validateHttpsPackageUrl(entry.download_url || "");
  if (!downloadUrl) {
    throw new Error(`Plugin “${intent.id}” has no secure https download URL.`);
  }
  return { downloadUrl, entry };
}

function confirmInstall(label: string, downloadUrl: string, perms?: string[]): boolean {
  const permLine =
    perms && perms.length > 0
      ? `\n\nPermissions:\n- ${perms.slice(0, 12).join("\n- ")}${perms.length > 12 ? "\n- …" : ""}`
      : "";
  const message =
    `Install Qx plugin?\n\n${label}\n${downloadUrl}${permLine}\n\n`
    + `Package integrity and permissions are checked by Qx. Continue?`;
  return window.confirm(message);
}

let installChain: Promise<void> = Promise.resolve();
let handling = false;

async function processIntent(intent: PluginInstallIntent): Promise<void> {
  try {
    await invoke("floating_show").catch(() => {});

    showPluginInstallStatus({
      kind: "activity",
      label: "Preparing install…",
      detail: intent.kind === "id" ? intent.id : "from browser",
    });

    const { downloadUrl, entry } = await resolveDownloadUrl(intent);
    const label = entry
      ? `${entry.name} (v${entry.version})`
      : intent.kind === "id"
        ? intent.id
        : intent.idHint || downloadUrl.split("/").pop() || downloadUrl;

    const ok = confirmInstall(label, downloadUrl, entry?.required_permissions);
    if (!ok) {
      showPluginInstallStatus({
        kind: "error",
        label: "Install cancelled",
        detail: label,
      });
      return;
    }

    showPluginInstallStatus({
      kind: "activity",
      label: "Installing plugin…",
      detail: label,
    });

    const installed = await invoke<InstalledPlugin>("install_plugin_from_url", {
      url: downloadUrl,
    });

    await usePluginRegistry.getState().refresh().catch(() => {});

    showPluginInstallStatus({
      kind: "success",
      label: `${installed.name || installed.id} installed`,
      detail: `v${installed.version || "?"}`.replace(/^vv/, "v"),
      pluginId: installed.id,
    });

    openSettings({ section: "plugins", focusPluginId: installed.id, returnTo: "launcher" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showPluginInstallStatus({
      kind: "error",
      label: "Install failed",
      detail: message,
    });
    console.error("[qx deep-link] install failed", err);
  }
}

function enqueueUrls(urls: string[]): void {
  const intents = urls
    .map(parsePluginInstallDeepLink)
    .filter((x): x is PluginInstallIntent => Boolean(x));
  if (intents.length === 0) return;

  installChain = installChain.then(async () => {
    for (const intent of intents) {
      await processIntent(intent);
    }
  });
}

/**
 * Register deep-link listeners for the main Qx window.
 * Safe to call once from App mount; no-ops outside Tauri.
 */
export async function installPluginDeepLinkHandler(): Promise<() => void> {
  if (handling) return () => {};
  handling = true;

  const cleanups: Array<() => void> = [];

  try {
    const current = await getCurrent();
    if (current?.length) enqueueUrls(current);
  } catch (err) {
    console.warn("[qx deep-link] getCurrent failed", err);
  }

  try {
    const unlisten = await onOpenUrl((urls) => {
      enqueueUrls(urls);
    });
    cleanups.push(unlisten);
  } catch (err) {
    console.warn("[qx deep-link] onOpenUrl failed", err);
  }

  return () => {
    handling = false;
    for (const dispose of cleanups) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  };
}

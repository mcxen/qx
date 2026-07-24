import type { AppEntry, SearchScope } from "../store";
import type { ModuleSearchModuleId } from "../modules/settings/store";

const MODULE_SEARCH_IDS = new Set<ModuleSearchModuleId>([
  "clipboard",
  "qx-ai",
  "rss",
  "screencap",
  "macros",
  "documents",
  "weather",
  "v2ex",
  "qx-tty",
]);

/**
 * Resolve the built-in module that owns a launcher result.
 *
 * Clipboard history predates Module Surfaces and is still emitted by the slow
 * provider as `kind: "clipboard"` without `moduleId`; normalize it here so all
 * result producers share the same Settings → Module Search boundary.
 */
export function launcherSearchModuleId(
  entry: Pick<AppEntry, "kind" | "moduleId" | "path">,
): ModuleSearchModuleId | null {
  if (
    entry.kind === "clipboard"
    || entry.path === "__qx:clipboard"
    || entry.path.startsWith("__qx:clipboard:")
  ) {
    return "clipboard";
  }
  const moduleId = entry.moduleId as ModuleSearchModuleId | undefined;
  if (moduleId && MODULE_SEARCH_IDS.has(moduleId)) return moduleId;

  const builtinCommand = entry.path.match(/^__qx:cmd:builtin:([^:]+):/);
  const commandModuleId = builtinCommand?.[1] as ModuleSearchModuleId | undefined;
  if (commandModuleId && MODULE_SEARCH_IDS.has(commandModuleId)) return commandModuleId;

  const builtinRoot = entry.path.match(/^__qx:([^:]+)$/);
  const rootModuleId = builtinRoot?.[1] as ModuleSearchModuleId | undefined;
  if (rootModuleId && MODULE_SEARCH_IDS.has(rootModuleId)) return rootModuleId;

  // Older releases persisted module-specific deep links such as
  // `__qx:rss:feed:42` in the 30-day usage table. Keep those historical rows
  // behind the same per-module search switch as current encoded launches.
  const legacyModulePath = entry.path.match(/^__qx:([^:]+):/);
  const legacyModuleId = legacyModulePath?.[1] as ModuleSearchModuleId | undefined;
  if (legacyModuleId && MODULE_SEARCH_IDS.has(legacyModuleId)) return legacyModuleId;

  if (entry.path.startsWith("__qx:launch:")) {
    try {
      const launch = JSON.parse(
        decodeURIComponent(entry.path.slice("__qx:launch:".length)),
      ) as { tab?: string };
      const launchModuleId = launch.tab as ModuleSearchModuleId | undefined;
      if (launchModuleId && MODULE_SEARCH_IDS.has(launchModuleId)) {
        return launchModuleId;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Filter direct providers, Module Surfaces, sticky pins and usage recall alike. */
export function filterLauncherModuleSearchEntries(
  entries: AppEntry[],
  isEnabled: (moduleId: ModuleSearchModuleId) => boolean,
): AppEntry[] {
  return entries.filter((entry) => {
    const moduleId = launcherSearchModuleId(entry);
    return moduleId === null || isEnabled(moduleId);
  });
}

/** Whether the dedicated clipboard-history provider should run at all. */
export function shouldSearchClipboardProvider(
  scope: SearchScope,
  query: string,
  clipboardSearchEnabled: boolean,
): boolean {
  return clipboardSearchEnabled
    && (scope === "all" || scope === "clipboard")
    && query.trim().length > 0;
}

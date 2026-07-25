import type { PluginRuntimeStatus } from "../../plugin/types";
import { islandHost } from "../session/hostApi";
import type { IslandTone } from "../types";

const PLUGIN_SESSION_ID = "plugin.status";
const PLUGIN_INSTALL_SESSION_ID = "plugin.install";

/** Rate limit: one show per plugin per second (global coalesce for v1). */
let lastShowAt = 0;
const MIN_INTERVAL_MS = 1000;

/**
 * Map plugin runtime status → islandHost toast session (§5.2).
 * Replaces App.tsx pluginIsland React state.
 */
export function showPluginIslandStatus(status: PluginRuntimeStatus): void {
  const now = Date.now();
  if (now - lastShowAt < MIN_INTERVAL_MS && status.kind === "activity") {
    // Coalesce high-frequency activity: update only
    islandHost.update(PLUGIN_SESSION_ID, {
      content: {
        primary: status.label,
        secondary: status.detail,
        tone: "neutral",
        meter: { kind: "activity", activity: "wave" },
      },
      ttlMs: 8000,
    });
    return;
  }
  lastShowAt = now;

  const tone: IslandTone =
    status.kind === "error"
      ? "danger"
      : status.kind === "success"
        ? "success"
        : "neutral";

  const ttlMs =
    status.kind === "success" ? 2600 : status.kind === "error" ? 8000 : 8000;

  islandHost.show({
    id: PLUGIN_SESSION_ID,
    priority: "toast",
    source: "plugin",
    sticky: false,
    placement: "docked",
    ttlMs,
    content: {
      primary: status.label,
      secondary: status.detail,
      tone,
      meter:
        status.kind === "activity"
          ? { kind: "activity", activity: "wave" }
          : undefined,
    },
  });
}

export function clearPluginIslandStatus(): void {
  islandHost.dismiss(PLUGIN_SESSION_ID);
}

/**
 * Host-owned install/update feedback. Installation is initiated by Qx rather
 * than by a plugin runtime, so it uses the shell source and is not subject to
 * the plugin display caps. The shared ShellContent marquee keeps long error
 * messages readable in the fixed-width island.
 */
export function showPluginInstallStatus(status: PluginRuntimeStatus): void {
  const tone: IslandTone =
    status.kind === "error"
      ? "danger"
      : status.kind === "success"
        ? "success"
        : "neutral";
  const priority = status.kind === "activity"
    ? "task" as const
    : status.kind === "error"
      ? "error" as const
      : "toast" as const;

  islandHost.show({
    id: PLUGIN_INSTALL_SESSION_ID,
    priority,
    source: "shell",
    placement: "docked",
    sticky: status.kind === "activity",
    ttlMs: status.kind === "activity" ? 30_000 : 8_000,
    content: {
      primary: status.label,
      secondary: status.detail,
      tone,
      meter: status.kind === "activity"
        ? { kind: "activity", activity: "wave" }
        : undefined,
    },
  });
}

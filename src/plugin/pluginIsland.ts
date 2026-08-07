import { islandHost } from "../island";
import type { IslandShowInput } from "../island/types";
import type {
  InstalledPlugin,
  PluginIslandActionIcon,
  PluginIslandActivity,
  PluginIslandDisplayInput,
  PluginIslandProgressStyle,
} from "./types";
import { getPluginIcon } from "./pluginIconRegistry";

export type PluginIslandCommandRunner = (
  pluginId: string,
  command: string,
) => void | Promise<void>;

const workbenchProjectionSignatures = new Map<string, string>();

function normalizePluginIslandProgressStyle(
  value: unknown,
): PluginIslandProgressStyle | undefined {
  return value === "surface-fill"
    || value === "icon-ring"
    || value === "island-ring"
    || value === "compact-line"
    ? value
    : undefined;
}

export function pluginIslandSessionId(pluginId: string): string {
  return `plugin.display.${pluginId}`;
}

export function pluginHasIslandPermission(plugin: InstalledPlugin | undefined): boolean {
  if (!plugin) return false;
  const permissions = new Set([
    ...(plugin.permissions ?? []),
    ...(plugin.manifest?.permissions ?? []),
  ]);
  return permissions.has("*") || permissions.has("island");
}

export function normalizePluginIslandInput(
  payload: Record<string, unknown>,
): PluginIslandDisplayInput {
  const raw = (payload.input || {}) as Record<string, unknown>;
  const primary = String(raw.primary || "").trim().slice(0, 80);
  if (!primary) throw new Error("Plugin island primary text is required");
  const tone =
    raw.tone === "success" || raw.tone === "warning" || raw.tone === "danger"
      ? raw.tone
      : "neutral";
  const normalizeAction = (value: unknown) => {
    if (!value || typeof value !== "object") return undefined;
    const actionRaw = value as Record<string, unknown>;
    const actionIcon: PluginIslandActionIcon | undefined = actionRaw.icon === "pause"
      || actionRaw.icon === "play"
      || actionRaw.icon === "stop"
      || actionRaw.icon === "open"
      ? actionRaw.icon
      : undefined;
    const action = {
      label: String(actionRaw.label || "").trim().slice(0, 40),
      command: String(actionRaw.command || "").trim().slice(0, 128),
      icon: actionIcon,
      variant: actionRaw.variant === "danger" ? "danger" as const : "default" as const,
    };
    return action.label && action.command ? action : undefined;
  };
  const action = normalizeAction(raw.action);
  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(normalizeAction).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 2)
    : undefined;
  const activity: PluginIslandActivity | undefined =
    raw.activity === "wave"
      || raw.activity === "dots"
      || raw.activity === "spinner"
      || raw.activity === "pulse"
      ? raw.activity
      : undefined;
  const countdownRaw = raw.countdown && typeof raw.countdown === "object"
    ? raw.countdown as Record<string, unknown>
    : null;
  const durationMs = typeof countdownRaw?.durationMs === "number"
    ? countdownRaw.durationMs
    : Number.NaN;
  const endsAt = typeof countdownRaw?.endsAt === "number"
    ? countdownRaw.endsAt
    : Number.NaN;
  const remainingMs = typeof countdownRaw?.remainingMs === "number"
    ? countdownRaw.remainingMs
    : Number.NaN;
  const normalizedDuration = Number.isFinite(durationMs)
    ? Math.max(1_000, Math.min(30 * 86_400_000, durationMs))
    : undefined;
  const normalizedRemaining = Number.isFinite(remainingMs)
    ? Math.max(0, Math.min(normalizedDuration ?? 30 * 86_400_000, remainingMs))
    : undefined;
  const normalizedEndsAt = Number.isFinite(endsAt) && endsAt > 0
    ? Math.min(Date.now() + 30 * 86_400_000, endsAt)
    : undefined;
  const countdown = countdownRaw && (normalizedEndsAt != null || normalizedRemaining != null)
    ? {
        endsAt: normalizedEndsAt,
        remainingMs: normalizedRemaining,
        durationMs: normalizedDuration,
        paused: countdownRaw.paused === true,
      }
    : undefined;

  return {
    primary,
    secondary: raw.secondary == null ? undefined : String(raw.secondary).slice(0, 120),
    tone,
    progress: typeof raw.progress === "number"
      ? Math.max(0, Math.min(100, raw.progress))
      : undefined,
    progressStyle: normalizePluginIslandProgressStyle(raw.progressStyle),
    activity,
    countdown,
    action,
    actions: actions && actions.length > 0 ? actions : undefined,
    ttlMs: typeof raw.ttlMs === "number" && Number.isFinite(raw.ttlMs)
      ? Math.max(500, Math.floor(raw.ttlMs))
      : undefined,
  };
}

export function buildPluginIslandShowInput(
  plugin: InstalledPlugin,
  input: PluginIslandDisplayInput,
  runCommand?: PluginIslandCommandRunner,
): IslandShowInput {
  const commandSet = new Set((plugin.manifest?.commands ?? []).map((command) => command.name));
  const resolvedActions = (input.actions && input.actions.length > 0
    ? input.actions
    : input.action
      ? [input.action]
      : []).slice(0, 2);
  for (const action of resolvedActions) {
    if (!commandSet.has(action.command)) {
      throw new Error(`Plugin island action is not a manifest command: ${action.command}`);
    }
  }
  const identityIcon = getPluginIcon(plugin.id);
  const contentActions = resolvedActions.map((action, index) => ({
    id: index === 0 ? "plugin-command" : `plugin-command-${index}`,
    label: action.label,
    icon: action.icon,
    variant: action.variant,
  }));
  const handlers = runCommand
    ? Object.fromEntries(
      resolvedActions.map((action, index) => [
        contentActions[index].id,
        () => runCommand(plugin.id, action.command),
      ]),
    )
    : undefined;
  return {
    id: pluginIslandSessionId(plugin.id),
    priority: "location",
    source: "plugin-display",
    placement: "docked-or-float",
    openTarget: { kind: "plugin", id: plugin.id },
    sticky: true,
    ttlMs: input.ttlMs,
    content: {
      identity: identityIcon
        ? { iconName: identityIcon }
        : undefined,
      primary: input.primary,
      secondary: input.secondary,
      tone: input.tone,
      meter: input.progress != null
        ? {
            kind: "progress",
            progress: input.progress,
            presentation: input.progressStyle,
          }
        : input.activity
          ? { kind: "activity", activity: input.activity }
          : undefined,
      countdown: input.countdown,
      action: contentActions[0],
      actions: contentActions.length > 0 ? contentActions : undefined,
    },
    actions: handlers,
  };
}

export function showPluginIsland(
  plugin: InstalledPlugin,
  input: PluginIslandDisplayInput,
  runCommand?: PluginIslandCommandRunner,
): void {
  islandHost.show(buildPluginIslandShowInput(plugin, input, runCommand));
}

export function updatePluginIsland(
  plugin: InstalledPlugin,
  input: PluginIslandDisplayInput,
  runCommand?: PluginIslandCommandRunner,
): void {
  const next = buildPluginIslandShowInput(plugin, input, runCommand);
  const result = islandHost.update(next.id, {
    content: next.content,
    ttlMs: next.ttlMs ?? null,
    actions: next.actions,
  });
  if (!result.ok) islandHost.show(next);
}

export function dismissPluginIsland(pluginId: string): void {
  islandHost.dismiss(pluginIslandSessionId(pluginId));
}

/**
 * Drop host-owned island projection for one plugin (session + Workbench signature).
 * Call on disable / uninstall / registry unload so sticky location islands and
 * action handlers cannot outlive the plugin runtime.
 */
export function clearPluginIslandProjection(pluginId: string): void {
  workbenchProjectionSignatures.delete(pluginId);
  dismissPluginIsland(pluginId);
  // Toast-priority plugin sessions use free-form ids; drop any still tagged as
  // plugin source for this package when the open target matches.
  for (const session of islandHost.getSnapshot()) {
    if (session.source !== "plugin" && session.source !== "plugin-display") continue;
    if (session.id === pluginIslandSessionId(pluginId)) continue;
    if (session.openTarget?.kind === "plugin" && session.openTarget.id === pluginId) {
      islandHost.dismiss(session.id);
    }
  }
}

/** Registry-wide teardown: every plugin.display.* and plugin-source island. */
export function clearAllPluginIslandProjections(): void {
  workbenchProjectionSignatures.clear();
  for (const session of islandHost.getSnapshot()) {
    if (
      session.source === "plugin"
      || session.source === "plugin-display"
      || session.id.startsWith("plugin.display.")
    ) {
      islandHost.dismiss(session.id);
    }
  }
}

export function hasPluginIslandSession(pluginId: string): boolean {
  const id = pluginIslandSessionId(pluginId);
  return islandHost.getSnapshot().some((session) => session.id === id);
}

/**
 * Host-owned projection for declarative Workbench state. It returns false when
 * the plugin is not allowed to own an island, so the shell fallback can remain.
 */
export function syncPluginWorkbenchIsland(
  plugin: InstalledPlugin | undefined,
  input: PluginIslandDisplayInput | null | undefined,
  runCommand?: PluginIslandCommandRunner,
): boolean {
  if (!plugin || !pluginHasIslandPermission(plugin)) {
    if (plugin?.id) {
      workbenchProjectionSignatures.delete(plugin.id);
      dismissPluginIsland(plugin.id);
    }
    return false;
  }
  if (input == null) {
    workbenchProjectionSignatures.set(plugin.id, "null");
    dismissPluginIsland(plugin.id);
    // A null Workbench projection only dismisses the transient plugin-owned
    // session. It must not suppress the QxShell static fallback island.
    return false;
  }
  const signature = JSON.stringify(input);
  if (
    workbenchProjectionSignatures.get(plugin.id) === signature
    && hasPluginIslandSession(plugin.id)
  ) {
    return true;
  }
  updatePluginIsland(plugin, input, runCommand);
  workbenchProjectionSignatures.set(plugin.id, signature);
  return true;
}

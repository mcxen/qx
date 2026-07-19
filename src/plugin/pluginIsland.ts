import { islandHost } from "../island";
import type { IslandShowInput } from "../island/types";
import type {
  InstalledPlugin,
  PluginIslandActionIcon,
  PluginIslandActivity,
  PluginIslandDisplayInput,
} from "./types";
import { getPluginIcon } from "./pluginIconRegistry";

export type PluginIslandCommandRunner = (
  pluginId: string,
  command: string,
) => void | Promise<void>;

const workbenchProjectionSignatures = new Map<string, string>();

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
  const actionRaw = raw.action as Record<string, unknown> | undefined;
  const actionIcon: PluginIslandActionIcon | undefined = actionRaw?.icon === "pause"
    || actionRaw?.icon === "play"
    || actionRaw?.icon === "stop"
    || actionRaw?.icon === "open"
    ? actionRaw.icon
    : undefined;
  const action = actionRaw
    ? {
        label: String(actionRaw.label || "").trim().slice(0, 40),
        command: String(actionRaw.command || "").trim().slice(0, 128),
        icon: actionIcon,
        variant: actionRaw.variant === "danger" ? "danger" as const : "default" as const,
      }
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
    activity,
    countdown,
    action: action?.label && action.command ? action : undefined,
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
  if (
    input.action
    && !plugin.manifest?.commands?.some((command) => command.name === input.action?.command)
  ) {
    throw new Error(`Plugin island action is not a manifest command: ${input.action.command}`);
  }
  const actionId = input.action ? "plugin-command" : undefined;
  const identityIcon = getPluginIcon(plugin.id);
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
        ? { kind: "progress", progress: input.progress }
        : input.activity
          ? { kind: "activity", activity: input.activity }
          : undefined,
      countdown: input.countdown,
      action: input.action && actionId
        ? {
            id: actionId,
            label: input.action.label,
            icon: input.action.icon,
            variant: input.action.variant,
          }
        : undefined,
    },
    actions: input.action && actionId && runCommand
      ? { [actionId]: () => runCommand(plugin.id, input.action!.command) }
      : undefined,
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
    return true;
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

import type {
  PluginCommandRunOptions,
  PluginRuntimeStatus,
  RegisteredCommand,
} from "./types";
import { createUnavailableContext } from "./context";
import {
  isBackgroundCategoryEnabled,
  isBackgroundIntervalCommand,
  normalizeBackgroundCategory,
  usePluginBackgroundStore,
} from "./backgroundActivity";
import { createQxLogger } from "../lib/logger";

export interface PluginCommandDispatchResult {
  ok: boolean;
  error?: string;
}

export interface PluginCommandDispatchHooks {
  onToast?: (message: string) => void;
  onPluginStatus?: (status: PluginRuntimeStatus) => void;
}

const commandLogger = createQxLogger("plugin.command");

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").slice(0, 140);
}

/** Execute one already-registered plugin command through the existing restricted port. */
export async function dispatchPluginCommand(
  command: RegisteredCommand,
  options: PluginCommandRunOptions | undefined,
  hooks: PluginCommandDispatchHooks | null,
): Promise<PluginCommandDispatchResult> {
  const startedAt = performance.now();
  const isBackgroundJob = options?.launchType === "background";
  const backgroundCategory = normalizeBackgroundCategory(command.backgroundCategory);
  if (isBackgroundJob && !isBackgroundCategoryEnabled(backgroundCategory)) {
    usePluginBackgroundStore.getState().markPaused(command);
    commandLogger.info("Background plugin command skipped by host policy", {
      pluginId: command.pluginId,
      command: command.name,
      backgroundCategory,
    });
    return { ok: false, error: "Command disabled by host policy" };
  }
  if (isBackgroundIntervalCommand(command)) {
    usePluginBackgroundStore.getState().markRunning(command);
  }
  commandLogger.info("Plugin command dispatch started", {
    pluginId: command.pluginId,
    command: command.name,
    mode: command.mode,
    launchType: options?.launchType || (isBackgroundJob ? "background" : "userInitiated"),
  });
  try {
    await command.run(createUnavailableContext(command.pluginId), {
      launchType: options?.launchType || "userInitiated",
      timeoutMs: options?.timeoutMs,
    });
    if (isBackgroundIntervalCommand(command)) {
      usePluginBackgroundStore.getState().markFinished(command, null);
    }
    commandLogger.info("Plugin command dispatch completed", {
      pluginId: command.pluginId,
      command: command.name,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return { ok: true };
  } catch (error) {
    const summary = summarizeError(error);
    if (isBackgroundIntervalCommand(command)) {
      usePluginBackgroundStore.getState().markFinished(command, summary);
    }
    commandLogger.error("Plugin command dispatch failed", {
      pluginId: command.pluginId,
      command: command.name,
      durationMs: Math.round(performance.now() - startedAt),
      error,
    });
    if (options?.launchType !== "background") {
      hooks?.onToast?.(`Plugin command failed: ${String(error)}`);
      hooks?.onPluginStatus?.({
        kind: "error",
        pluginId: command.pluginId,
        label: "Command failed",
        detail: `${command.pluginName}: ${summary}`,
      });
    }
    return { ok: false, error: summary };
  }
}

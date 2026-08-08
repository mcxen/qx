import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";
import { setPluginIcon } from "./pluginIconRegistry";
import { handlePluginRpc } from "./rpcMethods";
import { createQxLogger } from "../lib/logger";
import {
  deletePanelRuntimeSession,
  ensurePluginShellBridge,
  panelSessions,
  registerPluginRuntime,
  setPanelRuntimeSession,
  unregisterPluginRuntime,
  type PanelRuntimeSession,
} from "./pluginShellBridge";
import { createSandboxIframe, resolvePluginAssetUrl } from "./pluginRuntimeTransport";
import {
  nextRequestId,
  sendRuntimeRequest,
  waitForPluginRuntime,
} from "./pluginRuntimeIpc";
import { preparePluginModuleGraph, type PluginModuleBundle } from "./moduleGraph";
import {
  buildPluginRuntimeHtml,
  pluginDisplaySettingsSnapshot,
} from "./pluginRuntimeHtml";
export {
  broadcastToPluginRuntimes,
  isExpectedPluginMessageOrigin,
  isPluginRuntimeSource,
  postPluginChromeKey,
  postPluginChromeQuery,
  postPluginChromeTab,
  postPluginWorkbenchEvent,
  runPluginItemAction,
  subscribePluginChrome,
  subscribePluginItemActions,
  subscribePluginWorkbench,
  type PluginChromePayload,
  type PluginItemActionDescriptor,
} from "./pluginShellBridge";
export { resolvePluginAssetUrl } from "./pluginRuntimeTransport";
export { buildPluginRuntimeHtml } from "./pluginRuntimeHtml";
const runtimeLogger = createQxLogger("plugin.runtime");
export interface PluginLoadResult {
  plugin: InstalledPlugin;
  commands: RegisteredCommand[];
  panel?: RegisteredPanel;
  iframe: HTMLIFrameElement;
  runtimeId: string;
}

export interface PluginRuntimeOptions {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  onPluginStatus?: (status: {
    kind: "activity" | "success" | "error";
    pluginId?: string;
    label: string;
    detail?: string;
  }) => void;
  onRunPluginCommand?: (pluginId: string, command: string) => Promise<void>;
}

export function unloadPluginRuntime(
  pluginId: string,
  iframe: HTMLIFrameElement,
  runtimeId: string,
): void {
  runtimeLogger.debug("Unloading plugin runtime", { pluginId, runtimeId });
  iframe.contentWindow?.postMessage({ type: "qx:unload", pluginId, runtimeId }, "*");
  unregisterPluginRuntime(pluginId, runtimeId);
}

export async function loadPlugin(
  plugin: InstalledPlugin,
  _options: PluginRuntimeOptions,
): Promise<PluginLoadResult> {
  const loadStartedAt = performance.now();
  runtimeLogger.info("Loading plugin", {
    pluginId: plugin.id,
    pluginName: plugin.name,
    version: plugin.manifest?.version,
  });
  const manifest = plugin.manifest;
  const moduleBundle = await invoke<PluginModuleBundle>("read_plugin_modules", { id: plugin.id });
  const moduleGraph = await preparePluginModuleGraph(moduleBundle);
  const workerRuntimeId = nextRequestId();
  const workerHtml = buildPluginRuntimeHtml(plugin.id, workerRuntimeId, moduleGraph,
    pluginDisplaySettingsSnapshot(), (manifest?.commands || []).map((command) => command.name),
    Boolean(manifest?.panel));
  const iframe = createSandboxIframe(workerHtml, false);
  document.body.appendChild(iframe);
  registerPluginRuntime(plugin.id, workerRuntimeId, iframe);
  // Large first-party panels (e.g. external-display-control) need headroom for
  // module graph install + first import; 10s was too tight on cold starts.
  const pluginLoaded = waitForPluginRuntime(plugin, iframe, workerRuntimeId, 20_000);
  const result: PluginLoadResult = {
    plugin,
    iframe,
    runtimeId: workerRuntimeId,
    commands: [],
  };
  const pluginIcon = await resolvePluginAssetUrl(plugin.id, manifest?.icon);
  setPluginIcon(plugin.id, pluginIcon);

  if (manifest?.commands) {
    for (const cmd of manifest.commands) {
      const commandIcon = await resolvePluginAssetUrl(plugin.id, cmd.icon);
      const registered: RegisteredCommand = {
        ...cmd,
        keywords: Array.from(new Set([
          plugin.name,
          plugin.id,
          ...(manifest.keywords || []),
          ...Object.values(manifest.names || {}),
          ...Object.values(manifest.descriptions || {}),
          ...Object.values(cmd.titles || {}),
          ...Object.values(cmd.descriptions || {}),
          ...(cmd.keywords || []),
        ].map((keyword) => keyword.trim()).filter(Boolean))),
        icon: commandIcon || pluginIcon,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon,
        async run(_ctx, options) {
          const startedAt = performance.now();
          const launchType = options?.launchType || "userInitiated";
          const timeoutMs =
            typeof options?.timeoutMs === "number" && options.timeoutMs > 0
              ? options.timeoutMs
              : launchType === "background"
                ? 120_000
                : 10_000;
          runtimeLogger.info("Plugin command started", {
            pluginId: plugin.id,
            runtimeId: workerRuntimeId,
            command: cmd.name,
            launchType,
            timeoutMs,
          });
          try {
            await sendRuntimeRequest(
              plugin,
              iframe,
              workerRuntimeId,
              "qx:runCommand",
              "qx:runCommand:response",
              { name: cmd.name, launchType },
              timeoutMs,
            );
            runtimeLogger.info("Plugin command completed", {
              pluginId: plugin.id,
              runtimeId: workerRuntimeId,
              command: cmd.name,
              durationMs: Math.round(performance.now() - startedAt),
            });
          } catch (error) {
            runtimeLogger.error("Plugin command failed", {
              pluginId: plugin.id,
              runtimeId: workerRuntimeId,
              command: cmd.name,
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          }
          return undefined;
        },
      };
      result.commands.push(registered);
    }
  }

  if (manifest?.panel) {
    const panelIcon = await resolvePluginAssetUrl(
      plugin.id,
      manifest.panel.icon || manifest.icon,
    );
    setPluginIcon(plugin.id, panelIcon || pluginIcon);
    result.panel = {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginIcon,
      title: manifest.panel.title || plugin.name,
      icon: panelIcon || pluginIcon,
      keywords: Array.from(new Set([
        plugin.name,
        plugin.id,
        ...(manifest.keywords || []),
        ...(manifest.panel.keywords || []),
      ].map((keyword) => keyword.trim()).filter(Boolean))),
      async render(container, _ctx) {
        const startedAt = performance.now();
        runtimeLogger.info("Plugin panel render started", { pluginId: plugin.id });
        const existing = panelSessions.get(container);
        if (existing) {
          unloadPluginRuntime(plugin.id, existing.iframe, existing.runtimeId);
          existing.iframe.remove();
          panelSessions.delete(container);
          deletePanelRuntimeSession(plugin.id, existing.runtimeId);
        }
        container.innerHTML = "";
        const panelRuntimeId = nextRequestId();
        const panelHtml = buildPluginRuntimeHtml(plugin.id, panelRuntimeId, moduleGraph);
        const panelIframe = createSandboxIframe(panelHtml, true);
        container.appendChild(panelIframe);
        registerPluginRuntime(plugin.id, panelRuntimeId, panelIframe);
        const session: PanelRuntimeSession = {
          iframe: panelIframe,
          runtimeId: panelRuntimeId,
          pluginId: plugin.id,
        };
        panelSessions.set(container, session);
        setPanelRuntimeSession(session);
        ensurePluginShellBridge();
        try {
          // Load + first paint only. Plugins must not await long CLI/network in panel.render
          // (host tears down the iframe on timeout). See plugin-development-guide panel rules.
          await waitForPluginRuntime(plugin, panelIframe, panelRuntimeId, 12_000, false);
          await sendRuntimeRequest(
            plugin,
            panelIframe,
            panelRuntimeId,
            "qx:renderPanel",
            "qx:renderPanel:response",
            {},
            15_000,
          );
          runtimeLogger.info("Plugin panel render completed", {
            pluginId: plugin.id,
            runtimeId: panelRuntimeId,
            durationMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          runtimeLogger.error("Plugin panel render failed", {
            pluginId: plugin.id,
            runtimeId: panelRuntimeId,
            durationMs: Math.round(performance.now() - startedAt),
            error,
          });
          unregisterPluginRuntime(plugin.id, panelRuntimeId);
          panelIframe.remove();
          panelSessions.delete(container);
          deletePanelRuntimeSession(plugin.id, panelRuntimeId);
          throw error;
        }
      },
      async destroy(container) {
        const session = panelSessions.get(container);
        if (!session) return;
        panelSessions.delete(container);
        deletePanelRuntimeSession(plugin.id, session.runtimeId);
        try {
          runtimeLogger.debug("Plugin panel destroy started", {
            pluginId: plugin.id,
            runtimeId: session.runtimeId,
          });
          await sendRuntimeRequest(
            plugin,
            session.iframe,
            session.runtimeId,
            "qx:destroyPanel",
            "qx:destroyPanel:response",
            {},
            2000,
          );
        } finally {
          runtimeLogger.debug("Plugin panel destroy completed", {
            pluginId: plugin.id,
            runtimeId: session.runtimeId,
          });
          unregisterPluginRuntime(plugin.id, session.runtimeId);
          session.iframe.remove();
        }
      },
    };
  }

  try {
    await pluginLoaded;
    runtimeLogger.info("Plugin loaded", {
      pluginId: plugin.id,
      runtimeId: workerRuntimeId,
      commandCount: result.commands.length,
      hasPanel: Boolean(result.panel),
      durationMs: Math.round(performance.now() - loadStartedAt),
    });
  } catch (error) {
    runtimeLogger.error("Plugin load failed", {
      pluginId: plugin.id,
      runtimeId: workerRuntimeId,
      durationMs: Math.round(performance.now() - loadStartedAt),
      error,
    });
    unregisterPluginRuntime(plugin.id, workerRuntimeId);
    iframe.remove();
    throw error;
  }

  return result;
}
export { handlePluginRpc };

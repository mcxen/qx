import type { InstalledPlugin } from "./types";
import { isExpectedPluginMessageOrigin } from "./pluginShellBridge";
import { qxLog } from "../lib/logger";

let requestCounter = 0;

export function nextRequestId(): string {
  requestCounter += 1;
  return `rpc-${Date.now()}-${requestCounter}`;
}

export function waitForPluginRuntime(
  plugin: InstalledPlugin,
  iframe: HTMLIFrameElement,
  runtimeId: string,
  timeoutMs: number,
  captureLogs = true,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (!isExpectedPluginMessageOrigin(event)) return;
      if (event.source !== iframe.contentWindow) return;
      if (data.pluginId !== plugin.id || data.runtimeId !== runtimeId) return;
      if (captureLogs && data.type === "qx:plugin-log") {
        qxLog(
          data.level === "error" || data.level === "warn" || data.level === "debug"
            ? data.level
            : "info",
          "plugin.iframe",
          String(data.message || ""),
          {
            pluginId: plugin.id,
            runtimeId,
            ...(data.fields || {}),
          },
        );
        return;
      }
      if (data.type === "qx:plugin:loaded") {
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve();
      } else if (data.type === "qx:plugin:error") {
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        reject(new Error(data.error || "unknown plugin error"));
      }
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} load timeout`));
    }, timeoutMs);
    window.addEventListener("message", handler);
  });
}

export function sendRuntimeRequest(
  plugin: InstalledPlugin,
  iframe: HTMLIFrameElement,
  runtimeId: string,
  type: "qx:runCommand" | "qx:renderPanel" | "qx:destroyPanel",
  responseType:
    | "qx:runCommand:response"
    | "qx:renderPanel:response"
    | "qx:destroyPanel:response",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  const requestId = nextRequestId();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (!isExpectedPluginMessageOrigin(event)) return;
      if (event.source !== iframe.contentWindow) return;
      if (data.pluginId !== plugin.id || data.runtimeId !== runtimeId) return;
      if (data.type !== responseType || data.requestId !== requestId) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", handler);
      if (data.error) reject(new Error(data.error));
      else resolve();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} ${type.replace("qx:", "")} timeout`));
    }, timeoutMs);
    window.addEventListener("message", handler);
    const target = iframe.contentWindow;
    if (!target) {
      clearTimeout(timeout);
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} runtime is not available`));
      return;
    }
    target.postMessage(
      { type, pluginId: plugin.id, runtimeId, requestId, ...payload },
      "*",
    );
  });
}

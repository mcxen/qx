import type {
  PluginWorkbenchEditEvent,
  PluginWorkbenchEditPayload,
  PluginWorkbenchEditResult,
} from "./workbenchEditTypes";

type PendingEdit = {
  pluginId: string;
  event: PluginWorkbenchEditEvent;
  timer: number;
  resolve: (result: PluginWorkbenchEditResult) => void;
};

// BluePrint's start/save handlers each perform one MCP request with a 25 s
// transport deadline. Keep a small response margin so the host does not
// report a timeout while the plugin is still delivering that response.
export const WORKBENCH_EDIT_TIMEOUT_MS = 30_000;

export function workbenchEditError(
  event: PluginWorkbenchEditEvent,
  message: string,
): PluginWorkbenchEditResult {
  return {
    phase: event.phase,
    status: "error",
    itemId: event.itemId,
    sessionId: event.sessionId,
    requestId: event.requestId,
    message,
  } as PluginWorkbenchEditResult;
}

/** Correlates host editor requests and rejects late, superseded or stale replies. */
export class WorkbenchEditBridge {
  private readonly pending = new Map<string, PendingEdit>();

  constructor(private readonly timeoutMs = WORKBENCH_EDIT_TIMEOUT_MS) {}

  request(
    pluginId: string,
    event: PluginWorkbenchEditEvent,
    post: (pluginId: string, event: PluginWorkbenchEditEvent) => void,
  ): Promise<PluginWorkbenchEditResult> {
    const key = this.key(pluginId, event.requestId);
    const previous = this.pending.get(key);
    if (previous) {
      window.clearTimeout(previous.timer);
      previous.resolve(workbenchEditError(previous.event, "The edit request was superseded."));
      this.pending.delete(key);
    }
    return new Promise<PluginWorkbenchEditResult>((resolve) => {
      const timer = window.setTimeout(() => {
        const current = this.pending.get(key);
        if (!current || current.event.sessionId !== event.sessionId) return;
        this.pending.delete(key);
        resolve(workbenchEditError(event, "The plugin did not respond in time."));
      }, this.timeoutMs);
      this.pending.set(key, { pluginId, event, timer, resolve });
      try {
        post(pluginId, event);
      } catch (error) {
        window.clearTimeout(timer);
        if (this.pending.get(key)?.event.requestId === event.requestId) {
          this.pending.delete(key);
          resolve(workbenchEditError(
            event,
            String(error).replace(/^Error:\s*/i, "").slice(0, 1_000),
          ));
        }
      }
    });
  }

  resolve(payload: PluginWorkbenchEditPayload): boolean {
    const key = this.key(payload.pluginId, payload.result.requestId);
    const current = this.pending.get(key);
    if (!current) return false;
    if (
      current.event.itemId !== payload.result.itemId
      || current.event.sessionId !== payload.result.sessionId
      || current.event.phase !== payload.result.phase
    ) return false;
    window.clearTimeout(current.timer);
    this.pending.delete(key);
    current.resolve(payload.result);
    return true;
  }

  rejectPlugin(pluginId: string, message: string): void {
    for (const [key, current] of this.pending) {
      if (current.pluginId !== pluginId) continue;
      window.clearTimeout(current.timer);
      this.pending.delete(key);
      current.resolve(workbenchEditError(current.event, message));
    }
  }

  private key(pluginId: string, requestId: string): string {
    return `${pluginId}\0${requestId}`;
  }
}

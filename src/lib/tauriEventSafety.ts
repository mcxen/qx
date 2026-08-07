/**
 * Guard Tauri's injected unlisten helper against double-unregister.
 *
 * Tauri's event plugin evaluates:
 *   listeners[eventId].handlerId
 * when the event-name map exists but the id was already removed (double unlisten,
 * StrictMode remount, surface teardown). That throws:
 *   TypeError: undefined is not an object (evaluating 'listeners[eventId].handlerId')
 * and floods the host log. Replace the internals with a null-safe version.
 */

const LISTENERS_OBJECT = "__internal_unstable_listeners_object_id__";

type EventPluginInternals = {
  unregisterListener?: (event: string, eventId: number) => void;
  __qxSafeUnlisten?: boolean;
};

export function installSafeTauriEventUnlisten(): void {
  if (typeof window === "undefined") return;
  const root = window as Window & {
    __TAURI_EVENT_PLUGIN_INTERNALS__?: EventPluginInternals;
    __TAURI_INTERNALS__?: {
      unregisterCallback?: (id: number) => void;
    };
  };
  const internals = root.__TAURI_EVENT_PLUGIN_INTERNALS__;
  if (!internals || internals.__qxSafeUnlisten) return;

  internals.unregisterListener = (event: string, eventId: number) => {
    try {
      const store = (root as unknown as Record<string, unknown>)[LISTENERS_OBJECT] as
        | Record<string, Record<string, { handlerId?: number } | undefined> | undefined>
        | undefined;
      const listeners = store?.[event];
      const listener = listeners?.[String(eventId)] ?? listeners?.[eventId as unknown as string];
      const handlerId = listener?.handlerId;
      if (typeof handlerId === "number") {
        root.__TAURI_INTERNALS__?.unregisterCallback?.(handlerId);
      }
      if (listeners && (String(eventId) in listeners || eventId in listeners)) {
        try {
          delete listeners[String(eventId)];
        } catch {
          /* non-configurable property — ignore */
        }
      }
    } catch {
      /* never let unlisten crash host cleanup */
    }
  };
  internals.__qxSafeUnlisten = true;
}

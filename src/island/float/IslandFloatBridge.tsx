import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { actionRegistry } from "../session/actionRegistry";
import { getSnapshot, subscribe } from "../session/store";
import type { IslandSession } from "../types";
import { useSettingsStore, type AppearanceSettings } from "../../modules/settings/store";
import { ISLAND_FLOAT_REQUEST_EVENT } from "../session/hostApi";
import { islandRouteForTarget } from "../session/openTarget";

interface IslandFloatBridgeProps {
  appearance: AppearanceSettings;
  enabled: boolean;
  mainVisible: boolean;
  showWhenMainHidden: boolean;
  alwaysOnTop: boolean;
  rotationSeconds: number;
}

function isFloatCandidate(session: IslandSession | undefined): boolean {
  return Boolean(
    session &&
    session.placement !== "docked" &&
    session.priority !== "home",
  );
}

/**
 * Main-webview bridge for the optional external QxIsland surface.
 * Session data stays serialized; action closures remain in the main webview.
 */
export default function IslandFloatBridge({
  appearance,
  enabled,
  mainVisible,
  showWhenMainHidden,
  alwaysOnTop,
  rotationSeconds,
}: IslandFloatBridgeProps) {
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      const sessionId = String(detail?.sessionId ?? "").trim();
      if (sessionId) setRequestedSessionId(sessionId);
    };
    window.addEventListener(ISLAND_FLOAT_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(ISLAND_FLOAT_REQUEST_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (!enabled) setRequestedSessionId(null);
  }, [enabled]);

  useEffect(() => {
    let visibilityTimer: number | undefined;
    const sync = () => {
      const sessions = getSnapshot();
      const sessionsJson = JSON.stringify(sessions);
      void invoke("island_sessions_publish", { sessionsJson }).catch(() => {});
      void emit("island:sessions", { sessions }).catch(() => {});
      void emit("island:appearance", { appearance, rotationSeconds }).catch(() => {});

      if (visibilityTimer !== undefined) window.clearTimeout(visibilityTimer);
      visibilityTimer = window.setTimeout(() => {
        void getCurrentWindow()
          .isVisible()
          .catch(() => mainVisible)
          .then((windowVisible) => {
            const requestedSession = sessions.find(
              (session) => session.id === requestedSessionId,
            );
            const visibilityAllowed = windowVisible || showWhenMainHidden;
            const shouldShow =
              enabled &&
              isFloatCandidate(requestedSession) &&
              visibilityAllowed;
            if (requestedSessionId && !requestedSession) {
              setRequestedSessionId(null);
            }
            return shouldShow
              ? invoke("island_window_show", {
                  alwaysOnTop,
                  positionX: appearance.island_float_x,
                  positionY: appearance.island_float_y,
                  hasSavedPosition:
                    Number.isFinite(appearance.island_float_x) &&
                    Number.isFinite(appearance.island_float_y),
                })
              : invoke("island_window_hide");
          })
          .catch(() => {});
      }, mainVisible ? 0 : 180);
    };

    sync();
    const unsubscribe = subscribe(sync);
    const unlisten = listen<{
      type?: string;
      sessionId?: string;
      actionId?: string;
      x?: number;
      y?: number;
    }>(
      "island:intent",
      ({ payload }) => {
        if (payload.type === "moved") {
          const x = Number(payload.x);
          const y = Number(payload.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const store = useSettingsStore.getState();
          const current = store.settings.appearance;
          const nextX = Math.round(x);
          const nextY = Math.round(y);
          if (current.island_float_x === nextX && current.island_float_y === nextY) {
            return;
          }
          store.patch("appearance", {
            ...current,
            island_float_x: nextX,
            island_float_y: nextY,
          });
          void useSettingsStore.getState().flush();
          return;
        }
        if (payload.type === "close-float") {
          setRequestedSessionId(null);
          void invoke("island_window_hide").catch(() => {});
          return;
        }
        if (payload.type === "open-session" || payload.type === "open-main") {
          const sessionId = String(payload.sessionId || "");
          const session = getSnapshot().find((candidate) => candidate.id === sessionId);
          const route = islandRouteForTarget(session?.openTarget);
          void invoke("floating_show")
            .then(() => {
              if (route) {
                window.dispatchEvent(new CustomEvent("qx:navigate", { detail: route }));
              }
            })
            .catch(() => {});
          return;
        }
        const sessionId = String(payload.sessionId || "");
        const actionId = String(payload.actionId || "");
        if (sessionId && actionId) actionRegistry.dispatch(sessionId, actionId);
      },
    );
    return () => {
      unsubscribe();
      if (visibilityTimer !== undefined) window.clearTimeout(visibilityTimer);
      void unlisten.then((stop) => stop());
    };
  }, [
    alwaysOnTop,
    appearance,
    enabled,
    mainVisible,
    requestedSessionId,
    showWhenMainHidden,
    rotationSeconds,
  ]);

  return null;
}

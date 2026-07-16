import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { actionRegistry } from "../session/actionRegistry";
import { getSnapshot, subscribe } from "../session/store";
import type { IslandSession } from "../types";

interface IslandFloatBridgeProps {
  enabled: boolean;
  mainVisible: boolean;
  showWhenMainHidden: boolean;
  alwaysOnTop: boolean;
  preferDockedWhenMainVisible: boolean;
}

function hasFloatCandidate(sessions: IslandSession[]): boolean {
  return sessions.some(
    (session) =>
      session.placement !== "docked" &&
      (session.priority === "task" || session.source === "plugin-display"),
  );
}

/**
 * Main-webview bridge for the optional external QxIsland surface.
 * Session data stays serialized; action closures remain in the main webview.
 */
export default function IslandFloatBridge({
  enabled,
  mainVisible,
  showWhenMainHidden,
  alwaysOnTop,
  preferDockedWhenMainVisible,
}: IslandFloatBridgeProps) {
  useEffect(() => {
    let visibilityTimer: number | undefined;
    const sync = () => {
      const sessions = getSnapshot();
      const sessionsJson = JSON.stringify(sessions);
      void invoke("island_sessions_publish", { sessionsJson }).catch(() => {});
      void emit("island:sessions", { sessions }).catch(() => {});

      if (visibilityTimer !== undefined) window.clearTimeout(visibilityTimer);
      visibilityTimer = window.setTimeout(() => {
        void getCurrentWindow()
          .isVisible()
          .catch(() => mainVisible)
          .then((windowVisible) => {
            const hiddenPlacementAllowed = !windowVisible && showWhenMainHidden;
            const visiblePlacementAllowed =
              windowVisible && !preferDockedWhenMainVisible;
            const shouldShow =
              enabled &&
              hasFloatCandidate(sessions) &&
              (hiddenPlacementAllowed || visiblePlacementAllowed);
            return shouldShow
              ? invoke("island_window_show", { alwaysOnTop })
              : invoke("island_window_hide");
          })
          .catch(() => {});
      }, mainVisible ? 0 : 180);
    };

    sync();
    const unsubscribe = subscribe(sync);
    const unlisten = listen<{ sessionId?: string; actionId?: string }>(
      "island:intent",
      ({ payload }) => {
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
    enabled,
    mainVisible,
    preferDockedWhenMainVisible,
    showWhenMainHidden,
  ]);

  return null;
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { IslandSession } from "../types";
import QxIslandSurface from "../surface/QxIslandSurface";
import ShellContent from "../surface/ShellContent";
import { ThemeProvider } from "../../ThemeProvider";

interface Snapshot {
  sessions_json?: string | null;
  always_on_top?: boolean;
}

/**
 * Floating island surface — slots-only (v1). No home componentId rendering.
 * Intents for actions emit `island:intent` back to the main host.
 */
export default function IslandFloatApp() {
  const [session, setSession] = useState<IslandSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<Snapshot>("island_window_get_snapshot")
      .then((snap) => {
        if (cancelled || !snap.sessions_json) return;
        try {
          const list = JSON.parse(snap.sessions_json) as IslandSession[];
          setSession(pickFloatSession(list));
        } catch {
          /* ignore malformed */
        }
      })
      .catch(() => {});

    const unlisten = listen<{ sessions: IslandSession[] }>("island:sessions", (event) => {
      setSession(pickFloatSession(event.payload.sessions ?? []));
    });

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const content = session
    ? {
        ...session.content,
        // v1 float: ignore registered components
        componentId: undefined,
        componentProps: undefined,
      }
    : null;

  return (
    <ThemeProvider>
      <div className="qx-island-float-root">
        <QxIslandSurface
          placement="floating"
          variant="shell"
          empty={!content}
          tone={content?.tone}
        >
          <ShellContent
            content={content}
            sessionId={session?.id}
            onAction={() => {
              if (!session?.content.action) return;
              void import("@tauri-apps/api/event").then(({ emit }) =>
                emit("island:intent", {
                  type: "action",
                  sessionId: session.id,
                  actionId: session.content.action?.id ?? "default",
                }),
              );
            }}
          />
        </QxIslandSurface>
      </div>
    </ThemeProvider>
  );
}

function pickFloatSession(sessions: IslandSession[]): IslandSession | null {
  // Prefer sticky host tasks, then plugin display sessions. Home never floats.
  const stickyTask = sessions.find(
    (s) => s.priority === "task" && s.sticky && s.placement !== "docked",
  );
  if (stickyTask) return stickyTask;
  const task = sessions.find(
    (s) => s.priority === "task" && s.placement !== "docked",
  );
  if (task) return task;
  return sessions.find(
    (s) => s.source === "plugin-display" && s.placement !== "docked",
  ) ?? null;
}

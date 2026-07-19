import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { IslandSession } from "../types";
import QxIslandSurface from "../surface/QxIslandSurface";
import ShellContent from "../surface/ShellContent";
import { ThemeProvider } from "../../ThemeProvider";
import { applyFloatingIslandAppearance } from "../appearance";
import { useIslandRotation } from "../session/useIslandRotation";
import type { AppearanceSettings, Settings } from "../../modules/settings/store";
import { Button } from "../../components/ui";
import { Maximize2, Minimize2, PanelTopOpen, X } from "lucide-react";
import { useT } from "../../i18n";

interface Snapshot {
  sessions_json?: string | null;
  always_on_top?: boolean;
  compact?: boolean;
}

/**
 * Floating island surface — slots-only (v1). No home componentId rendering.
 * Intents for actions emit `island:intent` back to the main host.
 */
export default function IslandFloatApp() {
  const t = useT();
  const [sessions, setSessions] = useState<IslandSession[]>([]);
  const [rotationSeconds, setRotationSeconds] = useState(8);
  const [compact, setCompact] = useState(false);
  const dragActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void invoke<Snapshot>("island_window_get_snapshot")
      .then((snap) => {
        if (cancelled) return;
        setCompact(Boolean(snap.compact));
        if (!snap.sessions_json) return;
        try {
          const list = JSON.parse(snap.sessions_json) as IslandSession[];
          setSessions(list);
        } catch {
          /* ignore malformed */
        }
      })
      .catch(() => {});

    void invoke<Settings>("get_settings")
      .then((settings) => {
        if (cancelled) return;
        applyFloatingIslandAppearance(settings.appearance);
        setRotationSeconds(settings.appearance.island_float_rotate_secs || 8);
      })
      .catch(() => {});

    const unlistenSessions = listen<{ sessions: IslandSession[] }>("island:sessions", (event) => {
      setSessions(event.payload.sessions ?? []);
    });
    const unlistenAppearance = listen<{
      appearance: AppearanceSettings;
      rotationSeconds?: number;
    }>("island:appearance", (event) => {
      applyFloatingIslandAppearance(event.payload.appearance);
      setRotationSeconds(event.payload.rotationSeconds || 8);
    });

    return () => {
      cancelled = true;
      void unlistenSessions.then((fn) => fn());
      void unlistenAppearance.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let persistTimer: number | undefined;
    const unlistenMoved = getCurrentWindow().onMoved(({ payload }) => {
      if (!dragActiveRef.current) return;
      const x = Math.round(payload.x);
      const y = Math.round(payload.y);
      void invoke("island_window_remember_position", { x, y }).catch(() => {});
      if (persistTimer !== undefined) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        void emit("island:intent", { type: "moved", x, y });
      }, 180);
    });
    return () => {
      if (persistTimer !== undefined) window.clearTimeout(persistTimer);
      void unlistenMoved.then((stop) => stop());
    };
  }, []);

  const candidates = useMemo(() => floatCandidates(sessions), [sessions]);
  const { winnerId } = useIslandRotation(candidates, rotationSeconds);
  const session = useMemo(
    () => winnerId
      ? candidates.find((candidate) => candidate.id === winnerId) ?? null
      : null,
    [candidates, winnerId],
  );

  const content = session
    ? {
        ...session.content,
        // v1 float: ignore registered components
        componentId: undefined,
        componentProps: undefined,
      }
    : null;

  const toggleCompact = () => {
    const next = !compact;
    setCompact(next);
    void invoke("island_window_set_compact", { compact: next }).catch(() => {
      setCompact(!next);
    });
  };

  const openQx = () => {
    void import("@tauri-apps/api/event").then(({ emit }) =>
      emit("island:intent", { type: "open-session", sessionId: session?.id }),
    );
  };

  const closeFloat = () => {
    void invoke("island_window_hide").catch(() => {});
    void import("@tauri-apps/api/event").then(({ emit }) =>
      emit("island:intent", { type: "close-float", sessionId: session?.id }),
    );
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, textarea, select, [data-qx-no-drag]")) {
      return;
    }
    event.preventDefault();
    dragActiveRef.current = true;
    void getCurrentWindow()
      .startDragging()
      .catch(() => {
        dragActiveRef.current = false;
      })
      .finally(() => {
        window.setTimeout(() => {
          dragActiveRef.current = false;
        }, 240);
      });
  };

  return (
    <ThemeProvider>
      <div
        className="qx-island-float-root"
        data-compact={compact ? "true" : undefined}
        onPointerDown={startDrag}
      >
        <QxIslandSurface
          placement="floating"
          variant="shell"
          empty={!content}
          tone={content?.tone}
          className="qx-island-float-surface"
        >
          <div className="qx-island-float-content">
            <ShellContent
              key={session?.id ?? "empty"}
              content={content}
              compact={compact}
              sessionId={session?.id}
              openTarget={session?.openTarget}
              onOpenTarget={session?.openTarget ? openQx : undefined}
              onAction={(actionId) => {
                if (!session) return;
                void import("@tauri-apps/api/event").then(({ emit }) =>
                  emit("island:intent", {
                    type: "action",
                    sessionId: session.id,
                    actionId,
                  }),
                );
              }}
            />
          </div>
          <span className="qx-island-float-controls">
            <Button
              className="qx-island-host-control"
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleCompact}
              aria-label={compact
                ? t("island.float.expand", "Expand Island")
                : t("island.float.compact", "Minimize Island")}
              title={compact
                ? t("island.float.expand", "Expand Island")
                : t("island.float.compact", "Minimize Island")}
            >
              {compact ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
            </Button>
            <Button
              className="qx-island-host-control"
              type="button"
              variant="ghost"
              size="sm"
              onClick={openQx}
              aria-label={t("island.float.openQx", "Open Qx")}
              title={t("island.float.openQx", "Open Qx")}
            >
              <PanelTopOpen size={12} />
            </Button>
            <Button
              className="qx-island-host-control"
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeFloat}
              aria-label={t("island.float.close", "Close Island")}
              title={t("island.float.close", "Close Island")}
            >
              <X size={12} />
            </Button>
          </span>
        </QxIslandSurface>
      </div>
    </ThemeProvider>
  );
}

function floatCandidates(sessions: IslandSession[]): IslandSession[] {
  return sessions.filter(
    (session) =>
      session.placement !== "docked" &&
      session.priority !== "home" &&
      (session.priority === "task" ||
        session.priority === "error" ||
        session.priority === "toast" ||
        session.priority === "location"),
  );
}

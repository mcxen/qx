import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { IslandSession } from "../types";
import QxIslandSurface from "../surface/QxIslandSurface";
import ShellContent from "../surface/ShellContent";
import { ThemeProvider } from "../../ThemeProvider";
import { applyFloatingIslandAppearance } from "../appearance";
import { resolveRotatingWinner } from "../session/priority";
import type { AppearanceSettings, Settings } from "../../modules/settings/store";
import { Button } from "../../components/ui";
import { Maximize2, Minimize2, PanelTopOpen } from "lucide-react";
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
  const [rotationIndex, setRotationIndex] = useState(0);
  const [compact, setCompact] = useState(false);

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

  const candidates = useMemo(() => floatCandidates(sessions), [sessions]);
  const standingSignature = candidates
    .filter((session) => session.priority === "location")
    .map((session) => session.id)
    .sort()
    .join("\u0000");
  useEffect(() => {
    setRotationIndex(0);
    const standingCount = standingSignature ? standingSignature.split("\u0000").length : 0;
    if (standingCount < 2) return;
    const timer = window.setInterval(() => {
      setRotationIndex((current) => (current + 1) % standingCount);
    }, Math.max(3, rotationSeconds) * 1000);
    return () => window.clearInterval(timer);
  }, [rotationSeconds, standingSignature]);

  const session = useMemo(() => {
    const id = resolveRotatingWinner(candidates, rotationIndex);
    return id ? candidates.find((candidate) => candidate.id === id) ?? null : null;
  }, [candidates, rotationIndex]);

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
      emit("island:intent", { type: "open-main", sessionId: session?.id }),
    );
  };

  return (
    <ThemeProvider>
      <div className="qx-island-float-root" data-compact={compact ? "true" : undefined}>
        <QxIslandSurface
          placement="floating"
          variant="shell"
          empty={!content}
          tone={content?.tone}
          className="qx-island-float-surface"
        >
          <div className="qx-island-float-content">
            <ShellContent
              content={content}
              compact={compact}
              sessionId={session?.id}
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
              className="qx-island-float-control"
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
              className="qx-island-float-control"
              type="button"
              variant="ghost"
              size="sm"
              onClick={openQx}
              aria-label={t("island.float.openQx", "Open Qx")}
              title={t("island.float.openQx", "Open Qx")}
            >
              <PanelTopOpen size={12} />
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

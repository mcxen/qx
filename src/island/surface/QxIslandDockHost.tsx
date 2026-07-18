import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getSnapshot,
  subscribe,
} from "../session/store";
import { countRotatingSessions, resolveRotatingWinner } from "../session/priority";
import { getIslandComponent } from "../components/registry";
import QxIslandSurface from "./QxIslandSurface";
import ShellContent from "./ShellContent";
import { useSettingsStore } from "../../modules/settings/store";

/**
 * Renders the docked store winner inside QxIslandSurface.
 * Exception customIsland paths suppress this via QxIslandDockSlot.
 */
export default function QxIslandDockHost() {
  // Subscribe to full snapshot so content-only updates (progress) re-render.
  const sessions = useSyncExternalStore(subscribe, getSnapshot, () => []);
  const rotationSeconds = useSettingsStore(
    (state) => state.settings.appearance.island_float_rotate_secs,
  );
  const [rotationIndex, setRotationIndex] = useState(0);
  const rotatingCount = countRotatingSessions(sessions);

  useEffect(() => {
    setRotationIndex(0);
    if (rotatingCount < 2) return;
    const intervalMs = Math.max(3, rotationSeconds || 8) * 1000;
    const timer = window.setInterval(() => {
      setRotationIndex((current) => (current + 1) % rotatingCount);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [rotatingCount, rotationSeconds]);

  const winnerId = resolveRotatingWinner(sessions, rotationIndex);
  const winner = winnerId
    ? sessions.find((session) => session.id === winnerId) ?? null
    : null;

  if (!winner) {
    return (
      <QxIslandSurface placement="docked" empty variant="shell">
        <ShellContent content={null} />
      </QxIslandSurface>
    );
  }

  const componentId = winner.content.componentId;
  if (componentId) {
    const Comp = getIslandComponent(componentId);
    if (Comp) {
      const variant =
        componentId.startsWith("home.date")
          ? "date"
          : componentId.startsWith("home.system")
            ? "system"
            : componentId.startsWith("home.") || componentId.startsWith("launcher.search")
              ? "sci"
              : "shell";
      return (
        <QxIslandSurface
          placement="docked"
          variant={variant}
          tone={winner.content.tone}
          aria-label={winner.content.primary}
        >
          <Comp {...(winner.content.componentProps ?? {})} />
        </QxIslandSurface>
      );
    }
    // Unknown componentId: fall back to slots if primary present
  }

  return (
    <QxIslandSurface
      placement="docked"
      variant="shell"
      tone={winner.content.tone}
      aria-label={winner.content.primary}
    >
      <ShellContent content={winner.content} sessionId={winner.id} />
    </QxIslandSurface>
  );
}

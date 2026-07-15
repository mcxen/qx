import { useSyncExternalStore } from "react";
import {
  getDockedWinner,
  getSnapshot,
  subscribe,
} from "../session/store";
import { getIslandComponent } from "../components/registry";
import QxIslandSurface from "./QxIslandSurface";
import ShellContent from "./ShellContent";

/**
 * Renders the docked store winner inside QxIslandSurface.
 * Exception customIsland paths suppress this via QxIslandDockSlot.
 */
export default function QxIslandDockHost() {
  // Subscribe to full snapshot so content-only updates (progress) re-render.
  useSyncExternalStore(subscribe, getSnapshot, () => []);
  const winner = getDockedWinner();

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

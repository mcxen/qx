import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { resolveDockedRenderMode } from "../session/priority";
import { getDockedWinner, subscribe } from "../session/store";
import QxIslandDockHost from "./QxIslandDockHost";
import QxIslandSurface from "./QxIslandSurface";

export interface QxIslandDockSlotProps {
  /**
   * Classified exception custom island (e.g. ScreenRecorder RecordingTransport)
   * or transitional home customNode. Suppresses store docked winner.
   */
  exception?: ReactNode;
}

/**
 * QxShell bottom-center slot.
 * Option 1: exception customIsland suppresses store winner while sessions remain.
 */
export default function QxIslandDockSlot({ exception }: QxIslandDockSlotProps) {
  const winnerId = useSyncExternalStore(
    subscribe,
    () => getDockedWinner()?.id ?? null,
    () => null,
  );

  const mode = resolveDockedRenderMode({
    exception: Boolean(exception),
    winnerId,
  });

  if (mode === "exception") {
    return <>{exception}</>;
  }

  if (mode === "store") {
    return <QxIslandDockHost />;
  }

  return (
    <QxIslandSurface placement="docked" empty variant="shell">
      <span className="qx-island-shell-placeholder" />
    </QxIslandSurface>
  );
}

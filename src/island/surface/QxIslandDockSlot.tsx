import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { resolveDockedRenderMode } from "../session/priority";
import { getDockedWinner, subscribe } from "../session/store";
import QxIslandDockHost from "./QxIslandDockHost";
import QxIslandSurface from "./QxIslandSurface";

export interface QxIslandDockSlotProps {
  /**
   * Classified exception custom island (e.g. ScreenRecorder RecordingTransport)
   * or transitional home customNode. Replaces idle content only.
   */
  exception?: ReactNode;
}

/**
 * QxShell bottom-center slot.
 * Task/error/toast sessions always take precedence over idle previews.
 */
export default function QxIslandDockSlot({ exception }: QxIslandDockSlotProps) {
  const winner = useSyncExternalStore(
    subscribe,
    () => getDockedWinner() ?? null,
    () => null,
  );

  const mode = resolveDockedRenderMode({
    exception: Boolean(exception),
    winnerId: winner?.id ?? null,
    winnerPriority: winner?.priority,
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

import { useSyncExternalStore } from "react";
import {
  getSnapshot,
  subscribe,
} from "../session/store";
import { getIslandComponent } from "../components/registry";
import QxIslandSurface from "./QxIslandSurface";
import ShellContent from "./ShellContent";
import { useSettingsStore } from "../../modules/settings/store";
import { Button } from "../../components/ui";
import { PictureInPicture2 } from "lucide-react";
import { useT } from "../../i18n";
import { islandHost } from "../session/hostApi";
import { useIslandRotation } from "../session/useIslandRotation";
import { islandRouteForTarget } from "../session/openTarget";

/**
 * Renders the docked store winner inside QxIslandSurface.
 * Exception customIsland paths suppress this via QxIslandDockSlot.
 */
export default function QxIslandDockHost() {
  const t = useT();
  // Subscribe to full snapshot so content-only updates (progress) re-render.
  const sessions = useSyncExternalStore(subscribe, getSnapshot, () => []);
  const rotationSeconds = useSettingsStore(
    (state) => state.settings.appearance.island_float_rotate_secs,
  );
  const floatEnabled = useSettingsStore(
    (state) => state.settings.appearance.island_float_enabled,
  );
  const { winnerId } = useIslandRotation(sessions, rotationSeconds);
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

  const canFloat =
    floatEnabled &&
    winner.placement !== "docked" &&
    winner.priority !== "home";
  const openRoute = islandRouteForTarget(winner.openTarget);

  return (
    <QxIslandSurface
      placement="docked"
      variant="shell"
      tone={winner.content.tone}
      aria-label={winner.content.primary}
      className={canFloat ? "qx-island-dock-popout" : undefined}
    >
      <div className="qx-island-dock-content">
        <ShellContent
          key={winner.id}
          content={winner.content}
          sessionId={winner.id}
          openTarget={winner.openTarget}
          onOpenTarget={openRoute
            ? () => window.dispatchEvent(new CustomEvent("qx:navigate", { detail: openRoute }))
            : undefined}
        />
      </div>
      {canFloat && (
        <span className="qx-island-dock-controls">
          <Button
            className="qx-island-host-control"
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => islandHost.requestFloat(winner.id)}
            aria-label={t("island.float.popOut", "Float Island")}
            title={t("island.float.popOut", "Float Island")}
          >
            <PictureInPicture2 size={12} />
          </Button>
        </span>
      )}
    </QxIslandSurface>
  );
}

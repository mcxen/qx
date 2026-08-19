import { useEffect, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
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
import { useIslandProgress } from "./useIslandProgress";
import { useStore } from "../../store";
import IslandRecentSwitcher from "../recents/IslandRecentSwitcher";
import {
  isRecentSwitcherOpen,
  loadRecentViews,
  recentsForSwitcher,
  setRecentSwitcherOpen,
  subscribeRecentSwitcher,
  subscribeRecentViews,
  tryCloseRecentSwitcher,
} from "../recents/recentViews";

const RECENT_IGNORE_SELECTOR = [
  ".qx-island-shell-actions",
  ".qx-island-dock-controls",
  ".qx-island-host-control",
  ".qx-island-recents",
].join(",");

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
  const progressState = useIslandProgress(winner?.content);
  const currentRoute = useStore((state) => String(state.tab));
  const recentViews = useSyncExternalStore(subscribeRecentViews, loadRecentViews, () => []);
  const recentsOpen = useSyncExternalStore(subscribeRecentSwitcher, isRecentSwitcherOpen, () => false);
  const recents = recentsForSwitcher(recentViews, currentRoute);
  const openRoute = winner ? islandRouteForTarget(winner.openTarget) : null;
  const hasOriginIcon = Boolean(openRoute);

  useEffect(() => {
    if (!recentsOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".qx-island-surface")) return;
      tryCloseRecentSwitcher();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [recentsOpen]);

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(RECENT_IGNORE_SELECTOR)) return;
    event.preventDefault();
    if (recents.length === 0) {
      setRecentSwitcherOpen(false);
      return;
    }
    setRecentSwitcherOpen(!recentsOpen);
  };

  const openRecent = (route: string) => {
    setRecentSwitcherOpen(false);
    window.dispatchEvent(new CustomEvent("qx:navigate", { detail: route }));
  };

  const recentsNode = recents.length > 0
    ? (
      <IslandRecentSwitcher
        open={recentsOpen}
        items={recents}
        hasOriginIcon={hasOriginIcon}
        onOpen={openRecent}
      />
    )
    : null;
  const recentsClass = recentsOpen ? "is-recents-open" : "";

  if (!winner) {
    return (
      <QxIslandSurface
        placement="docked"
        empty
        variant="shell"
        className={recentsClass}
        onDoubleClick={handleDoubleClick}
      >
        <ShellContent content={null} />
        {recentsNode}
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
          className={recentsClass}
          onDoubleClick={handleDoubleClick}
        >
          <Comp {...(winner.content.componentProps ?? {})} />
          {recentsNode}
        </QxIslandSurface>
      );
    }
    // Unknown componentId: fall back to slots if primary present
  }

  const canFloat =
    floatEnabled &&
    winner.placement !== "docked" &&
    winner.priority !== "home";

  return (
    <QxIslandSurface
      placement="docked"
      variant="shell"
      tone={winner.content.tone}
      progress={progressState.progress}
      progressStyle={winner.content.meter?.presentation}
      aria-label={winner.content.primary}
      className={[canFloat ? "qx-island-dock-popout" : "", recentsClass].filter(Boolean).join(" ") || undefined}
      onDoubleClick={handleDoubleClick}
    >
      <div className="qx-island-dock-content">
        <ShellContent
          key={winner.id}
          content={winner.content}
          progressState={progressState}
          sessionId={winner.id}
          openTarget={winner.openTarget}
          onOpenTarget={openRoute
            ? () => window.dispatchEvent(new CustomEvent("qx:navigate", { detail: openRoute }))
            : undefined}
        />
      </div>
      {recentsNode}
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

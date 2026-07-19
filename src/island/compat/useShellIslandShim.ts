import { useEffect, useRef } from "react";
import type { BottomIslandContent } from "../../components/QxBottomIsland";
import { islandHost } from "../session/hostApi";
import { mapBottomIslandContent } from "./mapBottomIslandContent";
import type {
  IslandOpenTarget,
  IslandPlacementMode,
  IslandPriority,
  IslandSource,
} from "../types";

export interface UseShellIslandShimOptions {
  /** Legacy QxShell island prop */
  island?: BottomIslandContent | null;
  /** Route key for shim session id: module.${routeKey}.shell */
  routeKey: string;
  source?: IslandSource;
  priority?: IslandPriority;
  sticky?: boolean;
  placement?: IslandPlacementMode;
  openTarget?: IslandOpenTarget;
  /** When true, do not write store (exception path owns docked) */
  suppressed?: boolean;
}

/**
 * Bridge QxShell `island={…}` into islandHost sessions.
 * Unmount / clear only dismisses this shim id.
 */
export function useShellIslandShim({
  island,
  routeKey,
  source = "module",
  priority = "location",
  sticky = false,
  placement = "docked-or-float",
  openTarget,
  suppressed = false,
}: UseShellIslandShimOptions): void {
  const sessionId = `module.${routeKey}.shell`;
  const generationRef = useRef(0);
  const publishedSignatureRef = useRef("");

  useEffect(() => {
    if (suppressed || !island) {
      islandHost.dismiss(sessionId);
      generationRef.current = 0;
      publishedSignatureRef.current = "";
      return;
    }

    const content = mapBottomIslandContent(island);
    const signature = JSON.stringify({ content, priority, source, sticky, placement, openTarget });
    if (generationRef.current !== 0 && publishedSignatureRef.current === signature) return;

    if (generationRef.current === 0) {
      const result = islandHost.show({
        id: sessionId,
        priority,
        source,
        sticky,
        content,
        placement,
        openTarget,
        replacePolicy: "replace-same-id",
      });
      generationRef.current = result.generation;
      publishedSignatureRef.current = signature;
    } else {
      const result = islandHost.update(sessionId, {
        content,
        priority,
        sticky,
        placement,
        openTarget,
      });
      if (result.ok && result.generation != null) {
        generationRef.current = result.generation;
        publishedSignatureRef.current = signature;
      } else {
        const shown = islandHost.show({
          id: sessionId,
          priority,
          source,
          sticky,
          content,
          placement,
          openTarget,
        });
        generationRef.current = shown.generation;
        publishedSignatureRef.current = signature;
      }
    }
  }, [
    island,
    island?.label,
    island?.detail,
    island?.progress,
    island?.activity,
    island?.tone,
    island?.actionLabel,
    island?.actions,
    island?.effect,
    sessionId,
    source,
    priority,
    sticky,
    placement,
    openTarget,
    suppressed,
  ]);

  useEffect(() => {
    if (suppressed || !island) return undefined;
    const actions = Object.fromEntries([
      ...(island.onAction != null ? [["default", island.onAction] as const] : []),
      ...(island.actions ?? []).slice(0, 2).map((action) => [action.id, action.onAction] as const),
    ]);
    if (Object.keys(actions).length === 0) return undefined;
    return islandHost.bindActions(sessionId, actions);
  }, [island, island?.onAction, island?.actions, sessionId, suppressed]);

  useEffect(() => {
    return () => {
      islandHost.dismiss(sessionId);
      generationRef.current = 0;
      publishedSignatureRef.current = "";
    };
  }, [sessionId]);
}

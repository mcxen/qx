import { useEffect, useRef } from "react";
import type { BottomIslandContent } from "../../components/QxBottomIsland";
import { islandHost } from "../session/hostApi";
import { mapBottomIslandContent } from "./mapBottomIslandContent";
import type { IslandPriority, IslandSource } from "../types";

export interface UseShellIslandShimOptions {
  /** Legacy QxShell island prop */
  island?: BottomIslandContent | null;
  /** Route key for shim session id: module.${routeKey}.shell */
  routeKey: string;
  source?: IslandSource;
  priority?: IslandPriority;
  sticky?: boolean;
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
  suppressed = false,
}: UseShellIslandShimOptions): void {
  const sessionId = `module.${routeKey}.shell`;
  const generationRef = useRef(0);

  useEffect(() => {
    if (suppressed || !island) {
      islandHost.dismiss(sessionId);
      generationRef.current = 0;
      return;
    }

    const content = mapBottomIslandContent(island);
    const actions =
      island.onAction != null
        ? { default: island.onAction }
        : undefined;

    if (generationRef.current === 0) {
      const result = islandHost.show({
        id: sessionId,
        priority,
        source,
        sticky,
        content,
        actions,
        placement: "docked",
        replacePolicy: "replace-same-id",
      });
      generationRef.current = result.generation;
    } else {
      const result = islandHost.update(sessionId, {
        content,
        actions,
        priority,
        sticky,
      });
      if (result.ok && result.generation != null) {
        generationRef.current = result.generation;
      } else {
        const shown = islandHost.show({
          id: sessionId,
          priority,
          source,
          sticky,
          content,
          actions,
          placement: "docked",
        });
        generationRef.current = shown.generation;
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
    island?.onAction,
    sessionId,
    source,
    priority,
    sticky,
    suppressed,
  ]);

  useEffect(() => {
    return () => {
      islandHost.dismiss(sessionId);
      generationRef.current = 0;
    };
  }, [sessionId]);
}

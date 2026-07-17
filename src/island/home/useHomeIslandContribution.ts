import { useEffect, useRef } from "react";
import type { ResolvedHomeIsland } from "../../home-island/types";
import type { HomeIslandAppearance } from "../../home-island/types";
import { mapBottomIslandContent } from "../compat/mapBottomIslandContent";
import { ensureHomeIslandComponents } from "./registerHomeComponents";
import { islandHost } from "../session/hostApi";

const HOME_SESSION_ID = "home";

/**
 * Launcher-only single writer for the global `home` session.
 * Settings preview must not call this for the global id.
 */
export function useHomeIslandContribution(
  active: boolean,
  resolved: ResolvedHomeIsland | null,
  appearance: HomeIslandAppearance,
): void {
  const genRef = useRef(0);

  useEffect(() => {
    ensureHomeIslandComponents();

    if (!active || !resolved) {
      islandHost.dismiss(HOME_SESSION_ID);
      genRef.current = 0;
      return;
    }

    const modeId = resolved.modeId;

    // Prefer componentId for custom modes; slots for shell modes.
    if (resolved.shellContent == null && modeId && modeId !== "default") {
      const componentId = `home.${modeId}`;
      const result = islandHost.show({
        id: HOME_SESSION_ID,
        priority: "home",
        source: "home",
        placement: "docked",
        content: {
          primary: modeId,
          componentId,
          componentProps: {
            showCpu: appearance.home_island_cpu,
            showMemory: appearance.home_island_memory,
            appearance: {
              ...appearance,
              home_island_mode: modeId,
            },
          },
        },
      });
      genRef.current = result.generation;
      return;
    }

    if (resolved.shellContent) {
      const content = mapBottomIslandContent(resolved.shellContent);
      const result = islandHost.show({
        id: HOME_SESSION_ID,
        priority: "home",
        source: "home",
        placement: "docked",
        content,
      });
      genRef.current = result.generation;
      return;
    }

    islandHost.dismiss(HOME_SESSION_ID);
    genRef.current = 0;
  }, [
    active,
    resolved,
    resolved?.modeId,
    resolved?.shellContent,
    appearance.home_island_cpu,
    appearance.home_island_gpu,
    appearance.home_island_memory,
    appearance,
  ]);

  useEffect(() => {
    return () => {
      islandHost.dismiss(HOME_SESSION_ID);
      genRef.current = 0;
    };
  }, []);
}

import { useEffect, useMemo, useState } from "react";
import { homeIslandDataBus } from "./data/bus";
import { ensureHomeIslandCatalog } from "./catalog";
import { normalizeHomeIslandModes } from "./registry";
import { resolveHomeIsland } from "./resolve";
import type { HomeIslandAppearance, ResolvedHomeIsland, Translate } from "./types";

/**
 * Resolve idle home island, optionally rotating through multi-selected modes.
 * Kicks the metrics bus whenever the resolved mode needs live data.
 */
export function useResolvedHomeIsland(
  appearance: HomeIslandAppearance,
  t: Translate,
  options?: {
    /** When set, pin to this mode (settings card hover / focus preview). */
    previewMode?: string | null;
    /** Disable auto-rotate (e.g. settings wants only the focused card). */
    pauseRotate?: boolean;
  },
): ResolvedHomeIsland {
  ensureHomeIslandCatalog();
  const modes = useMemo(
    () => normalizeHomeIslandModes(appearance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      appearance.home_island_mode,
      // stable key for array
      (appearance.home_island_modes ?? []).join("|"),
    ],
  );

  const rotateSecs = Math.max(0, appearance.home_island_rotate_secs ?? 8);
  const [index, setIndex] = useState(0);

  // Jump to preview mode when user selects a card in settings.
  useEffect(() => {
    if (!options?.previewMode) return;
    const i = modes.indexOf(options.previewMode);
    if (i >= 0) setIndex(i);
  }, [options?.previewMode, modes]);

  // Keep index in range when the selection set shrinks.
  useEffect(() => {
    setIndex((i) => (modes.length === 0 ? 0 : i % modes.length));
  }, [modes]);

  useEffect(() => {
    if (options?.pauseRotate || modes.length <= 1 || rotateSecs <= 0) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % modes.length);
    }, rotateSecs * 1000);
    return () => window.clearInterval(id);
  }, [modes, rotateSecs, options?.pauseRotate]);

  // Panel remount / mode change → refresh metrics immediately.
  useEffect(() => {
    homeIslandDataBus.kick();
  }, [modes, index]);

  const activeMode = options?.previewMode && modes.includes(options.previewMode)
    ? options.previewMode
    : modes[index % Math.max(1, modes.length)] ?? appearance.home_island_mode;

  return useMemo(
    () =>
      resolveHomeIsland(
        {
          ...appearance,
          home_island_mode: activeMode,
        },
        t,
      ),
    [appearance, activeMode, t],
  );
}

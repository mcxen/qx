import { useLayoutEffect, useState, type RefObject } from "react";
export function useShellBottomBar(shellRef: RefObject<HTMLDivElement | null>) {
  const [islandOverlapsActions, setIslandOverlapsActions] = useState(false);

  // Keep the island centered relative to the whole window while fitting it
  // inside the symmetric space left by the leading and trailing controls.
  // Shrinking must happen before suppression: otherwise a normal 400px island
  // disappears as soon as a route exposes several trailing actions.
  useLayoutEffect(() => {
    const root = shellRef.current;
    if (!root) {
      setIslandOverlapsActions(false);
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const bottomBar = root.querySelector<HTMLElement>(".qx-shell-bottombar");
      const islandSurface = bottomBar?.querySelector<HTMLElement>(
        '.qx-island-surface[data-placement="docked"]',
      );
      const leading = bottomBar?.querySelector<HTMLElement>(".qx-shell-left");
      const actions = bottomBar?.querySelector<HTMLElement>(".qx-shell-actions");
      if (!bottomBar || !islandSurface || !actions) {
        bottomBar?.style.removeProperty("--qx-island-safe-width");
        setIslandOverlapsActions(false);
        return;
      }
      const bottomBarRect = bottomBar.getBoundingClientRect();
      const leadingRect = leading?.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const centerX = bottomBarRect.left + bottomBarRect.width / 2;
      const edgeGap = 8;
      const leftBoundary = Math.max(
        bottomBarRect.left + edgeGap,
        (leadingRect?.right ?? bottomBarRect.left) + edgeGap,
      );
      const rightBoundary = Math.min(
        bottomBarRect.right - edgeGap,
        actionsRect.left - edgeGap,
      );
      const safeHalfWidth = Math.max(
        0,
        Math.min(centerX - leftBoundary, rightBoundary - centerX),
      );
      const safeWidth = Math.floor(safeHalfWidth * 2);
      bottomBar.style.setProperty("--qx-island-safe-width", `${safeWidth}px`);
      bottomBar.dataset.islandDensity = safeWidth < 80 ? "minimal" : safeWidth < 220 ? "compact" : "full";

      const minimumWidth = Number.parseFloat(
        window.getComputedStyle(islandSurface).minWidth,
      ) || 220;
      const critical = ["task", "error"].includes(islandSurface.dataset.priority ?? "");
      const overlaps = !critical && safeWidth < minimumWidth;
      setIslandOverlapsActions((current) => current === overlaps ? current : overlaps);
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("resize", schedule);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedule);
    resizeObserver?.observe(root);
    const bottomBar = root.querySelector<HTMLElement>(".qx-shell-bottombar");
    if (bottomBar) resizeObserver?.observe(bottomBar);
    const actions = bottomBar?.querySelector<HTMLElement>(".qx-shell-actions");
    if (actions) resizeObserver?.observe(actions);
    const islandSurface = bottomBar?.querySelector<HTMLElement>(
      '.qx-island-surface[data-placement="docked"]',
    );
    if (islandSurface) resizeObserver?.observe(islandSurface);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(schedule);
    if (bottomBar) mutationObserver?.observe(bottomBar, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-priority"] });

    return () => {
      window.removeEventListener("resize", schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.querySelector<HTMLElement>(".qx-shell-bottombar")
        ?.style.removeProperty("--qx-island-safe-width");
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

 return islandOverlapsActions;
}

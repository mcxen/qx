import { useCallback, useEffect, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import {
  resolveQxContentScroll,
  resolveQxListNavigation,
  type QxEditableNavigationPolicy,
  type QxShellNavigation,
} from "../components/qx-shell/navigationModel";
import { isEditableTarget } from "../utils/keyboard";

interface UseQxShellNavigationOptions {
  shellRef: RefObject<HTMLDivElement | null>;
  content: ReactNode;
  context?: ReactNode;
}

function isVisibleRegion(region: HTMLElement): boolean {
  return region.getAttribute("aria-hidden") !== "true"
    && !region.hasAttribute("hidden")
    && region.getClientRects().length > 0;
}

function editableNavigationAllowed(
  policy: QxEditableNavigationPolicy,
  fromSearch: boolean,
): boolean {
  if (policy === "all") return true;
  if (policy === "search") return fromSearch;
  return false;
}

/**
 * QxShell's reusable responder layer: region focus, list selection, and reading
 * scroll. Native editors keep caret movement; search fields may drive a list.
 */
export function useQxShellNavigation({ shellRef, content, context }: UseQxShellNavigationOptions) {
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);

  const getKeyboardRegions = useCallback((): HTMLElement[] => {
    const root = shellRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-qx-region]"))
      .filter(isVisibleRegion);
  }, [shellRef]);

  const activateRegion = useCallback((region: HTMLElement, focus = true) => {
    const id = region.dataset.qxRegion;
    if (!id) return;
    setActiveRegionId(id);
    if (focus) region.focus({ preventScroll: true });
  }, []);

  // Reconcile when Shell content changes so conditional regions cannot leave a
  // stale active id. State only changes when the retained/preferred id changes.
  useEffect(() => {
    const regions = getKeyboardRegions();
    if (regions.length === 0) {
      if (activeRegionId !== null) setActiveRegionId(null);
      return;
    }
    if (activeRegionId && regions.some((region) => region.dataset.qxRegion === activeRegionId)) return;
    const preferred = regions.find((region) => region.dataset.qxRegionInitial === "true") ?? regions[0];
    setActiveRegionId(preferred.dataset.qxRegion ?? null);
  }, [activeRegionId, content, context, getKeyboardRegions]);

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    if (activeRegionId) root.dataset.qxActiveRegion = activeRegionId;
    else delete root.dataset.qxActiveRegion;
    for (const region of getKeyboardRegions()) {
      region.classList.toggle("is-qx-region-active", region.dataset.qxRegion === activeRegionId);
    }
  }, [activeRegionId, getKeyboardRegions, shellRef]);

  const handleNavigationKeyDown = useCallback((
    event: KeyboardEvent<HTMLDivElement>,
    navigation?: QxShellNavigation,
  ): boolean => {
    const target = event.target instanceof Element ? event.target : null;
    const targetRegion = target?.closest<HTMLElement>("[data-qx-region]") ?? null;
    const targetRegionId = targetRegion?.dataset.qxRegion;
    const fromSearch = Boolean(target?.closest(".qx-shell-search-slot"));
    const editable = isEditableTarget(event.target);
    const hasAnyModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;

    // Left/right selects visible Shell regions only outside native editors.
    if (!editable && !hasAnyModifier && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      const regions = getKeyboardRegions();
      if (regions.length > 1) {
        const currentIndex = Math.max(0, regions.findIndex((region) =>
          region === targetRegion || region.dataset.qxRegion === activeRegionId
        ));
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = Math.max(0, Math.min(regions.length - 1, currentIndex + delta));
        event.preventDefault();
        event.stopPropagation();
        activateRegion(regions[nextIndex]);
        return true;
      }
    }

    if (navigation) {
      const policy = navigation.editable ?? "search";
      const inNavigationRegion = !navigation.regionId
        || fromSearch
        || targetRegionId === navigation.regionId
        || (!targetRegion && !fromSearch && activeRegionId === navigation.regionId);
      const command = inNavigationRegion
        ? resolveQxListNavigation({
            key: event.key,
            index: navigation.index,
            count: navigation.count,
            pageSize: navigation.pageSize,
            editable,
            allowEditable: editableNavigationAllowed(policy, fromSearch),
            modified: hasAnyModifier,
            canOpen: Boolean(navigation.onOpen),
            canClose: Boolean(navigation.onClose),
          })
        : null;

      if (command) {
        event.preventDefault();
        event.stopPropagation();
        if (command.type === "change") navigation.onChange(command.index);
        else if (command.type === "open") navigation.onOpen?.();
        else navigation.onClose?.();
        return true;
      }
    }

    // Reading movement is a fallback for the active region. Editable targets
    // (textarea/contenteditable/input) always retain their native caret/scroll.
    if (!editable && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const activeRegion = targetRegion
        ?? getKeyboardRegions().find((region) => region.dataset.qxRegion === activeRegionId)
        ?? null;
      const scrollTarget = activeRegion?.matches("[data-qx-region-scroll]")
        ? activeRegion
        : activeRegion?.querySelector<HTMLElement>("[data-qx-region-scroll]") ?? null;
      if (scrollTarget) {
        const top = resolveQxContentScroll({
          key: event.key,
          shiftKey: event.shiftKey,
          scrollTop: scrollTarget.scrollTop,
          scrollHeight: scrollTarget.scrollHeight,
          clientHeight: scrollTarget.clientHeight,
        });
        if (top !== null) {
          event.preventDefault();
          event.stopPropagation();
          scrollTarget.scrollTo({ top, behavior: "auto" });
          return true;
        }
      }
    }

    return false;
  }, [activateRegion, activeRegionId, getKeyboardRegions]);

  const handleRegionFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const region = event.target.closest<HTMLElement>("[data-qx-region]");
    if (region && shellRef.current?.contains(region)) activateRegion(region, false);
  }, [activateRegion, shellRef]);

  const handleRegionPointerCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const region = event.target.closest<HTMLElement>("[data-qx-region]");
    if (region && shellRef.current?.contains(region)) activateRegion(region, false);
  }, [activateRegion, shellRef]);

  return {
    activeRegionId,
    getKeyboardRegions,
    handleNavigationKeyDown,
    handleRegionFocusCapture,
    handleRegionPointerCapture,
  };
}

export type { QxShellNavigation } from "../components/qx-shell/navigationModel";

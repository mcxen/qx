import { useCallback } from "react";
import type { RefObject } from "react";

/**
 * Master–detail keyboard layout for QxShell modules (left list + center content).
 *
 * ## Region contract
 *
 * | Slot    | id                   | Keys when focused                          |
 * |---------|----------------------|--------------------------------------------|
 * | List    | `{module}-list`      | ↑↓ / Page / Home / End → list selection    |
 * | Detail  | `{module}-detail`    | ↑↓ / Page / Space → content scroll         |
 * | Actions | `{module}-actions`   | optional context panel; ←→ among regions   |
 *
 * ## Interaction (Shell already implements ←→ / scroll / list math)
 *
 * 1. **← / →** — cycle visible `[data-qx-region]` (list ↔ detail ↔ actions).
 * 2. **List region** + `QxShell.navigation.regionId = list` — selection only
 *    while that region is active (or search drives the list).
 * 3. **Detail region** must set `data-qx-region-scroll` (on itself or a child)
 *    so ↑↓ scrolls the article/body instead of moving the list.
 * 4. **Enter** — primary open (module `onOpen` / primaryAction).
 * 5. **Esc** — module cascade (close detail → clear query → leave).
 *
 * Hide empty detail panes with `aria-hidden="true"` so ←→ skips them until
 * content exists. Toggle `data-qx-region-initial` so focus lands on the reader
 * after open and on the list after close.
 *
 * Pair with `useQxListSelection` for list paint + scroll-follow.
 */

export type QxMasterDetailIds = {
  list: string;
  detail: string;
  actions: string;
};

/** Stable region ids: `rss-list`, `rss-detail`, `rss-actions`. */
export function qxMasterDetailIds(moduleId: string): QxMasterDetailIds {
  const base = moduleId.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "module";
  return {
    list: `${base}-list`,
    detail: `${base}-detail`,
    actions: `${base}-actions`,
  };
}

export type QxRegionDomProps = {
  "data-qx-region": string;
  "data-qx-region-label"?: string;
  "data-qx-region-initial"?: "true";
  "data-qx-region-scroll"?: true;
  tabIndex: -1;
};

/**
 * DOM props for a keyboard region. Spread onto the list / detail / actions root.
 *
 * @example
 * ```tsx
 * <div {...qxRegionProps(ids.list, { label: "Topics", initial: !detail, scroll: true })} />
 * <article
 *   {...qxRegionProps(ids.detail, { label: "Reader", initial: !!detail, scroll: true })}
 *   aria-hidden={!detail}
 * />
 * ```
 */
export function qxRegionProps(
  id: string,
  options?: {
    label?: string;
    /** Preferred region when the shell mounts or regions reappear. */
    initial?: boolean;
    /** This element (or a descendant) is the reading scroll container. */
    scroll?: boolean;
  },
): QxRegionDomProps {
  const props: QxRegionDomProps = {
    "data-qx-region": id,
    tabIndex: -1,
  };
  if (options?.label) props["data-qx-region-label"] = options.label;
  if (options?.initial) props["data-qx-region-initial"] = "true";
  if (options?.scroll) props["data-qx-region-scroll"] = true;
  return props;
}

/**
 * Focus a region by id. Prefer a shell/root ref so multi-window embeds stay scoped.
 */
export function focusQxRegion(
  regionId: string,
  root?: ParentNode | null,
): boolean {
  const scope = root ?? document;
  // Avoid CSS.escape for broader webview support; region ids are always slug-like.
  const safeId = regionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const el = scope.querySelector<HTMLElement>(`[data-qx-region="${safeId}"]`);
  if (!el || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) {
    return false;
  }
  el.focus({ preventScroll: true });
  return true;
}

/**
 * Hook: focus helpers bound to a shell or split root.
 */
export function useQxMasterDetailFocus(
  rootRef: RefObject<HTMLElement | null>,
  ids: QxMasterDetailIds,
) {
  const focusRegion = useCallback(
    (regionId: string) => focusQxRegion(regionId, rootRef.current),
    [rootRef],
  );

  const focusList = useCallback(() => focusRegion(ids.list), [focusRegion, ids.list]);
  const focusDetail = useCallback(() => focusRegion(ids.detail), [focusRegion, ids.detail]);
  const focusActions = useCallback(() => focusRegion(ids.actions), [focusRegion, ids.actions]);

  return { focusRegion, focusList, focusDetail, focusActions };
}

/**
 * Build the common `QxShell.navigation` slice for master–detail lists.
 * Module still supplies index/count/onChange and open/close side effects.
 */
export function qxMasterDetailNavigation(options: {
  ids: QxMasterDetailIds;
  index: number;
  count: number;
  onChange: (index: number) => void;
  onOpen?: () => void;
  onClose?: () => void;
  pageSize?: number;
  /** After open, move focus into the detail region. Default true. */
  focusDetailOnOpen?: boolean;
  focusList?: () => void;
  focusDetail?: () => void;
}) {
  const {
    ids,
    index,
    count,
    onChange,
    onOpen,
    onClose,
    pageSize = 8,
    focusDetailOnOpen = true,
    focusList,
    focusDetail,
  } = options;

  return {
    index,
    count,
    regionId: ids.list,
    pageSize,
    onChange: (next: number) => {
      onChange(next);
      focusList?.();
    },
    onOpen: onOpen
      ? () => {
          onOpen();
          if (focusDetailOnOpen) {
            // Open may mount detail asynchronously — rAF so the region exists.
            window.requestAnimationFrame(() => {
              focusDetail?.();
            });
          }
        }
      : undefined,
    onClose: onClose
      ? () => {
          onClose();
          focusList?.();
        }
      : undefined,
  };
}

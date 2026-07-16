import { useCallback, useEffect } from "react";
import type { RefObject } from "react";

/**
 * Shared list-selection chrome for QxShell modules.
 *
 * Split of responsibilities:
 * - **Keys / index math** → `QxShell.navigation` + `navigationModel`
 * - **Paint + scroll follow** → this hook (and `getQxListItemProps`)
 *
 * DOM contract for every keyboard-navigable row:
 * 1. Base class `qx-list-row` (optional module extras).
 * 2. Selected state class `is-active` → light surface via
 *    `var(--qx-bg-component-3)` (launcher may further tint with accent).
 * 3. Stable index attribute `data-qx-list-index="{n}"` for scroll targeting.
 * 4. `role="option"` + `aria-selected` when used inside a listbox.
 *
 * Scroll policy (UI_SPEC): when the selected row leaves the viewport, scroll
 * with `block: "nearest"` / `behavior: "auto"` so keyboard movement feels
 * native and does not animate every arrow press.
 */

export const QX_LIST_INDEX_ATTR = "data-qx-list-index";

export interface QxListItemProps {
  className: string;
  role: string;
  "aria-selected": boolean;
  [QX_LIST_INDEX_ATTR]: number;
}

export interface GetQxListItemPropsOptions {
  /** Extra classes after `qx-list-row` / `is-active` (e.g. `tall`, module row). */
  className?: string;
  role?: string;
  /** When false, omit the default `qx-list-row` base class. */
  baseClass?: boolean;
}

/** Pure: class + a11y + index attribute for one row. */
export function getQxListItemProps(
  index: number,
  selectedIndex: number,
  options: GetQxListItemPropsOptions = {},
): QxListItemProps {
  const active = index === selectedIndex;
  const base = options.baseClass === false ? "" : "qx-list-row";
  const className = [base, active ? "is-active" : "", options.className]
    .filter(Boolean)
    .join(" ");
  return {
    className,
    role: options.role ?? "option",
    "aria-selected": active,
    [QX_LIST_INDEX_ATTR]: index,
  };
}

export function isQxListIndexActive(index: number, selectedIndex: number): boolean {
  return index === selectedIndex;
}

/**
 * Scroll the row for `index` into the nearest visible edge of its scroll parent.
 * Safe no-op if the list root or row is missing.
 */
export function scrollQxListIndexIntoView(
  listRoot: HTMLElement | null | undefined,
  index: number,
  options?: {
    behavior?: ScrollBehavior;
    block?: ScrollLogicalPosition;
    inline?: ScrollLogicalPosition;
  },
): void {
  if (!listRoot || index < 0 || !Number.isFinite(index)) return;
  const row = listRoot.querySelector<HTMLElement>(
    `[${QX_LIST_INDEX_ATTR}="${Math.trunc(index)}"]`,
  );
  if (!row) return;
  row.scrollIntoView({
    block: options?.block ?? "nearest",
    inline: options?.inline ?? "nearest",
    behavior: options?.behavior ?? "auto",
  });
}

export interface UseQxListSelectionOptions {
  listRef: RefObject<HTMLElement | null>;
  /** Current keyboard / pointer selection index (owned by the module). */
  index: number;
  /**
   * Identity of the visible list (length, filter key, result signature).
   * When it changes, scroll re-runs so a new set still reveals the selection.
   */
  listSignature?: string | number;
  enabled?: boolean;
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
}

/**
 * Keeps the selected row painted (`is-active`) and scrolled into view when
 * `QxShell.navigation` changes `index`. Does **not** own selection state or
 * key handling — pass `index`/`onChange` into `QxShell.navigation` as today.
 */
export function useQxListSelection({
  listRef,
  index,
  listSignature,
  enabled = true,
  behavior = "auto",
  block = "nearest",
}: UseQxListSelectionOptions): {
  getItemProps: (itemIndex: number, options?: GetQxListItemPropsOptions) => QxListItemProps;
  isActive: (itemIndex: number) => boolean;
  scrollSelectedIntoView: () => void;
} {
  const scrollSelectedIntoView = useCallback(() => {
    if (!enabled) return;
    scrollQxListIndexIntoView(listRef.current, index, { behavior, block });
  }, [behavior, block, enabled, index, listRef]);

  useEffect(() => {
    if (!enabled) return;
    const frame = window.requestAnimationFrame(() => {
      scrollQxListIndexIntoView(listRef.current, index, { behavior, block });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [behavior, block, enabled, index, listRef, listSignature]);

  const getItemProps = useCallback(
    (itemIndex: number, options?: GetQxListItemPropsOptions) =>
      getQxListItemProps(itemIndex, index, options),
    [index],
  );

  const isActive = useCallback(
    (itemIndex: number) => isQxListIndexActive(itemIndex, index),
    [index],
  );

  return { getItemProps, isActive, scrollSelectedIntoView };
}

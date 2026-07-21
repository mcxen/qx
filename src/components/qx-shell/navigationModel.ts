export type QxEditableNavigationPolicy = "none" | "search" | "all";

const SEARCH_READING_PROXY_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown"]);

/** Empty Workbench search is a keyboard launch point for master/detail regions. */
export function shouldSwitchRegionFromSearch(input: {
  key: string;
  query: string;
  regionCount: number;
  modified: boolean;
}): boolean {
  return input.query.length === 0
    && input.regionCount > 1
    && !input.modified
    && (input.key === "ArrowLeft" || input.key === "ArrowRight");
}

/**
 * A search input can retain DOM focus while pointer interaction activates a
 * reading region. In that state, vertical reading keys belong to the active
 * detail pane; text, horizontal caret movement, Home/End, and modified
 * selections remain native input behavior.
 */
export function shouldProxySearchReadingKey(input: {
  key: string;
  fromSearch: boolean;
  activeRegionId: string | null;
  navigationRegionId?: string;
  modified: boolean;
}): boolean {
  return input.fromSearch
    && Boolean(input.activeRegionId)
    && input.activeRegionId !== input.navigationRegionId
    && !input.modified
    && SEARCH_READING_PROXY_KEYS.has(input.key);
}

/** Shared list-navigation contract consumed by every QxShell module. */
export interface QxShellNavigation {
  index: number;
  count: number;
  onChange: (index: number) => void;
  onOpen?: () => void;
  onClose?: () => void;
  pageSize?: number;
  /** Restrict list movement to one data-qx-region while still allowing search. */
  regionId?: string;
  /** Editable fields keep native keys; search inputs may drive lists by default. */
  editable?: QxEditableNavigationPolicy;
}

export type QxListNavigationCommand =
  | { type: "change"; index: number }
  | { type: "open" }
  | { type: "close" };

interface ResolveListNavigationOptions {
  key: string;
  index: number;
  count: number;
  pageSize?: number;
  editable: boolean;
  allowEditable: boolean;
  modified: boolean;
  canOpen: boolean;
  canClose: boolean;
}

/** Pure key resolver: DOM/focus policy stays in the hook, movement math stays testable. */
export function resolveQxListNavigation({
  key,
  index,
  count,
  pageSize,
  editable,
  allowEditable,
  modified,
  canOpen,
  canClose,
}: ResolveListNavigationOptions): QxListNavigationCommand | null {
  if (count <= 0 || modified || (editable && !allowEditable)) return null;

  const last = count - 1;
  const current = Math.max(0, Math.min(index, last));
  const page = Math.max(1, pageSize ?? 8);

  if (key === "ArrowDown") return { type: "change", index: Math.min(last, current + 1) };
  if (key === "ArrowUp") return { type: "change", index: Math.max(0, current - 1) };
  if (key === "PageDown") return { type: "change", index: Math.min(last, current + page) };
  if (key === "PageUp") return { type: "change", index: Math.max(0, current - page) };

  // Home/End and disclosure arrows retain native caret semantics in editable fields.
  if (editable) return null;
  if (key === "Home") return { type: "change", index: 0 };
  if (key === "End") return { type: "change", index: last };
  if (key === "ArrowRight" && canOpen) return { type: "open" };
  if (key === "ArrowLeft" && canClose) return { type: "close" };
  return null;
}

interface ResolveContentScrollOptions {
  key: string;
  shiftKey: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Pure reading/content movement resolver shared by every data-qx-region-scroll area. */
export function resolveQxContentScroll({
  key,
  shiftKey,
  scrollTop,
  scrollHeight,
  clientHeight,
}: ResolveContentScrollOptions): number | null {
  if (scrollHeight <= clientHeight + 1) return null;
  const page = Math.max(48, Math.round(clientHeight * 0.82));

  if (key === "ArrowDown" && !shiftKey) return scrollTop + 56;
  if (key === "ArrowUp" && !shiftKey) return scrollTop - 56;
  if (key === "PageDown" && !shiftKey) return scrollTop + page;
  if (key === "PageUp" && !shiftKey) return scrollTop - page;
  if (key === " " && !shiftKey) return scrollTop + page;
  if (key === " " && shiftKey) return scrollTop - page;
  if (key === "Home" && !shiftKey) return 0;
  if (key === "End" && !shiftKey) return scrollHeight;
  return null;
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const CONTEXT_WIDTH_STORAGE_KEY = "qx:shell:context-width";
const CONTEXT_HANDLE_WIDTH = 8;
const CONTEXT_MIN_WIDTH = 220;
const CONTEXT_MAX_WIDTH = 420;
const CONTENT_MIN_WIDTH = 320;
const CONTEXT_COLLAPSE_THRESHOLD = 160;
const KEYBOARD_STEP = 24;

function readStoredWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONTEXT_WIDTH_STORAGE_KEY);
    if (raw == null) return null;
    const width = Number(raw);
    if (!Number.isFinite(width) || width < 0) return null;
    if (width < CONTEXT_COLLAPSE_THRESHOLD) return 0;
    return Math.round(Math.max(CONTEXT_MIN_WIDTH, Math.min(CONTEXT_MAX_WIDTH, width)));
  } catch {
    return null;
  }
}

function persistWidth(width: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (width == null) window.localStorage.removeItem(CONTEXT_WIDTH_STORAGE_KEY);
    else window.localStorage.setItem(CONTEXT_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // The splitter remains usable if a private WebView blocks persistence.
  }
}

function clampWidth(width: number, maximum: number): number {
  return Math.round(Math.max(CONTEXT_MIN_WIDTH, Math.min(maximum, width)));
}

export default function QxContextSplit({
  children,
  context,
  separatorLabel,
}: {
  children: ReactNode;
  context: ReactNode;
  separatorLabel: string;
}) {
  const splitRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [contextWidth, setContextWidth] = useState<number | null>(readStoredWidth);
  const [dragging, setDragging] = useState(false);

  const maximumWidth = useCallback(() => {
    const width = splitRef.current?.getBoundingClientRect().width ?? 980;
    return Math.max(
      CONTEXT_MIN_WIDTH,
      Math.min(CONTEXT_MAX_WIDTH, width - CONTENT_MIN_WIDTH - CONTEXT_HANDLE_WIDTH),
    );
  }, []);

  const commitWidth = useCallback((width: number | null) => {
    setContextWidth(width);
    persistWidth(width);
  }, []);

  const measuredWidth = useCallback(() => {
    if (contextWidth != null) return contextWidth;
    const contextElement = splitRef.current?.querySelector<HTMLElement>(".qx-shell-context");
    return contextElement?.getBoundingClientRect().width || CONTEXT_MIN_WIDTH;
  }, [contextWidth]);

  const updateFromPointer = useCallback((clientX: number) => {
    const split = splitRef.current;
    if (!split) return;
    const rawWidth = split.getBoundingClientRect().right - clientX;
    commitWidth(
      rawWidth < CONTEXT_COLLAPSE_THRESHOLD
        ? 0
        : clampWidth(rawWidth, maximumWidth()),
    );
  }, [commitWidth, maximumWidth]);

  const finishDrag = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag();

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);

    const onMove = (moveEvent: PointerEvent) => updateFromPointer(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setDragging(false);
      dragCleanupRef.current = null;
    };

    updateFromPointer(event.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    dragCleanupRef.current = onUp;
  }, [finishDrag, updateFromPointer]);

  useEffect(() => () => finishDrag(), [finishDrag]);

  const nudgeWidth = useCallback((delta: number) => {
    const current = measuredWidth();
    const next = current + delta;
    commitWidth(
      delta < 0 && next < CONTEXT_MIN_WIDTH
        ? 0
        : clampWidth(next, maximumWidth()),
    );
  }, [commitWidth, maximumWidth, measuredWidth]);

  const onSeparatorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      // Moving the separator left expands the right-hand Context panel.
      nudgeWidth(event.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      commitWidth(event.key === "Home" ? maximumWidth() : 0);
    }
  }, [commitWidth, maximumWidth, nudgeWidth]);

  const collapsed = contextWidth === 0;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (contextWidth == null) root.style.removeProperty("--qx-context-current-w");
    else root.style.setProperty("--qx-context-current-w", `${contextWidth}px`);
  }, [contextWidth]);

  const splitStyle = contextWidth == null
    ? undefined
    : { "--qx-context-current-w": `${contextWidth}px` } as CSSProperties;

  return (
    <div
      ref={splitRef}
      className={`qx-shell-main qx-context-split${collapsed ? " is-context-collapsed" : ""}${dragging ? " is-resizing-context" : ""}`}
      style={splitStyle}
    >
      <main className="qx-shell-content">{children}</main>
      <div
        className="qx-shell-context-handle"
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={maximumWidth()}
        aria-valuenow={contextWidth ?? undefined}
        tabIndex={0}
        data-qx-no-window-drag
        data-qx-search-focus="preserve"
        onPointerDown={startResize}
        onKeyDown={onSeparatorKeyDown}
        onDoubleClick={() => commitWidth(null)}
      />
      <aside
        className="qx-shell-context"
        aria-hidden={collapsed || undefined}
        inert={collapsed || undefined}
      >
        {context}
      </aside>
    </div>
  );
}

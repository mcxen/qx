import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const RESIZE_HANDLE_WIDTH = 8;

export interface QxResizableSplitProps {
  /** Exactly two direct children: the left/list pane and right/detail pane. */
  children: ReactNode;
  /** Optional positioned overlay, such as a toast, that does not participate in the split. */
  overlay?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Persist the left pane width across module visits. */
  storageKey?: string;
  /** Null leaves the initial width to the split's CSS fallback. */
  defaultLeftWidth?: number | null;
  /** Width restored by double-clicking the separator. Defaults to defaultLeftWidth. */
  resetLeftWidth?: number | null;
  minLeftWidth?: number;
  minRightWidth?: number;
  keyboardStep?: number;
  separatorLabel: string;
  onLeftWidthChange?: (width: number | null) => void;
}

function readStoredWidth(storageKey: string | undefined): number | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function persistWidth(storageKey: string | undefined, width: number | null): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    if (width == null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, String(width));
  } catch {
    // Resizing remains available when a private WebView blocks persistence.
  }
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function splitWidthFromComputedStyle(split: HTMLDivElement): number | null {
  const firstColumn = window.getComputedStyle(split).gridTemplateColumns.split(/\s+/)[0];
  const width = Number.parseFloat(firstColumn);
  return Number.isFinite(width) && width > 0 ? width : null;
}

export default function QxResizableSplit({
  children,
  overlay,
  className,
  style,
  storageKey,
  defaultLeftWidth = null,
  resetLeftWidth,
  minLeftWidth = 220,
  minRightWidth = 320,
  keyboardStep = 24,
  separatorLabel,
  onLeftWidthChange,
}: QxResizableSplitProps) {
  const panes = Children.toArray(children);
  if (panes.length !== 2) {
    throw new Error("QxResizableSplit requires exactly two direct pane children");
  }

  const splitRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [leftWidth, setLeftWidth] = useState<number | null>(() =>
    readStoredWidth(storageKey) ?? defaultLeftWidth,
  );
  const [dragging, setDragging] = useState(false);

  const getBounds = useCallback(() => {
    const splitWidth = splitRef.current?.getBoundingClientRect().width ?? 980;
    return {
      min: minLeftWidth,
      max: Math.max(minLeftWidth, splitWidth - minRightWidth - RESIZE_HANDLE_WIDTH),
    };
  }, [minLeftWidth, minRightWidth]);

  const commitWidth = useCallback((width: number | null) => {
    setLeftWidth(width);
    persistWidth(storageKey, width);
    onLeftWidthChange?.(width);
  }, [onLeftWidthChange, storageKey]);

  const updateWidth = useCallback((clientX: number) => {
    const split = splitRef.current;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    const bounds = getBounds();
    commitWidth(clampWidth(clientX - rect.left, bounds.min, bounds.max));
  }, [commitWidth, getBounds]);

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

    const onMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setDragging(false);
      dragCleanupRef.current = null;
    };

    updateWidth(event.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    dragCleanupRef.current = onUp;
  }, [finishDrag, updateWidth]);

  useEffect(() => () => finishDrag(), [finishDrag]);

  const nudgeWidth = useCallback((delta: number) => {
    const split = splitRef.current;
    if (!split) return;
    const bounds = getBounds();
    const current = leftWidth ?? splitWidthFromComputedStyle(split) ?? bounds.min;
    commitWidth(clampWidth(current + delta, bounds.min, bounds.max));
  }, [commitWidth, getBounds, leftWidth]);

  const onSeparatorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      nudgeWidth(event.key === "ArrowLeft" ? -keyboardStep : keyboardStep);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const bounds = getBounds();
      commitWidth(event.key === "Home" ? bounds.min : bounds.max);
    }
  }, [commitWidth, getBounds, keyboardStep, nudgeWidth]);

  const resetWidth = resetLeftWidth === undefined ? defaultLeftWidth : resetLeftWidth;
  const splitStyle = leftWidth == null
    ? style
    : { ...style, "--qx-split-left-w": `${leftWidth}px` } as CSSProperties;
  const classes = ["qx-resizable-split", className, dragging ? "is-resizing" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={splitRef} className={classes} style={splitStyle}>
      {overlay ? <div className="qx-resizable-split-overlay">{overlay}</div> : null}
      {panes[0]}
      <div
        className="qx-resizable-split-handle"
        role="separator"
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemin={minLeftWidth}
        aria-valuenow={leftWidth ?? undefined}
        tabIndex={0}
        data-qx-search-focus="preserve"
        onPointerDown={startResize}
        onKeyDown={onSeparatorKeyDown}
        onDoubleClick={() => commitWidth(resetWidth)}
      />
      {panes[1]}
    </div>
  );
}

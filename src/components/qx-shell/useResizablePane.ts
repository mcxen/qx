import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { constrainSplitWidth, splitBounds, splitKeyWidth } from "./splitGeometry";

interface Options {
  side: "left" | "right";
  storageKey?: string;
  initial?: number | null;
  reset?: number | null;
  min: number;
  otherMin: number;
  max?: number;
  collapseAt?: number;
  step?: number;
  onChange?: (width: number | null) => void;
}

/** Shared pointer/keyboard/persistence lifecycle; wrappers retain pane semantics. */
export function useResizablePane(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const ref = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [preferred, setPreferred] = useState<number | null>(() => {
    try {
      const raw = options.storageKey ? localStorage.getItem(options.storageKey) : null;
      const saved = raw == null ? NaN : Number(raw);
      if (Number.isFinite(saved) && (saved > 0 || (saved === 0 && options.collapseAt != null))) return saved;
    } catch { /* Private WebViews may deny storage; resizing still works. */ }
    return options.initial ?? null;
  });
  const preferredRef = useRef(preferred);
  const [geometry, setGeometry] = useState({ total: 980, measured: options.min });
  const [dragging, setDragging] = useState(false);
  const bounds = splitBounds(geometry.total, options.min, options.otherMin, options.max, options.collapseAt);
  const width = preferred == null ? null : constrainSplitWidth(preferred, bounds);
  const current = width ?? geometry.measured;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const currentRef = useRef(current);
  currentRef.current = current;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const panes = [...root.children].filter((node) => !node.matches('[role="separator"], .qx-resizable-split-overlay'));
      const pane = optionsRef.current.side === "right" ? panes[panes.length - 1] : panes[0];
      const total = root.getBoundingClientRect().width;
      const measured = pane?.getBoundingClientRect().width ?? optionsRef.current.min;
      setGeometry((old) => old.total === total && old.measured === measured ? old : { total, measured });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  const update = useCallback((value: number | null) => {
    preferredRef.current = value;
    setPreferred(value);
  }, []);
  const persist = useCallback(() => {
    const { storageKey, onChange } = optionsRef.current;
    const value = preferredRef.current;
    try {
      if (storageKey) {
        if (value == null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, String(value));
      }
    } catch { /* Persistence is optional, never block interaction. */ }
    onChange?.(value);
  }, []);
  const commit = useCallback((value: number | null) => { update(value); persist(); }, [update, persist]);

  const start = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !ref.current) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const rect = ref.current.getBoundingClientRect();
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);
    let frame = 0;
    let latest = event.clientX;
    const paint = () => {
      frame = 0;
      const value = optionsRef.current.side === "right" ? rect.right - latest : latest - rect.left;
      update(constrainSplitWidth(value, boundsRef.current));
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      latest = next.clientX;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const finish = () => {
      if (frame) { cancelAnimationFrame(frame); paint(); }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      setDragging(false);
      persist();
      cleanup.current = null;
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      if (next.type === "pointerup") { if (frame) cancelAnimationFrame(frame); latest = next.clientX; paint(); }
      finish();
    };
    paint();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", finish);
    cleanup.current = finish;
  }, [update, persist]);
  useEffect(() => () => cleanup.current?.(), []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const value = splitKeyWidth(event.key, currentRef.current, options.step ?? 24, options.side, bounds);
    if (value == null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    commit(value);
  };
  return { ref, width, dragging, separator: {
    role: "separator" as const, "aria-orientation": "vertical" as const,
    "aria-valuemin": options.collapseAt != null ? 0 : bounds.min,
    "aria-valuemax": bounds.max, "aria-valuenow": current,
    tabIndex: 0, onPointerDown: start, onKeyDown,
    onDoubleClick: () => commit(options.reset ?? null),
  } };
}

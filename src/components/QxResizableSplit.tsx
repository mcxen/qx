import { Children, type CSSProperties, type ReactNode } from "react";
import { useResizablePane } from "./qx-shell/useResizablePane";

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

  const pane = useResizablePane({ side: "left", storageKey, initial: defaultLeftWidth, reset: resetLeftWidth === undefined ? defaultLeftWidth : resetLeftWidth, min: minLeftWidth, otherMin: minRightWidth, step: keyboardStep, onChange: onLeftWidthChange });
  const { ref: splitRef, width: leftWidth, dragging } = pane;
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
        {...pane.separator}
        aria-label={separatorLabel}
        data-qx-search-focus="preserve"
      />
      {panes[1]}
    </div>
  );
}

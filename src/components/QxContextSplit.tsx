import { useLayoutEffect, type ReactNode, type CSSProperties } from "react";
import { useResizablePane } from "./qx-shell/useResizablePane";

export default function QxContextSplit({ children, context, separatorLabel }: { children: ReactNode; context: ReactNode; separatorLabel: string }) {
  const pane = useResizablePane({ side: "right", storageKey: "qx:shell:context-width", min: 220, max: 420, otherMin: 320, collapseAt: 160 });
  const { ref: splitRef, width: contextWidth, dragging } = pane;
  const collapsed = contextWidth === 0;
  useLayoutEffect(() => {
    const shell = splitRef.current?.closest<HTMLElement>(".qx-shell");
    if (!shell) return;
    if (contextWidth == null) shell.style.removeProperty("--qx-context-current-w");
    else shell.style.setProperty("--qx-context-current-w", String(contextWidth) + "px");
    return () => { shell.style.removeProperty("--qx-context-current-w"); };
  }, [contextWidth, splitRef]);
  const splitStyle = contextWidth == null ? undefined : { "--qx-context-current-w": String(contextWidth) + "px" } as CSSProperties;
  return (
    <div
      ref={splitRef}
      className={`qx-shell-main qx-context-split${collapsed ? " is-context-collapsed" : ""}${dragging ? " is-resizing-context" : ""}`}
      style={splitStyle}
    >
      <main className="qx-shell-content">{children}</main>
      <div
        className="qx-shell-context-handle"
        {...pane.separator}
        aria-label={separatorLabel}
        data-qx-no-window-drag
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

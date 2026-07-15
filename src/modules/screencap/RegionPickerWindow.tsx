import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Dedicated transparent fullscreen surface for region selection.
 * Must NOT use the main Qx glass shell — that was the full-screen mask users saw.
 * Drag a rectangle in place; release starts recording that crop (logical points).
 */
export default function RegionPickerWindow() {
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("qx-region-picker-body");
    rootRef.current?.focus();
    return () => {
      document.body.classList.remove("qx-region-picker-body");
    };
  }, []);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("screencap_cancel_region_select");
    } catch {
      // best-effort
    }
  }, [busy]);

  const confirm = useCallback(
    async (x: number, y: number, w: number, h: number) => {
      if (busy) return;
      setBusy(true);
      let options: Record<string, unknown> | null = null;
      try {
        options = JSON.parse(localStorage.getItem("qx.screencap.options") ?? "null") as Record<
          string,
          unknown
        > | null;
      } catch {
        options = null;
      }
      try {
        // Logical CSS points relative to the primary display (picker covers it).
        // xcap capture_region expects points, not physical pixels.
        await invoke("screencap_confirm_region_select", {
          area: {
            x: Math.max(0, Math.round(x)),
            y: Math.max(0, Math.round(y)),
            w: Math.max(2, Math.round(w)),
            h: Math.max(2, Math.round(h)),
          },
          options,
        });
      } catch {
        try {
          await invoke("screencap_cancel_region_select");
        } catch {
          // ignore
        }
      }
    },
    [busy],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (busy || e.button !== 0) return;
    e.preventDefault();
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || busy) return;
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    if (!dragStart || !dragEnd || busy) {
      void cancel();
      return;
    }
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    setDragStart(null);
    setDragEnd(null);
    if (w < 16 || h < 16) {
      void cancel();
      return;
    }
    void confirm(x, y, w, h);
  };

  const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
  const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
  const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
  const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;
  const dragging = Boolean(dragStart && dragEnd && selW > 2 && selH > 2);

  return (
    <div
      ref={rootRef}
      className="qx-region-picker"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          void cancel();
        }
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        // Leaving the screen edge mid-drag: keep last point; mouseup still fires.
      }}
    >
      {dragging && (
        <>
          {/* Dim only outside the selection while dragging — never a full pre-mask. */}
          <div className="qx-region-picker-shade" style={{ left: 0, top: 0, right: 0, height: selY }} />
          <div className="qx-region-picker-shade" style={{ left: 0, top: selY + selH, right: 0, bottom: 0 }} />
          <div className="qx-region-picker-shade" style={{ left: 0, top: selY, width: selX, height: selH }} />
          <div className="qx-region-picker-shade" style={{ left: selX + selW, top: selY, right: 0, height: selH }} />
          <div
            className="qx-region-picker-rect"
            style={{ left: selX, top: selY, width: selW, height: selH }}
          />
          <div
            className="qx-region-picker-size"
            style={{ left: selX, top: Math.max(8, selY - 28) }}
          >
            {Math.round(selW)} × {Math.round(selH)}
          </div>
        </>
      )}
      {!dragging && !busy && (
        <div className="qx-region-picker-hint">
          直接在桌面上拖动圈选区域，松手开始录制 · Esc 取消
        </div>
      )}
    </div>
  );
}

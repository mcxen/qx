import { useEffect, useState } from "react";

export type Point = { x: number; y: number };

function ScreenshotRegionOverlay({
  backgroundPath,
  onComplete,
  onCancel,
}: {
  backgroundPath: string;
  onComplete: (start: Point, end: Point) => void;
  onCancel: () => void;
}) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const onMouseDown = (event: React.MouseEvent) => {
    const point = { x: event.clientX, y: event.clientY };
    setDragStart(point);
    setDragEnd(point);
  };

  const onMouseMove = (event: React.MouseEvent) => {
    if (!dragStart) return;
    setDragEnd({ x: event.clientX, y: event.clientY });
  };

  const onMouseUp = () => {
    if (!dragStart || !dragEnd) {
      onCancel();
      return;
    }
    onComplete(dragStart, dragEnd);
  };

  const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
  const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
  const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
  const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;

  // Four dim rectangles around the selection to create the "spotlight" effect
  const dimStyle: React.CSSProperties = {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.5)",
    pointerEvents: "none",
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: "fixed",
        inset: 0,
        cursor: "crosshair",
        zIndex: 1000,
        backgroundImage: `url(file://${backgroundPath})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Dim overlay everywhere */}
      {!dragStart && <div style={{ ...dimStyle, inset: 0 }} />}
      {dragStart && dragEnd && (
        <>
          {/* Top strip */}
          <div style={{ ...dimStyle, left: 0, top: 0, right: 0, height: selY }} />
          {/* Bottom strip */}
          <div style={{ ...dimStyle, left: 0, top: selY + selH, right: 0, bottom: 0 }} />
          {/* Left strip */}
          <div style={{ ...dimStyle, left: 0, top: selY, width: selX, height: selH }} />
          {/* Right strip */}
          <div style={{ ...dimStyle, left: selX + selW, top: selY, right: 0, height: selH }} />
          {/* Selection border */}
          <div
            style={{
              position: "absolute",
              left: selX,
              top: selY,
              width: selW,
              height: selH,
              border: "2px solid #3B82F6",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          />
          {/* Size badge */}
          {selW > 0 && selH > 0 && (
            <div
              style={{
                position: "absolute",
                left: selX,
                top: Math.max(0, selY - 28),
                backgroundColor: "rgba(59,130,246,0.95)",
                color: "#fff",
                fontSize: 12,
                fontFamily: "monospace",
                padding: "2px 8px",
                borderRadius: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              {Math.round(selW)} × {Math.round(selH)}
            </div>
          )}
        </>
      )}
      {/* Hint text */}
      {!dragStart && (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#fff",
            fontSize: 16,
            pointerEvents: "none",
            textShadow: "0 1px 4px rgba(0,0,0,0.6)",
          }}
        >
          Drag to select screenshot area · Esc to cancel
        </div>
      )}
    </div>
  );
}

export default ScreenshotRegionOverlay;

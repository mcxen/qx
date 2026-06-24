import { useState, useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Preload the background image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgLoaded(true);
    };
    img.src = convertFileSrc(backgroundPath);
  }, [backgroundPath]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

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
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{
        position: "fixed",
        inset: 0,
        cursor: "crosshair",
        zIndex: 1000,
        outline: "none",
        overflow: "hidden",
      }}
    >
      {/* Full-viewport background image, always fills the viewport */}
      <img
        ref={imgRef}
        src={convertFileSrc(backgroundPath)}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100vw",
          height: "100vh",
          objectFit: "fill",
          pointerEvents: "none",
          userSelect: "none",
        }}
        draggable={false}
      />

      {/* Dim overlay everywhere before selection starts */}
      {!imgLoaded && (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.3)" }} />
      )}
      {!dragStart && imgLoaded && (
        <div style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />
      )}

      {/* Spotlight: dim everything except the selected area */}
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
                left: selX + 4,
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
              {Math.round(selW)} &times; {Math.round(selH)}
            </div>
          )}
        </>
      )}

      {/* Hint text */}
      {!dragStart && imgLoaded && (
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
          Drag to select screenshot area &middot; Esc to cancel
        </div>
      )}
    </div>
  );
}

export default ScreenshotRegionOverlay;

import { useEffect, useRef, useState } from "react";
import { useScreencapStore, type RecordArea } from "./store";
import GifPreview from "./GifPreview";
import GifHistory from "./GifHistory";

type SelectMode = "none" | "selecting";

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function estimatePerMinute(area: RecordArea): string {
  const pixels = area.w * area.h;
  const bytesPerSec = pixels * 0.4 * 15;
  const bytesPerMin = bytesPerSec * 60;
  if (bytesPerMin < 1024 * 1024) return `${(bytesPerMin / 1024).toFixed(0)} KB/min`;
  return `${(bytesPerMin / (1024 * 1024)).toFixed(1)} MB/min`;
}

export default function ScreenRecorder() {
  const {
    isRecording,
    status,
    lastGifPath,
    error,
    startRecording,
    stopRecording,
    loadHistory,
    reset,
  } = useScreencapStore();

  const [selectMode, setSelectMode] = useState<SelectMode>("none");
  const [area, setArea] = useState<RecordArea | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - start), 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = undefined;
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const beginAreaSelect = () => {
    setSelectMode("selecting");
    setDragStart(null);
    setDragEnd(null);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (selectMode !== "selecting") return;
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (selectMode !== "selecting" || !dragStart) return;
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    if (selectMode !== "selecting" || !dragStart || !dragEnd) {
      setSelectMode("none");
      return;
    }
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    setSelectMode("none");
    setDragStart(null);
    setDragEnd(null);
    if (w < 8 || h < 8) return;
    setArea({ x, y, w, h });
  };

  const handleStart = () => {
    void startRecording(area);
  };

  const handleStop = () => {
    void stopRecording();
  };

  const handleNewRecording = () => {
    reset();
    setArea(null);
  };

  if (selectMode === "selecting") {
    const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
    const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
    const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
    const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;
    return (
      <div
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          cursor: "crosshair",
          zIndex: 100,
        }}
      >
        {dragStart && dragEnd && (
          <div
            style={{
              position: "absolute",
              left: selX,
              top: selY,
              width: selW,
              height: selH,
              border: "2px solid var(--color-accent)",
              background: "rgba(99,102,241,0.1)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#fff",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          Drag to select recording area · Esc to cancel
        </div>
      </div>
    );
  }

  if (status === "done" && lastGifPath) {
    return (
      <div className="qx-module-shell">
        <div className="qx-plugin-toolbar">
          <div className="qx-toolbar-title" style={{ flex: 1 }}>Recording Complete</div>
          <button className="qx-command-button" onClick={handleNewRecording}>New</button>
        </div>
        <GifPreview path={lastGifPath} onClose={handleNewRecording} />
        <GifHistory />
      </div>
    );
  }

  if (isRecording || status === "processing") {
    return (
      <div className="qx-module-shell">
        <div className="qx-plugin-toolbar">
          <div className="qx-toolbar-title">Recording</div>
        </div>
        <div className="qx-module-stage" style={{ alignItems: "center", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              className="qx-rec-dot"
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#ef4444",
              }}
            />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              {status === "processing" ? "Processing" : "Recording"}
            </span>
          </div>
          <div
            style={{
              fontSize: 44,
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-text-primary)",
              fontWeight: 300,
              letterSpacing: 1,
            }}
          >
            {formatTime(elapsed)}
          </div>
          {area && (
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              {area.w} × {area.h} px
            </div>
          )}
          <button
            onClick={handleStop}
            disabled={status === "processing"}
            className={`qx-command-button${status === "processing" ? "" : " danger"}`}
            style={{ height: 40, padding: "0 28px" }}
          >
            {status === "processing" ? "Encoding GIF…" : "Stop"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qx-raycast">
      <div className="qx-plugin-toolbar">
        <div className="qx-toolbar-title" style={{ flex: 1 }}>Screen Recording</div>
        <button className="qx-command-button primary" onClick={handleStart}>
          Start Recording
        </button>
        <button className="qx-command-button" onClick={beginAreaSelect}>
          Select Area
        </button>
      </div>
      <div className="qx-plugin-body two-pane">
        <div className="qx-plugin-detail" style={{ borderRight: "1px solid var(--color-border)" }}>
          <div className="qx-detail-header">
            <div>
              <div className="qx-detail-title">Configuration</div>
              <div className="qx-detail-meta">Capture a screen recording and save as GIF.</div>
            </div>
          </div>
          <div className="qx-module-stage">
            <div className="qx-panel-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={handleStart} className="qx-command-button primary" style={{ flex: 1 }}>
                  Start Recording
                </button>
                <button onClick={beginAreaSelect} className="qx-command-button" style={{ flex: 1 }}>
                  Select Area
                </button>
              </div>
          {area ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>
                Area: {area.w} × {area.h} px · Est. ~{estimatePerMinute(area)}
              </span>
              <button onClick={() => setArea(null)} style={linkBtn}>
                Clear
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
              Full screen · ~3–8 MB/min (varies by content)
            </div>
          )}
            </div>
            {error && (
              <div className="qx-panel-card" style={{ padding: "8px 12px", fontSize: 12, color: "#b91c1c" }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <aside className="qx-action-panel">
          <div className="qx-action-title">ActionPanel</div>
          <button className="qx-action-item" onClick={handleStart}>
            <span>Start Recording</span>
          </button>
          <button className="qx-action-item" onClick={beginAreaSelect}>
            <span>Select Area</span>
          </button>
          <button className="qx-action-item" onClick={() => setArea(null)} disabled={!area}>
            <span>Clear Area</span>
          </button>
        </aside>
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-accent)",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};

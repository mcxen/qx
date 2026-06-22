import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ScreenshotEntry } from "../../store";

type Mode = "list" | "selecting" | "preview";

export default function ScreenshotPanel() {
  const [mode, setMode] = useState<Mode>("list");
  const [recent, setRecent] = useState<ScreenshotEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    loadRecent();
  }, []);

  const loadRecent = async () => {
    try {
      const res = await invoke<ScreenshotEntry[]>("get_recent_screenshots", {
        limit: 20,
      });
      setRecent(res);
    } catch {}
  };

  const captureFull = async () => {
    setError(null);
    try {
      const result = await invoke<ScreenshotEntry>("take_screenshot");
      setPreview(`file://${result.path}`);
      loadRecent();
    } catch (e) {
      setError(String(e));
    }
  };

  const startAreaSelect = () => {
    setMode("selecting");
    setDragStart(null);
    setDragEnd(null);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (mode !== "selecting") return;
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (mode !== "selecting" || !dragStart) return;
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = async () => {
    if (mode !== "selecting" || !dragStart || !dragEnd) {
      setMode("list");
      return;
    }
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    setMode("list");
    setDragStart(null);
    setDragEnd(null);
    if (w < 8 || h < 8) return;
    setError(null);
    try {
      const result = await invoke<ScreenshotEntry>("take_screenshot_area", {
        x,
        y,
        width: w,
        height: h,
      });
      setPreview(`file://${result.path}`);
      setMode("preview");
      loadRecent();
    } catch (e) {
      setError(String(e));
    }
  };

  const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
  const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
  const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
  const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;

  if (mode === "selecting") {
    return (
      <div
        ref={overlayRef}
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
          Drag to select area · Esc to cancel
        </div>
      </div>
    );
  }

  return (
    <div className="qx-raycast">
      <div className="qx-plugin-toolbar">
        <div className="qx-toolbar-title" style={{ flex: 1 }}>Screenshot</div>
        <button className="qx-command-button primary" onClick={captureFull}>
          Capture Full Screen
        </button>
        <button className="qx-command-button" onClick={startAreaSelect}>
          Select Area
        </button>
      </div>
      {error && (
        <div
          style={{
            margin: "0 16px 8px",
            padding: "8px 12px",
            fontSize: 12,
            color: "#b91c1c",
            background: "rgba(185,28,28,0.08)",
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      <div className="qx-plugin-body">
        <div className="qx-plugin-list">
          <div className="qx-section-header">
            <span style={{ flex: 1 }}>Recent</span>
            <span>{recent.length}</span>
          </div>
          {recent.length === 0 ? (
            <div className="qx-empty-state">No screenshots yet</div>
          ) : (
            recent.map((s) => (
              <button
                key={s.path}
                onClick={() => {
                  setPreview(`file://${s.path}`);
                  setMode("preview");
                }}
                className={`qx-list-row compact${preview === `file://${s.path}` ? " is-active" : ""}`}
              >
                <span className="qx-list-icon">IMG</span>
                <span className="qx-list-copy">
                  <span className="qx-list-title">{s.path.split("/").pop()}</span>
                  <span className="qx-list-subtitle">{s.timestamp}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="qx-plugin-detail">
          <div className="qx-detail-header">
            <div>
              <div className="qx-detail-title">Preview</div>
              <div className="qx-detail-meta">{mode === "preview" ? "Captured image" : "Select a screenshot"}</div>
            </div>
          </div>
          <div className="qx-module-stage" style={{ flex: 1, minHeight: 0 }}>
            {preview ? (
              <div className="qx-panel-card" style={{ maxHeight: 320 }}>
                <img
                  src={preview}
                  alt="preview"
                  style={{ width: "100%", objectFit: "contain", display: "block", maxHeight: 320 }}
                />
              </div>
            ) : (
              <div className="qx-empty-state">Capture or select a screenshot to preview it</div>
            )}
          </div>
        </div>

        <aside className="qx-action-panel">
          <div className="qx-action-title">ActionPanel</div>
          <button className="qx-action-item" onClick={captureFull}>
            <span>Capture Full Screen</span>
          </button>
          <button className="qx-action-item" onClick={startAreaSelect}>
            <span>Select Area</span>
          </button>
        </aside>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore, type ScreenshotEntry } from "../../store";
import QxShell from "../../components/QxShell";

type Mode = "list" | "preview";

export const REGION_CAPTURE_EVENT = "qx:screenshot-region-capture";

export function enterRegionCapture() {
  window.dispatchEvent(new Event(REGION_CAPTURE_EVENT));
}

export default function ScreenshotPanel() {
  const [mode, setMode] = useState<Mode>("list");
  const [recent, setRecent] = useState<ScreenshotEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screenshotCapture = useStore((state) => state.screenshotCapture);

  useEffect(() => {
    loadRecent();
  }, []);

  useEffect(() => {
    if (screenshotCapture.previewPath) {
      setPreview(`file://${screenshotCapture.previewPath}`);
      setMode("preview");
      void loadRecent();
    }
    if (screenshotCapture.error) {
      setError(screenshotCapture.error);
    }
  }, [screenshotCapture.error, screenshotCapture.previewPath]);

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
    setError(null);
    enterRegionCapture();
  };

  const context = (
    <div className="qx-action-panel">
      <div className="qx-action-title">Capture</div>
      <button className="qx-action-item" onClick={captureFull}>
        <span>Capture Full Screen</span>
      </button>
      <button className="qx-action-item" onClick={startAreaSelect}>
        <span>Select Area</span>
      </button>
    </div>
  );

  return (
    <QxShell
      title="Screenshot"
      search={<div className="qx-rss-detail-title">Screenshot</div>}
      trailing={
        <>
          <button className="qx-command-button primary" onClick={captureFull}>
          Capture Full Screen
          </button>
          <button className="qx-command-button" onClick={startAreaSelect}>
            Select Area
          </button>
        </>
      }
      context={context}
      island={{
        label: screenshotCapture.status === "idle" ? "Screenshot" : "Capturing",
        detail: screenshotCapture.status === "idle" ? `${recent.length} recent captures` : screenshotCapture.status,
        tone: error ? "danger" : "neutral",
      }}
      primaryAction={{ label: "Capture", onClick: captureFull }}
      secondaryAction={{ label: "Area", onClick: startAreaSelect }}
    >
      {error && (
        <div
          style={{
            margin: "0 10px 6px",
            padding: "6px 8px",
            fontSize: 12,
            color: "var(--qx-danger)",
            background: "var(--qx-danger-border)",
            borderRadius: 4,
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
                <span className="qx-list-icon" aria-hidden="true">
                  <span className="qx-symbol-icon image" />
                </span>
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
      </div>
    </QxShell>
  );
}

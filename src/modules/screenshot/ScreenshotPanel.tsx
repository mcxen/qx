import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useStore, type ScreenshotEntry } from "../../store";
import QxShell from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";

export const REGION_CAPTURE_EVENT = "qx:screenshot-region-capture";

export function enterRegionCapture() {
  window.dispatchEvent(new Event(REGION_CAPTURE_EVENT));
}

export default function ScreenshotPanel() {
  const setTab = useStore((state) => state.setTab);
  const screenshotCapture = useStore((state) => state.screenshotCapture);
  const [recent, setRecent] = useState<ScreenshotEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const res = await invoke<ScreenshotEntry[]>("get_recent_screenshots", {
        limit: 20,
      });
      setRecent(res);
    } catch {}
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    if (screenshotCapture.previewPath) {
      setPreview(convertFileSrc(screenshotCapture.previewPath));
      void loadRecent();
    }
    if (screenshotCapture.error) {
      setError(screenshotCapture.error);
    }
  }, [screenshotCapture.error, screenshotCapture.previewPath, loadRecent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((s) =>
      (s.path.split("/").pop() ?? "").toLowerCase().includes(q),
    );
  }, [recent, query]);

  useEffect(() => {
    setSelected((cur) => Math.min(cur, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const selectedItem = filtered[selected];

  const captureFull = useCallback(async () => {
    setError(null);
    try {
      const result = await invoke<ScreenshotEntry>("take_screenshot");
      setPreview(convertFileSrc(result.path));
      void loadRecent();
    } catch (e) {
      setError(String(e));
    }
  }, [loadRecent]);

  const startAreaSelect = useCallback(() => {
    setError(null);
    enterRegionCapture();
  }, []);

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: { active: preview !== null, close: () => setPreview(null) },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setTab("launcher"),
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedItem) {
        setPreview(convertFileSrc(selectedItem.path));
      }
    }
  };

  const searchSlot = (
    <div className="qx-clipboard-search-wrap">
      <span className="qx-search-icon" aria-hidden="true" />
      <input
        type="text"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        placeholder="Filter screenshots..."
        className="qx-clipboard-search"
      />
    </div>
  );

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
      search={searchSlot}
      onBack={() => setTab("launcher")}
      onKeyDown={handleKeyDown}
      context={context}
      island={{
        label: screenshotCapture.status === "idle" ? "Screenshot" : "Capturing",
        detail:
          screenshotCapture.status === "idle"
            ? `${recent.length} recent captures`
            : screenshotCapture.status,
        tone: error ? "danger" : "neutral",
      }}
      primaryAction={{ label: "Capture Full", onClick: captureFull }}
      secondaryAction={{ label: "Select Area", onClick: startAreaSelect }}
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
            <span>{filtered.length}</span>
          </div>
          {filtered.length === 0 ? (
            <div className="qx-empty-state">
              {recent.length === 0
                ? "No screenshots yet"
                : "No matching screenshots"}
            </div>
          ) : (
            filtered.map((s, i) => {
              const active = i === selected;
              const fileUrl = convertFileSrc(s.path);
              return (
                <button
                  key={s.path}
                  onClick={() => {
                    setSelected(i);
                    setPreview(fileUrl);
                  }}
                  className={`qx-list-row compact${active ? " is-active" : ""}`}
                >
                  <span className="qx-list-icon" aria-hidden="true">
                    <span className="qx-symbol-icon image" />
                  </span>
                  <span className="qx-list-copy">
                    <span className="qx-list-title">{s.path.split("/").pop()}</span>
                    <span className="qx-list-subtitle">{s.timestamp}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="qx-plugin-detail">
          <div className="qx-detail-header">
            <div>
              <div className="qx-detail-title">Preview</div>
              <div className="qx-detail-meta">
                {preview ? "Captured image" : "Select a screenshot"}
              </div>
            </div>
          </div>
          <div className="qx-module-stage" style={{ flex: 1, minHeight: 0 }}>
            {preview ? (
              <div className="qx-panel-card" style={{ maxHeight: 320 }}>
                <img
                  src={preview}
                  alt="preview"
                  style={{
                    width: "100%",
                    objectFit: "contain",
                    display: "block",
                    maxHeight: 320,
                  }}
                />
              </div>
            ) : (
              <div className="qx-empty-state">
                Capture or select a screenshot to preview it
              </div>
            )}
          </div>
        </div>
      </div>
    </QxShell>
  );
}

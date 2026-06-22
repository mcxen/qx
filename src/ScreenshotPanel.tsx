import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

interface ScreenshotResult {
  path: string;
  timestamp: string;
}

export default function ScreenshotPanel() {
  const [capturing, setCapturing] = useState(false);
  const [recent, setRecent] = useState<ScreenshotResult[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    loadRecent();
  }, []);

  const loadRecent = async () => {
    try {
      const res = await invoke<ScreenshotResult[]>("get_recent_screenshots", { limit: 10 });
      setRecent(res);
    } catch {}
  };

  const capture = async () => {
    setCapturing(true);
    try {
      const result = await invoke<ScreenshotResult>("take_screenshot");
      setPreview(`file://${result.path}`);
      loadRecent();
    } catch (e) {
      console.error("Capture failed:", e);
    }
    setCapturing(false);
  };

  const copyToClipboard = async (path: string) => {
    try {
      const img = await fetch(`file://${path}`);
      // For MVP, just copy the path
      await writeText(path);
    } catch {}
  };

  return (
    <div style={{ padding: "8px 12px" }}>
      <button
        onClick={capture}
        disabled={capturing}
        style={{
          width: "100%",
          height: 40,
          border: "none",
          borderRadius: 10,
          background: "var(--accent)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          marginBottom: 12,
        }}
      >
        {capturing ? "Capturing…" : "Capture Full Screen"}
      </button>

      {preview && (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 10,
            overflow: "hidden",
            maxHeight: 200,
          }}
        >
          <img
            src={preview}
            alt="preview"
            style={{ width: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
        Recent Screenshots
      </div>
      {recent.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 12 }}>
          No screenshots yet
        </div>
      ) : (
        recent.slice(0, 5).map((s) => (
          <div
            key={s.path}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 8px",
              borderRadius: 8,
              fontSize: 13,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
            onClick={() => setPreview(`file://${s.path}`)}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.path.split("/").pop()}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>{s.timestamp}</span>
          </div>
        ))
      )}
    </div>
  );
}

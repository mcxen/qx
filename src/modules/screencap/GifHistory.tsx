import { useScreencapStore } from "./store";

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default function GifHistory() {
  const { history, lastGifPath, setPreview, deleteEntry, clearHistory } =
    useScreencapStore();

  if (history.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 80,
        }}
      >
        <div style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
          No recordings yet
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingBottom: 8 }}>
      <div className="qx-section-header">
        <span style={{ flex: 1 }}>History</span>
        <button
          onClick={() => void clearHistory()}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--color-text-tertiary)",
            fontSize: 11,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Clear All
        </button>
      </div>
      {history.map((entry) => {
        const active = entry.path === lastGifPath;
        return (
          <div
            key={entry.id}
            onClick={() => setPreview(entry.path)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 16px",
              cursor: "pointer",
              background: active ? "var(--color-surface-active)" : "transparent",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.path.split("/").pop()}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                {entry.width}×{entry.height} · {formatDuration(entry.duration_ms)} ·{" "}
                {formatTimestamp(entry.created_at)}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void deleteEntry(entry.id);
              }}
              title="Delete"
              style={{
                border: "none",
                background: "transparent",
                color: "var(--color-text-tertiary)",
                fontSize: 14,
                cursor: "pointer",
                padding: "4px 8px",
                lineHeight: 1,
              }}
            >
              Delete
            </button>
          </div>
        );
      })}
    </div>
  );
}

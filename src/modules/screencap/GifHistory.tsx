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
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div className="qx-section-header">
          <span style={{ flex: 1 }}>History</span>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 80,
            padding: 16,
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>
            No recordings yet.
            <br />
            Start a capture to see GIFs here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
      data-qx-region-scroll
    >
      <div className="qx-section-header">
        <span style={{ flex: 1 }}>History</span>
        <span style={{ marginRight: 8 }}>{history.length}</span>
        <button
          type="button"
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
          <button
            key={entry.id}
            type="button"
            className={`qx-list-row${active ? " is-active" : ""}`}
            onClick={() => setPreview(entry.path)}
            style={{
              width: "100%",
              textAlign: "left",
              border: "none",
              background: active ? "var(--color-surface-active, var(--qx-bg-component-3))" : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              gap: 8,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--qx-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {entry.path.split("/").pop()}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--qx-text-tertiary)",
                  marginTop: 2,
                }}
              >
                {entry.width}×{entry.height} · {formatDuration(entry.duration_ms)} ·{" "}
                {formatTimestamp(entry.created_at)}
              </div>
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                void deleteEntry(entry.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  void deleteEntry(entry.id);
                }
              }}
              title="Delete"
              style={{
                color: "var(--qx-text-tertiary)",
                fontSize: 12,
                padding: "4px 6px",
                flexShrink: 0,
              }}
            >
              Delete
            </span>
          </button>
        );
      })}
    </div>
  );
}

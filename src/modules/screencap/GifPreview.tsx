import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

interface Props {
  path: string;
  onClose: () => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function GifPreview({ path, onClose }: Props) {
  const [playing, setPlaying] = useState(true);
  const [size, setSize] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const src = `file://${path}`;
  const fileName = path.split("/").pop() ?? path;
  const dir = path.substring(0, path.lastIndexOf("/"));

  useEffect(() => {
    setPlaying(true);
    setSize(null);
    setDims(null);
    setStatusMsg(null);
    setSaveName("");
    fetch(src)
      .then((r) => r.blob())
      .then((b) => setSize(b.size))
      .catch(() => {
        // file:// fetch may be blocked; size stays null
      });
  }, [src]);

  const handleReveal = async () => {
    try {
      await revealItemInDir(path);
    } catch (e) {
      setStatusMsg(`Reveal failed: ${String(e)}`);
    }
  };

  const handleSaveAs = async () => {
    const base = (
      saveName.trim() ||
      fileName.replace(/\.gif$/i, "") + "_copy"
    ).replace(/\.gif$/i, "");
    const dest = `${dir}/${base}.gif`;
    setSaving(true);
    setStatusMsg(null);
    try {
      await invoke("save_gif", { sourcePath: path, destPath: dest });
      setStatusMsg(`Saved to ${dest}`);
    } catch (e) {
      setStatusMsg(`Error: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const isError = statusMsg?.startsWith("Error") || statusMsg?.startsWith("Reveal");

  return (
    <div
      style={{
        padding: "0 16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "rgba(255,255,255,0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 160,
          maxHeight: 240,
        }}
      >
        {playing ? (
          <img
            src={src}
            alt="GIF preview"
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={{
              maxWidth: "100%",
              maxHeight: 240,
              display: "block",
              objectFit: "contain",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              color: "var(--color-text-tertiary)",
              minHeight: 160,
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 28 }}>▶</span>
            <span style={{ fontSize: 12 }}>Paused</span>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
          color: "var(--color-text-secondary)",
        }}
      >
        <button onClick={() => setPlaying((p) => !p)} style={toggleBtn}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <span>{dims ? `${dims.w} × ${dims.h} px` : "—"}</span>
        <span>{size !== null ? formatBytes(size) : "—"}</span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--color-text-tertiary)",
          }}
        >
          {fileName}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="filename…"
          style={{
            flex: 1,
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--color-border)",
            borderRadius: 6,
            background: "rgba(255,255,255,0.6)",
            color: "var(--color-text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button onClick={handleSaveAs} disabled={saving} style={primaryBtn}>
          {saving ? "Saving…" : "Save As…"}
        </button>
        <button onClick={handleReveal} style={secondaryBtn}>
          Reveal in Finder
        </button>
        <button onClick={onClose} style={ghostBtn}>
          New
        </button>
      </div>

      {statusMsg && (
        <div
          style={{
            fontSize: 11,
            color: isError ? "#b91c1c" : "var(--color-text-tertiary)",
            wordBreak: "break-all",
          }}
        >
          {statusMsg}
        </div>
      )}
    </div>
  );
}

const toggleBtn: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.6)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  padding: "4px 10px",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  height: 32,
  padding: "0 14px",
  border: "none",
  borderRadius: 6,
  background: "var(--color-accent)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryBtn: React.CSSProperties = {
  height: 32,
  padding: "0 14px",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.6)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  height: 32,
  padding: "0 14px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

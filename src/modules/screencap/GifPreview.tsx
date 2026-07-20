import { useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useScreencapStore } from "./store";
import { Select } from "../../components/ui";
import { useT } from "../../i18n";
import { revealSystemPath, writeImageFileToClipboard } from "../../system";

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
  const t = useT();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [size, setSize] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [converting, setConverting] = useState(false);
  const [gifWidth, setGifWidth] = useState(960);
  const [gifFps, setGifFps] = useState(12);
  const { loadHistory, setPreview } = useScreencapStore();

  const src = convertFileSrc(path);
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isVideo = extension === "mp4" || extension === "mov";
  const isAnimatedImage = extension === "gif";
  const isStillImage = extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp";
  const canCopyImage = isStillImage || isAnimatedImage;
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = path.substring(0, separatorIndex);
  const pathSeparator = path.lastIndexOf("\\") > path.lastIndexOf("/") ? "\\" : "/";

  useEffect(() => {
    setPlaying(true);
    setSize(null);
    setDims(null);
    setStatusMsg(null);
    setStatusError(false);
    setSaveName("");
    // Get file size via Tauri command — file:// fetch doesn't work in Tauri v2
    invoke<number>("get_file_size", { path })
      .then((s) => setSize(s))
      .catch(() => {});
  }, [src]);

  const handleReveal = async () => {
    try {
      await revealSystemPath(path);
    } catch (e) {
      setStatusError(true);
      setStatusMsg(`${t("screencap.preview.revealFailed", "Show in folder failed")}: ${String(e)}`);
    }
  };

  const handleCopyImage = async () => {
    setStatusError(false);
    setStatusMsg(null);
    try {
      await writeImageFileToClipboard(path);
      setStatusMsg(t("screencap.toast.copied", "Copied"));
    } catch (e) {
      setStatusError(true);
      setStatusMsg(`${t("common.error", "Error")}: ${String(e)}`);
    }
  };

  const handleSaveAs = async () => {
    const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = extension || "mp4";
    const base = (saveName.trim() || fileName.replace(new RegExp(`\\.${escapedExtension}$`, "i"), "") + "_copy")
      .replace(new RegExp(`\\.${escapedExtension}$`, "i"), "");
    const dest = `${dir}${pathSeparator}${base}.${suffix}`;
    setSaving(true);
    setStatusMsg(null);
    setStatusError(false);
    try {
      await invoke("save_gif", { sourcePath: path, destPath: dest });
      setStatusMsg(`${t("screencap.preview.savedTo", "Saved to")} ${dest}`);
    } catch (e) {
      setStatusError(true);
      setStatusMsg(`${t("common.error", "Error")}: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConvertGif = async () => {
    setConverting(true);
    setStatusError(false);
    setStatusMsg(t("screencap.preview.converting", "Converting video to GIF…"));
    try {
      const gif = await invoke<string>("convert_recording_to_gif", {
        sourcePath: path,
        maxWidth: gifWidth,
        fps: gifFps,
      });
      await loadHistory();
      setPreview(gif);
      setStatusMsg(`${t("screencap.preview.gifSaved", "GIF saved to")} ${gif}`);
    } catch (error) {
      setStatusError(true);
      setStatusMsg(`${t("common.error", "Error")}: ${String(error)}`);
    } finally {
      setConverting(false);
    }
  };

  const togglePlayback = () => {
    if (!isVideo) {
      setPlaying((value) => !value);
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      void media.play();
      setPlaying(true);
    } else {
      media.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      style={{
        padding: "0 10px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid var(--qx-border-1)",
          background: "var(--qx-overlay-1)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 160,
          maxHeight: 240,
        }}
      >
        {isVideo ? (
          <video
            ref={mediaRef}
            src={src}
            autoPlay
            loop
            muted
            playsInline
            onLoadedMetadata={(event) => setDims({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{ maxWidth: "100%", maxHeight: 240, display: "block", objectFit: "contain" }}
          />
        ) : playing || !isAnimatedImage ? (
          <img
            src={src}
            alt={isStillImage
              ? t("screencap.preview.imageAlt", "Screenshot preview")
              : t("screencap.preview.gifAlt", "GIF preview")}
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
              color: "var(--qx-text-tertiary)",
              minHeight: 160,
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {t("screencap.preview.paused", "Playback paused")}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12,
          color: "var(--qx-text-secondary)",
        }}
      >
        {(isVideo || isAnimatedImage) && (
          <button onClick={togglePlayback} style={toggleBtn}>
            {playing ? t("common.pause", "Pause") : t("common.play", "Play")}
          </button>
        )}
        <span>{dims ? `${dims.w} × ${dims.h} px` : "—"}</span>
        <span>{size !== null ? formatBytes(size) : "—"}</span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--qx-text-tertiary)",
          }}
        >
          {fileName}
        </span>
      </div>

      {isVideo && (
        <div className="qx-screencap-convert-row">
          <strong>{t("screencap.preview.convert", "Convert to GIF")}</strong>
          <label>
            {t("screencap.preview.width", "Width")}
            <Select
              value={String(gifWidth) as "640" | "960" | "1280"}
              options={[
                { value: "640", label: "640 px" },
                { value: "960", label: "960 px" },
                { value: "1280", label: "1280 px" },
              ]}
              onChange={(value) => setGifWidth(Number(value))}
              ariaLabel={t("screencap.preview.gifWidth", "GIF width")}
            />
          </label>
          <label>
            {t("screencap.preview.speed", "Speed")}
            <Select
              value={String(gifFps) as "8" | "12" | "15"}
              options={[
                { value: "8", label: "8 fps" },
                { value: "12", label: "12 fps" },
                { value: "15", label: "15 fps" },
              ]}
              onChange={(value) => setGifFps(Number(value))}
              ariaLabel={t("screencap.preview.gifFps", "GIF frame rate")}
            />
          </label>
          <button onClick={() => void handleConvertGif()} disabled={converting} style={primaryBtn}>
            {converting
              ? t("screencap.preview.convertingShort", "Converting…")
              : t("screencap.preview.createGif", "Create GIF")}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={t("screencap.preview.filename", "filename…")}
          style={{
            flex: 1,
            height: 28,
            padding: "0 8px",
            border: "1px solid var(--qx-border-1)",
            borderRadius: 4,
            background: "var(--qx-overlay-1)",
            color: "var(--qx-text-primary)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button onClick={handleSaveAs} disabled={saving} style={primaryBtn}>
          {saving ? t("common.saving", "Saving…") : t("screencap.preview.saveAs", "Save As…")}
        </button>
        {canCopyImage && (
          <button onClick={() => void handleCopyImage()} style={secondaryBtn}>
            {t("screencap.toast.copy", "Copy")}
          </button>
        )}
        <button onClick={handleReveal} style={secondaryBtn}>
          {t("screencap.preview.showInFolder", "Show in Folder")}
        </button>
        <button onClick={onClose} style={ghostBtn}>
          {t("common.new", "New")}
        </button>
      </div>

      {statusMsg && (
        <div
          style={{
            fontSize: 11,
            color: statusError ? "var(--qx-danger)" : "var(--qx-text-tertiary)",
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
  border: "1px solid var(--qx-border-1)",
  borderRadius: 4,
  background: "var(--qx-overlay-1)",
  color: "var(--qx-text-primary)",
  fontSize: 12,
  padding: "4px 10px",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  border: "1px solid color-mix(in srgb, var(--qx-accent) 45%, var(--qx-border-1))",
  borderRadius: 4,
  background: "var(--qx-accent)",
  color: "var(--qx-text-on-accent)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryBtn: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  border: "1px solid var(--qx-border-1)",
  borderRadius: 4,
  background: "var(--qx-overlay-1)",
  color: "var(--qx-text-primary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "var(--qx-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

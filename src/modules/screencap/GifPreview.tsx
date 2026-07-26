import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { Pause, Play, Camera, Video, Volume2, VolumeX } from "lucide-react";
import { useScreencapStore } from "./store";
import { Select, Slider } from "../../components/ui";
import { useT } from "../../i18n";
import CaptureOcrPanel from "./CaptureOcrPanel";

interface Props {
  path: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function GifPreview({ path }: Props) {
  const t = useT();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [converting, setConverting] = useState(false);
  const [gifWidth, setGifWidth] = useState(960);
  const [gifFps, setGifFps] = useState(12);
  const { loadHistory, setPreview, previewStatus } = useScreencapStore();

  const src = convertFileSrc(path);
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isVideo = extension === "mp4" || extension === "mov";
  const isAnimatedImage = extension === "gif";
  const isStillImage = extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp";

  useEffect(() => {
    setPlaying(true);
    setVolume(1);
    setMuted(false);
    setCurrentTime(0);
    setDuration(0);
    setSize(null);
    setDims(null);
    // Get file size via Tauri command — file:// fetch doesn't work in Tauri v2
    invoke<number>("get_file_size", { path })
      .then((s) => setSize(s))
      .catch(() => {});
  }, [src]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.volume = volume;
  }, [volume]);

  const handleConvertGif = async () => {
    setConverting(true);
    try {
      const gif = await invoke<string>("convert_recording_to_gif", {
        sourcePath: path,
        maxWidth: gifWidth,
        fps: gifFps,
      });
      await loadHistory();
      setPreview(gif);
    } catch {
      // Conversion errors are surfaced via the action menu status, not the
      // inline pane — the inline convert row stays focused on its controls.
    } finally {
      setConverting(false);
    }
  };

  const togglePlayback = useCallback(() => {
    if (!isVideo) {
      setPlaying((value) => !value);
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      if (media.ended || (
        Number.isFinite(media.duration)
        && media.duration > 0
        && media.currentTime >= media.duration - 0.05
      )) {
        media.currentTime = 0;
        setCurrentTime(0);
      }
      void media.play();
      setPlaying(true);
    } else {
      media.pause();
      setPlaying(false);
    }
  }, [isVideo]);

  const handleScrub = useCallback((value: number) => {
    const media = mediaRef.current;
    if (!media) return;
    const target = Math.max(0, Math.min(value, Number.isFinite(media.duration) ? media.duration : value));
    media.currentTime = target;
    setCurrentTime(target);
  }, []);

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value);
    if (value > 0) setMuted(false);
  }, []);

  const IconKind = isVideo ? Video : isStillImage ? Camera : Video;

  return (
    <div className="qx-screencap-preview">
      <div className="qx-screencap-preview-stage">
        {isVideo ? (
          <video
            ref={mediaRef}
            src={src}
            autoPlay
            muted={muted}
            playsInline
            onLoadedMetadata={(event) => {
              const media = event.currentTarget;
              setDims({ w: media.videoWidth, h: media.videoHeight });
              if (Number.isFinite(media.duration) && media.duration > 0) {
                setDuration(media.duration);
              }
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onDurationChange={(event) => {
              const next = event.currentTarget.duration;
              if (Number.isFinite(next) && next > 0) setDuration(next);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={(event) => {
              const media = event.currentTarget;
              setCurrentTime(Number.isFinite(media.duration) ? media.duration : media.currentTime);
              setPlaying(false);
            }}
            className="qx-screencap-preview-media"
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
            className="qx-screencap-preview-media"
          />
        ) : (
          <div className="qx-screencap-preview-paused">
            <span>{t("screencap.preview.paused", "Playback paused")}</span>
          </div>
        )}
      </div>

      {isVideo && (
        <div className="qx-screencap-preview-player">
          <button
            type="button"
            onClick={togglePlayback}
            className="qx-screencap-preview-player-toggle"
            aria-label={playing
              ? t("screencap.preview.player.pause", "Pause")
              : t("screencap.preview.player.play", "Play")}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="qx-screencap-preview-player-time" aria-live="off">
            {t("screencap.preview.player.time", "{current} / {total}")
              .replace("{current}", formatClock(currentTime))
              .replace("{total}", formatClock(duration))}
          </span>
          <Slider
            value={currentTime}
            min={0}
            max={duration > 0 ? duration : 1}
            step={1 / 30}
            disabled={duration <= 0}
            onChange={handleScrub}
            ariaLabel={t("screencap.preview.player.scrub", "Seek")}
            formatLabel={(v) => formatClock(v)}
            className="qx-screencap-preview-player-slider"
          />
          <div className="qx-screencap-preview-player-volume">
            <button
              type="button"
              className="qx-screencap-preview-player-volume-toggle"
              onClick={() => setMuted((value) => !value)}
              aria-label={muted || volume === 0
                ? t("screencap.preview.player.unmute", "Unmute")
                : t("screencap.preview.player.mute", "Mute")}
            >
              {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <Slider
              value={muted ? 0 : volume}
              min={0}
              max={1}
              step={0.05}
              onChange={handleVolumeChange}
              ariaLabel={t("screencap.preview.player.volume", "Volume")}
              formatLabel={(value) => `${Math.round(value * 100)}%`}
              className="qx-screencap-preview-player-volume-slider"
            />
          </div>
        </div>
      )}

      <div className="qx-screencap-preview-meta">
        <span className="qx-screencap-preview-meta-icon" aria-hidden="true">
          <IconKind size={12} />
        </span>
        <span className="qx-screencap-preview-meta-name" title={fileName}>{fileName}</span>
        <span className="qx-screencap-preview-meta-stats">
          {dims ? `${dims.w} × ${dims.h}` : "—"}
          <span className="qx-screencap-preview-meta-divider" aria-hidden="true" />
          {size !== null ? formatBytes(size) : "—"}
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
          <button
            type="button"
            onClick={() => void handleConvertGif()}
            disabled={converting}
            className="qx-screencap-preview-btn qx-screencap-preview-btn--primary"
          >
            {converting
              ? t("screencap.preview.convertingShort", "Converting…")
              : t("screencap.preview.createGif", "Create GIF")}
          </button>
        </div>
      )}

      {isStillImage ? <CaptureOcrPanel path={path} /> : null}

      {previewStatus.msg && (
        <div
          className={`qx-screencap-preview-status${previewStatus.error ? " is-error" : ""}`}
        >
          {previewStatus.msg}
        </div>
      )}
    </div>
  );
}

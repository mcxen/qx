import { convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Trash2, Video } from "lucide-react";
import { useRef, useState } from "react";
import { useLocale, useT } from "../../i18n";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useScreencapStore } from "./store";
import type { CaptureHistoryLayout } from "./preferences";

function formatTimestamp(timestamp: number, locale: string): string {
  return new Date(timestamp * 1000).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatMeasuredFps(frameCount: number, durationMs: number): string | null {
  if (frameCount <= 0 || durationMs <= 0) return null;
  return (frameCount * 1000 / durationMs).toFixed(1);
}

function isScreenshotPath(path: string, durationMs: number): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return true;
  }
  return durationMs === 0 && !lower.endsWith(".gif") && !lower.endsWith(".mp4") && !lower.endsWith(".mov");
}

function RecordingThumbnail({ entry }: { entry: { path: string; thumbnail_path?: string | null } }) {
  const [coverFailed, setCoverFailed] = useState(false);
  if (entry.thumbnail_path && !coverFailed) {
    return (
      <img
        src={convertFileSrc(entry.thumbnail_path)}
        alt=""
        loading="lazy"
        onError={() => setCoverFailed(true)}
      />
    );
  }
  return (
    <video
      src={convertFileSrc(entry.path)}
      muted
      preload="auto"
      playsInline
      onLoadedMetadata={(event) => {
        const media = event.currentTarget;
        if (Number.isFinite(media.duration) && media.duration > 0) {
          media.currentTime = Math.min(0.08, media.duration / 2);
        }
      }}
    />
  );
}

export default function CaptureHistory({ layout }: { layout: CaptureHistoryLayout }) {
  const t = useT();
  const locale = useLocale();
  const { history, lastGifPath, setPreview, deleteEntry, clearHistory } = useScreencapStore();
  const selectedIndex = history.length
    ? Math.max(0, history.findIndex((entry) => entry.path === lastGifPath))
    : -1;
  const listRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${layout}:${history.map((entry) => entry.id).join(",")}`,
    enabled: selectedIndex >= 0,
  });

  return (
    <section className="qx-capture-history" aria-label={t("screencap.history", "History")}>
      <header className="qx-section-header qx-capture-history-header">
        <span>{t("screencap.history", "History")}</span>
        <small>{history.length}</small>
        {history.length > 0 && (
          <button type="button" onClick={() => void clearHistory()}>
            {t("screencap.history.clear", "Clear All")}
          </button>
        )}
      </header>

      {history.length === 0 ? (
        <div className="qx-capture-history-empty">
          <Camera size={20} aria-hidden="true" />
          <strong>{t("screencap.history.empty", "No captures yet.")}</strong>
          <span>{t("screencap.history.emptyHint", "Take a screenshot or start recording to see it here.")}</span>
        </div>
      ) : (
        <div
          ref={listRef}
          className={layout === "gallery" ? "qx-capture-history-gallery" : "qx-capture-history-list"}
          data-qx-region-scroll
          role="listbox"
        >
          {history.map((entry, index) => {
            const active = entry.path === lastGifPath;
            const screenshot = isScreenshotPath(entry.path, entry.duration_ms);
            const image = screenshot || entry.path.toLowerCase().endsWith(".gif");
            const mediaSrc = convertFileSrc(entry.path);
            const measuredFps = formatMeasuredFps(entry.frame_count, entry.duration_ms);
            if (layout === "gallery") {
              return (
                <article
                  key={entry.id}
                  className={`qx-capture-gallery-card${active ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    {...getItemProps(index, { className: "qx-capture-gallery-main", baseClass: false })}
                    onClick={() => setPreview(entry.path)}
                  >
                    <span className="qx-capture-gallery-media" aria-hidden="true">
                      {image ? (
                        <img src={mediaSrc} alt="" loading="lazy" />
                      ) : (
                        <RecordingThumbnail entry={entry} />
                      )}
                      {!image ? <span className="qx-capture-gallery-video"><Video size={13} /></span> : null}
                    </span>
                    <span className="qx-capture-gallery-copy">
                      <strong>{entry.path.split(/[\\/]/).pop()}</strong>
                      <small>
                        {entry.width}×{entry.height} · {screenshot
                          ? t("screencap.screenshot", "Screenshot")
                          : `${formatDuration(entry.duration_ms)}${measuredFps ? ` · ${measuredFps} fps` : ""}`}
                      </small>
                      <small>{formatTimestamp(entry.created_at, locale)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="qx-capture-gallery-delete"
                    title={t("common.delete", "Delete")}
                    aria-label={t("common.delete", "Delete")}
                    onClick={() => void deleteEntry(entry.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </article>
              );
            }
            return (
              <div key={entry.id} className={`qx-capture-history-row${active ? " is-active" : ""}`}>
                <button
                  type="button"
                  {...getItemProps(index, { className: "qx-capture-history-main", baseClass: false })}
                  onClick={() => setPreview(entry.path)}
                >
                  {image || entry.thumbnail_path ? (
                    <span className="qx-capture-history-thumb" aria-hidden="true">
                      {image ? (
                        <img src={mediaSrc} alt="" loading="lazy" />
                      ) : (
                        <RecordingThumbnail entry={entry} />
                      )}
                    </span>
                  ) : (
                    <span className="qx-capture-history-icon" aria-hidden="true">
                      {screenshot ? <Camera size={15} /> : <Video size={15} />}
                    </span>
                  )}
                  <span className="qx-capture-history-copy">
                    <strong>{entry.path.split(/[\\/]/).pop()}</strong>
                    <small>
                      {entry.width}×{entry.height} · {screenshot
                        ? t("screencap.screenshot", "Screenshot")
                        : `${formatDuration(entry.duration_ms)}${measuredFps ? ` · ${measuredFps} fps` : ""}`} · {formatTimestamp(entry.created_at, locale)}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  className="qx-capture-history-delete"
                  title={t("common.delete", "Delete")}
                  aria-label={t("common.delete", "Delete")}
                  onClick={() => void deleteEntry(entry.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

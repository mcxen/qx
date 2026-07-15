import { convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Trash2, Video } from "lucide-react";
import { useLocale, useT } from "../../i18n";
import { useScreencapStore } from "./store";

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

function isScreenshotPath(path: string, durationMs: number): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return true;
  }
  return durationMs === 0 && !lower.endsWith(".gif") && !lower.endsWith(".mp4") && !lower.endsWith(".mov");
}

export default function CaptureHistory() {
  const t = useT();
  const locale = useLocale();
  const { history, lastGifPath, setPreview, deleteEntry, clearHistory } = useScreencapStore();

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
        <div className="qx-capture-history-list" data-qx-region-scroll role="listbox">
          {history.map((entry) => {
            const active = entry.path === lastGifPath;
            const screenshot = isScreenshotPath(entry.path, entry.duration_ms);
            const thumb = screenshot || entry.path.toLowerCase().endsWith(".gif")
              ? convertFileSrc(entry.path)
              : null;
            return (
              <div key={entry.id} className={`qx-capture-history-row${active ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="qx-capture-history-main"
                  role="option"
                  aria-selected={active}
                  onClick={() => setPreview(entry.path)}
                >
                  {thumb ? (
                    <span className="qx-capture-history-thumb" aria-hidden="true">
                      <img src={thumb} alt="" loading="lazy" />
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
                        : formatDuration(entry.duration_ms)} · {formatTimestamp(entry.created_at, locale)}
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

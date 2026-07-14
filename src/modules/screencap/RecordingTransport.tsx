import { useState } from "react";
import { PanelBottom, PictureInPicture2, Square } from "lucide-react";
import { useT } from "../../i18n";
import type { RecordingSnapshot, RecordingStatus } from "./store";

export const RECORDING_TRANSPORT_WIDTH = 340;
export const RECORDING_TRANSPORT_HEIGHT = 36;

interface RecordingTransportProps {
  host: "main" | "floating";
  snapshot?: RecordingSnapshot | null;
  status?: RecordingStatus;
  elapsedMs?: number;
  frameCount?: number;
  stopping?: boolean;
  onTransfer: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function RecordingTransport({
  host,
  snapshot,
  status,
  elapsedMs,
  frameCount,
  stopping = false,
  onTransfer,
  onStop,
}: RecordingTransportProps) {
  const t = useT();
  const [transferring, setTransferring] = useState(false);
  const phase = snapshot?.phase ?? status ?? "recording";
  const elapsed = snapshot?.elapsedMs ?? elapsedMs ?? 0;
  const frames = snapshot?.frameCount ?? frameCount ?? 0;
  const processing = phase === "processing" || stopping;
  const failed = phase === "error";
  const transferLabel = host === "main"
    ? t("screencap.popOut", "Move to Floating Controls")
    : t("screencap.controls.dock", "Move into Qx");

  const transfer = async () => {
    if (transferring || processing) return;
    setTransferring(true);
    // A short contraction makes the cross-window hand-off read as one surface moving.
    await new Promise((resolve) => window.setTimeout(resolve, 110));
    try {
      await onTransfer();
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div
      className={`qx-recording-transport is-${host}${failed ? " is-error" : ""}${
        processing ? " is-processing" : ""
      }${transferring ? " is-transferring" : ""}`}
      data-tauri-drag-region={host === "floating" ? true : undefined}
      aria-label={t("screencap.controls.aria", "Screen recording controls")}
    >
      <span className="qx-recording-transport-dot" aria-hidden="true" />
      <strong className="qx-recording-transport-state" data-tauri-drag-region={host === "floating" ? true : undefined}>
        {processing
          ? t("screencap.controls.savingShort", "Saving")
          : failed
            ? t("screencap.controls.error", "Recording error")
            : t("screencap.controls.recording", "Recording")}
      </strong>
      <span className="qx-recording-transport-time" data-tauri-drag-region={host === "floating" ? true : undefined}>
        {formatTime(elapsed)}
      </span>
      <span className="qx-recording-transport-frames" data-tauri-drag-region={host === "floating" ? true : undefined}>
        {frames} {t("screencap.framesShort", "frames")}
      </span>
      <span className="qx-recording-transport-divider" aria-hidden="true" />
      <button
        className="qx-recording-transport-icon"
        type="button"
        title={transferLabel}
        aria-label={transferLabel}
        disabled={processing || transferring}
        onClick={() => void transfer()}
      >
        {host === "main" ? <PictureInPicture2 size={14} /> : <PanelBottom size={14} />}
      </button>
      <button
        className="qx-recording-transport-stop"
        type="button"
        disabled={processing || transferring}
        onClick={() => void onStop()}
      >
        <Square size={9} fill="currentColor" aria-hidden="true" />
        <span>
          {processing
            ? t("screencap.controls.savingShort", "Saving")
            : failed
              ? t("screencap.controls.finish", "Finish")
              : t("screencap.controls.stop", "Stop")}
        </span>
      </button>
    </div>
  );
}

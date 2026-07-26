import { Circle, Play } from "lucide-react";
import { useT } from "../../i18n";
import type { RecordingSnapshot, RecordingStatus } from "./store";

export const RECORDING_TRANSPORT_WIDTH = 340;
export const RECORDING_TRANSPORT_HEIGHT = 36;

interface RecordingTransportProps {
  snapshot?: RecordingSnapshot | null;
  status?: RecordingStatus;
  elapsedMs?: number;
  stopping?: boolean;
  onStop: () => void | Promise<void>;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function RecordingTransport({
  snapshot,
  status,
  elapsedMs,
  stopping = false,
  onStop,
}: RecordingTransportProps) {
  const t = useT();
  const phase = snapshot?.phase ?? status ?? "recording";
  const elapsed = snapshot?.elapsedMs ?? elapsedMs ?? 0;
  const processing = phase === "processing" || stopping;
  const failed = phase === "error";

  return (
    <div
      className={`qx-recording-toolbar${failed ? " is-error" : ""}${
        processing ? " is-processing" : ""
      }`}
      data-tauri-drag-region
      aria-label={t("screencap.controls.aria", "Screen recording controls")}
    >
      <div className="qx-recording-toolbar-status" data-tauri-drag-region>
      <strong data-tauri-drag-region>
        {processing
          ? t("screencap.controls.savingShort", "Saving")
          : failed
            ? t("screencap.controls.error", "Recording error")
            : t("screencap.controls.recording", "Recording")}
      </strong>
      <span data-tauri-drag-region>
        {formatTime(elapsed)}
      </span>
      </div>
      <span className="qx-recording-toolbar-divider" aria-hidden="true" />
      <button
        className="qx-recording-toolbar-action"
        type="button"
        aria-label={processing
          ? t("screencap.controls.savingShort", "Saving")
          : t("screencap.controls.pauseSave", "Pause and save recording")}
        title={processing
          ? t("screencap.controls.savingShort", "Saving")
          : t("screencap.controls.pauseSave", "Pause and save recording")}
        disabled={processing}
        onClick={() => void onStop()}
      >
        {processing
          ? <Play size={15} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
          : <Circle size={15} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </div>
  );
}

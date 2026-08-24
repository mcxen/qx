import { convertFileSrc } from "@tauri-apps/api/core";
import type { Rect } from "./useCaptureAnnotations";

interface CaptureSelectionShadeProps {
  rect: Rect | null;
  countdown: number | null;
  recordingActive: boolean;
  snapshotPath?: string;
}

/** Full-display dimmer with a transparent cutout for the current selection. */
export function CaptureSelectionShade({
  rect,
  countdown,
  recordingActive,
  snapshotPath,
}: CaptureSelectionShadeProps) {
  const frozenFrameSrc = snapshotPath ? convertFileSrc(snapshotPath) : "";
  return (
    <>
      {!recordingActive && frozenFrameSrc && (
        <img
          key={snapshotPath}
          className="qx-region-picker-frozen-frame"
          src={frozenFrameSrc}
          alt=""
          draggable={false}
          aria-hidden="true"
        />
      )}
      {!rect && countdown === null && (
        <div className="qx-region-picker-shade is-full" aria-hidden="true" />
      )}
      {rect && countdown === null && (
        <>
          <div className="qx-region-picker-shade" style={{ left: 0, top: 0, right: 0, height: rect.y }} />
          <div className="qx-region-picker-shade" style={{ left: 0, top: rect.y + rect.h, right: 0, bottom: 0 }} />
          <div className="qx-region-picker-shade" style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
          <div className="qx-region-picker-shade" style={{ left: rect.x + rect.w, top: rect.y, right: 0, height: rect.h }} />
        </>
      )}
      {rect && recordingActive && (
        <div
          className="qx-region-picker-recording-ring"
          style={{
            left: rect.x - 3,
            top: rect.y - 3,
            width: rect.w + 6,
            height: rect.h + 6,
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}

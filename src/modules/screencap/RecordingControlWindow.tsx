import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { requestCaptureSelection, type CaptureMode, type RecordingSnapshot } from "./store";
import RecordingTransport from "./RecordingTransport";
import { Camera, Circle, History, X } from "lucide-react";
import { useT } from "../../i18n";
import { saveCaptureControlsPinned } from "./preferences";

export default function RecordingControlWindow() {
  const t = useT();
  const [snapshot, setSnapshot] = useState<RecordingSnapshot | null>(null);
  const [stopping, setStopping] = useState(false);
  const [launching, setLaunching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await invoke<RecordingSnapshot>("recording_status"));
    } catch {
      // The next state event or poll will retry.
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("qx-recording-control-body");
    void refresh();
    const timer = window.setInterval(() => void refresh(), 250);
    const unlisten = listen<RecordingSnapshot>("screencap:state", (event) => {
      setSnapshot(event.payload);
    });
    return () => {
      document.body.classList.remove("qx-recording-control-body");
      window.clearInterval(timer);
      void unlisten.then((dispose) => dispose());
    };
  }, [refresh]);

  const stop = async () => {
    if (stopping || snapshot?.phase === "processing") return;
    setStopping(true);
    try {
      await invoke("stop_recording");
    } finally {
      setStopping(false);
    }
  };

  const returnToMain = async () => {
    await invoke<void>("screencap_return_to_main").catch(() => {});
  };

  const beginCapture = async (mode: CaptureMode) => {
    if (launching) return;
    setLaunching(true);
    await invoke("screencap_hide_controls").catch(() => {});
    try {
      await requestCaptureSelection(mode);
    } catch {
      await invoke("screencap_show_controls").catch(() => {});
    } finally {
      setLaunching(false);
    }
  };

  const closePinnedControls = async () => {
    saveCaptureControlsPinned(false);
    await invoke("screencap_set_controls_pinned", { pinned: false }).catch(() => {});
  };

  const recordingActive = Boolean(snapshot?.isRecording || snapshot?.phase === "processing");

  return (
    <main className="qx-recording-control-window" data-tauri-drag-region>
      {recordingActive ? (
        <RecordingTransport
          host="floating"
          snapshot={snapshot}
          stopping={stopping}
          onTransfer={returnToMain}
          onStop={stop}
        />
      ) : (
        <div className="qx-recording-transport is-floating is-capture-launcher" data-tauri-drag-region>
          <strong className="qx-recording-transport-state" data-tauri-drag-region>
            {t("screencap.capture", "Capture")}
          </strong>
          <button className="qx-recording-transport-launch" type="button" disabled={launching} onClick={() => void beginCapture("screenshot")}>
            <Camera size={13} aria-hidden="true" />
            <span>{t("screencap.screenshot", "Screenshot")}</span>
          </button>
          <button className="qx-recording-transport-launch is-record" type="button" disabled={launching} onClick={() => void beginCapture("recording")}>
            <Circle size={10} fill="currentColor" aria-hidden="true" />
            <span>{t("screencap.record", "Record")}</span>
          </button>
          <span className="qx-recording-transport-divider" aria-hidden="true" />
          <button className="qx-recording-transport-icon" type="button" onClick={() => void returnToMain()} aria-label={t("screencap.controls.history", "View Capture History")}>
            <History size={14} />
          </button>
          <button className="qx-recording-transport-icon" type="button" onClick={() => void closePinnedControls()} aria-label={t("common.close", "Close")}>
            <X size={14} />
          </button>
        </div>
      )}
    </main>
  );
}

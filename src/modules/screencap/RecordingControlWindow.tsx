import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RecordingSnapshot } from "./store";
import RecordingTransport from "./RecordingTransport";

export default function RecordingControlWindow() {
  const [snapshot, setSnapshot] = useState<RecordingSnapshot | null>(null);
  const [stopping, setStopping] = useState(false);

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

  return (
    <main className="qx-recording-control-window" data-tauri-drag-region>
      <RecordingTransport
        host="floating"
        snapshot={snapshot}
        stopping={stopping}
        onTransfer={returnToMain}
        onStop={stop}
      />
    </main>
  );
}

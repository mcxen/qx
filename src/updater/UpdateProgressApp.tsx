import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useT } from "../i18n";
import "../App.css";

export interface UpdateProgressPayload {
  phase: string;
  message: string;
  version?: string | null;
  percent?: number | null;
  bytesDownloaded?: number | null;
  bytesTotal?: number | null;
  indeterminate: boolean;
  error?: string | null;
}

function phaseLabel(phase: string, t: (key: string, fallback: string) => string): string {
  switch (phase) {
    case "checking":
      return t("update.progress.checking", "Checking");
    case "preparing":
      return t("update.progress.preparing", "Preparing");
    case "downloading":
      return t("update.progress.downloading", "Downloading");
    case "verifying":
      return t("update.progress.verifying", "Verifying");
    case "staging":
      return t("update.progress.staging", "Installing package");
    case "installing":
      return t("update.progress.installing", "Installing");
    case "restarting":
      return t("update.progress.restarting", "Restarting");
    case "cancelling":
      return t("update.progress.cancelling", "Cancelling");
    case "error":
      return t("update.progress.error", "Update failed");
    default:
      return t("update.progress.waiting", "Please wait");
  }
}

/** Helper already owns install — do not offer cancel. */
function canCancel(phase: string): boolean {
  return !["installing", "restarting", "error", "cancelling"].includes(phase);
}

export default function UpdateProgressApp() {
  const t = useT();
  const [progress, setProgress] = useState<UpdateProgressPayload>({
    phase: "preparing",
    message: t("update.progress.waitingMessage", "Waiting for update…"),
    indeterminate: true,
  });
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("qx-update-progress-page");
    document.body.classList.add("qx-update-progress-body");
    void invoke<UpdateProgressPayload | null>("qx_update_progress_snapshot")
      .then((snapshot) => {
        if (snapshot) setProgress(snapshot);
      })
      .catch(() => {});
    const unlisten = listen<UpdateProgressPayload>("qx-update-progress", ({ payload }) => {
      setProgress(payload);
      if (payload.phase === "error" || payload.phase === "cancelling") {
        setCancelling(payload.phase === "cancelling");
      }
      if (payload.phase === "restarting" || payload.phase === "installing") {
        setCancelling(false);
      }
    });
    return () => {
      document.documentElement.classList.remove("qx-update-progress-page");
      document.body.classList.remove("qx-update-progress-body");
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const percent = Math.max(0, Math.min(100, progress.percent ?? 0));
  const isError = progress.phase === "error" || Boolean(progress.error);
  const showDeterminate = !progress.indeterminate && progress.percent != null && !isError;
  const showCancel = canCancel(progress.phase) && !cancelling && !isError;

  const handleCancel = () => {
    if (cancelling || !showCancel) return;
    setCancelling(true);
    void invoke("qx_update_progress_cancel").catch(() => {
      setCancelling(false);
    });
  };

  return (
    <main className="qx-update-progress" data-tauri-drag-region data-error={isError ? "true" : "false"}>
      <header className="qx-update-progress-header" data-tauri-drag-region>
        <div className="qx-update-progress-title" data-tauri-drag-region>
          {t("update.progress.title", "Updating Qx")}
          {progress.version ? ` · v${progress.version}` : ""}
        </div>
        <div className="qx-update-progress-phase" data-tauri-drag-region>
          {phaseLabel(progress.phase, t)}
        </div>
      </header>

      <p className="qx-update-progress-message" data-tauri-drag-region>
        {progress.error || progress.message}
      </p>

      <div
        className={
          showDeterminate
            ? "qx-update-progress-track"
            : "qx-update-progress-track is-indeterminate"
        }
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={showDeterminate ? Math.round(percent) : undefined}
        aria-busy={!isError}
      >
        <div
          className="qx-update-progress-fill"
          style={showDeterminate ? { width: `${percent}%` } : undefined}
        />
      </div>

      <footer className="qx-update-progress-footer" data-tauri-drag-region>
        <span data-tauri-drag-region>
          {showDeterminate
            ? `${Math.round(percent)}%`
            : isError
              ? t("update.progress.failed", "Failed")
              : cancelling || progress.phase === "cancelling"
                ? t("update.progress.cancellingHint", "Stopping…")
                : t("update.progress.keepOpen", "Please keep this window open")}
        </span>
        <div className="qx-update-progress-actions">
          {showCancel && (
            <button
              type="button"
              className="qx-command-button"
              onClick={handleCancel}
            >
              {t("update.progress.cancel", "Cancel")}
            </button>
          )}
          {isError && (
            <button
              type="button"
              className="qx-command-button"
              onClick={() => void invoke("qx_update_progress_close").catch(() => {})}
            >
              {t("common.close", "Close")}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

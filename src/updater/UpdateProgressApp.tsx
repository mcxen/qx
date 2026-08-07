import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  readyToInstall?: boolean;
  error?: string | null;
}

const SNAPSHOT_POLL_MS = 250;

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
      return t("update.progress.staging", "Preparing package");
    case "ready":
      return t("update.progress.ready", "Ready");
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

/** Helper owns install — no cancel once applying. */
function canCancel(phase: string): boolean {
  return !["installing", "restarting", "error", "cancelling"].includes(phase);
}

function progressSignature(progress: UpdateProgressPayload): string {
  return [
    progress.phase,
    progress.message,
    progress.version ?? "",
    progress.percent ?? "",
    progress.bytesDownloaded ?? "",
    progress.bytesTotal ?? "",
    progress.indeterminate ? "1" : "0",
    progress.readyToInstall ? "1" : "0",
    progress.error ?? "",
  ].join("|");
}

export default function UpdateProgressApp() {
  const t = useT();
  const [progress, setProgress] = useState<UpdateProgressPayload>({
    phase: "preparing",
    message: t("update.progress.waitingMessage", "Waiting for update…"),
    indeterminate: true,
    readyToInstall: false,
  });
  const [cancelling, setCancelling] = useState(false);
  const [applying, setApplying] = useState(false);

  const applyProgress = useCallback((next: UpdateProgressPayload) => {
    setProgress((prev) =>
      progressSignature(prev) === progressSignature(next) ? prev : next,
    );
    if (next.phase === "error" || next.phase === "cancelling") {
      setCancelling(next.phase === "cancelling");
      setApplying(false);
    }
    if (next.phase === "ready") {
      setCancelling(false);
      setApplying(false);
    }
    if (next.phase === "restarting" || next.phase === "installing") {
      setCancelling(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("qx-update-progress-page");
    document.body.classList.add("qx-update-progress-body");

    const pullSnapshot = () => {
      void invoke<UpdateProgressPayload | null>("qx_update_progress_snapshot")
        .then((snapshot) => {
          if (snapshot) applyProgress(snapshot);
        })
        .catch(() => {});
    };

    pullSnapshot();
    const poll = window.setInterval(pullSnapshot, SNAPSHOT_POLL_MS);

    const unlisten = listen<UpdateProgressPayload>("qx-update-progress", ({ payload }) => {
      applyProgress(payload);
    });

    return () => {
      window.clearInterval(poll);
      document.documentElement.classList.remove("qx-update-progress-page");
      document.body.classList.remove("qx-update-progress-body");
      void unlisten.then((dispose) => dispose()).catch(() => {});
    };
  }, [applyProgress]);

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, textarea, select, [data-qx-no-drag]")) {
      return;
    }
    event.preventDefault();
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const percent = Math.max(0, Math.min(100, progress.percent ?? 0));
  const isError = progress.phase === "error" || Boolean(progress.error);
  const isReady = progress.phase === "ready" || progress.readyToInstall === true;
  const showDeterminate =
    (!progress.indeterminate && progress.percent != null && !isError)
    || isReady;
  const showCancel = canCancel(progress.phase) && !cancelling && !isError && !applying;
  const showInstall = isReady && !applying && !isError;

  const handleCancel = () => {
    if (cancelling || !showCancel) return;
    setCancelling(true);
    void invoke("qx_update_progress_cancel").catch(() => {
      setCancelling(false);
    });
  };

  const handleInstallAndRestart = () => {
    if (!showInstall || applying) return;
    setApplying(true);
    void invoke("qx_update_apply_and_restart")
      .catch((error) => {
        setApplying(false);
        applyProgress({
          phase: "error",
          message: String(error),
          version: progress.version,
          indeterminate: false,
          readyToInstall: false,
          error: String(error),
          percent: 100,
        });
      });
  };

  return (
    <main
      className="qx-update-progress"
      data-error={isError ? "true" : "false"}
      data-ready={isReady ? "true" : "false"}
      onPointerDown={startDrag}
    >
      <header className="qx-update-progress-header">
        <div className="qx-update-progress-title">
          {t("update.progress.title", "Updating Qx")}
          {progress.version ? ` · v${progress.version}` : ""}
        </div>
        <div className="qx-update-progress-phase">
          {phaseLabel(progress.phase, t)}
        </div>
      </header>

      <p className="qx-update-progress-message">
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
        aria-valuenow={showDeterminate ? Math.round(isReady ? 100 : percent) : undefined}
        aria-busy={!isError && !isReady}
      >
        <div
          className="qx-update-progress-fill"
          style={showDeterminate ? { width: `${isReady ? 100 : percent}%` } : undefined}
        />
      </div>

      <footer className="qx-update-progress-footer">
        <span>
          {isReady
            ? t("update.progress.readyHint", "Ready when you are")
            : showDeterminate
              ? `${Math.round(percent)}%`
              : isError
                ? t("update.progress.failed", "Failed")
                : cancelling || progress.phase === "cancelling"
                  ? t("update.progress.cancellingHint", "Stopping…")
                  : applying
                    ? t("update.progress.installingHint", "Starting installer…")
                    : t("update.progress.keepOpen", "You can keep using Qx")}
        </span>
        <div className="qx-update-progress-actions" data-qx-no-drag>
          {showInstall && (
            <button
              type="button"
              className="qx-command-button primary"
              data-qx-no-drag
              onClick={handleInstallAndRestart}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {t("update.progress.installRestart", "Install & Restart")}
            </button>
          )}
          {showCancel && (
            <button
              type="button"
              className="qx-command-button"
              data-qx-no-drag
              onClick={handleCancel}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {isReady
                ? t("update.progress.later", "Later")
                : t("update.progress.cancel", "Cancel")}
            </button>
          )}
          {isError && (
            <button
              type="button"
              className="qx-command-button"
              data-qx-no-drag
              onClick={() => void invoke("qx_update_progress_close").catch(() => {})}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {t("common.close", "Close")}
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

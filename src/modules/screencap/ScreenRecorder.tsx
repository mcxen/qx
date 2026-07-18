import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ensureCaptureToastListener,
  requestCaptureSelection,
  takeScreenshotToast,
  useScreencapStore,
  type RecordingOptions,
} from "./store";
import { useStore } from "../../store";
import { useSettingsStore } from "../settings/store";
import { LinkButton, SegmentedControl } from "../../components/ui";
import GifPreview from "./GifPreview";
import CaptureHistory from "./CaptureHistory";
import CaptureToast from "./CaptureToast";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import BetaBadge from "../../components/BetaBadge";
import { useT } from "../../i18n";
import RecordingTransport from "./RecordingTransport";
import type { CaptureHistoryLayout } from "./preferences";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function isScreenshotPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return path.toLowerCase().endsWith(".png");
}

export default function ScreenRecorder() {
  const t = useT();
  const {
    isRecording,
    status,
    elapsedMs,
    frameCount,
    lastGifPath,
    history,
    error,
    stopRecording,
    syncRecordingStatus,
    showControls,
    loadHistory,
    setPreview,
    reset,
  } = useScreencapStore();

  const setTab = useStore((state) => state.setTab);
  const { settings, patch: patchSettings } = useSettingsStore();
  const captureSettings = settings.screencap;
  const recordingOptions: RecordingOptions = {
    outputFormat: captureSettings.output_format,
    fps: captureSettings.fps,
    quality: captureSettings.quality,
    resolution: captureSettings.resolution,
  };
  const controlsPinned = captureSettings.controls_pinned;
  const delaySeconds = captureSettings.capture_delay_seconds;
  const historyLayout = captureSettings.history_layout as CaptureHistoryLayout;
  const updateCaptureSettings = useCallback(
    (changes: Partial<typeof captureSettings>) => {
      patchSettings("screencap", { ...captureSettings, ...changes });
    },
    [captureSettings, patchSettings],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [toastPath, setToastPath] = useState<string | null>(null);

  useEffect(() => {
    void loadHistory();
    void syncRecordingStatus();
  }, [loadHistory, syncRecordingStatus]);

  useEffect(() => {
    ensureCaptureToastListener();
    const pending = takeScreenshotToast();
    if (pending) {
      setToastPath(pending);
      setPreview(pending);
      void loadHistory();
      void syncRecordingStatus();
    }
    if (!isTauriRuntime()) return;
    const unlistenCaptured = listen<{ kind?: string; path?: string }>("screencap:captured", (event) => {
      const path = event.payload?.path;
      if (!path || !isScreenshotPath(path)) return;
      void loadHistory();
      void syncRecordingStatus();
      setPreview(path);
      setToastPath(path);
    });
    const unlistenState = listen<{ phase?: string; outputPath?: string | null }>("screencap:state", (event) => {
      if (event.payload?.phase !== "done") return;
      const path = event.payload.outputPath;
      if (!path || !isScreenshotPath(path)) return;
      void loadHistory();
      setPreview(path);
    });
    return () => {
      void unlistenCaptured.then((dispose) => dispose());
      void unlistenState.then((dispose) => dispose());
    };
  }, [loadHistory, setPreview, syncRecordingStatus]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("screencap_set_controls_pinned", { pinned: controlsPinned });
  }, [controlsPinned]);

  const beginCaptureSelection = useCallback(async (
    mode: "screenshot" | "recording",
  ) => {
    setLocalError(null);
    if (!isTauriRuntime()) {
      setLocalError(t("screencap.select.needsApp", "Region select requires the Qx desktop app."));
      return;
    }
    try {
      await requestCaptureSelection(mode);
    } catch (captureError) {
      setLocalError(String(captureError));
    }
  }, [t]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("screencap");
    if (!launch) return;
    if (launch.surface === "start" || launch.surface === "record" || launch.surface === "screenshot") {
      void beginCaptureSelection(
        launch.surface === "screenshot" ? "screenshot" : "recording",
      );
      return;
    }
    if (launch.surface === "preview") {
      const path = String(launch.params?.path || "");
      if (path) {
        void loadHistory().then(() => setPreview(path));
      }
    }
  }, [beginCaptureSelection, loadHistory, setPreview]);

  useEffect(() => {
    if (isRecording || status === "processing") {
      const syncTimer = window.setInterval(() => void syncRecordingStatus(), 350);
      return () => {
        window.clearInterval(syncTimer);
      };
    }
  }, [isRecording, status, syncRecordingStatus]);

  useEffect(() => {
    const onFocus = () => {
      void syncRecordingStatus();
      void loadHistory();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadHistory, syncRecordingStatus]);

  const beginAreaSelect = useCallback(
    () => beginCaptureSelection("recording"),
    [beginCaptureSelection],
  );

  const beginScreenshot = useCallback(
    () => beginCaptureSelection("screenshot"),
    [beginCaptureSelection],
  );

  const togglePinnedControls = useCallback(() => {
    updateCaptureSettings({ controls_pinned: !controlsPinned });
  }, [controlsPinned, updateCaptureSettings]);

  const handlePopOut = async () => {
    await showControls();
    if (!isTauriRuntime()) return;
    const snapshot = await syncRecordingStatus();
    if (snapshot?.controlsVisible) {
      await invoke("floating_hide").catch(() => getCurrentWindow().hide());
    }
  };

  const handleStop = async () => {
    if (isTauriRuntime()) {
      try {
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus().catch(() => {});
      } catch {
        // ignore
      }
    }
    await stopRecording();
  };

  const handleNewRecording = () => {
    reset();
  };

  const displayError = localError || error;

  const openCaptureSettings = useCallback(() => {
    sessionStorage.setItem("qx.settings.pendingTab", "plugins");
    sessionStorage.setItem("qx.settings.focusPluginId", "builtin:screencap");
    setTab("settings");
  }, [setTab]);

  const runTrayAction = useCallback((id: string) => {
    switch (id) {
      case "open_main":
        void invoke("floating_show");
        break;
      case "hide_main":
        void invoke("floating_hide");
        break;
      case "settings":
        openCaptureSettings();
        break;
      case "keep_visible":
        patchSettings("general", {
          ...settings.general,
          autoHideOnBlur: !settings.general.autoHideOnBlur,
        });
        break;
      default:
        void invoke("get_system_stats");
        break;
    }
  }, [openCaptureSettings, patchSettings, settings]);

  const readyActions = useMemo<QxShellAction[]>(
    () => [
      { label: t("screencap.screenshot", "Take Screenshot"), kbd: "Enter", onClick: () => void beginScreenshot() },
      { label: t("screencap.record", "Record"), onClick: () => void beginAreaSelect() },
      {
        label: controlsPinned
          ? t("screencap.controls.unpin", "Hide Persistent Capture Island")
          : t("screencap.controls.pin", "Keep Capture Island Visible"),
        onClick: togglePinnedControls,
      },
      ...settings.tray_actions
        .filter((action) => action.enabled)
        .map((action) => ({
          label: action.title,
          kbd: settings.shortcuts[`tray_${action.id}`]?.enabled
            ? settings.shortcuts[`tray_${action.id}`]?.key
            : undefined,
          onClick: () => runTrayAction(action.id),
        })),
    ],
    [beginAreaSelect, beginScreenshot, controlsPinned, runTrayAction, settings.shortcuts, settings.tray_actions, t, togglePinnedControls],
  );

  const doneActions = useMemo<QxShellAction[]>(
    () => [
      { label: t("screencap.newRecording", "New Capture"), kbd: "Enter", onClick: handleNewRecording },
      {
        label: t("screencap.backLauncher", "Back to Launcher"),
        onClick: () => {
          reset();
          setTab("launcher");
        },
      },
    ],
    [reset, setTab, t],
  );

  const recordingActions = useMemo<QxShellAction[]>(
    () => [
      {
        label: t("screencap.popOut", "Move to Floating Controls"),
        disabled: status === "processing",
        onClick: () => void handlePopOut(),
      },
      {
        label: status === "processing"
          ? t("screencap.saving", "Saving…")
          : t("screencap.stop", "Stop Recording"),
        kbd: "Enter",
        disabled: status === "processing",
        tone: status === "processing" ? "normal" : "danger",
        onClick: () => void handleStop(),
      },
    ],
    [status, t],
  );

  const showingPreview = Boolean(lastGifPath) && (status === "done" || status === "idle");

  // Stepped Esc: stop recording / clear preview → leave to launcher.
  // Host then continues: clear launcher query → hide panel.
  // While finalizing (processing), leave is allowed — encode continues in Rust.
  const handleModuleKeys = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      void beginAreaSelect();
      return;
    }

    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (isRecording || status === "processing") {
        e.preventDefault();
        void handleStop();
        return;
      }
      if (status === "idle" || status === "error") {
        e.preventDefault();
        void beginScreenshot();
        return;
      }
      if (status === "done") {
        e.preventDefault();
        handleNewRecording();
        return;
      }
    }

  }, [beginAreaSelect, beginScreenshot, handleStop, isRecording, status]);

  const leave = useCallback(() => {
    reset();
    setTab("launcher");
  }, [reset, setTab]);

  const shell = useQxModuleShell({
    leave,
    esc: {
      inner: {
        active: isRecording || showingPreview,
        close: () => {
          if (isRecording) {
            void handleStop();
            return;
          }
          reset();
        },
      },
    },
    onKeyDown: handleModuleKeys,
    actionsLabel: t("common.actions", "Actions"),
    island: {
      label: isRecording || status === "processing"
        ? t("screencap.recording", "Recording")
        : showingPreview
          ? t("screencap.ready", "Capture Ready")
          : t("screencap.readyToRecord", "Ready to Capture"),
      detail: isRecording || status === "processing"
        ? formatTime(elapsedMs)
        : showingPreview
          ? lastGifPath?.split(/[\\/]/).pop()
          : `${recordingOptions.outputFormat.toUpperCase()} · ${recordingOptions.fps} fps · ${delaySeconds > 0 ? `${delaySeconds}s` : t("screencap.delay.none", "No delay")}`,
      tone: showingPreview
        ? "success"
        : displayError
          ? "danger"
          : isRecording
            ? "danger"
            : "neutral",
    },
    t,
  });

  const selectedHistoryIndex = history.length
    ? Math.max(0, history.findIndex((entry) => entry.path === lastGifPath))
    : -1;

  if (isRecording || status === "processing") {
    return (
      <QxShell
        title={t("screencap.title", "Screen Capture")}
        search={
          <div className="qx-rss-detail-title qx-module-title-with-badge">
            <span>{t("screencap.recording", "Recording")}</span>
            <BetaBadge />
          </div>
        }
        onKeyDown={shell.onKeyDown}
        customIsland={(
          <RecordingTransport
            host="main"
            status={status}
            elapsedMs={elapsedMs}
            frameCount={frameCount}
            onTransfer={handlePopOut}
            onStop={handleStop}
          />
        )}
        escapeAction={shell.escapeAction}
        primaryAction={{
          label: status === "processing" ? t("common.savingShort", "Saving") : t("common.stop", "Stop"),
          disabled: status === "processing",
          tone: status === "processing" ? "normal" : "danger",
          onClick: () => void handleStop(),
        }}
        secondaryAction={status === "processing" ? undefined : shell.secondaryAction}
        actionTitle={t("screencap.actions", "Recording Actions")}
        actions={recordingActions}
      >
        <div className="qx-module-stage" style={{ alignItems: "center", justifyContent: "center", flex: 1, gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              className="qx-rec-dot"
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "var(--qx-danger)",
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--qx-text-primary)" }}>
              {status === "processing"
                ? t("common.savingShort", "Saving")
                : status === "error"
                  ? t("screencap.recordingError", "Recording Error")
                  : t("screencap.recording", "Recording")}
            </span>
          </div>
          <div
            style={{
              fontSize: 44,
              fontVariantNumeric: "tabular-nums",
              color: "var(--qx-text-primary)",
              fontWeight: 300,
              letterSpacing: 1,
            }}
          >
            {formatTime(elapsedMs)}
          </div>
          <p style={{ fontSize: 12, color: "var(--qx-text-tertiary)", maxWidth: 360, textAlign: "center", margin: 0 }}>
            {status === "processing"
              ? t("screencap.finalizingHint", "Finalizing the MP4/MOV container…")
              : t("screencap.controllerHint", "The floating controller is excluded from capture. You can return here or move control back outside at any time.")}
          </p>
          <button
            onClick={() => void handleStop()}
            disabled={status === "processing"}
            className={`qx-command-button${status === "processing" ? "" : " danger"}`}
            style={{ height: 28, padding: "0 12px" }}
          >
            {status === "processing"
              ? t("screencap.savingVideoProgress", "Saving video…")
              : t("common.stop", "Stop")}
          </button>
        </div>
      </QxShell>
    );
  }

  return (
    <QxShell
      title={t("screencap.title", "Screen Capture")}
      search={
        <div className="qx-rss-detail-title qx-module-title-with-badge">
          <span>
            {showingPreview
              ? t("screencap.previewTitle", "Capture Preview")
              : t("screencap.title", "Screen Capture")}
          </span>
          <BetaBadge />
        </div>
      }
      onKeyDown={shell.onKeyDown}
      navigation={history.length ? {
        index: selectedHistoryIndex,
        count: history.length,
        pageSize: historyLayout === "gallery" ? 8 : 6,
        regionId: "screencap-history",
        editable: "search",
        onChange: (index) => setPreview(history[index].path),
        onOpen: selectedHistoryIndex >= 0
          ? () => setPreview(history[selectedHistoryIndex].path)
          : undefined,
      } : undefined}
      trailing={
        <>
          <SegmentedControl
            value={historyLayout}
            options={[
              { value: "list", label: t("screencap.history.list", "List") },
              { value: "gallery", label: t("screencap.history.gallery", "Gallery") },
            ]}
            onChange={(value) => updateCaptureSettings({ history_layout: value as CaptureHistoryLayout })}
          />
          <button className="qx-command-button primary" onClick={() => void beginScreenshot()} type="button">
            {t("screencap.screenshot", "Screenshot")}
          </button>
          <button className="qx-command-button" onClick={() => void beginAreaSelect()} type="button">
            {t("screencap.record", "Record")}
          </button>
        </>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryAction={
        showingPreview
          ? { label: t("common.new", "New"), kbd: "Enter", tone: "primary", onClick: handleNewRecording }
          : { label: t("screencap.screenshot", "Screenshot"), kbd: "Enter", tone: "primary", onClick: () => void beginScreenshot() }
      }
      secondaryAction={shell.secondaryAction}
      actionTitle={t("screencap.actions", "Capture Actions")}
      actions={showingPreview ? doneActions : readyActions}
    >
      <div
        className={`qx-screencap-browser is-${historyLayout}`}
      >
        <div
          className="qx-content-list qx-screencap-history-pane"
          data-qx-region="screencap-history"
          data-qx-region-label={t("screencap.history.region", "Capture history")}
          data-qx-region-initial="true"
          data-qx-region-scroll
          tabIndex={-1}
        >
          <CaptureHistory layout={historyLayout} />
        </div>

        <div
          className="qx-plugin-detail qx-screencap-detail-pane"
          data-qx-region="screencap-detail"
          data-qx-region-label={t("screencap.detail.region", "Capture detail")}
          data-qx-region-scroll
          tabIndex={-1}
        >
          {toastPath && (
            <CaptureToast
              path={toastPath}
              onOpen={() => {
                setPreview(toastPath);
                setToastPath(null);
              }}
              onDismiss={() => setToastPath(null)}
            />
          )}
          {lastGifPath && (status === "done" || status === "idle") ? (
            <GifPreview path={lastGifPath} onClose={handleNewRecording} />
          ) : (
            <div className="qx-module-stage" style={{ padding: 12, gap: 12 }}>
              <div className="qx-panel-card" style={{ padding: 12 }}>
                <div className="qx-detail-title" style={{ marginBottom: 6 }}>
                  {t("screencap.configuration", "Capture Settings")}
                </div>
                <div className="qx-detail-meta" style={{ marginBottom: 12 }}>
                  {t("screencap.configurationHint", "Screenshot or record any display. Region selection follows the display under your pointer.")}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button onClick={() => void beginScreenshot()} className="qx-command-button primary" type="button">
                    {t("screencap.screenshot", "Screenshot")}
                  </button>
                  <button onClick={() => void beginAreaSelect()} className="qx-command-button" type="button">
                    {t("screencap.record", "Record")}
                  </button>
                  <button onClick={togglePinnedControls} className="qx-command-button" type="button">
                    {controlsPinned
                      ? t("screencap.controls.unpinShort", "Hide Capture Island")
                      : t("screencap.controls.pinShort", "Show Capture Island")}
                  </button>
                </div>
                <div className="qx-screencap-settings-link">
                  <span>{t("screencap.configurationMoved", "Capture and recording options are managed in the Screen Capture module settings.")}</span>
                  <LinkButton onClick={openCaptureSettings}>
                    {t("screencap.openSettings", "Open module settings")}
                  </LinkButton>
                </div>
                <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)", marginTop: 10 }}>
                  {t("screencap.fullSelectHint", "Region · Window · Full screen on built-in and external displays")}
                </div>
              </div>

              {displayError && (
                <div
                  className="qx-panel-card"
                  style={{ padding: "8px 10px", fontSize: 12, color: "var(--qx-danger)", whiteSpace: "pre-wrap" }}
                >
                  {displayError}
                </div>
              )}

              <div className="qx-panel-card" style={{ padding: 12, fontSize: 12, color: "var(--qx-text-tertiary)", lineHeight: 1.5 }}>
                <strong style={{ color: "var(--qx-text-secondary)" }}>
                  {t("screencap.tips", "Tips")}
                </strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  <li>{t("screencap.tip.permission", "macOS: Screen Recording permission must be granted; restart Qx after enabling.")}</li>
                  <li>{t("screencap.tip.keys", "Picker: Enter / double-click confirm · Space full screen · S/R intent · Tab region/window · 1–6 tools.")}</li>
                  <li>{t("screencap.tip.directVideo", "Recording is written directly to MP4 or MOV without temporary PNG frames.")}</li>
                  <li>{t("screencap.tip.protected", "The floating controller and the Qx recording panel are excluded from capture.")}</li>
                  <li>{t("screencap.tip.gif", "Open a completed video and choose Convert to GIF only when needed.")}</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </QxShell>
  );
}

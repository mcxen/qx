import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ensureCaptureToastListener,
  recaptureLastRegion,
  requestCaptureSelection,
  takeScreenshotToast,
  useScreencapStore,
  type RecordingOptions,
} from "./store";
import { useStore } from "../../store";
import { useSettingsStore } from "../settings/store";
import { openSettings } from "../settings/openSettings";
import GifPreview from "./GifPreview";
import CaptureHistory from "./CaptureHistory";
import CaptureToast from "./CaptureToast";
import QxResizableSplit from "../../components/QxResizableSplit";
import QxShell, {
  type BottomIslandContent,
  type QxShellAction,
  type QxShellActionMenuRequest,
} from "../../components/QxShell";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import BetaBadge from "../../components/BetaBadge";
import { useT } from "../../i18n";
import RecordingTransport from "./RecordingTransport";
import {
  getCaptureHistoryKind,
  type CaptureHistoryKind,
  type CaptureHistoryLayout,
} from "./preferences";

const SCREENCAP_HISTORY_WIDTH_KEY = "qx:screencap:history-width";

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

function isImageCopyablePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".png")
    || lower.endsWith(".jpg")
    || lower.endsWith(".jpeg")
    || lower.endsWith(".webp")
    || lower.endsWith(".gif");
}

function isVideoConvertiblePath(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".mp4") || lower.endsWith(".mov");
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
    saveAsCopy,
    copyImage,
    revealInFolder,
    previewStatus,
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
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState<Record<CaptureHistoryKind, boolean>>({
    screenshot: true,
    recording: true,
  });
  const screenshotHistory = useMemo(
    () => history.filter((entry) => getCaptureHistoryKind(entry) === "screenshot"),
    [history],
  );
  const recordingHistory = useMemo(
    () => history.filter((entry) => getCaptureHistoryKind(entry) === "recording"),
    [history],
  );
  const visibleHistory = useMemo(
    () => [
      ...(expandedHistoryGroups.screenshot ? screenshotHistory : []),
      ...(expandedHistoryGroups.recording ? recordingHistory : []),
    ],
    [expandedHistoryGroups, recordingHistory, screenshotHistory],
  );
  const updateCaptureSettings = useCallback(
    (changes: Partial<typeof captureSettings>) => {
      patchSettings("screencap", { ...captureSettings, ...changes });
    },
    [captureSettings, patchSettings],
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [toastPath, setToastPath] = useState<string | null>(null);
  const observedPreviewPath = useRef<string | null>(null);
  /**
   * Pointer-anchored Action menu request: bottom Actions button uses the
   * default anchor, right-click on a history row supplies (x, y) so the same
   * menu pops up next to the cursor (Launcher-style).
   */
  const [actionMenuRequest, setActionMenuRequest] =
    useState<QxShellActionMenuRequest | null>(null);
  useEffect(() => {
    void loadHistory();
    void syncRecordingStatus();
    if (isTauriRuntime()) {
      // Warm the native display inventory while the module is idle so a later
      // shortcut or island action can open the picker without the first-frame
      // xcap enumeration delay.
      void invoke("display_list").catch(() => {});
    }
  }, [loadHistory, syncRecordingStatus]);

  useEffect(() => {
    ensureCaptureToastListener(t);
    const pending = takeScreenshotToast();
    if (pending) {
      setToastPath(pending);
      setPreview(pending);
      void loadHistory();
      void syncRecordingStatus();
    }
    if (!isTauriRuntime()) return;
    const unlistenCaptured = listen<{ kind?: string; path?: string; dismissed?: boolean }>(
      "screencap:captured",
      (event) => {
      const path = event.payload?.path;
      if (!path || !isScreenshotPath(path)) return;
      void loadHistory();
      void syncRecordingStatus();
      // Copy-and-continue (Cmd/Ctrl+C) keeps Qx hidden — no in-module toast/preview.
      if (event.payload?.dismissed) return;
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
  }, [loadHistory, setPreview, syncRecordingStatus, t]);

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
      const message = String(captureError);
      setLocalError(message);
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

  /**
   * Right-click on a history row should first select that entry, then surface
   * the shared Actions menu at the cursor position. Selection must commit
   * before the menu snapshots its actions; deferring the menu one frame
   * matches Launcher's pattern and avoids showing stale per-item actions.
   */
  const handleOpenActionsAt = useCallback((x: number, y: number) => {
    window.requestAnimationFrame(() => {
      setActionMenuRequest((request) => ({
        id: (request?.id ?? 0) + 1,
        x,
        y,
      }));
    });
  }, []);

  /**
   * Convert the current preview to a GIF via the same Rust command as the
   * inline Convert row. Mirrors GifPreview's defaults so an action-menu pick
   * produces the same artifact as clicking the inline Create GIF button.
   */
  const handleConvertGifAction = useCallback(
    async (path: string) => {
      try {
        const gif = await invoke<string>("convert_recording_to_gif", {
          sourcePath: path,
          maxWidth: 960,
          fps: 12,
        });
        await loadHistory();
        setPreview(gif);
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [loadHistory, setPreview],
  );

  const displayError = localError || error;
  const showingPreview = Boolean(lastGifPath) && (status === "done" || status === "idle");
  const saving = previewStatus.saving;

  useEffect(() => {
    if (!lastGifPath || observedPreviewPath.current === lastGifPath) return;
    const entry = history.find((item) => item.path === lastGifPath);
    if (!entry) return;
    observedPreviewPath.current = lastGifPath;
    const kind = getCaptureHistoryKind(entry);
    setExpandedHistoryGroups((current) => current[kind]
      ? current
      : { ...current, [kind]: true });
  }, [history, lastGifPath]);

  const handleHistoryGroupExpanded = useCallback((
    kind: CaptureHistoryKind,
    expanded: boolean,
  ) => {
    setExpandedHistoryGroups((current) => ({ ...current, [kind]: expanded }));
    if (expanded || !lastGifPath) return;
    const selected = history.find((entry) => entry.path === lastGifPath);
    if (!selected || getCaptureHistoryKind(selected) !== kind) return;
    const otherKind: CaptureHistoryKind = kind === "screenshot" ? "recording" : "screenshot";
    const otherEntries = otherKind === "screenshot" ? screenshotHistory : recordingHistory;
    if (expandedHistoryGroups[otherKind] && otherEntries[0]) {
      setPreview(otherEntries[0].path);
    } else {
      reset();
    }
  }, [expandedHistoryGroups, history, lastGifPath, recordingHistory, reset, screenshotHistory, setPreview]);

  const openCaptureSettings = useCallback(() => {
    openSettings({ focusPluginId: "builtin:screencap" });
  }, []);

  const captureIsland = useMemo<BottomIslandContent>(() => {
    return {
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
      actions: [
        {
          id: "start-screenshot",
          label: t("screencap.startScreenshot", "Start Screenshot / Recording"),
          icon: "play",
          onAction: () => void beginScreenshot(),
        },
        {
          id: "open-settings",
          label: t("screencap.settings", "Settings"),
          icon: "open",
          onAction: openCaptureSettings,
        },
      ],
    };
  }, [
    beginScreenshot,
    delaySeconds,
    displayError,
    elapsedMs,
    isRecording,
    lastGifPath,
    openCaptureSettings,
    recordingOptions.fps,
    recordingOptions.outputFormat,
    showingPreview,
    status,
    t,
  ]);

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

  const handleRecaptureLast = useCallback(async () => {
    setLocalError(null);
    if (!isTauriRuntime()) {
      setLocalError(t("screencap.select.needsApp", "Region select requires the Qx desktop app."));
      return;
    }
    try {
      await recaptureLastRegion();
    } catch (captureError) {
      const message = String(captureError);
      setLocalError(message);
    }
  }, [t]);

  const readyActions = useMemo<QxShellAction[]>(
    () => [
      {
        id: "screenshot",
        label: t("screencap.startCapture", "Screenshot / Recording"),
        kbd: "Enter",
        onClick: () => void beginScreenshot(),
      },
      {
        id: "recapture-last",
        label: t("screencap.recaptureLast", "Recapture Last Region"),
        kbd: settings.shortcuts.recapture_last_region?.enabled
          ? settings.shortcuts.recapture_last_region.key
          : undefined,
        onClick: () => void handleRecaptureLast(),
      },
      { id: "record", label: t("screencap.record", "Record"), onClick: () => void beginAreaSelect() },
      {
        id: "toggle-pinned-controls",
        label: controlsPinned
          ? t("screencap.controls.unpin", "Hide Persistent Capture Island")
          : t("screencap.controls.pin", "Keep Capture Island Visible"),
        onClick: togglePinnedControls,
      },
      ...settings.tray_actions
        .filter((action) => action.enabled)
        .map((action) => ({
          id: `tray-${action.id}`,
          label: action.title,
          kbd: settings.shortcuts[`tray_${action.id}`]?.enabled
            ? settings.shortcuts[`tray_${action.id}`]?.key
            : undefined,
          onClick: () => runTrayAction(action.id),
        })),
    ],
    [
      beginAreaSelect,
      beginScreenshot,
      controlsPinned,
      handleRecaptureLast,
      runTrayAction,
      settings.shortcuts,
      settings.tray_actions,
      t,
      togglePinnedControls,
    ],
  );

  const doneActions = useMemo<QxShellAction[]>(() => {
    const actions: QxShellAction[] = [];
    // Operations that operate on the currently previewed item.
    if (lastGifPath) {
      actions.push({
        id: "save-as-copy",
        label: saving
          ? t("common.saving", "Saving…")
          : t("screencap.preview.list.saveAs", "Save as copy"),
        disabled: !lastGifPath || saving,
        onClick: () => void saveAsCopy(lastGifPath, t),
      });
      if (isImageCopyablePath(lastGifPath)) {
        actions.push({
          id: "copy-image",
          label: t("screencap.preview.list.copy", "Copy to clipboard"),
          onClick: () => void copyImage(lastGifPath, t),
        });
      }
      if (isVideoConvertiblePath(lastGifPath)) {
        actions.push({
          id: "convert-gif",
          label: t("screencap.preview.convert", "Convert to GIF"),
          onClick: () => void handleConvertGifAction(lastGifPath),
        });
      }
      actions.push({
        id: "show-in-folder",
        label: t("screencap.preview.list.reveal", "Show in folder"),
        onClick: () => void revealInFolder(lastGifPath, t),
      });
      actions.push({
        id: "new-capture",
        label: t("screencap.preview.list.newCapture", "New capture"),
        kbd: "Enter",
        onClick: () => void beginScreenshot(),
      });
      actions.push({
        id: "back-launcher",
        label: t("screencap.backLauncher", "Back to Launcher"),
        onClick: () => {
          reset();
          setTab("launcher");
        },
      });
    } else {
      actions.push({
        id: "new-capture",
        label: t("screencap.startCapture", "Screenshot / Recording"),
        kbd: "Enter",
        onClick: () => void beginScreenshot(),
      });
    }
    return actions;
  }, [
    beginScreenshot,
    copyImage,
    handleConvertGifAction,
    lastGifPath,
    previewStatus.saving,
    reset,
    revealInFolder,
    saveAsCopy,
    setTab,
    t,
  ]);

  const recordingActions = useMemo<QxShellAction[]>(
    () => [
      {
        id: "pop-out",
        label: t("screencap.popOut", "Move to Floating Controls"),
        disabled: status === "processing",
        onClick: () => void handlePopOut(),
      },
      {
        id: "stop",
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

  // Stepped Esc: stop recording / clear preview → leave to launcher.
  // Host then continues: clear launcher query → hide panel.
  // While finalizing (processing), leave is allowed — encode continues in Rust.
  const handleModuleKeys = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      void beginAreaSelect();
      return;
    }

  }, [beginAreaSelect]);

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
    island: captureIsland,
  });

  const selectedHistoryIndex = visibleHistory.findIndex((entry) => entry.path === lastGifPath);

  if (isRecording || status === "processing") {
    return (
      <QxShell
        title={t("screencap.title", "Screenshot & Recording Module")}
        islandKey="screencap.recording"
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
        primaryActionId="stop"
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

  const captureToast = toastPath ? (
    <CaptureToast
      path={toastPath}
      onOpen={() => {
        setPreview(toastPath);
        setToastPath(null);
      }}
      onDismiss={() => setToastPath(null)}
    />
  ) : null;
  const historyPane = (
    <div
      className="qx-content-list qx-screencap-history-pane"
      data-qx-region="screencap-history"
      data-qx-region-label={t("screencap.history.region", "Capture history")}
      data-qx-region-initial="true"
      tabIndex={-1}
    >
      <CaptureHistory
        layout={historyLayout}
        expandedGroups={expandedHistoryGroups}
        onExpandedChange={handleHistoryGroupExpanded}
        onOpenActionsAt={handleOpenActionsAt}
      />
    </div>
  );
  const previewPane = (
    <div
      className="qx-content-detail qx-screencap-preview-pane"
      data-qx-region="screencap-preview"
      data-qx-region-label={t("screencap.previewTitle", "Capture Preview")}
      data-qx-region-scroll
      tabIndex={-1}
    >
      <GifPreview path={lastGifPath!} />
    </div>
  );

  return (
    <QxShell
      title={t("screencap.title", "Screenshot & Recording Module")}
      islandKey="screencap"
      search={
        <div className="qx-rss-detail-title qx-module-title-with-badge">
          <span>
            {showingPreview
              ? t("screencap.previewTitle", "Capture Preview")
              : t("screencap.title", "Screenshot & Recording Module")}
          </span>
          <BetaBadge />
        </div>
      }
      onKeyDown={shell.onKeyDown}
      navigation={visibleHistory.length ? {
        index: selectedHistoryIndex,
        count: visibleHistory.length,
        pageSize: historyLayout === "gallery" ? 8 : 6,
        regionId: "screencap-history",
        editable: "search",
        onChange: (index) => setPreview(visibleHistory[index].path),
        onOpen: selectedHistoryIndex >= 0
          ? () => setPreview(visibleHistory[selectedHistoryIndex].path)
          : undefined,
      } : undefined}
      topbarFilters={[{
        id: "capture-layout",
        label: t("screencap.history.layout", "History layout"),
        value: historyLayout,
        options: [
          { value: "list", label: t("screencap.history.list", "List") },
          { value: "gallery", label: t("screencap.history.gallery", "Gallery") },
        ],
        onChange: (value) => updateCaptureSettings({
          history_layout: value as CaptureHistoryLayout,
        }),
      }]}
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryActionId={showingPreview ? "new-capture" : "screenshot"}
      actionTitle={t("screencap.actions", "Capture Actions")}
      actions={showingPreview ? doneActions : readyActions}
      actionMenuRequest={actionMenuRequest}
    >
      {showingPreview ? (
        <QxResizableSplit
          className={`qx-content-split qx-screencap-browser is-${historyLayout} has-detail`}
          storageKey={SCREENCAP_HISTORY_WIDTH_KEY}
          defaultLeftWidth={null}
          resetLeftWidth={null}
          minLeftWidth={280}
          minRightWidth={320}
          separatorLabel={t("screencap.resizeHistory", "Resize capture history and preview")}
          overlay={captureToast}
        >
          {historyPane}
          {previewPane}
        </QxResizableSplit>
      ) : (
        <div className={`qx-content-split qx-screencap-browser is-${historyLayout}`}>
          {captureToast}
          {historyPane}
        </div>
      )}
    </QxShell>
  );
}

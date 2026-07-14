import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  primaryMonitor,
  currentMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import {
  DEFAULT_RECORDING_OPTIONS,
  useScreencapStore,
  type RecordArea,
  type RecordingOptions,
} from "./store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { LinkButton, Select } from "../../components/ui";
import GifPreview from "./GifPreview";
import GifHistory from "./GifHistory";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { getQxShortcutPreset } from "../../utils/keyboard";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import BetaBadge from "../../components/BetaBadge";
import { useT } from "../../i18n";
import RecordingTransport from "./RecordingTransport";

type SelectMode = "none" | "selecting";

interface WindowSnapshot {
  /** Physical outer position */
  x: number;
  y: number;
  /** Physical outer size */
  width: number;
  height: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function loadRecordingOptions(): RecordingOptions {
  try {
    const stored = JSON.parse(localStorage.getItem("qx.screencap.options") ?? "null") as Partial<RecordingOptions> | null;
    return { ...DEFAULT_RECORDING_OPTIONS, ...(stored ?? {}) };
  } catch {
    return DEFAULT_RECORDING_OPTIONS;
  }
}

async function snapshotWindow(): Promise<WindowSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    return { x: pos.x, y: pos.y, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

async function restoreWindow(snap: WindowSnapshot | null) {
  if (!isTauriRuntime() || !snap) return;
  try {
    const win = getCurrentWindow();
    const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
    await win.setPosition(new PhysicalPosition(snap.x, snap.y));
    await win.setSize(new PhysicalSize(snap.width, snap.height));
    await win.show();
    await win.setFocus().catch(() => {});
  } catch {
    // best-effort restore
  }
}

async function expandToPrimaryMonitor(): Promise<{ monitor: Monitor; scale: number } | null> {
  if (!isTauriRuntime()) return null;
  try {
    const win = getCurrentWindow();
    const monitor = (await primaryMonitor()) ?? (await currentMonitor());
    if (!monitor) return null;
    const { PhysicalPosition, PhysicalSize } = await import("@tauri-apps/api/window");
    await win.setAlwaysOnTop(true);
    await win.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
    await win.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
    await win.show();
    await win.setFocus().catch(() => {});
    return { monitor, scale: monitor.scaleFactor };
  } catch {
    return null;
  }
}

async function ensureScreenPermission(permissionError: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    type Perm = { id: string; granted: boolean; available: boolean };
    const list = await invoke<Perm[]>("qx_permissions_status");
    const screen = list.find((p) => p.id === "screen-recording");
    if (!screen || !screen.available) return null;
    if (screen.granted) return null;
    const ok = await invoke<boolean>("qx_permissions_request", { id: "screen-recording" });
    if (ok) return null;
    return permissionError;
  } catch {
    return null;
  }
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
    startRecording,
    stopRecording,
    syncRecordingStatus,
    showControls,
    loadHistory,
    setPreview,
    reset,
  } = useScreencapStore();

  const setTab = useStore((state) => state.setTab);

  const [selectMode, setSelectMode] = useState<SelectMode>("none");
  const [area, setArea] = useState<RecordArea | null>(null);
  /** Physical-pixel crop used by scrap (Retina-aware). */
  const [areaPhysical, setAreaPhysical] = useState<RecordArea | null>(null);
  const [recordingOptions, setRecordingOptions] = useState<RecordingOptions>(loadRecordingOptions);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectHint, setSelectHint] = useState(() =>
    t("screencap.select.drag", "Drag on the primary display · Esc to cancel"),
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const windowSnapRef = useRef<WindowSnapshot | null>(null);
  const selectScaleRef = useRef(1);

  useEffect(() => {
    if (selectMode === "selecting") {
      overlayRef.current?.focus();
    }
  }, [selectMode]);

  useEffect(() => {
    void loadHistory();
    void syncRecordingStatus();
  }, [loadHistory, syncRecordingStatus]);

  useEffect(() => {
    localStorage.setItem("qx.screencap.options", JSON.stringify(recordingOptions));
  }, [recordingOptions]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("screencap");
    if (!launch) return;
    if (launch.surface === "start") {
      void (async () => {
        const permErr = await ensureScreenPermission(
          t("screencap.permission", "Screen Recording permission is required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."),
        );
        if (permErr) {
          setLocalError(permErr);
          return;
        }
        await startRecording(null, recordingOptions);
      })();
      return;
    }
    if (launch.surface === "preview") {
      const path = String(launch.params?.path || "");
      if (path) {
        void loadHistory().then(() => setPreview(path));
      }
    }
  }, [loadHistory, recordingOptions, setPreview, startRecording, t]);

  useEffect(() => {
    if (isRecording || status === "processing") {
      const syncTimer = window.setInterval(() => void syncRecordingStatus(), 350);
      return () => {
        window.clearInterval(syncTimer);
      };
    }
  }, [isRecording, status, syncRecordingStatus]);

  const cancelAreaSelect = useCallback(async () => {
    setSelectMode("none");
    setDragStart(null);
    setDragEnd(null);
    await restoreWindow(windowSnapRef.current);
    windowSnapRef.current = null;
  }, []);

  const beginAreaSelect = useCallback(async () => {
    setLocalError(null);
    const permErr = await ensureScreenPermission(
      t("screencap.permission", "Screen Recording permission is required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."),
    );
    if (permErr) {
      setLocalError(permErr);
      return;
    }

    windowSnapRef.current = await snapshotWindow();
    const expanded = await expandToPrimaryMonitor();
    if (expanded) {
      selectScaleRef.current = expanded.scale;
      setSelectHint(t("screencap.select.primary", "Drag to select on the primary display · Esc to cancel"));
    } else {
      // Browser / failed expand: still allow in-window select for dev, but warn.
      selectScaleRef.current = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      setSelectHint(t("screencap.select.fallback", "Drag to select (in-window fallback) · Esc to cancel"));
    }
    setSelectMode("selecting");
    setDragStart(null);
    setDragEnd(null);
  }, [t]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (selectMode !== "selecting") return;
    e.preventDefault();
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (selectMode !== "selecting" || !dragStart) return;
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = async () => {
    if (selectMode !== "selecting" || !dragStart || !dragEnd) {
      await cancelAreaSelect();
      return;
    }
    const scale = selectScaleRef.current || 1;
    const lx = Math.min(dragStart.x, dragEnd.x);
    const ly = Math.min(dragStart.y, dragEnd.y);
    const lw = Math.abs(dragEnd.x - dragStart.x);
    const lh = Math.abs(dragEnd.y - dragStart.y);

    setSelectMode("none");
    setDragStart(null);
    setDragEnd(null);
    await restoreWindow(windowSnapRef.current);
    windowSnapRef.current = null;

    if (lw < 8 || lh < 8) return;

    // Logical (CSS) size for UI labels; physical for scrap crop.
    const logical: RecordArea = {
      x: Math.round(lx),
      y: Math.round(ly),
      w: Math.round(lw),
      h: Math.round(lh),
    };
    const physical: RecordArea = {
      x: Math.max(0, Math.round(lx * scale)),
      y: Math.max(0, Math.round(ly * scale)),
      w: Math.max(1, Math.round(lw * scale)),
      h: Math.max(1, Math.round(lh * scale)),
    };
    setArea(logical);
    setAreaPhysical(physical);
  };

  const handleStart = async () => {
    setLocalError(null);
    const permErr = await ensureScreenPermission(
      t("screencap.permission", "Screen Recording permission is required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."),
    );
    if (permErr) {
      setLocalError(permErr);
      return;
    }
    await startRecording(areaPhysical ?? null, recordingOptions);
  };

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
    // Keep history selection cleared; area can stay for re-record.
  };

  const actionMenuShortcut = getQxShortcutPreset().actionMenu;
  const displayError = localError || error;

  const readyActions = useMemo<QxShellAction[]>(
    () => [
      { label: t("screencap.start", "Start Recording"), kbd: "Enter", onClick: () => void handleStart() },
      { label: t("screencap.selectArea", "Select Area"), kbd: "CmdOrCtrl+Shift+A", onClick: () => void beginAreaSelect() },
      {
        label: t("screencap.clearArea", "Clear Area"),
        disabled: !area,
        onClick: () => {
          setArea(null);
          setAreaPhysical(null);
        },
      },
      {
        label: t("screencap.fullPrimary", "Full Screen (Primary)"),
        onClick: () => {
          setArea(null);
          setAreaPhysical(null);
        },
      },
    ],
    [area, beginAreaSelect, t],
  );

  const doneActions = useMemo<QxShellAction[]>(
    () => [
      { label: t("screencap.newRecording", "New Recording"), kbd: "Enter", onClick: handleNewRecording },
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

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: selectMode === "selecting",
      close: () => {
        void cancelAreaSelect();
      },
    },
    launcher: () => {
      if (isRecording) void handleStop();
      reset();
      setTab("launcher");
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;

    if (selectMode === "selecting") return;

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
        void handleStart();
        return;
      }
      if (status === "done") {
        e.preventDefault();
        handleNewRecording();
        return;
      }
    }

    if (history.length === 0) return;
    const currentIndex = Math.max(
      0,
      history.findIndex((h) => h.path === lastGifPath),
    );
    switch (e.key) {
      case "ArrowDown":
      case "j": {
        if (e.metaKey || e.ctrlKey || e.altKey) break;
        e.preventDefault();
        const next = Math.min(currentIndex + 1, history.length - 1);
        setPreview(history[next].path);
        break;
      }
      case "ArrowUp":
      case "k": {
        if (e.metaKey || e.ctrlKey || e.altKey) break;
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        setPreview(history[prev].path);
        break;
      }
      default:
        break;
    }
  };

  // ── Full-screen (monitor) region picker ─────────────────────────────
  if (selectMode === "selecting") {
    const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
    const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
    const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
    const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;
    return (
      <div
        ref={overlayRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void cancelAreaSelect();
          }
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={() => void onMouseUp()}
        style={{
          position: "fixed",
          inset: 0,
          // Dim desktop under the transparent window so the drag rect is clear.
          background: "rgba(0, 0, 0, 0.35)",
          cursor: "crosshair",
          zIndex: 1000,
          outline: "none",
          userSelect: "none",
        }}
      >
        {dragStart && dragEnd && selW > 0 && selH > 0 && (
          <div
            style={{
              position: "absolute",
              left: selX,
              top: selY,
              width: selW,
              height: selH,
              border: "2px solid var(--qx-accent, #5b8cff)",
              background: "transparent",
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.35)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            pointerEvents: "none",
            textShadow: "0 1px 4px rgba(0,0,0,0.6)",
          }}
        >
          {selectHint}
        </div>
      </div>
    );
  }

  // ── Recording / encoding HUD ────────────────────────────────────────
  if (isRecording || status === "processing") {
    return (
      <QxShell
        title={t("screencap.title", "Screen Recording")}
        search={
          <div className="qx-rss-detail-title qx-module-title-with-badge">
            <span>{t("screencap.recording", "Recording")}</span>
            <BetaBadge />
          </div>
        }
        onKeyDown={handleKeyDown}
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
        escapeAction={{
          label: "Esc",
          kbd: "Esc",
          onClick: () => {
            if (isRecording) void handleStop();
            else {
              reset();
              setTab("launcher");
            }
          },
        }}
        primaryAction={{
          label: status === "processing" ? t("common.savingShort", "Saving") : t("common.stop", "Stop"),
          disabled: status === "processing",
          tone: status === "processing" ? "normal" : "danger",
          onClick: () => void handleStop(),
        }}
        secondaryAction={
          status === "processing"
            ? undefined
            : { label: t("common.actions", "Actions"), kbd: actionMenuShortcut }
        }
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
          {area && (
            <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
              {t("screencap.regionSummary", "Region {width} × {height} (logical) · primary display")
                .replace("{width}", String(area.w))
                .replace("{height}", String(area.h))}
            </div>
          )}
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

  // ── Idle / done / error: history + config or preview ─────────────────
  const showingPreview = Boolean(lastGifPath) && (status === "done" || status === "idle");

  return (
    <QxShell
      title={t("screencap.title", "Screen Recording")}
      search={
        <div className="qx-rss-detail-title qx-module-title-with-badge">
          <span>
            {showingPreview
              ? t("screencap.previewTitle", "Recording Preview")
              : t("screencap.title", "Screen Recording")}
          </span>
          <BetaBadge />
        </div>
      }
      onKeyDown={handleKeyDown}
      trailing={
        <>
          <button className="qx-command-button primary" onClick={() => void handleStart()} type="button">
            {t("common.start", "Start")}
          </button>
          <button className="qx-command-button" onClick={() => void beginAreaSelect()} type="button">
            {t("screencap.selectArea", "Select Area")}
          </button>
        </>
      }
      island={{
        label: showingPreview
          ? t("screencap.ready", "Recording Ready")
          : t("screencap.readyToRecord", "Ready to Record"),
        detail: showingPreview
            ? lastGifPath?.split(/[\\/]/).pop()
          : area
            ? `${area.w}×${area.h} · ${recordingOptions.outputFormat.toUpperCase()} · ${recordingOptions.fps} fps`
            : t("screencap.fullSummary", "Full primary display · {format} · {fps} fps")
                .replace("{format}", recordingOptions.outputFormat.toUpperCase())
                .replace("{fps}", String(recordingOptions.fps)),
        tone: showingPreview ? "success" : displayError ? "danger" : "neutral",
      }}
      escapeAction={{
        label: "Esc",
        kbd: "Esc",
        onClick: () => {
          reset();
          setTab("launcher");
        },
      }}
      primaryAction={
        showingPreview
          ? { label: t("common.new", "New"), kbd: "Enter", tone: "primary", onClick: handleNewRecording }
          : { label: t("common.start", "Start"), kbd: "Enter", tone: "primary", onClick: () => void handleStart() }
      }
      secondaryAction={{ label: t("common.actions", "Actions"), kbd: actionMenuShortcut }}
      actionTitle={t("screencap.actions", "Recording Actions")}
      actions={showingPreview ? doneActions : readyActions}
    >
      <div
        className="qx-content-split has-detail"
        style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(200px, 280px) 1fr" }}
      >
        <div
          className="qx-content-list"
          style={{
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--qx-border-1)",
          }}
          data-qx-region="screencap-history"
          data-qx-region-label={t("screencap.history.region", "Recording history")}
          data-qx-region-initial="true"
          tabIndex={-1}
        >
          <GifHistory />
        </div>

        <div
          className="qx-plugin-detail"
          style={{ minHeight: 0, overflow: "auto" }}
          data-qx-region="screencap-detail"
          data-qx-region-label={t("screencap.detail.region", "Recording detail")}
          tabIndex={-1}
        >
          {lastGifPath && (status === "done" || status === "idle") ? (
            <GifPreview path={lastGifPath} onClose={handleNewRecording} />
          ) : (
            <div className="qx-module-stage" style={{ padding: 12, gap: 12 }}>
              <div className="qx-panel-card" style={{ padding: 12 }}>
                <div className="qx-detail-title" style={{ marginBottom: 6 }}>
                  {t("screencap.configuration", "Configuration")}
                </div>
                <div className="qx-detail-meta" style={{ marginBottom: 12 }}>
                  {t("screencap.configurationHint", "Capture the primary display (or a region) directly to H.264 video. Convert to GIF only when you need it.")}
                </div>
                <div className="qx-screencap-options">
                  <label>
                    <span>{t("screencap.format", "Format")}</span>
                    <Select
                      value={recordingOptions.outputFormat}
                      options={[{ value: "mp4", label: "MP4" }, { value: "mov", label: "MOV" }]}
                      onChange={(outputFormat) => setRecordingOptions((value) => ({ ...value, outputFormat }))}
                      ariaLabel={t("screencap.format", "Recording format")}
                    />
                  </label>
                  <label>
                    <span>{t("screencap.resolution", "Resolution")}</span>
                    <Select
                      value={recordingOptions.resolution}
                      options={[
                        { value: "720p", label: "720p" },
                        { value: "1080p", label: "1080p" },
                        { value: "native", label: t("screencap.native4k", "Native (up to 4K)") },
                      ]}
                      onChange={(resolution) => setRecordingOptions((value) => ({ ...value, resolution }))}
                      ariaLabel={t("screencap.resolution", "Recording resolution")}
                    />
                  </label>
                  <label>
                    <span>{t("screencap.frameRate", "Frame rate")}</span>
                    <Select
                      value={String(recordingOptions.fps) as "15" | "24" | "30"}
                      options={[
                        { value: "15", label: "15 fps" },
                        { value: "24", label: "24 fps" },
                        { value: "30", label: "30 fps" },
                      ]}
                      onChange={(fps) => setRecordingOptions((value) => ({ ...value, fps: Number(fps) as RecordingOptions["fps"] }))}
                      ariaLabel={t("screencap.frameRate", "Recording frame rate")}
                    />
                  </label>
                  <label>
                    <span>{t("screencap.quality", "Quality")}</span>
                    <Select
                      value={recordingOptions.quality}
                      options={[
                        { value: "compact", label: t("screencap.quality.compact", "Compact") },
                        { value: "balanced", label: t("screencap.quality.balanced", "Balanced") },
                        { value: "high", label: t("screencap.quality.high", "High") },
                      ]}
                      onChange={(quality) => setRecordingOptions((value) => ({ ...value, quality }))}
                      ariaLabel={t("screencap.quality", "Recording quality")}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <button onClick={() => void handleStart()} className="qx-command-button primary" type="button">
                    {t("screencap.start", "Start Recording")}
                  </button>
                  <button onClick={() => void beginAreaSelect()} className="qx-command-button" type="button">
                    {t("screencap.selectArea", "Select Area")}
                  </button>
                  {area && (
                    <LinkButton
                      onClick={() => {
                        setArea(null);
                        setAreaPhysical(null);
                      }}
                    >
                      {t("screencap.clearArea", "Clear Area")}
                    </LinkButton>
                  )}
                </div>
                {area ? (
                  <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
                    {t("screencap.region", "Region")}: {area.w} × {area.h} px ({t("screencap.logical", "logical")})
                    {areaPhysical
                      ? ` · ${t("screencap.capture", "capture")} ${areaPhysical.w}×${areaPhysical.h}`
                      : ""}
                    {` · ${recordingOptions.outputFormat.toUpperCase()} · ${recordingOptions.fps} fps`}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
                    {t("screencap.fullSelectHint", "Full primary display · Select Area expands over the desktop for a real region pick")}
                  </div>
                )}
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

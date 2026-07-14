import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  primaryMonitor,
  currentMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { useScreencapStore, type RecordArea } from "./store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { LinkButton } from "../../components/ui";
import GifPreview from "./GifPreview";
import GifHistory from "./GifHistory";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { getQxShortcutPreset } from "../../utils/keyboard";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";

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

function estimatePerMinute(area: RecordArea): string {
  const pixels = area.w * area.h;
  const bytesPerSec = pixels * 0.4 * 15;
  const bytesPerMin = bytesPerSec * 60;
  if (bytesPerMin < 1024 * 1024) return `${(bytesPerMin / 1024).toFixed(0)} KB/min`;
  return `${(bytesPerMin / (1024 * 1024)).toFixed(1)} MB/min`;
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

async function ensureScreenPermission(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    type Perm = { id: string; granted: boolean; available: boolean };
    const list = await invoke<Perm[]>("qx_permissions_status");
    const screen = list.find((p) => p.id === "screen-recording");
    if (!screen || !screen.available) return null;
    if (screen.granted) return null;
    const ok = await invoke<boolean>("qx_permissions_request", { id: "screen-recording" });
    if (ok) return null;
    return "Screen Recording permission is required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx.";
  } catch {
    return null;
  }
}

export default function ScreenRecorder() {
  const {
    isRecording,
    status,
    lastGifPath,
    history,
    error,
    startRecording,
    stopRecording,
    loadHistory,
    setPreview,
    reset,
  } = useScreencapStore();

  const setTab = useStore((state) => state.setTab);

  const [selectMode, setSelectMode] = useState<SelectMode>("none");
  const [area, setArea] = useState<RecordArea | null>(null);
  /** Physical-pixel crop used by scrap (Retina-aware). */
  const [areaPhysical, setAreaPhysical] = useState<RecordArea | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectHint, setSelectHint] = useState("Drag on the primary display · Esc to cancel");
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const overlayRef = useRef<HTMLDivElement>(null);
  const windowSnapRef = useRef<WindowSnapshot | null>(null);
  const selectScaleRef = useRef(1);
  const hideAfterStartRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (selectMode === "selecting") {
      overlayRef.current?.focus();
    }
  }, [selectMode]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("screencap");
    if (!launch) return;
    if (launch.surface === "start") {
      void (async () => {
        const permErr = await ensureScreenPermission();
        if (permErr) {
          setLocalError(permErr);
          return;
        }
        await startRecording(null);
      })();
      return;
    }
    if (launch.surface === "preview") {
      const path = String(launch.params?.path || "");
      if (path) {
        void loadHistory().then(() => setPreview(path));
      }
    }
  }, [loadHistory, setPreview, startRecording]);

  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - start), 100);
      // Hide the main panel so the GIF is not mostly the Qx chrome.
      if (hideAfterStartRef.current) clearTimeout(hideAfterStartRef.current);
      hideAfterStartRef.current = setTimeout(() => {
        if (!isTauriRuntime()) return;
        getCurrentWindow().hide().catch(() => {});
      }, 450);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = undefined;
      setElapsed(0);
      if (hideAfterStartRef.current) {
        clearTimeout(hideAfterStartRef.current);
        hideAfterStartRef.current = undefined;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideAfterStartRef.current) clearTimeout(hideAfterStartRef.current);
    };
  }, [isRecording]);

  const cancelAreaSelect = useCallback(async () => {
    setSelectMode("none");
    setDragStart(null);
    setDragEnd(null);
    await restoreWindow(windowSnapRef.current);
    windowSnapRef.current = null;
  }, []);

  const beginAreaSelect = useCallback(async () => {
    setLocalError(null);
    const permErr = await ensureScreenPermission();
    if (permErr) {
      setLocalError(permErr);
      return;
    }

    windowSnapRef.current = await snapshotWindow();
    const expanded = await expandToPrimaryMonitor();
    if (expanded) {
      selectScaleRef.current = expanded.scale;
      setSelectHint("Drag to select on the primary display · Esc to cancel");
    } else {
      // Browser / failed expand: still allow in-window select for dev, but warn.
      selectScaleRef.current = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      setSelectHint("Drag to select (in-window fallback) · Esc to cancel");
    }
    setSelectMode("selecting");
    setDragStart(null);
    setDragEnd(null);
  }, []);

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
    const permErr = await ensureScreenPermission();
    if (permErr) {
      setLocalError(permErr);
      return;
    }
    await startRecording(areaPhysical ?? null);
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
      { label: "Start Recording", kbd: "Enter", onClick: () => void handleStart() },
      { label: "Select Area", kbd: "CmdOrCtrl+Shift+A", onClick: () => void beginAreaSelect() },
      {
        label: "Clear Area",
        disabled: !area,
        onClick: () => {
          setArea(null);
          setAreaPhysical(null);
        },
      },
      {
        label: "Full Screen (Primary)",
        onClick: () => {
          setArea(null);
          setAreaPhysical(null);
        },
      },
    ],
    [area, beginAreaSelect],
  );

  const doneActions = useMemo<QxShellAction[]>(
    () => [
      { label: "New Recording", kbd: "Enter", onClick: handleNewRecording },
      {
        label: "Back to Launcher",
        kbd: "Esc",
        onClick: () => {
          reset();
          setTab("launcher");
        },
      },
    ],
    [reset, setTab],
  );

  const recordingActions = useMemo<QxShellAction[]>(
    () => [
      {
        label: status === "processing" ? "Encoding…" : "Stop Recording",
        kbd: "Enter",
        disabled: status === "processing",
        tone: status === "processing" ? "normal" : "danger",
        onClick: () => void handleStop(),
      },
    ],
    [status],
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
        title="Screen Recording"
        search={<div className="qx-rss-detail-title">Recording</div>}
        onKeyDown={handleKeyDown}
        island={{
          label: status === "processing" ? "Encoding GIF" : "Recording",
          detail: status === "processing" ? "Processing frames" : formatTime(elapsed),
          tone: status === "processing" ? "warning" : "danger",
        }}
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
          label: status === "processing" ? "Encoding" : "Stop",
          disabled: status === "processing",
          tone: status === "processing" ? "normal" : "danger",
          onClick: () => void handleStop(),
        }}
        secondaryAction={
          status === "processing"
            ? undefined
            : { label: "Actions", kbd: actionMenuShortcut }
        }
        actionTitle="Recording Actions"
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
              {status === "processing" ? "Processing" : "Recording"}
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
            {formatTime(elapsed)}
          </div>
          {area && (
            <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
              Region {area.w} × {area.h} (logical) · primary display
            </div>
          )}
          <p style={{ fontSize: 12, color: "var(--qx-text-tertiary)", maxWidth: 360, textAlign: "center", margin: 0 }}>
            {status === "processing"
              ? "Encoding frames to GIF…"
              : "Qx hid itself so the panel is not in the capture. Summon with your launcher shortcut, then press Stop."}
          </p>
          <button
            onClick={() => void handleStop()}
            disabled={status === "processing"}
            className={`qx-command-button${status === "processing" ? "" : " danger"}`}
            style={{ height: 28, padding: "0 12px" }}
          >
            {status === "processing" ? "Encoding GIF…" : "Stop"}
          </button>
        </div>
      </QxShell>
    );
  }

  // ── Idle / done / error: history + config or preview ─────────────────
  const showingPreview = Boolean(lastGifPath) && (status === "done" || status === "idle");

  return (
    <QxShell
      title="Screen Recording"
      search={
        <div className="qx-rss-detail-title">
          {showingPreview ? "Recording Preview" : "Screen Recording"}
        </div>
      }
      onKeyDown={handleKeyDown}
      trailing={
        <>
          <button className="qx-command-button primary" onClick={() => void handleStart()} type="button">
            Start
          </button>
          <button className="qx-command-button" onClick={() => void beginAreaSelect()} type="button">
            Select Area
          </button>
        </>
      }
      island={{
        label: showingPreview ? "GIF Ready" : "Ready to Record",
        detail: showingPreview
          ? lastGifPath?.split("/").pop()
          : area
            ? `${area.w}×${area.h} · ${estimatePerMinute(areaPhysical ?? area)}`
            : "Full primary display",
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
          ? { label: "New", kbd: "Enter", tone: "primary", onClick: handleNewRecording }
          : { label: "Start", kbd: "Enter", tone: "primary", onClick: () => void handleStart() }
      }
      secondaryAction={{ label: "Actions", kbd: actionMenuShortcut }}
      actionTitle="Recording Actions"
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
          data-qx-region-label="Recording history"
          data-qx-region-initial="true"
          tabIndex={-1}
        >
          <GifHistory />
        </div>

        <div
          className="qx-plugin-detail"
          style={{ minHeight: 0, overflow: "auto" }}
          data-qx-region="screencap-detail"
          data-qx-region-label="Recording detail"
          tabIndex={-1}
        >
          {lastGifPath && (status === "done" || status === "idle") ? (
            <GifPreview path={lastGifPath} onClose={handleNewRecording} />
          ) : (
            <div className="qx-module-stage" style={{ padding: 12, gap: 12 }}>
              <div className="qx-panel-card" style={{ padding: 12 }}>
                <div className="qx-detail-title" style={{ marginBottom: 6 }}>Configuration</div>
                <div className="qx-detail-meta" style={{ marginBottom: 12 }}>
                  Capture the primary display (or a region) and encode an animated GIF.
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <button onClick={() => void handleStart()} className="qx-command-button primary" type="button">
                    Start Recording
                  </button>
                  <button onClick={() => void beginAreaSelect()} className="qx-command-button" type="button">
                    Select Area
                  </button>
                  {area && (
                    <LinkButton
                      onClick={() => {
                        setArea(null);
                        setAreaPhysical(null);
                      }}
                    >
                      Clear Area
                    </LinkButton>
                  )}
                </div>
                {area ? (
                  <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
                    Region: {area.w} × {area.h} px (logical)
                    {areaPhysical ? ` · capture ${areaPhysical.w}×${areaPhysical.h}` : ""}
                    {" · "}~{estimatePerMinute(areaPhysical ?? area)}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
                    Full primary display · Select Area expands over the desktop for a real region pick
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
                <strong style={{ color: "var(--qx-text-secondary)" }}>Tips</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  <li>macOS: Screen Recording permission must be granted; restart Qx after enabling.</li>
                  <li>Recording hides Qx so the panel is not burned into the GIF — summon to Stop.</li>
                  <li>Click a history item on the left to preview past GIFs.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </QxShell>
  );
}

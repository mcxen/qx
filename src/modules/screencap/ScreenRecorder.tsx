import { useEffect, useMemo, useRef, useState } from "react";
import { useScreencapStore, type RecordArea } from "./store";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { LinkButton } from "../../components/ui";
import GifPreview from "./GifPreview";
import GifHistory from "./GifHistory";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { getQxShortcutPreset } from "../../utils/keyboard";

type SelectMode = "none" | "selecting";

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

export default function ScreenRecorder() {
  const {
    isRecording,
    status,
    lastGifPath,
    error,
    startRecording,
    stopRecording,
    loadHistory,
    reset,
  } = useScreencapStore();

  const setTab = useStore((state) => state.setTab);

  const [selectMode, setSelectMode] = useState<SelectMode>("none");
  const [area, setArea] = useState<RecordArea | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectMode === "selecting") {
      overlayRef.current?.focus();
    }
  }, [selectMode]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - start), 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = undefined;
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const beginAreaSelect = () => {
    setSelectMode("selecting");
    setDragStart(null);
    setDragEnd(null);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (selectMode !== "selecting") return;
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (selectMode !== "selecting" || !dragStart) return;
    setDragEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    if (selectMode !== "selecting" || !dragStart || !dragEnd) {
      setSelectMode("none");
      return;
    }
    const x = Math.min(dragStart.x, dragEnd.x);
    const y = Math.min(dragStart.y, dragEnd.y);
    const w = Math.abs(dragEnd.x - dragStart.x);
    const h = Math.abs(dragEnd.y - dragStart.y);
    setSelectMode("none");
    setDragStart(null);
    setDragEnd(null);
    if (w < 8 || h < 8) return;
    setArea({ x, y, w, h });
  };

  const handleStart = () => {
    void startRecording(area);
  };

  const handleStop = () => {
    void stopRecording();
  };

  const handleNewRecording = () => {
    reset();
    setArea(null);
  };

  const actionMenuShortcut = getQxShortcutPreset().actionMenu;

  const readyActions = useMemo<QxShellAction[]>(
    () => [
      { label: "Start Recording", kbd: "Enter", onClick: handleStart },
      { label: "Select Area", onClick: beginAreaSelect },
      {
        label: "Clear Area",
        disabled: !area,
        onClick: () => setArea(null),
      },
    ],
    [area],
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
        onClick: handleStop,
      },
    ],
    [status],
  );

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: selectMode === "selecting",
      close: () => {
        setSelectMode("none");
        setDragStart(null);
        setDragEnd(null);
      },
    },
    launcher: () => {
      if (isRecording) void stopRecording();
      reset();
      setTab("launcher");
    },
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
    const state = useScreencapStore.getState();
    const { history, lastGifPath, setPreview, deleteEntry } = state;
    if (history.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      history.findIndex((h) => h.path === lastGifPath),
    );
    switch (e.key) {
      case "ArrowDown":
      case "j": {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, history.length - 1);
        setPreview(history[next].path);
        break;
      }
      case "ArrowUp":
      case "k": {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        setPreview(history[prev].path);
        break;
      }
      case "Enter": {
        e.preventDefault();
        const entry = history[currentIndex];
        if (entry) setPreview(entry.path);
        break;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        const entry = history[currentIndex];
        if (entry) void deleteEntry(entry.id);
        break;
      }
    }
  };

  if (selectMode === "selecting") {
    const selX = dragStart && dragEnd ? Math.min(dragStart.x, dragEnd.x) : 0;
    const selY = dragStart && dragEnd ? Math.min(dragStart.y, dragEnd.y) : 0;
    const selW = dragStart && dragEnd ? Math.abs(dragEnd.x - dragStart.x) : 0;
    const selH = dragStart && dragEnd ? Math.abs(dragEnd.y - dragStart.y) : 0;
    return (
      <div
        ref={overlayRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--qx-overlay-1)",
          cursor: "crosshair",
          zIndex: 100,
          outline: "none",
        }}
      >
        {dragStart && dragEnd && (
          <div
            style={{
              position: "absolute",
              left: selX,
              top: selY,
              width: selW,
              height: selH,
              border: "2px solid var(--qx-accent)",
              background: "var(--qx-accent-soft)",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "var(--qx-text-on-accent)",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          Drag to select recording area · Esc to cancel
        </div>
      </div>
    );
  }

  if (status === "done" && lastGifPath) {
    return (
      <QxShell
        title="Screen Recording"
        search={<div className="qx-rss-detail-title">Recording Complete</div>}
        trailing={<button className="qx-command-button" onClick={handleNewRecording} type="button">New</button>}
        island={{ label: "GIF Ready", detail: lastGifPath.split("/").pop(), tone: "success" }}
        escapeAction={{
          label: "Esc",
          kbd: "Esc",
          onClick: () => {
            if (isRecording) void stopRecording();
            reset();
            setTab("launcher");
          },
        }}
        primaryAction={{ label: "New", kbd: "Enter", tone: "primary", onClick: handleNewRecording }}
        secondaryAction={{ label: "Actions", kbd: actionMenuShortcut }}
        actionTitle="Recording Actions"
        actions={doneActions}
        onKeyDown={handleKeyDown}
      >
        <GifPreview path={lastGifPath} onClose={handleNewRecording} />
        <GifHistory />
      </QxShell>
    );
  }

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
            if (isRecording) void stopRecording();
            reset();
            setTab("launcher");
          },
        }}
        primaryAction={{
          label: status === "processing" ? "Encoding" : "Stop",
          disabled: status === "processing",
          tone: status === "processing" ? "normal" : "danger",
          onClick: handleStop,
        }}
        secondaryAction={
          status === "processing"
            ? undefined
            : { label: "Actions", kbd: actionMenuShortcut }
        }
        actionTitle="Recording Actions"
        actions={recordingActions}
      >
        <div className="qx-module-stage" style={{ alignItems: "center", justifyContent: "center", flex: 1 }}>
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
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--qx-text-primary)",
              }}
            >
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
              {area.w} × {area.h} px
            </div>
          )}
          <button
            onClick={handleStop}
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

  const context = (
    <div className="qx-action-panel">
      <div className="qx-action-title">Recording</div>
      <button className="qx-action-item" onClick={handleStart}>
        <span>Start Recording</span>
      </button>
      <button className="qx-action-item" onClick={beginAreaSelect}>
        <span>Select Area</span>
      </button>
      <button className="qx-action-item" onClick={() => setArea(null)} disabled={!area}>
        <span>Clear Area</span>
      </button>
    </div>
  );

  return (
    <QxShell
      title="Screen Recording"
      search={<div className="qx-rss-detail-title">Screen Recording</div>}
      onKeyDown={handleKeyDown}
      trailing={
        <>
          <button className="qx-command-button primary" onClick={handleStart}>
            Start Recording
          </button>
          <button className="qx-command-button" onClick={beginAreaSelect}>
            Select Area
          </button>
        </>
      }
      context={context}
      island={{
        label: "Ready to Record",
        detail: area ? `${area.w} x ${area.h} px · ${estimatePerMinute(area)}` : "Full screen",
      }}
      escapeAction={{
        label: "Esc",
        kbd: "Esc",
        onClick: () => {
          if (isRecording) void stopRecording();
          reset();
          setTab("launcher");
        },
      }}
      primaryAction={{ label: "Start", kbd: "Enter", tone: "primary", onClick: handleStart }}
      secondaryAction={{ label: "Actions", kbd: actionMenuShortcut }}
      actionTitle="Recording Actions"
      actions={readyActions}
    >
      <div className="qx-plugin-body two-pane">
        <div className="qx-plugin-detail" style={{ borderRight: "1px solid var(--qx-border-1)" }}>
          <div className="qx-detail-header">
            <div>
              <div className="qx-detail-title">Configuration</div>
              <div className="qx-detail-meta">Capture a screen recording and save as GIF.</div>
            </div>
          </div>
          <div className="qx-module-stage">
            <div className="qx-panel-card" style={{ padding: 8 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button onClick={handleStart} className="qx-command-button primary" style={{ flex: 1 }}>
                  Start Recording
                </button>
                <button onClick={beginAreaSelect} className="qx-command-button" style={{ flex: 1 }}>
                  Select Area
                </button>
              </div>
          {area ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--qx-text-tertiary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>
                Area: {area.w} × {area.h} px · Est. ~{estimatePerMinute(area)}
              </span>
              <LinkButton onClick={() => setArea(null)}>Clear</LinkButton>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--qx-text-tertiary)" }}>
              Full screen · ~3–8 MB/min (varies by content)
            </div>
          )}
            </div>
            {error && (
              <div className="qx-panel-card" style={{ padding: "6px 8px", fontSize: 12, color: "var(--qx-danger)" }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </QxShell>
  );
}

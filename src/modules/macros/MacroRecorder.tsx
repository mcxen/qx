import { useEffect, useMemo, useRef, useState } from "react";
import { useMacroStore } from "./store";
import { Kbd } from "../../components/ui";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { useStore } from "../../store";
import { useEscBack } from "../../hooks/useEscBack";
import { getQxShortcutPreset } from "../../utils/keyboard";
import SaveDialog from "./SaveDialog";

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MacroRecorder() {
  const {
    isRecording,
    lastRecordedSteps,
    lastTotalDurationMs,
    savedMacros,
    error,
    startRecording,
    stopRecording,
    saveMacro,
    listMacros,
    deleteMacro,
    playMacro,
    clearLast,
    setError,
  } = useMacroStore();

  const setTab = useStore((state) => state.setTab);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listMacros();
  }, [listMacros]);

  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - start), 100);
      shellRef.current?.focus();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = undefined;
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const handleStart = () => {
    setName("");
    setError(null);
    void startRecording();
  };

  const handleStop = () => {
    void stopRecording();
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = await saveMacro(trimmed);
    if (id != null) setName("");
  };

  const handleDiscard = () => {
    clearLast();
    setName("");
  };

  const goLauncher = () => setTab("launcher");

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: {
      active: isRecording || Boolean(lastRecordedSteps),
      close: () => {
        if (isRecording) void stopRecording();
        else handleDiscard();
      },
    },
    launcher: goLauncher,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    escKeyDown(e);
  };

  const escapeAction = {
    label: "Esc",
    kbd: "Esc",
    onClick: isRecording
      ? handleStop
      : lastRecordedSteps
        ? handleDiscard
        : goLauncher,
  };

  const actionMenuShortcut = getQxShortcutPreset().actionMenu;

  const macroActions = useMemo<QxShellAction[]>(() => {
    if (isRecording) {
      return [{ label: "Stop Recording", kbd: "Enter", tone: "danger", onClick: handleStop }];
    }
    if (lastRecordedSteps) {
      return [
        {
          label: "Save Macro",
          kbd: "Enter",
          disabled: !name.trim(),
          onClick: () => void handleSave(),
        },
        { label: "Discard", tone: "danger", onClick: handleDiscard },
        { label: "Record Again", onClick: handleStart },
      ];
    }
    return [
      { label: "Start Recording", kbd: "Enter", onClick: handleStart },
      {
        label: "Refresh List",
        onClick: () => void listMacros(),
      },
    ];
  }, [isRecording, lastRecordedSteps, listMacros, name]);

  return (
    <QxShell
      ref={shellRef}
      title="Macro Recorder"
      search={<div className="qx-rss-detail-title">Macro Recorder</div>}
      trailing={
        <>
          {!isRecording && !lastRecordedSteps && (
            <button className="qx-command-button primary" onClick={handleStart} type="button">
              Start Recording
            </button>
          )}
          {isRecording && (
            <button className="qx-command-button danger" onClick={handleStop} type="button">
              Stop
            </button>
          )}
        </>
      }
      island={{
        label: isRecording ? "Recording Macro" : lastRecordedSteps ? "Macro Captured" : "Macro Recorder",
        detail: isRecording
          ? formatTime(elapsed)
          : lastRecordedSteps
            ? `${lastRecordedSteps.length} steps · ${formatTime(lastTotalDurationMs)}`
            : `${savedMacros.length} saved macros`,
        tone: error ? "danger" : isRecording ? "danger" : lastRecordedSteps ? "success" : "neutral",
      }}
      escapeAction={escapeAction}
      primaryAction={
        isRecording
          ? { label: "Stop", tone: "danger", onClick: handleStop }
          : lastRecordedSteps
            ? { label: "Save", kbd: "Enter", disabled: !name.trim(), onClick: () => void handleSave() }
            : { label: "Record", kbd: "Enter", tone: "primary", onClick: handleStart }
      }
      secondaryAction={{ label: "Actions", kbd: actionMenuShortcut }}
      actionTitle="Macro Actions"
      actions={macroActions}
      onKeyDown={handleKeyDown}
      className="qx-macro-shell"
    >
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div className="qx-module-stage">
          <div
            className="qx-panel-card"
            style={{
              padding: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {isRecording && (
                <span
                  className="qx-rec-dot"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--qx-danger)",
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--qx-text-primary)",
                }}
              >
                {isRecording
                  ? "Recording"
                  : lastRecordedSteps
                    ? "Recording Complete"
                    : "Ready"}
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
              {formatTime(isRecording ? elapsed : lastTotalDurationMs)}
            </div>

            {isRecording ? (
              <button
                className="qx-command-button danger"
                    style={{ height: 28, padding: "0 12px" }}
                onClick={handleStop}
              >
                Stop
              </button>
            ) : lastRecordedSteps ? (
              <SaveDialog
                stepCount={lastRecordedSteps.length}
                name={name}
                setName={setName}
                onSave={() => void handleSave()}
                onDiscard={handleDiscard}
              />
            ) : (
              <button
                className="qx-command-button primary"
                style={{ height: 28, padding: "0 12px" }}
                onClick={handleStart}
              >
                Start Recording
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 12,
              fontSize: 11,
              color: "var(--qx-text-tertiary)",
            }}
          >
            {isRecording ? (
              <span>
                <Kbd>Esc</Kbd>Stop recording
              </span>
            ) : lastRecordedSteps ? (
              <>
                <span>
                  <Kbd>↩</Kbd>Save macro
                </span>
                <span>
                  <Kbd>Esc</Kbd>Discard
                </span>
              </>
            ) : (
              <span>Records keyboard &amp; mouse input globally</span>
            )}
          </div>

          {error && (
            <div
              className="qx-panel-card"
              style={{ padding: "6px 8px", fontSize: 12, color: "var(--qx-danger)" }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="qx-section-header">
          <span style={{ flex: 1 }}>Saved Macros</span>
          <span>{savedMacros.length}</span>
        </div>
        {savedMacros.length === 0 ? (
          <div className="qx-empty-state">No saved macros yet.</div>
        ) : (
          savedMacros.map((m) => {
            const id = m.id;
            if (id == null) return null;
            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "5px 10px",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="qx-list-title">{m.name}</div>
                  <div className="qx-list-subtitle">
                    {m.steps.length} steps · {formatTime(m.total_duration_ms)}
                    {m.created_at ? ` · ${formatTimestamp(m.created_at)}` : ""}
                  </div>
                </div>
                <button
                  className="qx-icon-button"
                  onClick={() => void playMacro(id)}
                >
                  Play
                </button>
                <button
                  className="qx-icon-button"
                  onClick={() => void deleteMacro(id)}
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            );
          })
        )}
      </div>
    </QxShell>
  );
}

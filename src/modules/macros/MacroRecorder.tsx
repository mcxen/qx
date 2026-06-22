import { useEffect, useRef, useState } from "react";
import { useMacroStore } from "./store";

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

const kbdStyle: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 11,
  background: "var(--qx-bg-component-3)",
  borderRadius: 4,
  padding: "1px 5px",
  marginRight: 4,
};

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isRecording) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void stopRecording();
      }
      return;
    }
    if (lastRecordedSteps) {
      if (e.key === "Enter" && name.trim()) {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleDiscard();
      }
    }
  };

  return (
    <div
      ref={shellRef}
      className="qx-module-shell"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="qx-plugin-toolbar">
        <div className="qx-toolbar-title" style={{ flex: 1 }}>
          Macro Recorder
        </div>
        {!isRecording && !lastRecordedSteps && (
          <button className="qx-command-button primary" onClick={handleStart}>
            Start Recording
          </button>
        )}
        {isRecording && (
          <button className="qx-command-button danger" onClick={handleStop}>
            Stop
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <div className="qx-module-stage">
          <div
            className="qx-panel-card"
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
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
                    background: "#ef4444",
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
                style={{ height: 40, padding: "0 28px" }}
                onClick={handleStop}
              >
                Stop
              </button>
            ) : lastRecordedSteps ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  width: "100%",
                  maxWidth: 360,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--qx-text-tertiary)",
                    textAlign: "center",
                  }}
                >
                  {lastRecordedSteps.length} steps captured
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="qx-inline-input"
                    style={{ flex: 1 }}
                    placeholder="Macro name…"
                    value={name}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button
                    className="qx-command-button primary"
                    onClick={handleSave}
                    disabled={!name.trim()}
                  >
                    Save
                  </button>
                  <button className="qx-command-button" onClick={handleDiscard}>
                    Discard
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="qx-command-button primary"
                style={{ height: 40, padding: "0 28px" }}
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
              gap: 16,
              fontSize: 11,
              color: "var(--qx-text-tertiary)",
            }}
          >
            {isRecording ? (
              <span>
                <kbd style={kbdStyle}>Esc</kbd>Stop recording
              </span>
            ) : lastRecordedSteps ? (
              <>
                <span>
                  <kbd style={kbdStyle}>↩</kbd>Save macro
                </span>
                <span>
                  <kbd style={kbdStyle}>Esc</kbd>Discard
                </span>
              </>
            ) : (
              <span>Records keyboard &amp; mouse input globally</span>
            )}
          </div>

          {error && (
            <div
              className="qx-panel-card"
              style={{ padding: "8px 12px", fontSize: 12, color: "var(--qx-danger)" }}
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
                  padding: "8px 14px",
                  gap: 10,
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
    </div>
  );
}

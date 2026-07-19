import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { CircleStop, Plus, SquareTerminal, Trash2 } from "lucide-react";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { Button } from "../../components/ui";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { useStore } from "../../store";

interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  running: boolean;
  created_at: number;
}

interface TerminalSnapshot {
  session: TerminalSession;
  data: string;
}

interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

interface TerminalExitEvent {
  session_id: string;
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function compactPath(path: string): string {
  const home = path.match(/^\/Users\/[^/]+/u)?.[0];
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export default function QxTTYPanel() {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [activeId, sessions],
  );
  const activeSessionTitle = activeSession
    ? t("tty.sessionName", "Terminal {n}").replace("{n}", String(sessions.indexOf(activeSession) + 1))
    : t("tty.title", "QxTTY");

  const refreshSessions = useCallback(async () => {
    const next = await invoke<TerminalSession[]>("terminal_list_sessions");
    setSessions(next);
    return next;
  }, []);

  const createSession = useCallback(async () => {
    setError("");
    try {
      const terminal = terminalRef.current;
      const created = await invoke<TerminalSession>("terminal_create_session", {
        rows: terminal?.rows ?? 24,
        cols: terminal?.cols ?? 80,
      });
      setSessions((current) => [...current, created]);
      setActiveId(created.id);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    setError("");
    try {
      await invoke("terminal_close_session", { sessionId });
      setSessions((current) => {
        const next = current.filter((session) => session.id !== sessionId);
        if (activeIdRef.current === sessionId) setActiveId(next[0]?.id ?? null);
        return next;
      });
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    const computedStyle = window.getComputedStyle(host);
    terminal.options.theme = {
      background: "transparent",
      foreground: computedStyle.color,
      cursor: computedStyle.getPropertyValue("--qx-accent").trim(),
      selectionBackground: computedStyle.getPropertyValue("--qx-accent-soft").trim(),
    };
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    window.requestAnimationFrame(() => fit.fit());

    const input = terminal.onData((data) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      void invoke("terminal_write", { sessionId, data: encodeBase64(data) }).catch((reason) => {
        setError(String(reason));
      });
    });
    const resize = terminal.onResize(({ rows, cols }) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      void invoke("terminal_resize", { sessionId, rows, cols }).catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => fit.fit());
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void Promise.all([
      listen<TerminalOutputEvent>("qx-terminal-output", (event) => {
        if (event.payload.session_id === activeIdRef.current) {
          terminalRef.current?.write(decodeBase64(event.payload.data));
        }
      }),
      listen<TerminalExitEvent>("qx-terminal-exit", (event) => {
        setSessions((current) => current.map((session) => (
          session.id === event.payload.session_id ? { ...session, running: false } : session
        )));
      }),
    ]).then((unlisten) => {
      if (disposed) unlisten.forEach((cleanup) => cleanup());
      else cleanups.push(...unlisten);
    });
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshSessions()
      .then(async (existing) => {
        if (cancelled) return;
        if (existing.length > 0) setActiveId(existing[0].id);
        else await createSession();
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [createSession, refreshSessions]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    if (!activeId) return;
    let cancelled = false;
    void invoke<TerminalSnapshot>("terminal_snapshot", { sessionId: activeId })
      .then((snapshot) => {
        if (cancelled || activeIdRef.current !== activeId) return;
        terminal.write(decodeBase64(snapshot.data), () => {
          fitRef.current?.fit();
          terminal.focus();
        });
        setSessions((current) => current.map((session) => (
          session.id === snapshot.session.id ? snapshot.session : session
        )));
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const clearTerminal = useCallback(async () => {
    if (!activeId) return;
    terminalRef.current?.clear();
    await invoke("terminal_clear_buffer", { sessionId: activeId }).catch((reason) => setError(String(reason)));
  }, [activeId]);

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: t("tty.new", "New Terminal"),
      kbd: "CmdOrCtrl+N",
      onClick: () => void createSession(),
    },
    {
      label: t("tty.clear", "Clear Terminal"),
      kbd: "CmdOrCtrl+L",
      disabled: !activeId,
      onClick: () => void clearTerminal(),
    },
    {
      label: t("tty.close", "Close Session"),
      disabled: !activeId,
      tone: "danger",
      onClick: () => activeId && void closeSession(activeId),
    },
  ], [activeId, clearTerminal, closeSession, createSession, t]);

  const leave = useCallback(() => setTab("launcher"), [setTab]);
  const shell = useQxModuleShell({
    leave,
    island: {
      label: activeSessionTitle,
      detail: activeSession
        ? `${activeSession.running ? t("tty.running", "Running") : t("tty.exited", "Exited")} · ${compactPath(activeSession.cwd)}`
        : t("tty.noSessions", "No terminal sessions"),
      tone: error ? "danger" : activeSession?.running ? "success" : "neutral",
    },
    t,
  });

  return (
    <QxShell
      title={t("tty.title", "QxTTY")}
      islandKey="qx-tty"
      className="qx-tty-shell"
      trailing={(
        <Button size="sm" onClick={() => void createSession()}>
          <Plus size={14} aria-hidden="true" />
          {t("tty.new", "New Terminal")}
        </Button>
      )}
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      island={shell.island}
      secondaryAction={shell.secondaryAction}
      actionTitle={t("tty.actions", "Terminal Actions")}
      actions={actions}
    >
      <div className="qx-tty-layout">
        <aside className="qx-tty-sidebar" data-qx-region="tty-sessions">
          <div className="qx-tty-sidebar-header">
            <span>{t("tty.sessions", "Sessions")}</span>
            <span>{sessions.length}</span>
          </div>
          <div className="qx-tty-session-list" role="listbox" aria-label={t("tty.sessions", "Sessions")}>
            {sessions.map((session, index) => (
              <div
                key={session.id}
                className={`qx-tty-session${session.id === activeId ? " is-active" : ""}`}
                role="option"
                aria-selected={session.id === activeId}
                tabIndex={0}
                onClick={() => setActiveId(session.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setActiveId(session.id);
                }}
              >
                <SquareTerminal size={16} aria-hidden="true" />
                <div className="qx-tty-session-copy">
                  <strong>{t("tty.sessionName", "Terminal {n}").replace("{n}", String(index + 1))}</strong>
                  <span>{compactPath(session.cwd)}</span>
                </div>
                <span className={`qx-tty-session-state${session.running ? " is-running" : ""}`} title={session.running ? t("tty.running", "Running") : t("tty.exited", "Exited")} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="qx-tty-close"
                  aria-label={t("tty.close", "Close Session")}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeSession(session.id);
                  }}
                >
                  {session.running ? <CircleStop size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
                </Button>
              </div>
            ))}
            {!loading && sessions.length === 0 && (
              <div className="qx-tty-empty">{t("tty.noSessions", "No terminal sessions")}</div>
            )}
          </div>
        </aside>
        <section
          className="qx-tty-terminal-pane"
          data-qx-region="tty-terminal"
          data-qx-region-initial="true"
          tabIndex={-1}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {error && <div className="qx-tty-error" role="alert">{error}</div>}
          <div ref={hostRef} className="qx-tty-terminal" />
        </section>
      </div>
    </QxShell>
  );
}

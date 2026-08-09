import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMacroStore, type MacroData, type MacroPlaybackState } from "./store";
import { Button, Kbd, Select } from "../../components/ui";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import QxResizableSplit from "../../components/QxResizableSplit";
import { QxActionSections } from "../../components/QxActionPanel";
import { useStore } from "../../store";
import { useSettingsStore } from "../settings/store";
import { useT } from "../../i18n";
import { getQxDesktopPlatform } from "../../utils/keyboard";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import {
  qxMasterDetailIds,
  qxMasterDetailNavigation,
  qxRegionProps,
  useQxMasterDetailFocus,
} from "../../hooks/useQxMasterDetail";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import SaveDialog from "./SaveDialog";
import BetaBadge from "../../components/BetaBadge";
import { ensureMacroPlaybackBridge, formatMacroStep } from "./playbackBridge";
import { islandHost } from "../../island";

const MASTER_DETAIL = qxMasterDetailIds("macros");
const MACRO_LIST_WIDTH_KEY = "qx.macros.list-width";
const PLAYBACK_DELAYS = [0, 3_000, 5_000, 10_000, 30_000];

type MacroPermissionIssue = "input-monitoring" | "windows-hook";

function getMacroPermissionIssue(error: string | null): MacroPermissionIssue | null {
  if (!error) return null;
  const normalized = error.toLowerCase();
  if (
    normalized.includes("macro_permission_denied:input-monitoring") ||
    normalized.includes("input monitoring")
  ) {
    return "input-monitoring";
  }
  if (
    normalized.includes("macro_permission_denied:keyboard-hook") ||
    normalized.includes("macro_permission_denied:mouse-hook") ||
    normalized.includes("keyboard hook permission denied") ||
    normalized.includes("mouse hook permission denied")
  ) {
    return "windows-hook";
  }
  return null;
}

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

function isPlaybackActive(playback: MacroPlaybackState): boolean {
  return playback.status === "waiting"
    || playback.status === "playing"
    || playback.status === "paused";
}

function playbackPercent(playback: MacroPlaybackState): number {
  if (playback.status === "completed") return 100;
  if (playback.totalSteps <= 0) return 0;
  return Math.round((playback.completedSteps / playback.totalSteps) * 100);
}

function formatCursorPosition(
  x: number | null,
  y: number | null,
  fallback: string,
): string {
  if (x == null || y == null) return fallback;
  return `${Math.round(x)}, ${Math.round(y)}`;
}

export default function MacroRecorder() {
  const t = useT();
  const desktopPlatform = getQxDesktopPlatform();
  const {
    isRecording,
    lastRecordedSteps,
    lastTotalDurationMs,
    savedMacros,
    error,
    recording,
    playback,
    startRecording,
    stopRecording,
    saveMacro,
    createDemoMacro,
    listMacros,
    deleteMacro,
    playMacro,
    togglePlaybackPause,
    stopPlayback,
    clearLast,
    setError,
  } = useMacroStore();

  const setTab = useStore((state) => state.setTab);
  const stopTailSeconds = useSettingsStore((state) => state.settings.macros.stop_tail_seconds);
  const [elapsed, setElapsed] = useState(0);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [playDelayMs, setPlayDelayMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The event bridge is intentionally not disposed on module unmount: a
  // playback task is a Workbench background task and its island must remain
  // actionable after the user navigates away from this view.
  useEffect(() => {
    ensureMacroPlaybackBridge(t);
  }, [t]);

  // The module is intentionally allowed to unmount while native recording or
  // native start is pending. Route teardown through the same store stop action
  // as Esc and the visible Stop control.
  useEffect(() => {
    return () => {
      islandHost.clearFloat("module.macros.shell");
      void stopRecording();
    };
  }, [stopRecording]);

  useEffect(() => {
    void listMacros();
  }, [listMacros]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("macros");
    if (!launch || launch.surface !== "play") return;
    const id = Number(launch.params?.id);
    if (Number.isFinite(id) && id > 0) {
      void listMacros().then(() => playMacro(id, playDelayMs));
    }
  }, [listMacros, playDelayMs, playMacro]);

  useEffect(() => {
    if (isRecording) {
      const started = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - started), 100);
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

  const visibleMacros = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return savedMacros;
    return savedMacros.filter((macro) => macro.name.toLocaleLowerCase().includes(normalized));
  }, [query, savedMacros]);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, visibleMacros.length - 1)));
  }, [visibleMacros.length]);

  const selectedMacro = visibleMacros[selectedIndex] ?? null;
  const selectedId = selectedMacro?.id ?? null;
  const activePlayback = isPlaybackActive(playback);
  const permissionIssue = getMacroPermissionIssue(error);
  const playbackMatchesSelection = selectedMacro?.id != null && playback.macroId === selectedMacro.id;
  const activeStepIndex = playbackMatchesSelection && playback.currentStepIndex != null
    ? playback.currentStepIndex - 1
    : -1;

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: `${query}:${visibleMacros.map((macro) => macro.id).join(",")}`,
    enabled: visibleMacros.length > 0,
  });

  const setSelectedMacro = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const openDetail = useCallback(() => {
    if (!selectedMacro) return;
    setDetailOpen(true);
  }, [selectedMacro]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const handleStart = useCallback(() => {
    setName("");
    setDetailOpen(false);
    setError(null);
    void startRecording();
  }, [setError, startRecording]);

  const handleStop = useCallback(() => {
    islandHost.clearFloat("module.macros.shell");
    void stopRecording();
  }, [stopRecording]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = await saveMacro(trimmed);
    if (id != null) setName("");
  }, [name, saveMacro]);

  const handleDiscard = useCallback(() => {
    clearLast();
    setName("");
  }, [clearLast]);

  const handleCreateDemo = useCallback(() => {
    void createDemoMacro(t("macros.demo.name", "Demo: Open Google Chrome and search hello"));
  }, [createDemoMacro, t]);

  const openMacroPermissionSettings = useCallback(async () => {
    try {
      await invoke("qx_permissions_request", { id: "input-monitoring" });
    } catch (permissionError) {
      setError(String(permissionError));
    }
  }, [setError]);

  const playSelected = useCallback(() => {
    if (selectedId == null || activePlayback) return;
    void playMacro(selectedId, playDelayMs);
  }, [activePlayback, playDelayMs, playMacro, selectedId]);

  const leave = useCallback(() => {
    setTab("launcher");
  }, [setTab]);

  const closeInner = useCallback(() => {
    if (isRecording) {
      handleStop();
    } else if (lastRecordedSteps) {
      handleDiscard();
    } else if (detailOpen) {
      closeDetail();
    } else if (activePlayback) {
      void stopPlayback();
    }
  }, [activePlayback, closeDetail, detailOpen, handleDiscard, handleStop, isRecording, lastRecordedSteps, stopPlayback]);

  const shell = useQxModuleShell({
    leave,
    esc: {
      inner: {
        active: isRecording || Boolean(lastRecordedSteps) || detailOpen || activePlayback,
        close: closeInner,
      },
      query: {
        active: Boolean(query),
        clear: () => setQuery(""),
      },
    },
    island: {
      label: isRecording
        ? t("macros.island.recording", "Recording macro")
        : activePlayback
          ? t("macros.island.playing", "Playing macro")
          : lastRecordedSteps
            ? t("macros.island.captured", "Macro captured")
            : t("macros.title", "Macro Recorder"),
      detail: isRecording
        ? `${formatTime(elapsed)} · ${formatCursorPosition(
            recording.cursorX,
            recording.cursorY,
            t("macros.cursor.waiting", "Pointer waiting"),
          )}`
        : activePlayback
          ? `${playback.completedSteps}/${playback.totalSteps} · ${playbackPercent(playback)}%`
          : lastRecordedSteps
            ? replaceTemplate(t("macros.island.capturedDetail", "{n} steps · {time}"), {
                n: lastRecordedSteps.length,
                time: formatTime(lastTotalDurationMs),
              })
            : replaceTemplate(t("macros.island.savedDetail", "{n} saved macros"), {
                n: savedMacros.length,
              }),
      tone: error ? "danger" : isRecording ? "danger" : activePlayback ? "neutral" : lastRecordedSteps ? "success" : "neutral",
      progress: activePlayback ? playbackPercent(playback) : undefined,
      actions: isRecording
        ? [{
            id: "stop-recording",
            label: t("macros.stopRecording", "Stop recording"),
            icon: "stop",
            variant: "danger",
            onAction: handleStop,
          }]
        : !lastRecordedSteps && !activePlayback
          ? [{
              id: "start-recording",
              label: t("macros.start", "Start recording"),
              icon: "play",
              onAction: handleStart,
            }]
          : undefined,
    },
  });

  // A recording session must expose a stop affordance even after the main
  // window is hidden. The shell publishes the session first; the next task
  // turn asks the shared float bridge to show that same session.
  useEffect(() => {
    if (!isRecording) return undefined;
    const timer = window.setTimeout(() => {
      islandHost.requestFloat("module.macros.shell");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isRecording]);

  const actions = useMemo<QxShellAction[]>(() => {
    if (isRecording) {
      return [{
        id: "stop-recording",
        label: t("macros.stopRecording", "Stop recording"),
        kbd: "Enter",
        tone: "danger",
        onClick: handleStop,
      }];
    }
    if (lastRecordedSteps) {
      return [
        {
          id: "save-draft",
          label: t("macros.save", "Save macro"),
          kbd: "Enter",
          disabled: !name.trim(),
          onClick: () => void handleSave(),
        },
        {
          id: "discard-draft",
          label: t("macros.discard", "Discard"),
          tone: "danger",
          onClick: handleDiscard,
        },
        {
          id: "record-again",
          label: t("macros.recordAgain", "Record again"),
          onClick: handleStart,
        },
      ];
    }

    const list: QxShellAction[] = [];
    if (selectedMacro) {
      list.push({
        id: "open-detail",
        label: detailOpen
          ? t("macros.playSelected", "Play selected macro")
          : t("macros.openDetail", "Open macro details"),
        kbd: "Enter",
        disabled: activePlayback,
        onClick: detailOpen ? playSelected : openDetail,
      });
      list.push({
        id: "play-selected",
        label: t("macros.playSelected", "Play selected macro"),
        disabled: activePlayback,
        onClick: playSelected,
      });
      list.push({
        id: "delete-selected",
        label: t("macros.deleteSelected", "Delete selected macro"),
        tone: "danger",
        disabled: activePlayback,
        onClick: () => {
          if (selectedId != null) void deleteMacro(selectedId);
        },
      });
    }
    list.push({
      id: "record",
      label: t("macros.start", "Start recording"),
      kbd: selectedMacro ? undefined : "Enter",
      onClick: handleStart,
    });
    list.push({
      id: "refresh",
      label: t("macros.refresh", "Refresh list"),
      onClick: () => void listMacros(),
    });
    list.push({
      id: "create-demo",
      label: t("macros.demo.create", "Create demo macro"),
      onClick: handleCreateDemo,
    });
    if (activePlayback) {
      list.unshift({
        id: "toggle-playback",
        label: playback.status === "paused"
          ? t("macros.playback.resume", "Resume playback")
          : t("macros.playback.pause", "Pause playback"),
        kbd: "Space",
        onClick: () => void togglePlaybackPause(),
      });
      list.unshift({
        id: "stop-playback",
        label: t("macros.playback.stop", "Stop playback"),
        kbd: "Enter",
        tone: "danger",
        onClick: () => void stopPlayback(),
      });
    }
    return list;
  }, [activePlayback, createDemoMacro, deleteMacro, detailOpen, handleCreateDemo, handleDiscard, handleSave, handleStart, handleStop, lastRecordedSteps, listMacros, name, openDetail, playSelected, selectedId, selectedMacro, stopPlayback, t, togglePlaybackPause, isRecording, playback.status]);

  const primaryActionId = isRecording
    ? "stop-recording"
    : lastRecordedSteps
      ? "save-draft"
      : activePlayback
        ? "stop-playback"
        : selectedMacro
          ? "open-detail"
          : "record";

  const { focusList, focusDetail } = useQxMasterDetailFocus(shellRef, MASTER_DETAIL);
  const navigation = useMemo(() => qxMasterDetailNavigation({
    ids: MASTER_DETAIL,
    index: selectedIndex,
    count: visibleMacros.length,
    onChange: setSelectedMacro,
    onOpen: detailOpen ? playSelected : openDetail,
    onClose: detailOpen ? closeDetail : undefined,
    pageSize: 8,
    focusList,
    focusDetail,
  }), [closeDetail, detailOpen, focusDetail, focusList, openDetail, playSelected, selectedIndex, setSelectedMacro, visibleMacros.length]);

  const delayOptions = useMemo(
    () => PLAYBACK_DELAYS.map((ms) => ({
      value: String(ms),
      label: ms === 0
        ? t("macros.playback.noDelay", "Immediately")
        : t("macros.playback.seconds", "{n}s").replace("{n}", String(ms / 1000)),
    })),
    [t],
  );

  const actionSections = useMemo(() => {
    const withoutPrimary = actions.filter((action) => action.id !== primaryActionId);
    const selectedActions = withoutPrimary.filter((action) => [
      "open-detail",
      "play-selected",
      "delete-selected",
      "stop-playback",
      "toggle-playback",
    ].includes(action.id));
    const moduleActions = withoutPrimary.filter((action) => ["record", "refresh"].includes(action.id));
    return [
      {
        id: "selected-macro",
        title: t("macros.actions.selected", "Selected macro"),
        summary: selectedMacro ? (
          <div className="qx-macro-action-summary">
            <strong>{selectedMacro.name}</strong>
            <span>{selectedMacro.steps.length} · {formatTime(selectedMacro.total_duration_ms)}</span>
          </div>
        ) : null,
        actions: selectedActions,
      },
      {
        id: "module",
        title: t("macros.actions.module", "Macro recorder"),
        actions: moduleActions,
        showShortcuts: true,
      },
    ];
  }, [actions, primaryActionId, selectedMacro, t]);

  return (
    <QxShell
      ref={shellRef}
      title={t("macros.title", "Macro Recorder")}
      islandKey="macros"
      search={(
        <div className="qx-rss-detail-title qx-module-title-with-badge">
          <QxModuleSearch
            value={query}
            onChange={setQuery}
            placeholder={t("macros.search", "Filter macros…")}
            aria-label={t("macros.search", "Filter macros…")}
          />
          <BetaBadge />
        </div>
      )}
      context={(
        <aside
          className="qx-action-panel qx-macro-actions"
          {...qxRegionProps(MASTER_DETAIL.actions, {
            label: t("macros.actions.title", "Macro actions"),
            scroll: true,
          })}
        >
          <div className="qx-macro-delay-control">
            <div className="qx-action-title">{t("macros.playback.delay", "Playback delay")}</div>
            <div className="qx-action-hint">{t("macros.playback.delayHint", "Wait before starting playback")}</div>
            <Select
              value={String(playDelayMs)}
              options={delayOptions}
              ariaLabel={t("macros.playback.delay", "Playback delay")}
              disabled={activePlayback || isRecording}
              onChange={(value) => setPlayDelayMs(Number(value))}
            />
          </div>
          <QxActionSections sections={actionSections} />
        </aside>
      )}
      island={shell.island}
      islandPriority={isRecording ? "task" : "location"}
      islandSticky={isRecording}
      islandPlacement={isRecording ? "floating" : "docked-or-float"}
      primaryActionId={primaryActionId}
      actionTitle={t("macros.actions.title", "Macro actions")}
      actions={actions}
      navigation={navigation}
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      className="qx-macro-shell"
    >
      <div className="qx-macro-content">
        <div className="qx-module-stage qx-macro-stage">
          <div className="qx-panel-card qx-macro-record-card">
            <div className="qx-macro-record-status">
              {isRecording ? <span className="qx-rec-dot" aria-hidden="true" /> : null}
              <span>
                {isRecording
                  ? t("macros.status.recording", "Recording")
                  : lastRecordedSteps
                    ? t("macros.status.complete", "Recording complete")
                    : t("macros.status.ready", "Ready")}
              </span>
            </div>
            <div className="qx-macro-record-time">
              {formatTime(isRecording ? elapsed : lastTotalDurationMs)}
            </div>
            {isRecording ? (
              <div className="qx-macro-record-pointer" aria-live="polite">
                <svg viewBox="0 0 32 42" aria-hidden="true">
                  <path d="M3 2.5 28.5 25l-11.2 1.4 6.1 11.8-5.3 2.7-6.2-11.8-7.1 8.8Z" />
                </svg>
                <span>
                  {t("macros.cursor.position", "Pointer {x}, {y}")
                    .replace("{x}", recording.cursorX == null ? "—" : String(Math.round(recording.cursorX)))
                    .replace("{y}", recording.cursorY == null ? "—" : String(Math.round(recording.cursorY)))}
                </span>
                <small>{recording.steps} {t("macros.cursor.steps", "steps")}</small>
              </div>
            ) : null}
            {isRecording ? (
              <Button className="qx-command-button danger" type="button" onClick={handleStop}>
                {t("macros.stop", "Stop")}
              </Button>
            ) : lastRecordedSteps ? (
              <SaveDialog
                stepCount={lastRecordedSteps.length}
                name={name}
                setName={setName}
                onSave={() => void handleSave()}
                onDiscard={handleDiscard}
              />
            ) : (
              <Button className="qx-command-button primary" type="button" onClick={handleStart}>
                {t("macros.start", "Start recording")}
              </Button>
            )}
          </div>

          <div className="qx-macro-hint">
            {isRecording ? (
              <>
                <span><Kbd>Esc</Kbd>{t("macros.hint.stop", "Stop recording")}</span>
                {stopTailSeconds > 0 ? (
                  <span>{t("macros.hint.tailTrim", "The last {n}s before stopping is not saved").replace("{n}", String(stopTailSeconds))}</span>
                ) : null}
              </>
            ) : lastRecordedSteps ? (
              <>
                <span><Kbd>↩</Kbd>{t("macros.hint.save", "Save macro")}</span>
                <span><Kbd>Esc</Kbd>{t("macros.hint.discard", "Discard")}</span>
              </>
            ) : (
              <span>{t("macros.hint.global", "Records keyboard and mouse input globally")}</span>
            )}
          </div>

          {error ? (
            <div className={`qx-macro-error${permissionIssue ? " is-permission" : ""}`} role="alert">
              <div>
                {permissionIssue === "input-monitoring"
                  ? t(
                      "macros.permission.inputMonitoring",
                      "Input Monitoring permission is required to record keyboard and mouse input. Enable Qx in System Settings → Privacy & Security → Input Monitoring.",
                    )
                  : permissionIssue === "windows-hook"
                    ? t(
                        "macros.permission.windowsHook",
                        "Windows could not register the keyboard or mouse hook. Check system permissions and try again.",
                      )
                    : error}
              </div>
              {permissionIssue === "input-monitoring" && desktopPlatform === "macos" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openMacroPermissionSettings()}
                >
                  {t("macros.permission.openSettings", "Open System Settings")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="qx-macro-workbench">
          <QxResizableSplit
            className={`qx-content-split qx-macro-split${detailOpen ? " has-detail" : ""}`}
            storageKey={MACRO_LIST_WIDTH_KEY}
            defaultLeftWidth={320}
            minLeftWidth={240}
            minRightWidth={320}
            separatorLabel={t("macros.resizeList", "Resize macro list")}
          >
            <div
              ref={listRef}
              className="qx-content-list qx-plugin-list qx-macro-list"
              role="listbox"
              aria-label={t("macros.list", "Saved macros")}
              {...qxRegionProps(MASTER_DETAIL.list, {
                label: t("macros.list", "Saved macros"),
                initial: !detailOpen,
                scroll: true,
              })}
            >
              <div className="qx-section-header">
                <span style={{ flex: 1 }}>{t("macros.list", "Saved macros")}</span>
                <span>{visibleMacros.length}</span>
              </div>
              {visibleMacros.length === 0 ? (
                <div className="qx-empty-state">
                  <div>
                    {query
                      ? t("macros.empty.search", "No matching macros")
                      : t("macros.empty", "No saved macros yet")}
                  </div>
                  {!query ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="qx-macro-demo-button"
                      onClick={handleCreateDemo}
                    >
                      {t("macros.demo.create", "Create demo macro")}
                    </Button>
                  ) : null}
                </div>
              ) : visibleMacros.map((macro, index) => (
                <MacroListRow
                  key={macro.id ?? `${macro.name}-${index}`}
                  macro={macro}
                  itemProps={getItemProps(index, { className: "tall" })}
                  selected={index === selectedIndex}
                  playing={macro.id === playback.macroId && activePlayback}
                  onClick={() => setSelectedMacro(index)}
                  onDoubleClick={() => {
                    setSelectedMacro(index);
                    setDetailOpen(true);
                  }}
                  t={t}
                />
              ))}
            </div>

            <article
              className="qx-content-detail qx-plugin-detail qx-macro-detail"
              {...qxRegionProps(MASTER_DETAIL.detail, {
                label: t("macros.detail.title", "Macro details"),
                initial: detailOpen,
                scroll: true,
              })}
              aria-hidden={!detailOpen}
            >
              {selectedMacro ? (
                <MacroDetail
                  macro={selectedMacro}
                  playback={playbackMatchesSelection ? playback : null}
                  activeStepIndex={activeStepIndex}
                  t={t}
                />
              ) : (
                <div className="qx-content-detail-empty">
                  <div>{t("macros.detail.empty", "Select a macro to preview its steps")}</div>
                </div>
              )}
            </article>
          </QxResizableSplit>
        </div>
      </div>
    </QxShell>
  );
}

function replaceTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

function MacroListRow({
  macro,
  itemProps,
  selected,
  playing,
  onClick,
  onDoubleClick,
  t,
}: {
  macro: MacroData;
  itemProps: { className: string; role: string; "aria-selected": boolean; "data-qx-list-index": number };
  selected: boolean;
  playing: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <button
      type="button"
      {...itemProps}
      className={`${itemProps.className} qx-macro-list-row${selected ? " is-active" : ""}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className={`qx-macro-list-mark${playing ? " is-playing" : ""}`} aria-hidden="true" />
      <span className="qx-list-copy">
        <span className="qx-list-title">{macro.name}</span>
        <span className="qx-list-subtitle">
          {replaceTemplate(t("macros.listMeta", "{steps} steps · {duration}"), {
            steps: macro.steps.length,
            duration: formatTime(macro.total_duration_ms),
          })}
          {macro.created_at ? ` · ${formatTimestamp(macro.created_at)}` : ""}
        </span>
      </span>
      <span className="qx-macro-list-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function MacroDetail({
  macro,
  playback,
  activeStepIndex,
  t,
}: {
  macro: MacroData;
  playback: MacroPlaybackState | null;
  activeStepIndex: number;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <>
      <div className="qx-detail-header">
        <div className="qx-detail-header-copy">
          <div className="qx-detail-title">{macro.name}</div>
          <div className="qx-detail-meta">
            {replaceTemplate(t("macros.detail.meta", "{steps} steps · {duration}"), {
              steps: macro.steps.length,
              duration: formatTime(macro.total_duration_ms),
            })}
            {macro.created_at ? ` · ${formatTimestamp(macro.created_at)}` : ""}
          </div>
        </div>
        {playback && (playback.status === "waiting" || playback.status === "playing") ? (
          <span className="qx-badge">
            {replaceTemplate(t("macros.playback.progress", "{done}/{total} steps"), {
              done: playback.completedSteps,
              total: playback.totalSteps,
            })}
          </span>
        ) : null}
      </div>
      <div className="qx-content-detail-scroll qx-macro-detail-scroll">
        <div className="qx-macro-step-heading">
          <span>{t("macros.detail.steps", "Steps")}</span>
          <span>{macro.steps.length}</span>
        </div>
        {macro.steps.length === 0 ? (
          <div className="qx-content-detail-empty">
            {t("macros.detail.noSteps", "This macro has no recorded steps")}
          </div>
        ) : (
          <div className="qx-macro-step-list">
            {macro.steps.map((step, index) => (
              <div
                key={`${step.event_type}-${index}`}
                className={`qx-macro-step${index === activeStepIndex ? " is-current" : ""}`}
              >
                <span className="qx-macro-step-index">{index + 1}</span>
                <span className="qx-macro-step-copy">
                  <span>{formatMacroStep(step, t)}</span>
                  <small>
                    {step.duration_ms > 0
                      ? replaceTemplate(t("macros.step.delay", "wait {time}"), {
                          time: `${step.duration_ms} ms`,
                        })
                      : t("macros.step.noDelay", "no wait")}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useT } from "../../i18n";
import { loadLastCaptureSelection, saveLastCaptureSelection } from "./preferences";
import { DEFAULT_SETTINGS, type ScreencapSettings, type Settings } from "../settings/store";
import type { CaptureMode, RecordingSnapshot, RecordingOptions } from "./store";
import { CaptureToolbar } from "./CaptureToolbar";
import { useCaptureToolbarPlacement } from "./useCaptureToolbarPlacement";
import { useCaptureAnnotations, type Point, type Rect } from "./useCaptureAnnotations";
import { CaptureTextAnnotations } from "./CaptureTextAnnotations";
import {
  clamp,
  clampRectToViewport,
  MIN_CAPTURE_SIZE as MIN_SIZE,
  rectFromPoints,
  selectionFromLogicalArea,
} from "./captureSelectionGeometry";
interface LogicalArea {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}
interface PickerStatus {
  mode: CaptureMode;
  monitorId: number;
  monitorName: string;
  coordinateScale: number;
  logicalArea?: LogicalArea | null;
  restoreSelection?: boolean;
  /** When false (single display), skip cross-display pointer-follow IPC. */
  multiDisplay?: boolean;
}
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type PickMode = "region" | "fullscreen";
interface RectInteraction {
  kind: "move" | "resize";
  start: Point;
  origin: Rect;
  handle?: ResizeHandle;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Full-display protected overlay: draw, refine, annotate, then capture. */
export default function RegionPickerWindow() {
  const t = useT();
  const [picker, setPicker] = useState<PickerStatus | null>(null);
  const [recording, setRecording] = useState<RecordingSnapshot | null>(null);
  const [captureSettings, setCaptureSettings] = useState<ScreencapSettings>(DEFAULT_SETTINGS.screencap);
  const settingsEnvelopeRef = useRef<Settings | null>(null);
  const [intent, setIntent] = useState<CaptureMode>("screenshot");
  const [pickMode, setPickMode] = useState<PickMode>("region");
  const regionSelectionRef = useRef<Rect | null>(null);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [interaction, setInteraction] = useState<RectInteraction | null>(null);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelCountdownRef = useRef(false);
  /** Latest draw points while dragging — refs stay valid before React commits. */
  const drawStartRef = useRef<Point | null>(null);
  const drawEndRef = useRef<Point | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const interactionRef = useRef<RectInteraction | null>(null);
  const interactionRafRef = useRef<number | null>(null);
  const interactionPointRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const {
    tool, setTool, color, setColor, annotations, setAnnotations, redoStack, setRedoStack,
    shapeDraft, setShapeDraft, setNextNumber, penDraft, setPenDraft, textDraft, setTextDraft,
    canvasRef, undo, redo, onCanvasMouseDown, onCanvasMouseMove, onCanvasMouseUp,
    commitTextDraft, updateTextAnnotation, exportOverlayBase64,
  } = useCaptureAnnotations(selection, busy);
  const multiDisplay = picker?.multiDisplay === true;
  const multiDisplayRef = useRef(false);
  multiDisplayRef.current = multiDisplay;

  const setPointerFollow = useCallback((enabled: boolean) => {
    // Single-display: no outer shades / handoff tracker — skip the IPC.
    if (!multiDisplayRef.current) return;
    void invoke("screencap_set_pointer_follow", { enabled }).catch(() => {});
  }, []);

  /** Pin display handoff in Rust *before* any drag moves (sync with follow off). */
  const setInteractionLock = useCallback((locked: boolean) => {
    void invoke("screencap_set_picker_interaction_lock", { locked }).catch(() => {});
    if (locked) setPointerFollow(false);
  }, [setPointerFollow]);

  const clearDrawDraft = useCallback(() => {
    drawingRef.current = false;
    drawStartRef.current = null;
    drawEndRef.current = null;
    if (drawRafRef.current != null) {
      window.cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    }
    setDrawStart(null);
    setDrawEnd(null);
  }, []);

  useEffect(() => {
    document.body.classList.add("qx-region-picker-body");
    rootRef.current?.focus();
    void Promise.all([
      invoke<PickerStatus | null>("screencap_region_select_status"),
      invoke<RecordingSnapshot>("recording_status"),
      invoke<Settings>("get_settings"),
    ]).then(([status, snapshot, settings]) => {
      setPicker(status);
      settingsEnvelopeRef.current = settings;
      setCaptureSettings(settings.screencap);
      if (status?.mode === "recording" || status?.mode === "screenshot") {
        setIntent(status.mode);
      }
      const restored = selectionFromLogicalArea(status?.logicalArea);
      if (restored) {
        regionSelectionRef.current = restored;
        setSelection(restored);
      } else {
        // Remember last region on this monitor for fast re-capture.
        const remembered = settings.screencap.remember_last_selection
          ? loadLastCaptureSelection()
          : null;
        if (
          remembered
          && (remembered.monitorId == null || remembered.monitorId === status?.monitorId)
        ) {
          const next = clampRectToViewport({
            x: remembered.x,
            y: remembered.y,
            w: remembered.w,
            h: remembered.h,
          });
          regionSelectionRef.current = next;
          setSelection(next);
        }
      }
      setRecording(snapshot);
    }).catch((loadError) => {
      setError(String(loadError));
    });
    const pickerListener = listen<PickerStatus>("screencap:picker", (event) => {
      const payload = event.payload;
      // Windows multi-display handoff can re-emit picker while the pointer is
      // still down. Never wipe an in-progress draft/resize — that is the main
      // cause of the selection rectangle vanishing mid-drag.
      if (drawingRef.current || interactionRef.current) {
        setPicker((current) => ({
          ...(current ?? payload),
          ...payload,
          // Keep any local multiDisplay patch if the payload omits it.
          multiDisplay: payload.multiDisplay ?? current?.multiDisplay,
        }));
        if (payload.mode === "recording" || payload.mode === "screenshot") {
          setIntent(payload.mode);
        }
        return;
      }
      setPicker(payload);
      if (payload.mode === "recording" || payload.mode === "screenshot") {
        setIntent(payload.mode);
      }
      clearDrawDraft();
      interactionRef.current = null;
      setInteraction(null);
      setPickMode("region");
      setTool(null);
      setBusy(false);
      setCountdown(null);
      setError(null);
      cancelCountdownRef.current = true;
      if (payload.restoreSelection) {
        const restored = selectionFromLogicalArea(payload.logicalArea);
        if (restored) {
          regionSelectionRef.current = restored;
          setSelection(restored);
        }
        setAnnotations([]);
        setRedoStack([]);
        setNextNumber(1);
      } else {
        regionSelectionRef.current = null;
        setSelection(null);
        setAnnotations([]);
        setRedoStack([]);
        setNextNumber(1);
      }
    });
    // Hot-plug only: flip multiDisplay without wiping an in-progress draft/selection.
    const topologyListener = listen<{ multiDisplay?: boolean }>("screencap:multi-display", (event) => {
      const multi = Boolean(event.payload?.multiDisplay);
      multiDisplayRef.current = multi;
      setPicker((current) => (current ? { ...current, multiDisplay: multi } : current));
    });
    const stateListener = listen<RecordingSnapshot>("screencap:state", (event) => {
      setRecording(event.payload);
      if (event.payload.phase !== "recording" && event.payload.phase !== "processing") {
        setBusy(false);
      }
      setError(event.payload.error);
    });
    void pickerListener.catch((listenError) => setError(String(listenError)));
    void topologyListener.catch((listenError) => setError(String(listenError)));
    void stateListener.catch((listenError) => setError(String(listenError)));
    // The native window can be visible before WebView2 has mounted React in a
    // remote Windows session. Wait for all listeners, then ask Rust to replay
    // state and reassert focus/input on the actual picker surface.
    void Promise.all([pickerListener, topologyListener, stateListener])
      .then(() => invoke<PickerStatus | null>("screencap_region_picker_ready"))
      .then((status) => {
        if (status) setPicker(status);
        rootRef.current?.focus();
      })
      .catch((readyError) => setError(String(readyError)));
    return () => {
      document.body.classList.remove("qx-region-picker-body");
      void pickerListener.then((dispose) => dispose()).catch(() => {});
      void topologyListener.then((dispose) => dispose()).catch(() => {});
      void stateListener.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  const updateCaptureSettings = useCallback((patch: Partial<ScreencapSettings>) => {
    setCaptureSettings((current) => {
      const next = { ...current, ...patch };
      const envelope = settingsEnvelopeRef.current;
      if (envelope) {
        const settings = { ...envelope, screencap: next };
        settingsEnvelopeRef.current = settings;
        void invoke<Settings>("update_settings", { settings }).catch((updateError) => {
          setError(String(updateError));
        });
      }
      return next;
    });
  }, []);

  // Rust owns cross-display pointer tracking. Stop it as soon as the user has
  // started an interaction so an in-progress selection can never move screens.
  // When multi-display becomes true mid-session (hot-plug), re-arm follow only
  // while the picker is idle.
  useEffect(() => {
    if (!multiDisplay) {
      setPointerFollow(false);
      return;
    }
    if (selection || drawStart || interaction || busy || countdown !== null) {
      setPointerFollow(false);
    } else {
      setPointerFollow(true);
    }
  }, [busy, countdown, drawStart, interaction, multiDisplay, selection, setPointerFollow]);

  const cancel = useCallback(async () => {
    if (busy && countdown === null) return;
    cancelCountdownRef.current = true;
    setCountdown(null);
    setBusy(true);
    await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
    await invoke("screencap_cancel_region_select").catch(() => {});
  }, [busy, countdown]);

  const confirm = useCallback(async (
    action: CaptureMode,
    areaOverride?: Rect,
    ocrDestination?: "clipboard" | "editor" | null,
    options?: { forceCopy?: boolean; skipDelay?: boolean; dismissUi?: boolean },
  ) => {
    const target = areaOverride ?? selection;
    if (busy || !target || countdown !== null) return;
    if (action === "recording" && annotations.some((annotation) => annotation.type !== "mosaic")) {
      setError(t("screencap.picker.annotationsBlockRecord", "Clear annotations before recording."));
      return;
    }
    setBusy(true);
    setError(null);
    cancelCountdownRef.current = false;

    const canvas = canvasRef.current;
    const annotationOverlayBase64 = action === "screenshot" && annotations.length > 0 && canvas
      ? exportOverlayBase64()
      : undefined;

    // Copy-and-continue (Cmd/Ctrl+C) always skips the delay countdown.
    const dismissUi = options?.dismissUi === true;
    const delay = (options?.skipDelay || dismissUi) ? 0 : captureSettings.capture_delay_seconds;
    if (delay > 0) {
      try {
        await invoke("screencap_set_picker_passthrough", { enabled: true });
      } catch {
        // Best effort — countdown still proceeds.
      }
      for (let remaining = delay; remaining > 0; remaining -= 1) {
        if (cancelCountdownRef.current) {
          setCountdown(null);
          setBusy(false);
          await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
          return;
        }
        setCountdown(remaining);
        await sleep(1000);
      }
      setCountdown(null);
      await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
      if (cancelCountdownRef.current) {
        setBusy(false);
        return;
      }
    }

    try {
      if (captureSettings.remember_last_selection) {
        saveLastCaptureSelection({
          x: Math.round(target.x),
          y: Math.round(target.y),
          w: Math.round(target.w),
          h: Math.round(target.h),
          monitorId: picker?.monitorId ?? null,
        });
      }
      const shouldCopy = action === "screenshot"
        && (options?.forceCopy === true
          || dismissUi
          || captureSettings.screenshot_destination === "clipboard"
          || captureSettings.auto_copy_to_clipboard);
      await invoke("screencap_confirm_region_select", {
        area: {
          x: Math.round(target.x),
          y: Math.round(target.y),
          w: Math.round(target.w),
          h: Math.round(target.h),
        },
        options: {
          outputFormat: captureSettings.output_format,
          fps: captureSettings.fps,
          quality: captureSettings.quality,
          resolution: captureSettings.resolution,
        } satisfies RecordingOptions,
        action,
        captureOptions: {
          destination: action === "screenshot"
            ? captureSettings.screenshot_destination
            : captureSettings.recording_destination,
          customDirectory: action === "screenshot"
            ? captureSettings.screenshot_custom_directory
            : captureSettings.recording_custom_directory,
          openAfter: action === "screenshot"
            ? captureSettings.screenshot_open_after
            : captureSettings.recording_open_after,
          showFloatingThumbnail: captureSettings.show_floating_thumbnail,
          rememberSelection: captureSettings.remember_last_selection,
          includeCursor: action === "screenshot"
            ? captureSettings.screenshot_include_cursor
            : captureSettings.recording_include_cursor,
          showMouseClicks: action === "recording" && captureSettings.recording_show_mouse_clicks,
          microphoneId: action === "recording" ? captureSettings.recording_microphone_id : null,
          recordingMasks: action === "recording"
            ? annotations.filter((annotation) => annotation.type === "mosaic").map((annotation) => {
              const xs = annotation.points.map((point) => point.x);
              const ys = annotation.points.map((point) => point.y);
              const minX = Math.min(...xs);
              const minY = Math.min(...ys);
              return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
            })
            : [],
          playSound: action === "screenshot" && captureSettings.screenshot_sound_enabled,
        },
        ocrDestination: action === "screenshot" ? (ocrDestination ?? null) : null,
        annotationOverlayBase64,
        copyToClipboard: shouldCopy,
        dismissUi: action === "screenshot" && dismissUi,
      });
    } catch (captureError) {
      setBusy(false);
      setError(String(captureError));
    }
  }, [annotations, busy, captureSettings, countdown, exportOverlayBase64, picker?.monitorId, selection, t]);

  const selectFullScreen = useCallback(() => {
    if (busy) return;
    if (pickMode === "region" && selection) regionSelectionRef.current = selection;
    setInteractionLock(false);
    setPointerFollow(false);
    setPickMode("fullscreen");
    setSelection({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    clearDrawDraft();
    setAnnotations([]);
    setRedoStack([]);
    setError(null);
  }, [busy, clearDrawDraft, pickMode, selection, setInteractionLock, setPointerFollow]);

  const switchPickMode = useCallback((mode: PickMode) => {
    if (busy) return;
    if (mode === "region" && pickMode === "region") return;
    clearDrawDraft();
    setInteractionLock(false);
    setTool(null);
    if (mode === "fullscreen") {
      selectFullScreen();
      return;
    }
    setPickMode("region");
    setSelection(regionSelectionRef.current);
    setAnnotations([]);
    setRedoStack([]);
    setNextNumber(1);
    setError(null);
    setPointerFollow(regionSelectionRef.current == null);
  }, [busy, clearDrawDraft, pickMode, selectFullScreen, setInteractionLock, setPointerFollow]);

  const switchIntent = useCallback((next: CaptureMode) => {
    if (busy || next === intent) return;
    if (
      intent === "screenshot"
      && next === "recording"
      && annotations.length > 0
      && !window.confirm(t(
        "screencap.picker.clearAnnotationsForRecording",
        "Recording does not include screenshot annotations. Clear them and switch?",
      ))
    ) {
      return;
    }
    setAnnotations([]);
    setRedoStack([]);
    setShapeDraft(null);
    setPenDraft(null);
    setTextDraft(null);
    setNextNumber(1);
    setTool(null);
    setError(null);
    setIntent(next);
  }, [annotations.length, busy, intent, t]);

  const beginResize = (event: React.PointerEvent, handle: ResizeHandle) => {
    if (!selection || busy) return;
    event.preventDefault();
    event.stopPropagation();
    setInteractionLock(true);
    const next: RectInteraction = {
      kind: "resize",
      handle,
      start: { x: event.clientX, y: event.clientY },
      origin: selection,
    };
    interactionRef.current = next;
    setInteraction(next);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const flushDrawEnd = useCallback(() => {
    drawRafRef.current = null;
    const end = drawEndRef.current;
    if (end) setDrawEnd(end);
  }, []);

  const scheduleDrawEnd = useCallback((end: Point) => {
    drawEndRef.current = end;
    if (drawRafRef.current != null) return;
    drawRafRef.current = window.requestAnimationFrame(flushDrawEnd);
  }, [flushDrawEnd]);

  const applyInteractionPoint = useCallback((clientX: number, clientY: number) => {
    const active = interactionRef.current;
    if (!active) return;
    const dx = clientX - active.start.x;
    const dy = clientY - active.start.y;
    const origin = active.origin;
    if (active.kind === "move") {
      setSelection({
        ...origin,
        x: clamp(origin.x + dx, 0, window.innerWidth - origin.w),
        y: clamp(origin.y + dy, 0, window.innerHeight - origin.h),
      });
      return;
    }
    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.w;
    let bottom = origin.y + origin.h;
    const handle = active.handle ?? "se";
    if (handle.includes("w")) left = clamp(origin.x + dx, 0, right - MIN_SIZE);
    if (handle.includes("e")) right = clamp(origin.x + origin.w + dx, left + MIN_SIZE, window.innerWidth);
    if (handle.includes("n")) top = clamp(origin.y + dy, 0, bottom - MIN_SIZE);
    if (handle.includes("s")) bottom = clamp(origin.y + origin.h + dy, top + MIN_SIZE, window.innerHeight);
    setSelection({ x: left, y: top, w: right - left, h: bottom - top });
  }, []);

  const scheduleInteraction = useCallback((clientX: number, clientY: number) => {
    interactionPointRef.current = { x: clientX, y: clientY };
    if (interactionRafRef.current != null) return;
    interactionRafRef.current = window.requestAnimationFrame(() => {
      interactionRafRef.current = null;
      const point = interactionPointRef.current;
      if (!point) return;
      applyInteractionPoint(point.x, point.y);
    });
  }, [applyInteractionPoint]);

  const onRootPointerDown = (event: React.PointerEvent) => {
    if (busy || event.button !== 0 || countdown !== null) return;
    // Pin display immediately (Rust atomic) — do not wait for React or follow IPC.
    setInteractionLock(true);
    if (pickMode === "fullscreen") {
      setInteractionLock(false);
      return;
    }
    // Region mode: allow redraw by dragging on dimmed area (or always start new drag when no tool).
    if (tool) {
      setInteractionLock(false);
      return;
    }
    if (selection) {
      // Click outside selection → clear and start new drag.
      const inside = event.clientX >= selection.x
        && event.clientY >= selection.y
        && event.clientX <= selection.x + selection.w
        && event.clientY <= selection.y + selection.h;
      if (inside) {
        setInteractionLock(false);
        return;
      }
      setSelection(null);
      setAnnotations([]);
      setRedoStack([]);
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort on some hosts */
    }
    const point = { x: event.clientX, y: event.clientY };
    drawingRef.current = true;
    drawStartRef.current = point;
    drawEndRef.current = point;
    setDrawStart(point);
    setDrawEnd(point);
  };

  const onSelectionPointerDown = (event: React.PointerEvent) => {
    if (!selection || tool || busy || event.button !== 0 || countdown !== null) return;
    event.preventDefault();
    event.stopPropagation();
    setInteractionLock(true);
    const now = Date.now();
    const prev = lastClickRef.current;
    if (
      prev
      && now - prev.at < 320
      && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 8
    ) {
      lastClickRef.current = null;
      setInteractionLock(false);
      void confirm(intent);
      return;
    }
    lastClickRef.current = { at: now, x: event.clientX, y: event.clientY };
    const next: RectInteraction = {
      kind: "move",
      start: { x: event.clientX, y: event.clientY },
      origin: selection,
    };
    interactionRef.current = next;
    setInteraction(next);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onRootPointerMove = (event: React.PointerEvent) => {
    // Use refs so the first moves after pointerdown work before React re-renders
    // (critical on Windows WebView2 high-rate mouse events).
    const start = drawStartRef.current;
    if (drawingRef.current && start) {
      let end = { x: event.clientX, y: event.clientY };
      if (event.shiftKey) {
        const size = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
        end = {
          x: start.x + Math.sign(end.x - start.x || 1) * size,
          y: start.y + Math.sign(end.y - start.y || 1) * size,
        };
      }
      // One React commit per frame keeps the rect following the pointer without
      // flooding the reconciler on high-rate mouse/trackpad streams.
      scheduleDrawEnd(end);
      return;
    }
    if (!interactionRef.current) return;
    scheduleInteraction(event.clientX, event.clientY);
  };

  const finishDrawSelection = useCallback((opts?: {
    forceRefine?: boolean;
  }) => {
    if (drawRafRef.current != null) {
      window.cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    }
    // Prefer refs: React state for drawStart/selection can still be a frame behind
    // on Windows when pointerup races the commit from pointerdown.
    const start = drawStartRef.current;
    const end = drawEndRef.current;
    drawingRef.current = false;
    drawStartRef.current = null;
    drawEndRef.current = null;
    setDrawStart(null);
    setDrawEnd(null);
    setInteractionLock(false);
    if (!start || !end) {
      return false;
    }
    const next = rectFromPoints(start, end);
    if (next.w < MIN_SIZE || next.h < MIN_SIZE) {
      // Too small — drop draft, re-arm follow when multi-display.
      setPointerFollow(true);
      return false;
    }
    setSelection(next);
    regionSelectionRef.current = next;
    setPickMode("region");
    const confirmMode = captureSettings.capture_confirm_mode;
    // Screenshots stay in the editable selection state so the user can resize
    // and annotate before the explicit Cmd/Ctrl+C copy action. The release
    // preference remains meaningful for recordings, where the transport takes
    // over as soon as the region is accepted.
    if (intent === "recording" && confirmMode === "release" && !opts?.forceRefine) {
      void confirm(intent, next);
    }
    return true;
  }, [captureSettings.capture_confirm_mode, confirm, intent, setInteractionLock, setPointerFollow]);

  const onRootPointerUp = (event: React.PointerEvent) => {
    if (drawingRef.current || drawStartRef.current) {
      // Flush any pending rAF sample so mouseup uses the latest point.
      if (drawRafRef.current != null) {
        window.cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
      if (event.type !== "pointercancel" || (drawStartRef.current && drawEndRef.current)) {
        // pointercancel on Windows can fire during DWM focus churn — still
        // commit if the draft is already large enough via finishDrawSelection.
        const forceRefine = event.altKey && event.type === "pointerup";
        finishDrawSelection({ forceRefine });
      } else {
        clearDrawDraft();
        setInteractionLock(false);
      }
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    if (interactionRafRef.current != null) {
      window.cancelAnimationFrame(interactionRafRef.current);
      interactionRafRef.current = null;
    }
    interactionRef.current = null;
    setInteraction(null);
    setInteractionLock(false);
  };

  const draft = drawStart && drawEnd ? rectFromPoints(drawStart, drawEnd) : null;
  const rect = selection ?? draft;
  const display = picker?.monitorName ?? t("screencap.display", "display");
  const recordingActive = recording?.phase === "recording" || recording?.phase === "processing";
  const visibleRect = recordingActive && rect
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    : rect;
  const {
    toolbarRef,
    toolbarStyle,
    onToolbarPointerDown,
    onToolbarPointerMove,
    onToolbarPointerUp,
  } = useCaptureToolbarPlacement({
    selection,
    fullscreen: pickMode === "fullscreen",
    intent,
  });
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <div
      ref={rootRef}
      className={`qx-region-picker${countdown !== null ? " is-countdown" : ""}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (countdown !== null) {
            cancelCountdownRef.current = true;
            setCountdown(null);
            setBusy(false);
            void invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
            return;
          }
          if (textDraft) {
            setTextDraft(null);
            return;
          }
          if (tool) {
            setTool(null);
            return;
          }
          if (shapeDraft || penDraft) {
            setShapeDraft(null);
            setPenDraft(null);
            return;
          }
          if (drawStart || drawingRef.current) {
            clearDrawDraft();
            setInteractionLock(false);
            setPointerFollow(true);
            return;
          }
          if (selection) {
            setSelection(null);
            setAnnotations([]);
            setRedoStack([]);
            setNextNumber(1);
            setTool(null);
            setPointerFollow(true);
            return;
          }
          void cancel();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        // Cmd/Ctrl+C after a selection: capture → clipboard → hide picker & Qx.
        // Native text fields keep copy (annotation text input).
        if (
          (event.metaKey || event.ctrlKey)
          && !event.altKey
          && !event.shiftKey
          && event.key.toLowerCase() === "c"
        ) {
          const target = event.target as HTMLElement | null;
          if (target?.closest("input, textarea, [contenteditable='true']")) {
            return;
          }
          if (textDraft) return;
          if (!selection || busy || countdown !== null) return;
          event.preventDefault();
          void confirm("screenshot", selection, null, {
            forceCopy: true,
            skipDelay: true,
            dismissUi: true,
          });
          return;
        }
        if (event.key === "Enter" && selection && !busy && countdown === null) {
          event.preventDefault();
          void confirm(intent);
          return;
        }
        if (event.key === " " && !busy) {
          event.preventDefault();
          selectFullScreen();
          return;
        }
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === "s") {
            event.preventDefault();
            switchIntent("screenshot");
          } else if (key === "r") {
            // Xnip-style: re-apply last confirmed region on this display.
            event.preventDefault();
            if (busy || countdown !== null) return;
            const remembered = loadLastCaptureSelection();
            if (
              !remembered
              || (remembered.monitorId != null
                && picker?.monitorId != null
                && remembered.monitorId !== picker.monitorId)
            ) {
              setError(t(
                "screencap.picker.noLastRegion",
                "No previous region on this display. Drag to select first.",
              ));
              return;
            }
            const next = clampRectToViewport({
              x: remembered.x,
              y: remembered.y,
              w: remembered.w,
              h: remembered.h,
            });
            regionSelectionRef.current = next;
            setSelection(next);
            setPickMode("region");
            setTool(null);
            setAnnotations([]);
            setRedoStack([]);
            setNextNumber(1);
            setError(null);
            clearDrawDraft();
            setInteractionLock(false);
            setPointerFollow(false);
          } else if (key === "v") {
            event.preventDefault();
            switchIntent("recording");
          } else if (key === "tab") {
            event.preventDefault();
            switchPickMode(pickMode === "region" ? "fullscreen" : "region");
          } else if (key === "1") setTool("rect");
          else if (key === "2") setTool("arrow");
          else if (key === "3") setTool("text");
          else if (key === "4") setTool("pen");
          else if (key === "5") setTool("number");
          else if (key === "6") setTool("mosaic");
        }
      }}
      onPointerDown={onRootPointerDown}
      onPointerMove={onRootPointerMove}
      onPointerUp={onRootPointerUp}
      onPointerCancel={onRootPointerUp}
    >
      {/* Dim the active display immediately so multi-monitor capture reads as a
          single capture session; cutout shades replace this once a rect exists. */}
      {!recordingActive && countdown === null && !visibleRect && (
        <div className="qx-region-picker-shade is-full" aria-hidden="true" />
      )}

      {visibleRect && (
        <>
          {!recordingActive && countdown === null && <>
            <div className="qx-region-picker-shade" style={{ left: 0, top: 0, right: 0, height: visibleRect.y }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y + visibleRect.h, right: 0, bottom: 0 }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y, width: visibleRect.x, height: visibleRect.h }} />
            <div className="qx-region-picker-shade" style={{ left: visibleRect.x + visibleRect.w, top: visibleRect.y, right: 0, height: visibleRect.h }} />
          </>}
          <div
            className={`qx-region-picker-rect${selection ? " is-selected" : ""}${tool ? ` is-tool-${tool}` : ""}${recordingActive ? " is-recording" : ""}`}
            style={{ left: visibleRect.x, top: visibleRect.y, width: visibleRect.w, height: visibleRect.h }}
            onPointerDown={onSelectionPointerDown}
          >
            {selection && !recordingActive && countdown === null && (
              <>
                <canvas
                  ref={canvasRef}
                  className="qx-region-picker-annotations"
                  onMouseDown={onCanvasMouseDown}
                  onMouseMove={onCanvasMouseMove}
                  onMouseUp={onCanvasMouseUp}
                />
                <CaptureTextAnnotations
                  selection={selection}
                  annotations={annotations.filter((annotation) => annotation.type === "text")}
                  onUpdate={updateTextAnnotation}
                />
                {textDraft && (
                  <input
                    autoFocus
                    className="qx-region-picker-text-input"
                    value={textDraft.text}
                    placeholder={t("screencap.picker.textPrompt", "Enter annotation text")}
                    style={{
                      left: clamp(textDraft.point.x, 4, Math.max(4, selection.w - 184)),
                      top: clamp(textDraft.point.y - 22, 4, Math.max(4, selection.h - 32)),
                    }}
                    onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value })}
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={() => commitTextDraft()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitTextDraft();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setTextDraft(null);
                      }
                    }}
                  />
                )}
                {handles.map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={`qx-region-picker-handle is-${handle}`}
                    aria-label={t("screencap.picker.resize", "Resize selection")}
                    onPointerDown={(event) => beginResize(event, handle)}
                  />
                ))}
              </>
            )}
          </div>
          {!recordingActive && countdown === null && (
            <div className="qx-region-picker-size" style={{ left: visibleRect.x, top: Math.max(8, visibleRect.y - 28) }}>
              {Math.round(visibleRect.w)} × {Math.round(visibleRect.h)}
            </div>
          )}
        </>
      )}

      {selection && !recordingActive && countdown === null && (
        <CaptureToolbar
          ref={toolbarRef}
          intent={intent}
          tool={tool}
          color={color}
          busy={busy}
          canUndo={annotations.length > 0}
          canRedo={redoStack.length > 0}
          settings={captureSettings}
          onToggleIntent={() => switchIntent(intent === "screenshot" ? "recording" : "screenshot")}
          onSelectRegion={() => switchPickMode("region")}
          onSelectFullscreen={selectFullScreen}
          onToolChange={setTool}
          onColorChange={setColor}
          onUndo={undo}
          onRedo={redo}
          onSettingsChange={updateCaptureSettings}
          onConfirm={() => void confirm(intent, selection)}
          onCancel={() => void cancel()}
          onToolbarPointerDown={onToolbarPointerDown}
          onToolbarPointerMove={onToolbarPointerMove}
          onToolbarPointerUp={onToolbarPointerUp}
          style={toolbarStyle}
        />
      )}

      {!rect && !busy && !recordingActive && countdown === null && (
        <div className="qx-region-picker-hint">
          {t(
            "screencap.picker.draw",
            "Drag on {display} · Ctrl/⌘+C copies · R last region · Esc cancel",
          ).replace("{display}", display)}
        </div>
      )}
      {selection && !tool && !recordingActive && countdown === null && (
        <div className="qx-region-picker-hint is-tool-hint">
          {t(
            "screencap.picker.selectionHint",
            "⌘/Ctrl+C copy & dismiss · Enter confirm · Esc clear",
          )}
        </div>
      )}
      {selection && tool && countdown === null && (
        <div className="qx-region-picker-hint is-tool-hint">
          {tool === "text"
            ? t("screencap.picker.textHint", "Click to place text; click existing text to edit or drag it to move")
            : tool === "arrow"
              ? t("screencap.picker.arrowHint", "Drag inside the selection to draw an arrow")
              : tool === "rect"
                ? t("screencap.picker.rectHint", "Drag inside the selection to draw a rectangle")
                : tool === "number"
                  ? t("screencap.picker.numberHint", "Click to place numbered step markers")
                  : tool === "mosaic"
                    ? t("screencap.picker.mosaicHint", "Paint mosaic over an area")
                    : t("screencap.picker.penHint", "Drag inside the selection to draw freehand")}
        </div>
      )}
      {countdown !== null && (
        <div className="qx-region-picker-countdown" aria-live="assertive">
          <strong>{countdown}</strong>
          <span>{t("screencap.picker.countdown", "Capturing… Esc to cancel")}</span>
        </div>
      )}
      {error && !recordingActive && countdown === null && (
        <div className="qx-region-picker-error">{error}</div>
      )}
    </div>
  );
}

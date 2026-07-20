import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShortcutBinding } from "../modules/settings/store";
import { formatQxShortcut, getQxDesktopPlatform } from "../utils/keyboard";

function isModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control" || key === "Shift" || key === "Alt" || key === "OS";
}

function normalizeKey(event: KeyboardEvent): string | null {
  const key = event.key;
  if (isModifierKey(key)) return null;
  if (key === "Tab" || key === "Enter" || key === "Escape") return null;
  if (key === "Unidentified" || key.length === 0) return null;
  // Space only valid with a non-shift modifier (e.g. Alt+Space launcher).
  if (key === " " || key === "Spacebar" || event.code === "Space") {
    if (event.metaKey || event.ctrlKey || event.altKey) return "Space";
    return null;
  }
  if (key.startsWith("Arrow")) return key;
  if (key === "Backspace" || key === "Delete") {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return key === "Backspace" ? "Backspace" : "Delete";
    }
    return null;
  }
  // Prefer event.code for letter/digit so layout variants stay stable (KeyA → A).
  if (event.code.startsWith("Key") && event.code.length === 4) {
    return event.code.slice(3).toUpperCase();
  }
  if (event.code.startsWith("Digit") && event.code.length === 6) {
    return event.code.slice(5);
  }
  if (key.length === 1) return key.toUpperCase();
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/** Live preview of modifiers currently held (no main key yet). */
function modifiersPreview(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string {
  const parts: string[] = [];
  const platform = getQxDesktopPlatform();
  if (event.metaKey) parts.push(platform === "macos" ? "⌘" : "Win");
  if (event.ctrlKey) parts.push(platform === "macos" ? "⌃" : "Ctrl");
  if (event.altKey) parts.push(platform === "macos" ? "⌥" : "Alt");
  if (event.shiftKey) parts.push(platform === "macos" ? "⇧" : "Shift");
  return parts.length > 0 ? `${parts.join("")}…` : "Press shortcut…";
}

/**
 * Build a process-global shortcut binding from a key event.
 * Supports chords like Alt+V, Cmd+Shift+A, Ctrl+Alt+K, F5.
 * Requires at least one of Cmd/Ctrl/Alt (or a function key) so bare letters
 * cannot be registered as system-wide hotkeys. Shift alone is not enough.
 */
export function eventToBinding(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event);
  if (!key) return null;

  const hasNonShiftMod = event.metaKey || event.ctrlKey || event.altKey;
  const isFunctionKey = /^F\d{1,2}$/i.test(key);
  if (!hasNonShiftMod && !isFunctionKey) return null;

  const parts: string[] = [];
  const platform = getQxDesktopPlatform();
  // Canonical portable form: CmdOrCtrl for primary, keep Ctrl/Alt/Shift explicit.
  if (event.metaKey) {
    parts.push(platform === "macos" ? "CmdOrCtrl" : "Cmd");
  }
  if (event.ctrlKey) {
    // On Windows, Ctrl is the primary modifier (CmdOrCtrl). On macOS, Ctrl is distinct.
    if (platform === "windows") {
      if (!event.metaKey) parts.push("CmdOrCtrl");
      else parts.push("Ctrl");
    } else {
      parts.push("Ctrl");
    }
  }
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return { key: parts.join("+"), enabled: true };
}

let shortcutRegistrationQueue: Promise<void> = Promise.resolve();

function queueShortcutRegistration(command: "shortcuts_pause_global" | "shortcuts_resume_global") {
  const next = shortcutRegistrationQueue.then(async () => {
    try {
      await invoke(command);
    } catch {
      // Best effort in browser/tests. Keep the queue alive so a later resume
      // cannot be skipped after one unavailable invoke.
    }
  });
  shortcutRegistrationQueue = next.catch(() => {});
  return next;
}

function pauseGlobalShortcuts() {
  return queueShortcutRegistration("shortcuts_pause_global");
}

function resumeGlobalShortcuts() {
  return queueShortcutRegistration("shortcuts_resume_global");
}

export default function ShortcutRecorder({
  initial,
  conflict,
  onCommit,
  onCancel,
}: {
  initial: string;
  conflict: boolean;
  onCommit: (binding: ShortcutBinding) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [heldPreview, setHeldPreview] = useState("Press shortcut…");
  const containerRef = useRef<HTMLDivElement>(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const recordingRef = useRef(false);
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  const stopRecording = (cancelled: boolean) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setHeldPreview("Press shortcut…");
    void resumeGlobalShortcuts();
    if (cancelled) onCancelRef.current();
  };

  const startRecording = () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setHeldPreview("Press shortcut…");
    setRecording(true);
    void pauseGlobalShortcuts();
    // Keep focus so key events land here even after OS blur races.
    window.requestAnimationFrame(() => containerRef.current?.querySelector("button")?.focus());
  };

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Capture phase: take the chord before shell/list handlers.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (event.key === "Escape") {
        stopRecording(true);
        return;
      }

      // Update live modifier preview (Cmd/Alt/Shift alone).
      if (isModifierKey(event.key) || !normalizeKey(event)) {
        setHeldPreview(modifiersPreview(event));
        return;
      }

      const binding = eventToBinding(event);
      if (binding) {
        // Commit full chord (e.g. Alt+Shift+G, Cmd+K).
        recordingRef.current = false;
        setRecording(false);
        setHeldPreview("Press shortcut…");
        void resumeGlobalShortcuts().finally(() => {
          onCommitRef.current(binding);
        });
      } else {
        setHeldPreview(modifiersPreview(event));
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!recordingRef.current) return;
      if (isModifierKey(event.key)) {
        setHeldPreview(modifiersPreview(event));
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !containerRef.current?.contains(target)) {
        stopRecording(true);
      }
    };

    // Cancel only when the whole WebView loses focus. A child button blur is
    // not sufficient on Windows because pressing Alt can move DOM focus while
    // the user is still entering a valid global chord.
    const onWindowBlur = () => stopRecording(true);

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
      // If unmounted mid-record (navigate away), restore hotkeys.
      if (recordingRef.current) {
        recordingRef.current = false;
        void resumeGlobalShortcuts();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  return (
    <div
      ref={containerRef}
      className="qx-shortcut-recorder"
      data-qx-search-focus="preserve"
      data-qx-shortcut-recording={recording ? "true" : undefined}
    >
      <button
        type="button"
        className={`qx-shortcut-recorder-button${recording ? " is-recording" : ""}${conflict ? " has-conflict" : ""}`}
        onClick={() => {
          if (recording) return;
          startRecording();
        }}
      >
        {recording ? heldPreview : formatQxShortcut(initial) || "None"}
      </button>
      {recording && (
        <button
          type="button"
          className="qx-shortcut-recorder-cancel"
          onMouseDown={(event) => {
            event.preventDefault();
            stopRecording(true);
          }}
          title="Cancel (Esc)"
        >
          x
        </button>
      )}
    </div>
  );
}

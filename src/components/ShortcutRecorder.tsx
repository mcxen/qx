import { useEffect, useRef, useState } from "react";
import type { ShortcutBinding } from "../modules/settings/store";
import { formatQxShortcut, getQxDesktopPlatform } from "../utils/keyboard";

function normalizeKey(event: KeyboardEvent): string | null {
  const key = event.key;
  if (key === "Meta" || key === "Control" || key === "Shift" || key === "Alt") return null;
  if (key === "Tab" || key === "Enter" || key === "Escape") return null;
  if (key === "Unidentified" || key.length === 0) return null;
  // Space is only valid with a modifier (e.g. Alt+Space launcher). Bare Space is not.
  if (key === " " || key === "Spacebar") {
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
  if (key.length === 1) return key.toUpperCase();
  // Function keys etc.
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/**
 * Build a process-global shortcut binding from a key event.
 * Requires at least one of Cmd/Ctrl/Alt (or a function key) so bare letters
 * cannot be registered as system-wide hotkeys.
 */
export function eventToBinding(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event);
  if (!key) return null;

  const hasNonShiftMod = event.metaKey || event.ctrlKey || event.altKey;
  const isFunctionKey = /^F\d{1,2}$/i.test(key);
  if (!hasNonShiftMod && !isFunctionKey) return null;

  const parts: string[] = [];
  if (event.metaKey) parts.push(getQxDesktopPlatform() === "macos" ? "CmdOrCtrl" : "Cmd");
  if (event.ctrlKey) parts.push(getQxDesktopPlatform() === "windows" ? "CmdOrCtrl" : "Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return { key: parts.join("+"), enabled: true };
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
  const [draft, setDraft] = useState<ShortcutBinding | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  onCommitRef.current = onCommit;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        onCancelRef.current();
        return;
      }
      const binding = eventToBinding(event);
      if (binding) {
        setDraft(binding);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  useEffect(() => {
    if (!draft) return;
    onCommitRef.current(draft);
  }, [draft]);

  return (
    <div ref={containerRef} className="qx-shortcut-recorder">
      <button
        type="button"
        className={`qx-shortcut-recorder-button${recording ? " is-recording" : ""}${conflict ? " has-conflict" : ""}`}
        onClick={() => {
          setDraft(null);
          setRecording(true);
        }}
        onBlur={() => {
          if (recording) setRecording(false);
        }}
      >
        {recording ? "Press shortcut..." : (formatQxShortcut(initial) || "None")}
      </button>
      {recording && (
        <button
          type="button"
          className="qx-shortcut-recorder-cancel"
          onMouseDown={(event) => {
            event.preventDefault();
            setRecording(false);
            onCancel();
          }}
          title="Cancel (Esc)"
        >
          x
        </button>
      )}
    </div>
  );
}

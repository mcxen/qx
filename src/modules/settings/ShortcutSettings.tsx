import { useEffect, useRef, useState } from "react";
import {
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  useSettingsStore,
  type ShortcutBinding,
} from "./store";
import { LinkButton } from "../../components/ui";

function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Meta" || k === "Control" || k === "Shift" || k === "Alt") return null;
  if (k === "Tab" || k === "Enter" || k === " " || k === "Spacebar") return null;
  if (k === "Unidentified" || k.length === 0) return null;
  if (k.startsWith("Arrow")) return k;
  if (k === "Escape") return null;
  if (k === "Backspace" || k === "Delete") return null;
  if (k.length === 1) return k.toUpperCase();
  return k;
}

function eventToBinding(e: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push("Cmd");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return { key: parts.join("+"), enabled: true };
}

function ShortcutRecorder({
  initial,
  conflict,
  onCommit,
  onCancel,
}: {
  initial: string;
  conflict: boolean;
  onCommit: (b: ShortcutBinding) => void;
  onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<ShortcutBinding | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      const b = eventToBinding(e);
      if (b) {
        setDraft(b);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onCancel]);

  useEffect(() => {
    if (!draft) return;
    onCommit(draft);
  }, [draft, onCommit]);

  return (
    <div ref={containerRef} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={() => {
          setDraft(null);
          setRecording(true);
        }}
        onBlur={() => {
          if (recording) {
            setRecording(false);
          }
        }}
        style={{
          height: 26,
          padding: "0 10px",
          border: conflict
            ? "1px solid rgba(220,38,38,0.4)"
            : "1px solid var(--color-border)",
          borderRadius: 6,
          background: recording ? "var(--color-accent-soft)" : "var(--color-surface)",
          color: conflict
            ? "#dc2626"
            : recording
              ? "var(--color-accent-hover)"
              : "var(--color-text-primary)",
          fontSize: 12,
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
          cursor: "pointer",
          minWidth: 96,
          justifyContent: "center",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {recording ? "Press shortcut…" : (initial || "None")}
      </button>
      {recording && (
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            onCancel();
          }}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--color-text-tertiary)",
            cursor: "pointer",
            fontSize: 13,
            padding: 0,
          }}
          title="Cancel (Esc)"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function ShortcutSettings() {
  const { settings, patchShortcut } = useSettingsStore();
  const shortcuts = settings.shortcuts;

  const conflictMap: Record<string, boolean> = {};
  const counts: Record<string, number> = {};
  Object.entries(shortcuts).forEach(([_, b]) => {
    if (b.enabled && b.key) {
      counts[b.key] = (counts[b.key] || 0) + 1;
    }
  });
  Object.entries(shortcuts).forEach(([_, b]) => {
    if (b.enabled && b.key && counts[b.key] > 1) conflictMap[b.key] = true;
  });

  return (
    <div className="qx-settings-page">
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.group} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: "var(--color-text-tertiary)",
              textTransform: "uppercase",
              padding: "8px 0 4px",
            }}
          >
            {group.group}
          </div>
          {group.ids.map((id) => {
            const binding = shortcuts[id];
            const label = SHORTCUT_LABELS[id] ?? id;
            const conflict = binding ? !!conflictMap[binding.key] : false;
            return (
              <div
                key={id}
                className="qx-settings-row"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {label}
                  </div>
                  {conflict && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>
                      Conflict: this shortcut is used by another action.
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => patchShortcut(id, { enabled: !binding?.enabled })}
                    className="qx-command-button"
                    style={{ height: 26, color: binding?.enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                    title="Toggle enabled"
                  >
                    {binding?.enabled ? "On" : "Off"}
                  </button>
                  <ShortcutRecorder
                    initial={binding?.key ?? ""}
                    conflict={conflict}
                    onCommit={(b) => patchShortcut(id, b)}
                    onCancel={() => {}}
                  />
                  <LinkButton
                    onClick={() => {
                      const defaults: Record<string, string> = {
                        toggle_launcher: "Alt+Space",
                        clipboard: "Alt+V",
                        record_gif: "Alt+G",
                        rss: "Alt+R",
                        settings: "Cmd+,",
                      };
                      patchShortcut(id, {
                        key: defaults[id] ?? "",
                        enabled: true,
                      });
                    }}
                    title="Reset to default"
                  >
                    ↺
                  </LinkButton>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

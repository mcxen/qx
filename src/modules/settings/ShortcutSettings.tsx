import {
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  useSettingsStore,
} from "./store";
import { LinkButton } from "../../components/ui";
import ShortcutRecorder from "../../components/ShortcutRecorder";

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

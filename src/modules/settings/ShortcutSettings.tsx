import {
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  useSettingsStore,
} from "./store";
import { LinkButton } from "../../components/ui";
import ShortcutRecorder from "../../components/ShortcutRecorder";
import {
  countEnabledGlobalShortcuts,
  globalShortcutIssue,
} from "../../utils/keyboard";

const DEFAULT_GLOBAL_KEYS: Record<string, string> = {
  toggle_launcher: "Alt+Space",
  clipboard: "Alt+V",
  record_gif: "Alt+G",
  rss: "Alt+R",
};

export default function ShortcutSettings() {
  const { settings, patchShortcut } = useSettingsStore();
  const shortcuts = settings.shortcuts;
  const counts = countEnabledGlobalShortcuts(shortcuts, settings.app_shortcuts);

  return (
    <div className="qx-settings-page">
      <div className="qx-settings-hint" style={{ marginBottom: 12, fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45 }}>
        Global shortcuts are registered with the OS and work even when Qx is in the background.
        Only <strong>Toggle Launcher</strong> is on by default. Module shortcuts (clipboard, RSS, GIF)
        stay off until you enable them — they must not steal system keys like ⌘Space / Alt+Space.
      </div>
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
            const issue = globalShortcutIssue(binding, counts);
            return (
              <div
                key={id}
                className="qx-settings-row"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {label}
                  </div>
                  {issue && (
                    <div style={{ fontSize: 11, color: "var(--qx-danger)", marginTop: 2 }}>
                      {issue}
                    </div>
                  )}
                  {id === "toggle_launcher" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      全局切换：再按一次打开/隐藏主窗口。
                    </div>
                  )}
                  {id !== "toggle_launcher" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      全局切换：打开该模块；在同一模块上再按一次隐藏窗口。
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
                    conflict={Boolean(issue)}
                    onCommit={(b) => patchShortcut(id, b)}
                    onCancel={() => {}}
                  />
                  <LinkButton
                    onClick={() => {
                      patchShortcut(id, {
                        key: DEFAULT_GLOBAL_KEYS[id] ?? "",
                        // Only launcher is forced on by reset; modules stay user-chosen.
                        enabled: id === "toggle_launcher" ? true : (binding?.enabled ?? false),
                      });
                    }}
                    title="Reset to default key"
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

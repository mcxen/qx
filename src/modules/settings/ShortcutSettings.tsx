import {
  SHORTCUT_GROUPS,
  SHORTCUT_LABELS,
  useSettingsStore,
} from "./store";
import { LinkButton } from "../../components/ui";
import ShortcutRecorder from "../../components/ShortcutRecorder";
import { useT } from "../../i18n";
import {
  countEnabledGlobalShortcuts,
  globalShortcutIssue,
} from "../../utils/keyboard";

const DEFAULT_GLOBAL_KEYS: Record<string, string> = {
  toggle_launcher: "Alt+Space",
  toggle_window: "Alt+Shift+Space",
  clipboard: "Alt+V",
  record_gif: "Alt+G",
  rss: "Alt+R",
};

export default function ShortcutSettings() {
  const t = useT();
  const { settings, patchShortcut } = useSettingsStore();
  const shortcuts = settings.shortcuts;
  const counts = countEnabledGlobalShortcuts(shortcuts, settings.app_shortcuts);

  return (
    <div className="qx-settings-page">
      <div className="qx-settings-hint" style={{ marginBottom: 12, fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45 }}>
        {t(
          "shortcuts.hint",
          "Global shortcuts work while Qx is in the background. Launcher Search is enabled by default; Current Window and module shortcuts remain off until you enable them.",
        )}
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
            {t(`shortcuts.group.${group.group}`, group.group)}
          </div>
          {group.ids.map((id) => {
            const binding = shortcuts[id];
            const label = t(`shortcuts.label.${id}`, SHORTCUT_LABELS[id] ?? id);
            const issueCode = globalShortcutIssue(binding, counts);
            const issue = issueCode
              ? t(
                `shortcuts.issue.${issueCode}`,
                issueCode === "reserved"
                  ? "Reserved by the operating system (for example Cmd/Ctrl+Space)."
                  : issueCode === "invalid"
                    ? "Invalid shortcut."
                    : "This shortcut is already used by another global action.",
              )
              : null;
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
                      {t("shortcuts.desc.toggle_launcher", "Show Qx on Launcher and focus search; never hide the window.")}
                    </div>
                  )}
                  {id === "toggle_window" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.toggle_window", "Show or hide Qx while preserving the current module and view.")}
                    </div>
                  )}
                  {id !== "toggle_launcher" && id !== "toggle_window" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.module", "Open this module; press again on the same module to hide Qx.")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => patchShortcut(id, { enabled: !binding?.enabled })}
                    className="qx-command-button"
                    style={{ height: 26, color: binding?.enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                    title={t("shortcuts.toggleEnabled", "Toggle enabled")}
                  >
                    {binding?.enabled ? t("shortcuts.on", "On") : t("shortcuts.off", "Off")}
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
                    title={t("shortcuts.reset", "Reset to default key")}
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

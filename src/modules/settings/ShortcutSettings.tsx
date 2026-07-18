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
  formatQxShortcut,
  globalShortcutIssue,
} from "../../utils/keyboard";

const DEFAULT_GLOBAL_KEYS: Record<string, string> = {
  toggle_launcher: "Alt+Shift+Space",
  toggle_window: "Alt+Space",
  clipboard: "Alt+V",
  record_gif: "Alt+G",
  capture_screenshot: "Alt+Shift+S",
  toggle_capture_controls: "Alt+Shift+C",
  rss: "Alt+R",
  tray_open_main: "Alt+Shift+O",
  tray_keep_visible: "Alt+Shift+K",
  tray_settings: "Alt+Shift+,",
  tray_hide_main: "Alt+Shift+H",
  tray_status_memory: "",
  tray_status_network: "",
  tray_status_cpu: "",
};

function appShortcutLabel(id: string): string {
  if (id.startsWith("app:")) {
    const path = id.slice("app:".length);
    const leaf = path.split(/[\\/]/).pop() || path;
    return leaf.replace(/\.app$/i, "");
  }
  return id;
}

export default function ShortcutSettings() {
  const t = useT();
  const { settings, patchShortcut, patchAppShortcut } = useSettingsStore();
  const shortcuts = settings.shortcuts;
  const counts = countEnabledGlobalShortcuts(shortcuts, settings.app_shortcuts);
  const appShortcutEntries = Object.entries(settings.app_shortcuts)
    .filter(([, binding]) => Boolean(binding?.key?.trim()))
    .sort(([a], [b]) => appShortcutLabel(a).localeCompare(appShortcutLabel(b)));

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
                      {t("shortcuts.desc.toggle_launcher", "Show Qx on Launcher and focus search; press again to hide.")}
                    </div>
                  )}
                  {id === "toggle_window" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.toggle_window", "Show or hide Qx while preserving the current module and view.")}
                    </div>
                  )}
                  {(id === "capture_screenshot" || id === "record_gif") && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.capture", "Start area selection immediately on the display under the pointer.")}
                    </div>
                  )}
                  {id === "toggle_capture_controls" && !issue && (
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                      {t("shortcuts.desc.captureIsland", "Show or hide the floating screenshot and recording toolbar.")}
                    </div>
                  )}
                  {id !== "toggle_launcher" && id !== "toggle_window" && id !== "capture_screenshot" && id !== "record_gif" && id !== "toggle_capture_controls" && !issue && (
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
                        // Primary window toggle is forced on by reset; modules stay user-chosen.
                        enabled: id === "toggle_window" ? true : (binding?.enabled ?? false),
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

      <div style={{ marginBottom: 16 }}>
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
          {t("shortcuts.group.apps", "Applications")}
        </div>
        {appShortcutEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", lineHeight: 1.45, padding: "4px 0 8px" }}>
            {t(
              "shortcuts.apps.empty",
              "Right-click an app in the launcher and choose Record shortcut to launch it from anywhere.",
            )}
          </div>
        ) : (
          appShortcutEntries.map(([id, binding]) => {
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
              <div key={id} className="qx-settings-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {appShortcutLabel(id)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    {t("shortcuts.desc.app", "Global shortcut to launch this application.")}
                    {binding.key ? ` · ${formatQxShortcut(binding.key)}` : ""}
                  </div>
                  {issue && (
                    <div style={{ fontSize: 11, color: "var(--qx-danger)", marginTop: 2 }}>
                      {issue}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => patchAppShortcut(id, { enabled: !binding.enabled })}
                    className="qx-command-button"
                    style={{ height: 26, color: binding.enabled ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                    title={t("shortcuts.toggleEnabled", "Toggle enabled")}
                  >
                    {binding.enabled ? t("shortcuts.on", "On") : t("shortcuts.off", "Off")}
                  </button>
                  <ShortcutRecorder
                    initial={binding.key ?? ""}
                    conflict={Boolean(issue)}
                    onCommit={(b) =>
                      patchAppShortcut(id, {
                        ...b,
                        enabled: b.key.trim() ? (b.enabled ?? true) : false,
                      })
                    }
                    onCancel={() => {}}
                  />
                  <LinkButton
                    onClick={() => patchAppShortcut(id, { key: "", enabled: false })}
                    title={t("launcher.removeShortcut", "Remove shortcut")}
                  >
                    ×
                  </LinkButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

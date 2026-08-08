import { useSettingsStore } from "./store";
import { Row, Toggle, Select, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

/**
 * General — only app-wide daily prefs (UI_SPEC: compact native density).
 * Search sources → Appearance · Tray / data / reset → Advanced.
 */
export default function GeneralSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const g = settings.general;

  return (
    <div className="qx-settings-page">
      <SettingsCard title={t("general.startup.title", "Startup & Behavior")}>
        <Row
          title={t("general.launchAtLogin", "Launch at Login")}
          description={t("general.launchAtLogin.desc", "Open Qx automatically when you log in.")}
        >
          <Toggle
            value={g.launch_at_login}
            onChange={(v) => patch("general", { ...g, launch_at_login: v })}
          />
        </Row>
        <Row
          title={t("general.language", "Language")}
          description={t(
            "general.language.desc",
            "UI language. System uses Chinese only when the OS is Simplified Chinese; otherwise English.",
          )}
        >
          <Select
            value={
              g.language === "en" || g.language === "zh-CN" || g.language === "system"
                ? g.language
                : "system"
            }
            onChange={(v) => patch("general", { ...g, language: v })}
            options={[
              { value: "system", label: t("general.language.system", "System") },
              { value: "en", label: t("general.language.en", "English") },
              { value: "zh-CN", label: t("general.language.zh-CN", "简体中文") },
            ]}
          />
        </Row>
        <Row
          title={t("general.autoUpdates", "Automatic Updates")}
          description={t(
            "general.autoUpdates.desc",
            "Off by default. When enabled, Qx checks for and installs updates automatically. Pick the update source and run a manual check under About. On Windows a failed update can quit the app — prefer manual update from About if installs are unreliable.",
          )}
        >
          <Toggle
            value={g.auto_update}
            onChange={(v) => patch("general", { ...g, auto_update: v })}
          />
        </Row>
      </SettingsCard>
    </div>
  );
}

import { useSettingsStore } from "./store";
import { Row, Toggle, Select } from "../../components/ui";
import { useT } from "../../i18n";

export default function GeneralSettings() {
  const { settings, patch, reset } = useSettingsStore();
  const t = useT();
  const g = settings.general;

  return (
    <div className="qx-settings-page">
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
        description={t("general.language.desc", "Interface language.")}
      >
        <Select
          value={g.language}
          onChange={(v) => patch("general", { ...g, language: v })}
          options={[
            { value: "en", label: "English" },
            { value: "zh-CN", label: "简体中文" },
          ]}
        />
      </Row>
      <Row
        title={t("general.autoUpdates", "Automatic Updates")}
        description={t("general.autoUpdates.desc", "Check for and install updates automatically.")}
      >
        <Toggle
          value={g.auto_update}
          onChange={(v) => patch("general", { ...g, auto_update: v })}
        />
      </Row>
      <Row
        title={t("general.autoHideOnBlur", "Auto-hide on Blur")}
        description={t("general.autoHideOnBlur.desc", "Hide launcher-style views when Qx loses focus.")}
      >
        <Toggle
          value={g.autoHideOnBlur}
          onChange={(v) => patch("general", { ...g, autoHideOnBlur: v })}
        />
      </Row>
      <Row
        title={t("general.dataPath", "Data Path")}
        description={t("general.dataPath.desc", "Where Qx stores databases, recordings and history.")}
      >
        <input
          type="text"
          value={g.data_path}
          onChange={(e) => patch("general", { ...g, data_path: e.target.value })}
          style={{ width: 280 }}
          className="qx-inline-input"
        />
      </Row>
      <Row
        title={t("general.reset", "Reset All Settings")}
        description={t("general.reset.desc", "Restore shortcuts, appearance and preferences to defaults.")}
      >
        <button onClick={() => void reset()} className="qx-command-button">
          {t("general.reset.button", "Reset")}
        </button>
      </Row>
    </div>
  );
}

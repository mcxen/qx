import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useSettingsStore } from "./store";
import { Input, Row, Toggle, Select, SettingsCard, Button } from "../../components/ui";
import { useT } from "../../i18n";
import {
  TRAY_ACTION_TYPES,
  DEFAULT_TRAY_ACTIONS,
  sanitizeTrayActions,
  createTrayAction,
} from "./trayActions";

export default function GeneralSettings() {
  const { settings, patch, reset } = useSettingsStore();
  const t = useT();
  const g = settings.general;
  const trayActions = sanitizeTrayActions(settings.tray_actions);
  const [addAction, setAddAction] = useState<string>(TRAY_ACTION_TYPES[0].value);

  const patchTrayActions = (actions: typeof trayActions) => patch("tray_actions", actions);
  const updateAction = (id: string, changes: Partial<(typeof trayActions)[number]>) => {
    patchTrayActions(trayActions.map((a) => (a.id === id ? { ...a, ...changes } : a)));
  };
  const removeAction = (id: string) => {
    patchTrayActions(trayActions.filter((a) => a.id !== id));
  };
  const availableToAdd = TRAY_ACTION_TYPES.filter(
    (type) => !trayActions.some((a) => a.id === type.value),
  );

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("general.startup.title", "Startup & Behavior")}
        description={t("general.startup.desc", "Control how Qx starts, hides, and presents the interface.")}
      >
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
          title={t("general.autoHideOnBlur", "Auto-hide on Blur")}
          description={t("general.autoHideOnBlur.desc", "Hide launcher-style views when Qx loses focus.")}
        >
          <Toggle
            value={g.autoHideOnBlur}
            onChange={(v) => patch("general", { ...g, autoHideOnBlur: v })}
          />
        </Row>
        <Row
          title={t("general.language", "Language")}
          description={t(
            "general.language.desc",
            "Interface language. System follows the OS: Simplified Chinese systems use Chinese; all others use English.",
          )}
        >
          <Select
            value={g.language === "en" || g.language === "zh-CN" || g.language === "system" ? g.language : "system"}
            onChange={(v) => patch("general", { ...g, language: v })}
            options={[
              { value: "system", label: t("general.language.system", "System") },
              { value: "en", label: t("general.language.en", "English") },
              { value: "zh-CN", label: t("general.language.zh-CN", "简体中文") },
            ]}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("general.storageUpdates.title", "Updates & Data")}
        description={t("general.storageUpdates.desc", "Choose update behavior and where local Qx data is stored.")}
      >
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
          title={t("general.dataPath", "Data Path")}
          description={t("general.dataPath.desc", "Where Qx stores databases, recordings and history.")}
        >
          <div className="qx-settings-input-wrap">
            <Input
              type="text"
              value={g.data_path}
              onChange={(e) => patch("general", { ...g, data_path: e.target.value })}
            />
          </div>
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("general.trayMenu", "Tray Menu")}
        description={t("general.trayMenu.desc", "Customize the items shown in the system tray menu.")}
      >
        <div className="qx-tray-action-editor">
          {trayActions.map((action) => (
            <div className="qx-tray-action-edit-row" key={action.id}>
              <div className="qx-tray-action-edit-fields">
                <Input
                  value={action.title}
                  aria-label={t("general.trayMenu.title", "Action title")}
                  onChange={(e) => updateAction(action.id, { title: e.target.value })}
                />
                <span className="qx-tray-action-edit-id">{action.id}</span>
              </div>
              <div className="qx-tray-action-edit-actions">
                <Toggle
                  value={action.enabled}
                  onChange={(v) => updateAction(action.id, { enabled: v })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeAction(action.id)}
                  title={t("general.trayMenu.remove", "Remove")}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
          <div className="qx-tray-action-editor-footer">
            {availableToAdd.length > 0 && (
              <>
                <Select
                  value={addAction}
                  onChange={setAddAction}
                  options={availableToAdd.map((type) => ({
                    value: type.value,
                    label: type.label,
                  }))}
                  ariaLabel={t("general.trayMenu.addAction", "Add action")}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    patchTrayActions([...trayActions, createTrayAction(addAction)]);
                    const next = availableToAdd.filter((a) => a.value !== addAction);
                    if (next.length > 0) setAddAction(next[0].value);
                  }}
                >
                  <Plus size={14} />
                  {t("general.trayMenu.add", "Add")}
                </Button>
              </>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => patchTrayActions(DEFAULT_TRAY_ACTIONS)}
            >
              <RotateCcw size={14} />
              {t("general.trayMenu.reset", "Reset")}
            </Button>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("general.reset", "Reset All Settings")}
        description={t("general.reset.desc", "Restore shortcuts, appearance and preferences to defaults.")}
      >
        <Row
          title={t("general.reset.button", "Reset")}
          description={t("general.reset.confirm.desc", "Use this when settings feel inconsistent or you want a clean default layout.")}
        >
          <Button type="button" variant="destructive" size="sm" onClick={() => void reset()}>
            {t("general.reset.button", "Reset")}
          </Button>
        </Row>
      </SettingsCard>
    </div>
  );
}

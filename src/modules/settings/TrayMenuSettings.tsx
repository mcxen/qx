import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input, Select, SettingsCard, Toggle } from "../../components/ui";
import { useT } from "../../i18n";
import { useSettingsStore } from "./store";
import {
  createTrayAction,
  DEFAULT_TRAY_ACTIONS,
  sanitizeTrayActions,
  TRAY_ACTION_TYPES,
} from "./trayActions";

/**
 * Built-in tray composition belongs with global shortcuts: both apply while
 * the window is hidden. Plugin contributions remain runtime-owned.
 */
export default function TrayMenuSettings() {
  const t = useT();
  const { settings, patch } = useSettingsStore();
  const trayActions = sanitizeTrayActions(settings.tray_actions);
  const [addAction, setAddAction] = useState<string>(TRAY_ACTION_TYPES[0].value);
  const patchTrayActions = (actions: typeof trayActions) => patch("tray_actions", actions);
  const updateAction = (id: string, changes: Partial<(typeof trayActions)[number]>) => {
    patchTrayActions(trayActions.map((action) => (action.id === id ? { ...action, ...changes } : action)));
  };
  const availableToAdd = TRAY_ACTION_TYPES.filter(
    (type) => !trayActions.some((action) => action.id === type.value),
  );

  return (
    <SettingsCard title={t("shortcuts.trayMenu", "Tray Menu")}>
      <p className="qx-settings-section-desc" style={{ margin: "0 0 8px" }}>
        {t(
          "shortcuts.trayMenu.hint",
          "Choose the built-in rows shown while Qx is in the background. Plugins with tray permission can add grouped status and actions of their own.",
        )}
      </p>
      <div className="qx-tray-action-editor">
        {trayActions.map((action) => (
          <div className="qx-tray-action-edit-row" key={action.id}>
            <div className="qx-tray-action-edit-fields">
              <Input
                value={action.title}
                aria-label={t("shortcuts.trayMenu.title", "Action title")}
                onChange={(event) => updateAction(action.id, { title: event.target.value })}
              />
              <span className="qx-tray-action-edit-id">{action.id}</span>
            </div>
            <div className="qx-tray-action-edit-actions">
              <Toggle value={action.enabled} onChange={(enabled) => updateAction(action.id, { enabled })} />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => patchTrayActions(trayActions.filter((item) => item.id !== action.id))}
                title={t("shortcuts.trayMenu.remove", "Remove")}
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
                options={availableToAdd.map((type) => ({ value: type.value, label: type.label }))}
                ariaLabel={t("shortcuts.trayMenu.addAction", "Add action")}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  patchTrayActions([...trayActions, createTrayAction(addAction)]);
                  const next = availableToAdd.find((type) => type.value !== addAction);
                  if (next) setAddAction(next.value);
                }}
              >
                <Plus size={14} />
                {t("shortcuts.trayMenu.add", "Add")}
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
            {t("shortcuts.trayMenu.reset", "Reset")}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

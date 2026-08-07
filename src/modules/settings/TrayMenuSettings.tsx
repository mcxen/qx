import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input, Select, SettingsCard, Toggle } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { usePluginRegistry } from "../../plugin/registry";
import { resolveSurfaceProviders } from "../../plugin/surfaceProviders";
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
  const locale = useLocale();
  const { settings, patch } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
  const trayActions = sanitizeTrayActions(settings.tray_actions);
  const declaredProviders = resolveSurfaceProviders(plugins, "tray", locale);
  const configuredProviders = settings.tray_providers;
  const configuredKeys = new Set(configuredProviders.map((provider) => provider.id));
  const trayProviders = [
    ...configuredProviders.filter((config) => declaredProviders.some((provider) => provider.key === config.id)),
    ...declaredProviders
      .filter((provider) => !configuredKeys.has(provider.key))
      .map((provider) => ({ id: provider.key, enabled: provider.declaration.defaultEnabled === true })),
  ];
  const [addAction, setAddAction] = useState<string>(TRAY_ACTION_TYPES[0].value);
  const patchTrayActions = (actions: typeof trayActions) => patch("tray_actions", actions);
  const updateAction = (id: string, changes: Partial<(typeof trayActions)[number]>) => {
    patchTrayActions(trayActions.map((action) => (action.id === id ? { ...action, ...changes } : action)));
  };
  const move = <T,>(items: T[], index: number, delta: number): T[] => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
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
        {trayActions.map((action, index) => (
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
              <Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => patchTrayActions(move(trayActions, index, -1))} title={t("shortcuts.trayMenu.moveUp", "Move up")}><ArrowUp size={14} /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={index === trayActions.length - 1} onClick={() => patchTrayActions(move(trayActions, index, 1))} title={t("shortcuts.trayMenu.moveDown", "Move down")}><ArrowDown size={14} /></Button>
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
        {declaredProviders.length > 0 && (
          <div className="qx-tray-provider-section">
            <div className="qx-tray-provider-heading">{t("shortcuts.trayMenu.providers", "Tray Controls")}</div>
            {trayProviders.map((config, index) => {
              const provider = declaredProviders.find((item) => item.key === config.id);
              if (!provider) return null;
              return (
                <div className="qx-tray-action-edit-row" key={config.id}>
                  <div className="qx-tray-action-edit-fields">
                    <strong>{provider.title}</strong>
                    <span className="qx-tray-action-edit-id">{provider.declaration.source}</span>
                  </div>
                  <div className="qx-tray-action-edit-actions">
                    <Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => patch("tray_providers", move(trayProviders, index, -1))} title={t("shortcuts.trayMenu.moveUp", "Move up")}><ArrowUp size={14} /></Button>
                    <Button type="button" size="icon" variant="ghost" disabled={index === trayProviders.length - 1} onClick={() => patch("tray_providers", move(trayProviders, index, 1))} title={t("shortcuts.trayMenu.moveDown", "Move down")}><ArrowDown size={14} /></Button>
                    <Toggle value={config.enabled} onChange={(enabled) => patch("tray_providers", trayProviders.map((item) => item.id === config.id ? { ...item, enabled } : item))} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="qx-tray-action-editor-footer">
          {availableToAdd.length > 0 && (
            <>
              <Select
                value={addAction}
                onChange={setAddAction}
                options={availableToAdd.map((type) => ({
                  value: type.value,
                  label: t(type.labelKey, type.label),
                }))}
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

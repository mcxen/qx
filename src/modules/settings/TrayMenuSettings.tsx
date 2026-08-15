import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AppWindow,
  Boxes,
  Command,
  Cpu,
  EyeOff,
  GripVertical,
  MemoryStick,
  Network,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SettingsCard,
} from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import {
  localizePluginCommandTitle,
  localizePluginName,
} from "../../plugin/pluginLabels";
import { usePluginRegistry } from "../../plugin/registry";
import { resolveSurfaceProviders } from "../../plugin/surfaceProviders";
import { useSettingsStore, type TrayActionConfig } from "./store";
import {
  createTrayAction,
  DEFAULT_TRAY_ACTIONS,
  isTrayStatusAction,
  sanitizeTrayActions,
  TRAY_ACTION_TYPES,
} from "./trayActions";

type DragGroup = "actions" | "providers";
type DragState = { group: DragGroup; id: string };

type TrayCandidate = {
  action: TrayActionConfig;
  category: "builtin" | "module" | "plugin-command";
  subtitle: string;
};

const actionIcons = {
  status_memory: MemoryStick,
  status_cpu: Cpu,
  status_network: Network,
  open_main: AppWindow,
  keep_visible: Pin,
  settings: Settings,
  hide_main: EyeOff,
} as const;

function reorderById<T extends { id: string }>(items: T[], sourceId: string, targetId: string | null): T[] {
  if (!targetId || sourceId === targetId) return items;
  const from = items.findIndex((item) => item.id === sourceId);
  const to = items.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(next.findIndex((item) => item.id === targetId), 0, moved);
  return next;
}

/** The selected list is the tray: add shows, remove hides, and order is presentation order. */
export default function TrayMenuSettings() {
  const t = useT();
  const locale = useLocale();
  const { settings, patch } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
  const commands = usePluginRegistry((state) => state.commands);
  const panels = usePluginRegistry((state) => state.panels);
  const trayActions = useMemo(
    () => sanitizeTrayActions(settings.tray_actions),
    [settings.tray_actions],
  );
  const declaredProviders = useMemo(
    () => resolveSurfaceProviders(plugins, "tray", locale),
    [plugins, locale],
  );
  const configuredProviders = settings.tray_providers;
  const providerConfig = new Map(configuredProviders.map((provider) => [provider.id, provider]));
  const configuredProviderKeys = new Set(configuredProviders.map((provider) => provider.id));
  const orderedProviders = [
    ...configuredProviders
      .map((config) => declaredProviders.find((provider) => provider.key === config.id))
      .filter((provider): provider is (typeof declaredProviders)[number] => Boolean(provider)),
    ...declaredProviders.filter((provider) => !configuredProviderKeys.has(provider.key)),
  ];
  const selectedProviders = orderedProviders.filter((provider) => (
    providerConfig.get(provider.key)?.enabled ?? provider.declaration.defaultEnabled === true
  ));

  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addProvider, setAddProvider] = useState<string>("");
  const [dragged, setDragged] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const availableActions = useMemo<TrayCandidate[]>(() => {
    const selected = new Set(trayActions.map((action) => action.id));
    const builtinCandidates = TRAY_ACTION_TYPES
      .filter((type) => !selected.has(type.value))
      .map((type) => ({
        action: createTrayAction(type.value),
        category: "builtin" as const,
        subtitle: t("general.trayMenu.builtinAction", "Tray action"),
      }));
    const moduleCandidates = Object.values(panels).flatMap((panel) => {
      const target = panel.pluginId.startsWith("builtin:")
        ? panel.pluginId.slice("builtin:".length)
        : `plugin:${panel.pluginId}`;
      const id = `module:${target}`;
      if (!target || selected.has(id)) return [];
      const plugin = plugins.find((item) => item.id === panel.pluginId);
      const title = plugin
        ? localizePluginName(plugin, t, locale)
        : panel.title || panel.pluginName;
      return [{
        action: { id, title, enabled: true, kind: "module" as const, target },
        category: "module" as const,
        subtitle: t("general.trayMenu.module", "Module"),
      }];
    });
    const commandCandidates = commands.flatMap((command) => {
      const id = `command:${command.pluginId}:${command.name}`;
      if (selected.has(id)) return [];
      const plugin = plugins.find((item) => item.id === command.pluginId);
      const title = plugin
        ? localizePluginCommandTitle(plugin, command, t, locale)
        : command.title || command.name;
      return [{
        action: {
          id,
          title,
          enabled: true,
          kind: "plugin-command" as const,
          plugin_id: command.pluginId,
          command: command.name,
        },
        category: "plugin-command" as const,
        subtitle: plugin
          ? localizePluginName(plugin, t, locale)
          : command.pluginName,
      }];
    });
    return [...builtinCandidates, ...moduleCandidates, ...commandCandidates];
  }, [commands, locale, panels, plugins, t, trayActions]);
  const filteredActions = useMemo(() => {
    const query = addQuery.trim().toLocaleLowerCase(locale);
    if (!query) return availableActions;
    return availableActions.filter(({ action, subtitle }) => (
      `${action.title} ${subtitle} ${action.id}`.toLocaleLowerCase(locale).includes(query)
    ));
  }, [addQuery, availableActions, locale]);
  const availableProviders = orderedProviders.filter(
    (provider) => !selectedProviders.some((selected) => selected.key === provider.key),
  );
  const providerToAdd = availableProviders.some((provider) => provider.key === addProvider)
    ? addProvider
    : availableProviders[0]?.key ?? "";

  const saveActions = (actions: TrayActionConfig[]) => {
    patch("tray_actions", actions.map((action) => ({ ...action, enabled: true })));
  };

  const saveProviders = (providers: typeof selectedProviders) => {
    const selectedKeys = new Set(providers.map((provider) => provider.key));
    const unknownConfigs = configuredProviders.filter(
      (config) => !declaredProviders.some((provider) => provider.key === config.id),
    );
    patch("tray_providers", [
      ...providers.map((provider) => ({ id: provider.key, enabled: true })),
      ...declaredProviders
        .filter((provider) => !selectedKeys.has(provider.key))
        .map((provider) => ({ id: provider.key, enabled: false })),
      ...unknownConfigs,
    ]);
  };

  const reorder = (source: DragState, target: DragState | null) => {
    if (!target || source.group !== target.group) return;
    if (source.group === "actions") {
      saveActions(reorderById(trayActions, source.id, target.id));
    } else {
      const keyed = selectedProviders.map((provider) => ({ ...provider, id: provider.key }));
      saveProviders(reorderById(keyed, source.id, target.id));
    }
  };

  const moveWithKeyboard = (group: DragGroup, id: string, offset: number) => {
    if (group === "actions") {
      const index = trayActions.findIndex((action) => action.id === id);
      const target = trayActions[index + offset];
      if (target) saveActions(reorderById(trayActions, id, target.id));
      return;
    }
    const index = selectedProviders.findIndex((provider) => provider.key === id);
    const target = selectedProviders[index + offset];
    if (!target) return;
    const keyed = selectedProviders.map((provider) => ({ ...provider, id: provider.key }));
    saveProviders(reorderById(keyed, id, target.key));
  };

  useEffect(() => {
    if (!dragged) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-tray-item-id]");
      const id = row?.dataset.trayItemId;
      const group = row?.dataset.trayItemGroup as DragGroup | undefined;
      setDropTarget(id && group === dragged.group && id !== dragged.id ? { group, id } : null);
      event.preventDefault();
    };
    const finish = () => {
      reorder(dragRef.current ?? dragged, dropTarget);
      dragRef.current = null;
      setDragged(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragged, dropTarget, trayActions, selectedProviders]);

  const beginDrag = (event: React.PointerEvent, state: DragState) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = state;
    setDragged(state);
    setDropTarget(null);
  };

  const renderDragHandle = (group: DragGroup, id: string) => (
    <span
      className="qx-tray-drag-handle"
      role="button"
      tabIndex={0}
      aria-label={t("general.trayMenu.reorder", "Drag to reorder")}
      onPointerDown={(event) => beginDrag(event, { group, id })}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        moveWithKeyboard(group, id, event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <GripVertical size={14} />
    </span>
  );

  return (
    <SettingsCard title={t("general.trayMenu", "Tray Menu")}>
      <p className="qx-settings-section-desc qx-tray-menu-hint">
        {t(
          "general.trayMenu.hint",
          "Items in this list are shown immediately. Drag to reorder; remove an item to hide it.",
        )}
      </p>

      <div className="qx-tray-list-section">
        <div className="qx-tray-list-heading">
          <span>{t("general.trayMenu.items", "Menu Items")}</span>
          <span>{trayActions.length}</span>
        </div>
        <div className="qx-tray-compact-list">
          {trayActions.map((action) => {
            const catalog = TRAY_ACTION_TYPES.find((type) => type.value === action.id);
            const Icon = action.kind === "module"
              ? Boxes
              : action.kind === "plugin-command"
                ? Command
                : actionIcons[action.id as keyof typeof actionIcons] ?? Activity;
            return (
              <div
                key={action.id}
                data-tray-item-id={action.id}
                data-tray-item-group="actions"
                className={`qx-tray-compact-row${dragged?.group === "actions" && dragged.id === action.id ? " is-dragging" : ""}${dropTarget?.group === "actions" && dropTarget.id === action.id ? " is-drop-target" : ""}`}
              >
                {renderDragHandle("actions", action.id)}
                <span className="qx-tray-item-icon"><Icon size={15} /></span>
                <div className="qx-tray-item-copy">
                  <span>{catalog ? t(catalog.labelKey, catalog.label) : action.title}</span>
                  <small>
                    {isTrayStatusAction(action.id)
                      ? t("general.trayMenu.liveStatus", "Live status")
                      : action.kind === "module"
                        ? t("general.trayMenu.module", "Module")
                        : action.kind === "plugin-command"
                          ? t("general.trayMenu.pluginCommand", "Plugin command")
                      : t("general.trayMenu.command", "Command")}
                  </small>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => saveActions(trayActions.filter((item) => item.id !== action.id))}
                  aria-label={t("general.trayMenu.remove", "Remove")}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
          {trayActions.length === 0 && (
            <div className="qx-tray-empty">{t("general.trayMenu.empty", "No custom menu items")}</div>
          )}
        </div>
        <div className="qx-tray-add-row">
          <Popover
            open={addOpen}
            onOpenChange={(open) => {
              setAddOpen(open);
              if (!open) setAddQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="secondary">
                <Plus size={14} />
                {t("general.trayMenu.addItem", "Add module or command")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="qx-tray-picker">
              <div className="qx-tray-picker-search">
                <Search size={14} />
                <Input
                  autoFocus
                  value={addQuery}
                  onChange={(event) => setAddQuery(event.target.value)}
                  placeholder={t("general.trayMenu.searchPlaceholder", "Search modules or commands…")}
                  aria-label={t("general.trayMenu.searchPlaceholder", "Search modules or commands…")}
                />
              </div>
              <div className="qx-tray-picker-list">
                {filteredActions.map((candidate) => {
                  const CandidateIcon = candidate.category === "module"
                    ? Boxes
                    : candidate.category === "plugin-command"
                      ? Command
                      : actionIcons[candidate.action.id as keyof typeof actionIcons] ?? Activity;
                  const catalog = TRAY_ACTION_TYPES.find((type) => type.value === candidate.action.id);
                  return (
                    <Button
                      key={candidate.action.id}
                      type="button"
                      variant="ghost"
                      className="qx-tray-picker-item"
                      onClick={() => {
                        const action = catalog
                          ? { ...candidate.action, title: t(catalog.labelKey, catalog.label) }
                          : candidate.action;
                        saveActions([...trayActions, action]);
                        setAddOpen(false);
                        setAddQuery("");
                      }}
                    >
                      <span className="qx-tray-item-icon"><CandidateIcon size={15} /></span>
                      <span className="qx-tray-item-copy">
                        <span>{catalog ? t(catalog.labelKey, catalog.label) : candidate.action.title}</span>
                        <small>{candidate.subtitle}</small>
                      </span>
                    </Button>
                  );
                })}
                {filteredActions.length === 0 && (
                  <div className="qx-tray-empty">
                    {t("general.trayMenu.noResults", "No matching modules or commands")}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          <Button type="button" size="sm" variant="ghost" onClick={() => saveActions(DEFAULT_TRAY_ACTIONS)}>
            <RotateCcw size={14} />
            {t("general.trayMenu.reset", "Reset")}
          </Button>
        </div>
      </div>

      {declaredProviders.length > 0 && (
        <div className="qx-tray-list-section">
          <div className="qx-tray-list-heading">
            <span>{t("general.trayMenu.controls", "Tray Panel Controls")}</span>
            <span>{selectedProviders.length}</span>
          </div>
          <div className="qx-tray-compact-list">
            {selectedProviders.map((provider) => (
              <div
                key={provider.key}
                data-tray-item-id={provider.key}
                data-tray-item-group="providers"
                className={`qx-tray-compact-row${dragged?.group === "providers" && dragged.id === provider.key ? " is-dragging" : ""}${dropTarget?.group === "providers" && dropTarget.id === provider.key ? " is-drop-target" : ""}`}
              >
                {renderDragHandle("providers", provider.key)}
                <span className="qx-tray-item-icon"><SlidersHorizontal size={15} /></span>
                <div className="qx-tray-item-copy">
                  <span>{provider.title}</span>
                  <small>{provider.declaration.source}</small>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => saveProviders(selectedProviders.filter((item) => item.key !== provider.key))}
                  aria-label={t("general.trayMenu.remove", "Remove")}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
          {availableProviders.length > 0 && (
            <div className="qx-tray-add-row">
              <Select
                value={providerToAdd}
                onChange={setAddProvider}
                options={availableProviders.map((provider) => ({ value: provider.key, label: provider.title }))}
                ariaLabel={t("general.trayMenu.addControl", "Add tray control")}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!providerToAdd}
                onClick={() => {
                  const provider = availableProviders.find((item) => item.key === providerToAdd);
                  if (provider) saveProviders([...selectedProviders, provider]);
                }}
              >
                <Plus size={14} />
                {t("general.trayMenu.add", "Add")}
              </Button>
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

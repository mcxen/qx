import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Blocks, LayoutGrid, Search, Settings } from "lucide-react";
import { useMemo } from "react";
import { Button } from "../../components/ui";
import { useT, useLocale } from "../../i18n";
import { builtinModuleIcon } from "../../modules/builtinIcons";
import { getPluginIcon } from "../../plugin/pluginIconRegistry";
import { localizePluginName } from "../../plugin/pluginLabels";
import { usePluginRegistry } from "../../plugin/registry";
import {
  ISLAND_RECENT_SPRING,
  recentTileHiddenX,
  recentTileTransition,
} from "./recentMotion";
import type { RecentViewEntry } from "./recentViews";

const BUILTIN_TITLE_FALLBACK: Record<string, string> = {
  launcher: "Home",
  clipboard: "Clipboard",
  rss: "RSS Reader",
  settings: "Settings",
  weather: "Weather",
  "qx-ai": "QxAI",
  screencap: "Screenshot & Recording",
  documents: "Text Toolbox",
  macros: "Macro Recorder",
  "qx-tty": "QxTTY",
  "file-actions": "File Actions",
  "file-preview": "File Preview",
  "p-zai": "P-zai",
};

function routeKind(route: string): "launcher" | "settings" | "plugin" | "module" {
  if (route === "launcher") return "launcher";
  if (route === "settings" || route.startsWith("settings:")) return "settings";
  if (route.startsWith("plugin:")) return "plugin";
  return "module";
}

function pluginIdFromRoute(route: string): string {
  return route.startsWith("plugin:") ? route.slice("plugin:".length) : "";
}

export default function IslandRecentSwitcher({
  open,
  items,
  hasOriginIcon,
  onOpen,
}: {
  open: boolean;
  items: RecentViewEntry[];
  hasOriginIcon: boolean;
  onOpen: (route: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const reducedMotion = Boolean(useReducedMotion());
  const plugins = usePluginRegistry((state) => state.plugins);
  const pluginById = useMemo(
    () => new Map(plugins.map((plugin) => [plugin.id, plugin])),
    [plugins],
  );

  if (items.length === 0) return null;

  return (
    <div
      className={`qx-island-recents${hasOriginIcon ? " has-origin" : ""}`}
      data-open={open ? "true" : undefined}
      role="toolbar"
      aria-hidden={!open}
      aria-label={t("island.recents", "Recent views")}
    >
      <AnimatePresence>
        {open && !hasOriginIcon && (
          <motion.div
            key="origin"
            className="qx-island-recent-origin"
            initial={reducedMotion ? false : { scale: 1 }}
            animate={reducedMotion ? undefined : { scale: [1, 1.1, 1] }}
            exit={{ scale: 1, opacity: 0 }}
            transition={reducedMotion ? { duration: 0 } : ISLAND_RECENT_SPRING}
          >
            <Button
              className="qx-island-module-button"
              type="button"
              variant="ghost"
              size="sm"
              data-qx-no-drag
              onClick={() => onOpen("launcher")}
              aria-label={t("island.recents.open", "Open {name}").replace(
                "{name}",
                t("launcher.search", "Search"),
              )}
              title={t("launcher.search", "Search")}
            >
              <Search size={14} strokeWidth={2.1} aria-hidden="true" />
            </Button>
          </motion.div>
        )}
        {open
          && items.map((item, index) => {
            const kind = routeKind(item.route);
            const pluginId = pluginIdFromRoute(item.route);
            const plugin = pluginId ? pluginById.get(pluginId) : undefined;
            const pluginIcon = pluginId ? getPluginIcon(pluginId) : undefined;
            const title = kind === "plugin"
              ? (plugin
                ? localizePluginName(plugin, t, locale)
                : pluginId)
              : t(`launcher.${item.route}`, BUILTIN_TITLE_FALLBACK[item.route] ?? item.route);
            const Icon = kind === "launcher"
              ? Search
              : kind === "settings"
                ? Settings
                : builtinModuleIcon(item.route) ?? LayoutGrid;
            const label = t("island.recents.open", "Open {name}").replace("{name}", title);
            const hidden = {
              x: recentTileHiddenX(index),
              scale: 0.38,
              opacity: 0,
            };
            return (
              <motion.div
                key={item.route}
                className="qx-island-recent-item"
                initial={reducedMotion ? false : hidden}
                animate={{ x: 0, scale: 1, opacity: 1 }}
                exit={{
                  ...hidden,
                  transition: recentTileTransition(index, {
                    exiting: true,
                    count: items.length,
                    reducedMotion,
                  }),
                }}
                transition={recentTileTransition(index, {
                  count: items.length,
                  reducedMotion,
                })}
              >
                <Button
                  className="qx-island-module-button"
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-qx-no-drag
                  onClick={() => onOpen(item.route)}
                  aria-label={label}
                  title={title}
                >
                  {kind === "plugin" && pluginIcon ? (
                    <img src={pluginIcon} alt="" aria-hidden="true" />
                  ) : kind === "plugin" ? (
                    <Blocks size={14} strokeWidth={2.1} aria-hidden="true" />
                  ) : (
                    <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
                  )}
                </Button>
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}

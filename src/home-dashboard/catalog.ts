import type { HomeDashboardWidgetId } from "../modules/settings/store";
import type { InstalledPlugin, PluginHomeWidgetSource } from "../plugin/types";
import type { LucideIcon } from "lucide-react";
import { Cpu, MemoryStick, Monitor, Network, Pin, Zap } from "lucide-react";

type Translate = (key: string, fallback: string) => string;

export interface HomeDashboardWidgetOption {
  id: HomeDashboardWidgetId;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const HOME_DASHBOARD_WIDGET_IDS: HomeDashboardWidgetId[] = [
  "launcher.pinned",
  "system.cpu",
  "system.memory",
  "system.power",
  "system.network",
  "system.display-brightness",
];

export function homeDashboardWidgetOptions(t: Translate): HomeDashboardWidgetOption[] {
  return [
    {
      id: "launcher.pinned",
      title: t("launcher.home.pinned", "Pinned Applications"),
      description: t("launcher.home.pinned.desc", "Applications, modules and plugins pinned from Launcher Actions."),
      icon: Pin,
    },
    {
      id: "system.cpu",
      title: "CPU",
      description: t("launcher.home.cpu.desc", "Current processor utilization."),
      icon: Cpu,
    },
    {
      id: "system.memory",
      title: t("launcher.home.memory", "Memory"),
      description: t("launcher.home.memory.desc", "Current memory pressure and capacity."),
      icon: MemoryStick,
    },
    {
      id: "system.power",
      title: t("launcher.home.power", "Power"),
      description: t("launcher.home.power.desc", "Battery level and charging state."),
      icon: Zap,
    },
    {
      id: "system.network",
      title: t("launcher.home.network", "Network"),
      description: t("launcher.home.network.desc", "Current download and upload rates."),
      icon: Network,
    },
    {
      id: "system.display-brightness",
      title: t("launcher.home.displayBrightness", "Display Brightness"),
      description: t("launcher.home.displayBrightness.desc", "Current brightness across connected displays."),
      icon: Monitor,
    },
  ];
}

export function sanitizeHomeDashboardWidgets(value: readonly string[] | undefined): HomeDashboardWidgetId[] {
  const allowed = new Set(HOME_DASHBOARD_WIDGET_IDS);
  const widgets = Array.from(new Set((value ?? []).filter((id): id is HomeDashboardWidgetId => allowed.has(id as HomeDashboardWidgetId))));
  return widgets.length > 0 ? widgets : ["launcher.pinned"];
}

/** Find the first enabled plugin that associates its panel with this host data source. */
export function homeWidgetProvider(
  source: PluginHomeWidgetSource,
  plugins: readonly InstalledPlugin[],
): InstalledPlugin | null {
  return plugins.find((plugin) =>
    plugin.enabled
    && plugin.manifest?.panel
    && plugin.manifest.homeWidgets?.some((widget) => widget.source === source),
  ) ?? null;
}

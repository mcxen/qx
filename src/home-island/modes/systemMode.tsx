import { Toggle } from "../../components/ui";
import type { HomeIslandDefinition, HomeIslandSettingsProps } from "../types";
import SystemIsland from "./SystemIsland";
import { useT } from "../../i18n";

function SystemIslandSettings({ appearance, patchAppearance }: HomeIslandSettingsProps) {
  const t = useT();
  return (
    <div className="qx-home-island-settings" aria-label={t("appearance.systemCurves", "System Curves")}>
      <label>
        <span>CPU</span>
        <Toggle
          value={appearance.home_island_cpu}
          onChange={(v) => patchAppearance({ home_island_cpu: v })}
        />
      </label>
      <label>
        <span>GPU</span>
        <Toggle
          value={appearance.home_island_gpu}
          onChange={(v) => patchAppearance({ home_island_gpu: v })}
        />
      </label>
      <label>
        <span>MEM</span>
        <Toggle
          value={appearance.home_island_memory}
          onChange={(v) => patchAppearance({ home_island_memory: v })}
        />
      </label>
    </div>
  );
}

export const systemHomeIsland: HomeIslandDefinition = {
  id: "system",
  order: 20,
  titleKey: "appearance.homeIsland.system",
  titleFallback: "System",
  hintKey: "appearance.homeIsland.system.hint",
  hintFallback: "CPU · MEM · GPU",
  preview: "SYS",
  kind: "custom",
  Component: ({ appearance }) => (
    <SystemIsland
      showCpu={appearance.home_island_cpu}
      showGpu={appearance.home_island_gpu}
      showMemory={appearance.home_island_memory}
    />
  ),
  Settings: SystemIslandSettings,
  settingsTitleKey: "appearance.systemCurves",
  settingsTitleFallback: "System Curves",
  settingsDescKey: "appearance.systemCurves.desc",
  settingsDescFallback: "Toggle metrics on the System island.",
};

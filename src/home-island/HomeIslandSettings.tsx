import { Row } from "../components/ui";
import { useT } from "../i18n";
import type { AppearanceSettings } from "../modules/settings/store";
import { ensureHomeIslandCatalog } from "./catalog";
import { listHomeIslands, normalizeHomeIslandMode } from "./registry";
import type { HomeIslandAppearance } from "./types";

export default function HomeIslandSettings({
  appearance,
  patch,
}: {
  appearance: AppearanceSettings;
  patch: (next: AppearanceSettings) => void;
}) {
  const t = useT();
  ensureHomeIslandCatalog();
  const modes = listHomeIslands();
  const activeId = normalizeHomeIslandMode(appearance.home_island_mode);
  const active = modes.find((m) => m.id === activeId);

  const islandAppearance: HomeIslandAppearance = {
    home_island_mode: appearance.home_island_mode,
    home_island_cpu: appearance.home_island_cpu,
    home_island_gpu: appearance.home_island_gpu,
    home_island_memory: appearance.home_island_memory,
  };

  const patchAppearance = (partial: Partial<HomeIslandAppearance>) => {
    patch({ ...appearance, ...partial });
  };

  return (
    <>
      <Row
        title={t("appearance.homeIsland", "Home Island")}
        description={t("appearance.homeIsland.desc", "Content shown when search is idle.")}
      >
        <div
          className="qx-island-mode-grid"
          role="radiogroup"
          aria-label={t("appearance.homeIsland", "Home Island")}
        >
          {modes.map((mode) => {
            const selected = activeId === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`qx-island-mode-card${selected ? " is-selected" : ""}`}
                onClick={() => patchAppearance({ home_island_mode: mode.id })}
              >
                <span className="qx-island-mode-preview" aria-hidden="true">
                  {mode.preview}
                </span>
                <span className="qx-island-mode-title">
                  {t(mode.titleKey, mode.titleFallback)}
                </span>
                <span className="qx-island-mode-hint">
                  {t(mode.hintKey, mode.hintFallback)}
                </span>
              </button>
            );
          })}
        </div>
      </Row>

      {active?.Settings && (
        <Row
          title={t(
            active.settingsTitleKey ?? active.titleKey,
            active.settingsTitleFallback ?? active.titleFallback,
          )}
          description={t(
            active.settingsDescKey ?? active.hintKey,
            active.settingsDescFallback ?? active.hintFallback,
          )}
        >
          <active.Settings
            appearance={islandAppearance}
            patchAppearance={patchAppearance}
          />
        </Row>
      )}
    </>
  );
}

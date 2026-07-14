import { Row, Slider } from "../components/ui";
import { useT } from "../i18n";
import type { AppearanceSettings } from "../modules/settings/store";
import { ensureHomeIslandCatalog } from "./catalog";
import {
  listHomeIslands,
  normalizeHomeIslandMode,
  normalizeHomeIslandModes,
} from "./registry";
import type { HomeIslandAppearance } from "./types";

export default function HomeIslandSettings({
  appearance,
  patch,
  onPreviewModeChange,
}: {
  appearance: AppearanceSettings;
  patch: (next: AppearanceSettings) => void;
  /** Notify parent (settings shell) which mode to live-preview in the island. */
  onPreviewModeChange?: (modeId: string | null) => void;
}) {
  const t = useT();
  ensureHomeIslandCatalog();
  const catalog = listHomeIslands();
  const selectedModes = normalizeHomeIslandModes(appearance);
  const selectedSet = new Set(selectedModes);
  const primaryId = normalizeHomeIslandMode(
    appearance.home_island_mode || selectedModes[0],
  );
  const active = catalog.find((m) => m.id === primaryId);
  const rotateSecs = appearance.home_island_rotate_secs ?? 8;
  const multi = selectedModes.length > 1;

  const islandAppearance: HomeIslandAppearance = {
    home_island_mode: appearance.home_island_mode,
    home_island_modes: appearance.home_island_modes,
    home_island_rotate_secs: appearance.home_island_rotate_secs,
    home_island_cpu: appearance.home_island_cpu,
    home_island_gpu: appearance.home_island_gpu,
    home_island_memory: appearance.home_island_memory,
  };

  const patchAppearance = (partial: Partial<HomeIslandAppearance>) => {
    patch({ ...appearance, ...partial });
  };

  const toggleMode = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) {
      // Keep at least one mode; re-click single selection → preview only.
      if (next.size <= 1) {
        patchAppearance({ home_island_mode: id });
        onPreviewModeChange?.(id);
        return;
      }
      next.delete(id);
    } else {
      next.add(id);
    }
    // Preserve catalog order for stable rotation sequence.
    const ordered = catalog.map((m) => m.id).filter((mid) => next.has(mid));
    patchAppearance({
      home_island_modes: ordered,
      // Last interacted mode owns extra settings (e.g. system curves).
      home_island_mode: next.has(id) ? id : ordered[0],
    });
    onPreviewModeChange?.(id);
  };

  return (
    <>
      <Row
        title={t("appearance.homeIsland", "Home Island")}
        description={t(
          "appearance.homeIsland.desc",
          "Idle launcher island. Multi-select to rotate; the settings island previews live data.",
        )}
      >
        <div
          className="qx-island-mode-grid"
          role="group"
          aria-label={t("appearance.homeIsland", "Home Island")}
        >
          {catalog.map((mode) => {
            const selected = selectedSet.has(mode.id);
            const isPrimary = primaryId === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={selected}
                className={`qx-island-mode-card${selected ? " is-selected" : ""}${
                  isPrimary ? " is-primary" : ""
                }`}
                onClick={() => toggleMode(mode.id)}
                onFocus={() => {
                  onPreviewModeChange?.(mode.id);
                  if (selected) patchAppearance({ home_island_mode: mode.id });
                }}
                onMouseEnter={() => onPreviewModeChange?.(mode.id)}
              >
                <span className="qx-island-mode-preview" aria-hidden="true">
                  {mode.preview}
                </span>
                <span className="qx-island-mode-title">
                  {t(mode.titleKey, mode.titleFallback)}
                  {selected ? (
                    <span className="qx-island-mode-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </span>
                <span className="qx-island-mode-hint">
                  {t(mode.hintKey, mode.hintFallback)}
                </span>
              </button>
            );
          })}
        </div>
      </Row>

      {multi && (
        <Row
          title={t("appearance.homeIsland.rotate", "Auto rotate")}
          description={t(
            "appearance.homeIsland.rotate.desc",
            "Interval for cycling selected home islands when the launcher is idle.",
          )}
        >
          <div className="qx-home-island-rotate">
            <Slider
              min={0}
              max={30}
              step={1}
              value={rotateSecs}
              onChange={(value) =>
                patchAppearance({
                  home_island_rotate_secs: value || 0,
                })
              }
              ariaLabel={t("appearance.homeIsland.rotate", "Auto rotate")}
              formatLabel={(value) => `${value}s`}
            />
            <span className="qx-home-island-rotate-value">
              {rotateSecs <= 0
                ? t("appearance.homeIsland.rotate.off", "Off (first only)")
                : t("appearance.homeIsland.rotate.secs", "{n}s").replace(
                    "{n}",
                    String(rotateSecs),
                  )}
            </span>
            <span className="qx-home-island-rotate-count">
              {t("appearance.homeIsland.selectedCount", "{n} selected").replace(
                "{n}",
                String(selectedModes.length),
              )}
            </span>
          </div>
        </Row>
      )}

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

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";
import { Row, SegmentedControl, SettingsCard, Slider, Toggle } from "../../components/ui";
import { useT } from "../../i18n";
import { HomeIslandSettings } from "../../home-island";

const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_WIDTH = 1500;
const MAX_WINDOW_HEIGHT = 882;
function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function clampDimension(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDimensionDraft(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampDimension(parsed, min, max);
}

export default function AppearanceSettings({
  onHomeIslandPreview,
}: {
  /** Live-preview mode id for the settings shell island. */
  onHomeIslandPreview?: (modeId: string | null) => void;
} = {}) {
  const { settings, patch } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const t = useT();
  const a = settings.appearance;
  const radiusValue = String(clampDimension(a.border_radius, 4, 8));
  const [focusedDimension, setFocusedDimension] = useState<"width" | "height" | null>(null);
  const [widthDraft, setWidthDraft] = useState(String(a.window_width));
  const [heightDraft, setHeightDraft] = useState(String(a.window_height));

  useEffect(() => {
    if (focusedDimension !== "width") {
      setWidthDraft(String(a.window_width));
    }
    if (focusedDimension !== "height") {
      setHeightDraft(String(a.window_height));
    }
  }, [a.window_width, a.window_height, focusedDimension]);

  const commitWindowDimensions = (nextWidthDraft = widthDraft, nextHeightDraft = heightDraft) => {
    const width = parseDimensionDraft(
      nextWidthDraft,
      a.window_width,
      MIN_WINDOW_WIDTH,
      MAX_WINDOW_WIDTH,
    );
    const height = parseDimensionDraft(
      nextHeightDraft,
      a.window_height,
      MIN_WINDOW_HEIGHT,
      MAX_WINDOW_HEIGHT,
    );
    setWidthDraft(String(width));
    setHeightDraft(String(height));
    if (width === a.window_width && height === a.window_height) return;
    patch("appearance", {
      ...a,
      window_width: width,
      window_height: height,
    });
    if (isTauriRuntime()) {
      void invoke("set_window_size", { width, height }).catch(() => {});
    }
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard title={t("appearance.surface.title", "Theme & Surface")}>
        <Row title={t("appearance.theme", "Theme")} description={t("appearance.theme.desc", "Choose the interface color scheme.")}>
          <SegmentedControl
            value={theme}
            onChange={(v) => {
              setTheme(v);
              patch("appearance", { ...a, theme: v });
            }}
            options={[
              { value: "light", label: t("appearance.theme.light", "Light") },
              { value: "dark", label: t("appearance.theme.dark", "Dark") },
              { value: "system", label: t("appearance.theme.system", "System") },
            ]}
          />
        </Row>
        <Row title={t("appearance.glass", "System Glass")} description={t("appearance.glass.desc", "Use macOS Vibrancy or Windows Acrylic. Turning it off makes every window surface fully opaque while preserving your glass settings.")}>
          <Toggle
            value={a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, glass_enabled: v })}
            ariaLabel={t("appearance.glass", "System Glass")}
          />
        </Row>
        <Row title={t("appearance.opacity.window", "Window Opacity")} description={t("appearance.opacity.window.desc", "Controls background opacity independently from blur. 100% is fully opaque.")}>
          <Slider
            value={a.blur_opacity}
            min={0.05}
            max={1}
            step={0.01}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, blur_opacity: v })}
            ariaLabel={t("appearance.opacity.window", "Window Background")}
            formatLabel={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row title={t("appearance.blur", "Blur Strength")} description={t("appearance.blur.desc", "Controls backdrop blur independently from opacity. Set to 0 for clear transparency.")}>
          <Slider
            value={a.blur_radius}
            min={0}
            max={30}
            step={1}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, blur_radius: v })}
            ariaLabel={t("appearance.blur", "Blur Strength")}
            formatLabel={(v) => `${Math.round(v)}px`}
          />
        </Row>
        <Row title={t("appearance.opacity.chrome", "Top Bar & Context")} description={t("appearance.opacity.chrome.desc", "Controls shell chrome and context-region separation.")}>
          <Slider
            value={a.shell_region_opacity}
            min={0.03}
            max={0.35}
            step={0.01}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, shell_region_opacity: v })}
            ariaLabel={t("appearance.opacity.chrome", "Top Bar & Context")}
            formatLabel={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row title={t("appearance.opacity.surfaces", "Content Surfaces")} description={t("appearance.opacity.surfaces.desc", "Controls lists, cards, settings rows, and content panels.")}>
          <Slider
            value={a.surface_opacity}
            min={0.10}
            max={0.85}
            step={0.01}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, surface_opacity: v })}
            ariaLabel={t("appearance.opacity.surfaces", "Content Surfaces")}
            formatLabel={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row title={t("appearance.opacity.controls", "Actions & Controls")} description={t("appearance.opacity.controls.desc", "Keeps buttons, actions, menus, and popovers distinct from content.")}>
          <Slider
            value={a.control_opacity}
            min={0.30}
            max={0.95}
            step={0.01}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, control_opacity: v })}
            ariaLabel={t("appearance.opacity.controls", "Actions & Controls")}
            formatLabel={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
        <Row title={t("appearance.opacity.bottomBar", "Bottom Bar")} description={t("appearance.opacity.bottomBar.desc", "Controls the bottom bar separately while retaining its frosted separation.")}>
          <Slider
            value={a.bottom_bar_opacity}
            min={0.04}
            max={0.35}
            step={0.01}
            disabled={!a.glass_enabled}
            onChange={(v) => patch("appearance", { ...a, bottom_bar_opacity: v })}
            ariaLabel={t("appearance.opacity.bottomBar", "Bottom Bar")}
            formatLabel={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
      </SettingsCard>

      <SettingsCard title={t("appearance.layout.title", "Window & Density")}>
        <Row title={t("appearance.windowSize", "Window Size")} description={t("appearance.windowSize.desc", "Launcher window dimensions (min 400×300).")}>
          <div className="qx-window-size-group">
            <label className="qx-dimension-label">
              <span className="qx-dimension-label-text">W</span>
              <input
                type="number"
                min={MIN_WINDOW_WIDTH}
                max={MAX_WINDOW_WIDTH}
                value={widthDraft}
                onChange={(e) => {
                  setWidthDraft(e.target.value);
                }}
                onFocus={() => setFocusedDimension("width")}
                onBlur={() => {
                  setFocusedDimension(null);
                  commitWindowDimensions();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="qx-dimension-input"
              />
            </label>
            <span className="qx-dimension-sep">×</span>
            <label className="qx-dimension-label">
              <span className="qx-dimension-label-text">H</span>
              <input
                type="number"
                min={MIN_WINDOW_HEIGHT}
                max={MAX_WINDOW_HEIGHT}
                value={heightDraft}
                onChange={(e) => {
                  setHeightDraft(e.target.value);
                }}
                onFocus={() => setFocusedDimension("height")}
                onBlur={() => {
                  setFocusedDimension(null);
                  commitWindowDimensions();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="qx-dimension-input"
              />
            </label>
          </div>
        </Row>
        <Row title={t("appearance.cornerRadius", "Corner Radius")} description={t("appearance.cornerRadius.desc", "Window and card border radius.")}>
          <SegmentedControl
            value={radiusValue}
            onChange={(v) => patch("appearance", { ...a, border_radius: parseInt(v) })}
            options={[
              { value: "4", label: "4px" },
              { value: "6", label: "6px" },
              { value: "8", label: "8px" },
            ]}
          />
        </Row>
        <Row title={t("appearance.fontSize", "Font Size")} description={t("appearance.fontSize.desc", "Base UI font size.")}>
          <SegmentedControl
            value={String(a.font_size)}
            onChange={(v) => patch("appearance", { ...a, font_size: parseInt(v) })}
            options={[
              { value: "13", label: "13" },
              { value: "14", label: "14" },
              { value: "15", label: "15" },
              { value: "16", label: "16" },
            ]}
          />
        </Row>
        <Row
          title={t("appearance.launcherDensity", "Launcher Results")}
          description={t(
            "appearance.launcherDensity.desc",
            "Comfortable uses two-line Spotlight-style rows; Compact is denser and single-line.",
          )}
        >
          <SegmentedControl
            value={a.launcher_result_density === "compact" ? "compact" : "comfortable"}
            onChange={(v) =>
              patch("appearance", {
                ...a,
                launcher_result_density: v === "compact" ? "compact" : "comfortable",
              })
            }
            options={[
              { value: "comfortable", label: t("appearance.launcherDensity.comfortable", "Comfortable") },
              { value: "compact", label: t("appearance.launcherDensity.compact", "Compact") },
            ]}
          />
        </Row>
      </SettingsCard>

      <SettingsCard title={t("appearance.homeIsland.title", "Home Island")}>
        <HomeIslandSettings
          appearance={a}
          patch={(next) => patch("appearance", next)}
          onPreviewModeChange={onHomeIslandPreview}
        />
      </SettingsCard>

      <SettingsCard title={t("appearance.externalIsland.title", "External Island Display")}>
        <Row
          title={t("appearance.externalIsland.enabled", "Enable external display")}
          description={t(
            "appearance.externalIsland.enabled.desc",
            "Allow the docked Qx Island to be floated manually and dragged anywhere. It never opens automatically.",
          )}
        >
          <Toggle
            value={a.island_float_enabled}
            onChange={(value) =>
              patch("appearance", { ...a, island_float_enabled: value })
            }
          />
        </Row>
        <Row
          title={t("appearance.externalIsland.rotation", "Module rotation")}
          description={t(
            "appearance.externalIsland.rotation.desc",
            "Rotate normal module and plugin status by time. Tasks, errors, and important events take over immediately.",
          )}
        >
          <SegmentedControl
            value={String(a.island_float_rotate_secs)}
            onChange={(value) =>
              patch("appearance", {
                ...a,
                island_float_rotate_secs: Number.parseInt(value, 10),
              })
            }
            options={[
              { value: "5", label: "5s" },
              { value: "8", label: "8s" },
              { value: "15", label: "15s" },
            ]}
          />
        </Row>
        <Row
          title={t("appearance.externalIsland.whenHidden", "Show while Qx is hidden")}
          description={t(
            "appearance.externalIsland.whenHidden.desc",
            "Keep an island that you already floated manually visible after the main window hides.",
          )}
        >
          <Toggle
            value={a.island_float_when_main_hidden}
            disabled={!a.island_float_enabled}
            onChange={(value) =>
              patch("appearance", { ...a, island_float_when_main_hidden: value })
            }
          />
        </Row>
        <Row
          title={t("appearance.externalIsland.alwaysOnTop", "Always on top")}
          description={t(
            "appearance.externalIsland.alwaysOnTop.desc",
            "Keep the compact island above regular application windows.",
          )}
        >
          <Toggle
            value={a.island_float_always_on_top}
            disabled={!a.island_float_enabled}
            onChange={(value) =>
              patch("appearance", { ...a, island_float_always_on_top: value })
            }
          />
        </Row>
      </SettingsCard>

    </div>
  );
}

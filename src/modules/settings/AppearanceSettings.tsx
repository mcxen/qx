import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";
import { Row, SegmentedControl, SettingsCard, Slider } from "../../components/ui";
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
      <SettingsCard
        title={t("appearance.surface.title", "Theme & Surface")}
        description={t("appearance.surface.desc", "Choose the color mode and the transparent shell strength.")}
      >
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
        <Row
          title={t("appearance.opacity", "Interface Transparency")}
          description={`${t("appearance.opacity.desc", "Controls the whole shell, panels, and bottom island")} (${a.blur_opacity.toFixed(2)})`}
        >
          <Slider
            value={a.blur_opacity}
            min={0.05}
            max={0.40}
            step={0.01}
            onChange={(v) => patch("appearance", { ...a, blur_opacity: v })}
            ariaLabel="Frosted glass opacity"
            formatLabel={(v) => v.toFixed(2)}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("appearance.layout.title", "Window & Density")}
        description={t("appearance.layout.desc", "Tune the launcher footprint and compactness.")}
      >
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
      </SettingsCard>

      <SettingsCard
        title={t("appearance.homeIsland.title", "Home Island")}
        description={t("appearance.homeIsland.cardDesc", "Idle launcher island — pick a classic view or a sci-fi HUD.")}
      >
        <HomeIslandSettings
          appearance={a}
          patch={(next) => patch("appearance", next)}
          onPreviewModeChange={onHomeIslandPreview}
        />
      </SettingsCard>
    </div>
  );
}

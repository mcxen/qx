import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";
import { Row, SegmentedControl, Toggle, Slider } from "../../components/ui";
import { useT } from "../../i18n";

export default function AppearanceSettings() {
  const { settings, patch } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const t = useT();
  const a = settings.appearance;
  const mounted = useRef(false);

  // Apply window size changes to the actual window
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void invoke("set_window_size", {
      width: a.window_width,
      height: a.window_height,
    }).catch(() => {});
  }, [a.window_width, a.window_height]);

  return (
    <div className="qx-settings-page">
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
        title={t("appearance.opacity", "Frosted Glass Opacity")}
        description={`${t("appearance.opacity.desc", "Canvas transparency")} (${a.blur_opacity.toFixed(2)})`}
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
      <Row title={t("appearance.windowSize", "Window Size")} description={t("appearance.windowSize.desc", "Launcher window dimensions (min 400×300).")}>
        <div className="qx-window-size-group">
          <label className="qx-dimension-label">
            <span className="qx-dimension-label-text">W</span>
            <input
              type="number"
              min={400}
              max={2800}
              value={a.window_width}
              onChange={(e) => {
                const v = Math.max(400, parseInt(e.target.value) || 400);
                patch("appearance", { ...a, window_width: v });
              }}
              className="qx-dimension-input"
            />
          </label>
          <span className="qx-dimension-sep">×</span>
          <label className="qx-dimension-label">
            <span className="qx-dimension-label-text">H</span>
            <input
              type="number"
              min={300}
              max={1800}
              value={a.window_height}
              onChange={(e) => {
                const v = Math.max(300, parseInt(e.target.value) || 300);
                patch("appearance", { ...a, window_height: v });
              }}
              className="qx-dimension-input"
            />
          </label>
        </div>
      </Row>
      <Row title={t("appearance.cornerRadius", "Corner Radius")} description={t("appearance.cornerRadius.desc", "Window and card border radius.")}>
        <SegmentedControl
          value={String(a.border_radius)}
          onChange={(v) => patch("appearance", { ...a, border_radius: parseInt(v) })}
          options={[
            { value: "8", label: "8px" },
            { value: "12", label: "12px" },
            { value: "16", label: "16px" },
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
        title={t("appearance.homeIsland", "Home Island")}
        description={t("appearance.homeIsland.desc", "Content shown in the launcher island when search is idle.")}
      >
        <SegmentedControl
          value={a.home_island_mode}
          onChange={(v) => patch("appearance", { ...a, home_island_mode: v })}
          options={[
            { value: "default", label: t("appearance.homeIsland.default", "Default") },
            { value: "system", label: t("appearance.homeIsland.system", "System") },
          ]}
        />
      </Row>
      <Row
        title={t("appearance.systemCurves", "System Curves")}
        description={t("appearance.systemCurves.desc", "Dotted GEEK-style metrics for the homepage island.")}
      >
        <div className="qx-home-island-settings">
          <label>
            <span>CPU</span>
            <Toggle
              value={a.home_island_cpu}
              onChange={(v) => patch("appearance", { ...a, home_island_cpu: v })}
            />
          </label>
          <label>
            <span>GPU</span>
            <Toggle
              value={a.home_island_gpu}
              onChange={(v) => patch("appearance", { ...a, home_island_gpu: v })}
            />
          </label>
          <label>
            <span>MEM</span>
            <Toggle
              value={a.home_island_memory}
              onChange={(v) => patch("appearance", { ...a, home_island_memory: v })}
            />
          </label>
        </div>
      </Row>
    </div>
  );
}

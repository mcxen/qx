import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";
import { Row, SegmentedControl, Toggle } from "../../components/ui";
import { useT } from "../../i18n";

export default function AppearanceSettings() {
  const { settings, patch } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const t = useT();
  const a = settings.appearance;

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
        <input
          type="range"
          min={0.7}
          max={0.95}
          step={0.01}
          value={a.blur_opacity}
          onChange={(e) =>
            patch("appearance", { ...a, blur_opacity: parseFloat(e.target.value) })
          }
          style={{ width: 160 }}
        />
      </Row>
      <Row title={t("appearance.windowSize", "Window Size")} description={t("appearance.windowSize.desc", "Launcher window dimensions (min 400×300).")}>
        <input
          type="number"
          min={400}
          value={a.window_width}
          onChange={(e) =>
            patch("appearance", {
              ...a,
              window_width: Math.max(400, parseInt(e.target.value) || 400),
            })
          }
          style={{ width: 64, textAlign: "center" }}
          className="qx-inline-input"
        />
        <span style={{ color: "var(--color-text-tertiary)" }}>×</span>
        <input
          type="number"
          min={300}
          value={a.window_height}
          onChange={(e) =>
            patch("appearance", {
              ...a,
              window_height: Math.max(300, parseInt(e.target.value) || 300),
            })
          }
          style={{ width: 64, textAlign: "center" }}
          className="qx-inline-input"
        />
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

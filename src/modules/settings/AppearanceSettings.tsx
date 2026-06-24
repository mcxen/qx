import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettingsStore } from "./store";
import { useTheme } from "../../ThemeProvider";
import { Row, SegmentedControl, Toggle, Slider } from "../../components/ui";
import { useT } from "../../i18n";

const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_WIDTH = 2800;
const MAX_WINDOW_HEIGHT = 1800;
const RESIZE_SAVE_DELAY_MS = 250;

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

export default function AppearanceSettings() {
  const { settings, patch } = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const t = useT();
  const a = settings.appearance;
  const radiusValue = String(clampDimension(a.border_radius, 4, 8));
  const mounted = useRef(false);
  const resizeSyncRef = useRef(false);
  const resizeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
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

  // Apply window size changes to the actual window
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (resizeSyncRef.current) {
      resizeSyncRef.current = false;
      return;
    }
    if (!isTauriRuntime()) return;
    void invoke("set_window_size", {
      width: a.window_width,
      height: a.window_height,
    }).catch(() => {});
  }, [a.window_width, a.window_height]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();

    void win
      .onResized((size) => {
        if (resizeTimerRef.current) {
          window.clearTimeout(resizeTimerRef.current);
        }

        resizeTimerRef.current = window.setTimeout(() => {
          void win
            .scaleFactor()
            .then((scaleFactor) => {
              if (disposed) return;
              const width = clampDimension(
                Math.round(size.payload.width / scaleFactor),
                MIN_WINDOW_WIDTH,
                MAX_WINDOW_WIDTH,
              );
              const height = clampDimension(
                Math.round(size.payload.height / scaleFactor),
                MIN_WINDOW_HEIGHT,
                MAX_WINDOW_HEIGHT,
              );
              const current = useSettingsStore.getState().settings.appearance;
              if (current.window_width === width && current.window_height === height) return;

              resizeSyncRef.current = true;
              patch("appearance", {
                ...current,
                window_width: width,
                window_height: height,
              });
            })
            .catch(() => {});
        }, RESIZE_SAVE_DELAY_MS);
      })
      .then((off) => {
        if (disposed) {
          off();
        } else {
          unlisten = off;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      unlisten?.();
    };
  }, [patch]);

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
  };

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
        title={t("appearance.homeIsland", "Home Island")}
        description={t("appearance.homeIsland.desc", "Content shown in the launcher island when search is idle.")}
      >
        <SegmentedControl
          value={a.home_island_mode}
          onChange={(v) => patch("appearance", { ...a, home_island_mode: v })}
          options={[
            { value: "default", label: t("appearance.homeIsland.default", "Default") },
            { value: "system", label: t("appearance.homeIsland.system", "System Info") },
            { value: "date", label: t("appearance.homeIsland.date", "Date Display") },
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

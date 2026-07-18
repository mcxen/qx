import type { AppearanceSettings } from "../modules/settings/store";
import { getQxDesktopPlatform } from "../utils/keyboard";

/** Shared docked/floating island surface opacity calculation. */
export function resolveIslandSurfaceOpacity(appearance: AppearanceSettings): number {
  if (!appearance.glass_enabled) return 1;
  const bottom = Math.min(0.35, Math.max(0.04, appearance.bottom_bar_opacity));
  const control = Math.min(0.95, Math.max(0.30, appearance.control_opacity));
  if (getQxDesktopPlatform() === "windows") {
    const effectiveBottom = 0.72 + ((bottom - 0.04) / 0.31) * 0.20;
    return Math.max(0.90, control, effectiveBottom);
  }
  return Math.min(0.96, Math.max(control, bottom + 0.20));
}

/** Apply the island-only visual tokens in a secondary island webview. */
export function applyFloatingIslandAppearance(appearance: AppearanceSettings): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolvedTheme = appearance.theme === "system"
    ? (prefersDark ? "dark" : "light")
    : appearance.theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.glassEnabled = String(appearance.glass_enabled);
  document.documentElement.style.setProperty(
    "--qx-shell-popover-opacity",
    String(resolveIslandSurfaceOpacity(appearance)),
  );
  document.documentElement.style.setProperty(
    "--qx-shell-chrome-blur",
    appearance.glass_enabled ? "24px" : "0px",
  );
  const radius = Math.min(8, Math.max(4, appearance.border_radius));
  document.documentElement.style.setProperty("--qx-radius", `${radius}px`);
  document.documentElement.style.setProperty("--qx-font-size", `${appearance.font_size}px`);
}

const PLUGIN_THEME_TOKEN_NAMES = [
  // Dependencies used by public semantic tokens. Custom properties retain
  // nested var() references across iframe boundaries, so the dependency set
  // must travel with the public aliases.
  "--qx-window-opacity",
  "--qx-window-opacity-effective",
  "--qx-shell-popover-opacity",
  "--qx-shell-popover-opacity-effective",
  "--qx-surface-rgb-1",
  "--qx-surface-rgb-2",
  "--qx-surface-rgb-3",
  "--qx-surface-opacity-1",
  "--qx-surface-opacity-2",
  "--qx-surface-opacity-3",
  "--qx-surface-opacity-1-effective",
  "--qx-surface-opacity-2-effective",
  "--qx-surface-opacity-3-effective",
  "--qx-glass-bg",
  "--qx-blue-600",
  "--qx-blue-700",
  "--qx-text-on-accent",
  "--qx-accent-soft",
  "--qx-danger-border",
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--radius",
  "--qx-radius",
  "--qx-control-radius",
  "--qx-bg-component-1",
  "--qx-bg-component-2",
  "--qx-bg-component-3",
  "--qx-border-1",
  "--qx-border-2",
  "--qx-border-3",
  "--qx-text-primary",
  "--qx-text-secondary",
  "--qx-text-tertiary",
  "--qx-accent",
  "--qx-danger",
] as const;

export interface PluginThemePayload {
  theme: "light" | "dark";
  tokens: Record<string, string>;
}

export function currentPluginThemePayload(): PluginThemePayload {
  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  return {
    theme: root.dataset.theme === "dark" ? "dark" : "light",
    tokens: Object.fromEntries(PLUGIN_THEME_TOKEN_NAMES.map((name) => [
      name,
      styles.getPropertyValue(name).trim(),
    ]).filter(([, value]) => Boolean(value))),
  };
}

/** Serialized into the sandbox iframe; keep this closure dependency-free. */
export const PLUGIN_THEME_RUNTIME_JS = `
function applyPluginTheme(theme, tokens) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  if (!tokens || typeof tokens !== 'object') return;
  for (const [name, value] of Object.entries(tokens)) {
    if (name.startsWith('--') && typeof value === 'string') {
      document.documentElement.style.setProperty(name, value);
    }
  }
}
`;

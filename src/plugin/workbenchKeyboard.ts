export const PLUGIN_WORKBENCH_HOST_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Enter",
] as const;

/** Hidden plugin runtimes must yield visible Workbench navigation to QxShell. */
export function shouldForwardPluginWorkbenchHostKey(input: {
  mounted: boolean;
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return input.mounted
    && !input.metaKey
    && !input.ctrlKey
    && !input.altKey
    && !input.shiftKey
    && (PLUGIN_WORKBENCH_HOST_KEYS as readonly string[]).includes(input.key);
}

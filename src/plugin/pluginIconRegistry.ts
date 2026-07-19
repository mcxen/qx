const pluginIcons = new Map<string, string>();

/** Host-resolved plugin assets used when projecting serializable Island content. */
export function setPluginIcon(pluginId: string, iconUrl: string | undefined): void {
  if (iconUrl) pluginIcons.set(pluginId, iconUrl);
  else pluginIcons.delete(pluginId);
}

export function getPluginIcon(pluginId: string): string | undefined {
  return pluginIcons.get(pluginId);
}

export function clearPluginIcons(): void {
  pluginIcons.clear();
}

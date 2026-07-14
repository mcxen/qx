import type { InstalledPlugin } from "../../../plugin/types";
import PluginAssetImage from "./PluginAssetImage";
import { isBuiltin } from "./helpers";

/**
 * Compact installed-module tile.
 * Mature pattern: icon + name + one quiet status line; click opens config dialog.
 * Avoids badge clutter and marketing CTAs on the card face.
 */
export default function InstalledModuleCard({
  plugin,
  onOpen,
}: {
  plugin: InstalledPlugin;
  onOpen: () => void;
}) {
  const builtin = isBuiltin(plugin);
  const status = !plugin.enabled
    ? "Disabled"
    : builtin
      ? "Built-in"
      : `v${plugin.version}`;

  return (
    <button
      type="button"
      className={`qx-plugin-module-card${plugin.enabled ? "" : " is-disabled"}`}
      onClick={onOpen}
      aria-label={`${plugin.name}. ${status}. Open settings.`}
    >
      <PluginAssetImage
        plugin={plugin}
        asset={plugin.manifest?.icon}
        className="qx-plugin-module-card-icon"
        fallback={plugin.name}
      />
      <div className="qx-plugin-module-card-copy">
        <div className="qx-plugin-module-card-title">{plugin.name}</div>
        <div className="qx-plugin-module-card-meta">{status}</div>
      </div>
    </button>
  );
}

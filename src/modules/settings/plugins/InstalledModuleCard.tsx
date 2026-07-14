import type { InstalledPlugin } from "../../../plugin/types";
import PluginAssetImage from "./PluginAssetImage";
import { isBuiltin } from "./helpers";
import BetaBadge from "../../../components/BetaBadge";
import { isBetaModule } from "../../catalog";
import { useT } from "../../../i18n";

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
  const t = useT();
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
      aria-label={`${plugin.name}. ${isBetaModule(plugin.id) ? `${t("common.beta", "Beta")}. ` : ""}${status}. ${t("plugins.openSettings", "Open settings")}.`}
    >
      <PluginAssetImage
        plugin={plugin}
        asset={plugin.manifest?.icon}
        className="qx-plugin-module-card-icon"
        fallback={plugin.name}
      />
      <div className="qx-plugin-module-card-copy">
        <div className="qx-plugin-module-card-title qx-module-title-with-badge">
          <span>{plugin.name}</span>
          {isBetaModule(plugin.id) && <BetaBadge />}
        </div>
        <div className="qx-plugin-module-card-meta">{status}</div>
      </div>
    </button>
  );
}

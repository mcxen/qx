import type { InstalledPlugin } from "../../../plugin/types";
import PluginAssetImage from "./PluginAssetImage";
import { isBuiltin } from "./helpers";
import BetaBadge from "../../../components/BetaBadge";
import PluginBackgroundBadge, {
  usePluginBackgroundSummary,
} from "../../../components/PluginBackgroundBadge";
import { isBetaModule } from "../../catalog";
import { useT } from "../../../i18n";
import { formatTimestamp } from "../../../plugin/backgroundActivity";

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
  const background = usePluginBackgroundSummary(plugin.enabled ? plugin.id : null);
  const status = !plugin.enabled
    ? t("plugins.badge.disabled", "Disabled")
    : background?.isRunning
      ? t("plugins.background.running", "Background running")
      : background?.hasBackground
        ? t("plugins.background.scheduled", "Background scheduled")
        : builtin
          ? t("plugins.badge.builtin", "Built-in")
          : `v${plugin.version}`;
  const lastHint =
    background?.lastRunAt != null
      ? `${t("plugins.background.lastRun", "Last run")}: ${formatTimestamp(background.lastRunAt)}`
      : "";

  return (
    <button
      type="button"
      className={`qx-plugin-module-card${plugin.enabled ? "" : " is-disabled"}`}
      onClick={onOpen}
      title={lastHint || undefined}
      aria-label={`${plugin.name}. ${isBetaModule(plugin.id) ? `${t("common.beta", "Beta")}. ` : ""}${status}. ${lastHint} ${t("plugins.openSettings", "Open settings")}.`}
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
          {plugin.enabled && <PluginBackgroundBadge pluginId={plugin.id} compact />}
        </div>
        <div className="qx-plugin-module-card-meta">{status}</div>
      </div>
    </button>
  );
}

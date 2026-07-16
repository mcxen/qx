import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { resolvePluginAssetUrl } from "../../../plugin/runtime";
import type { InstalledPlugin } from "../../../plugin/types";
import { BUILTIN_PLUGIN_ICONS, fallbackLabel, isBuiltin } from "./helpers";

/**
 * Unified icon renderer for extension surfaces.
 * Always fills its well; parent controls size via CSS on `className`.
 */
export default function PluginAssetImage({
  plugin,
  asset,
  className,
  fallback,
}: {
  plugin: InstalledPlugin;
  asset?: string;
  className: string;
  fallback?: string;
}) {
  const [src, setSrc] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(undefined);
    setFailed(false);
    if (!asset || isBuiltin(plugin)) return;
    void resolvePluginAssetUrl(plugin.id, asset).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, plugin.id, asset]);

  if (isBuiltin(plugin)) {
    const BuiltinIcon = BUILTIN_PLUGIN_ICONS[plugin.id] ?? Puzzle;
    // Size follows the well: card 20, list 18, detail 24.
    const size = className.includes("detail")
      ? 24
      : className.includes("ext-card") || className.includes("card-icon")
        ? 20
        : 18;
    return (
      <span className={`${className} is-builtin-icon`}>
        <BuiltinIcon size={size} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }

  if (!src || failed) {
    return (
      <span className={`${className} is-fallback`} aria-hidden="true">
        {fallbackLabel(fallback || plugin.name)}
      </span>
    );
  }
  return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { resolvePluginAssetUrl } from "../../../plugin/runtime";
import type { InstalledPlugin } from "../../../plugin/types";
import { BUILTIN_PLUGIN_ICONS, fallbackLabel, isBuiltin } from "./helpers";

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
    const size = className.includes("detail")
      ? 22
      : className.includes("card-icon")
        ? 15
        : 17;
    return (
      <span className={`${className} is-builtin-icon`}>
        <BuiltinIcon size={size} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }

  if (!src || failed) {
    return <span className={`${className} is-fallback`}>{fallbackLabel(fallback || plugin.name)}</span>;
  }
  return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

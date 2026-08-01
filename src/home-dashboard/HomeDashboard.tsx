import { BatteryCharging, BatteryMedium, Cpu, MemoryStick, Network, Pin, Search } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { LauncherAppIcon } from "../ResultsList";
import { useIslandData, type SystemStatsSnapshot } from "../home-island";
import { useLocale, useT } from "../i18n";
import { useSettingsStore } from "../modules/settings/store";
import { usePluginRegistry } from "../plugin/registry";
import { useDisplayName } from "../search/appDisplay";
import { isEntryPinned, metadataKeyForEntry } from "../search/searchMetadata";
import type { AppEntry, SearchHistoryEntry } from "../store";
import { homeDashboardWidgetOptions, homeWidgetProvider, sanitizeHomeDashboardWidgets } from "./catalog";
import LauncherHomePopover from "../launcher/LauncherHomePopover";

function clampPercent(value: number | null | undefined): number {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function MetricCard({
  id,
  title,
  value,
  detail,
  progress,
  icon,
  onClick,
}: {
  id: string;
  title: string;
  value: string;
  detail: string;
  progress?: number | null;
  icon: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="qx-home-metric-icon" aria-hidden="true">{icon}</span>
      <span className="qx-home-metric-copy">
        <span className="qx-home-widget-title">{title}</span>
        <span className="qx-home-metric-detail">{detail}</span>
      </span>
      <span className="qx-home-metric-value">{value}</span>
      {progress != null && (
        <span className="qx-home-meter" aria-hidden="true">
          <span style={{ width: `${clampPercent(progress)}%` }} />
        </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="qx-home-widget qx-home-metric" data-widget-id={id} onClick={onClick}>
      {content}
    </button>
  ) : (
    <section className="qx-home-widget qx-home-metric" data-widget-id={id}>
      {content}
    </section>
  );
}

export default function HomeDashboard({
  items,
  recentSearches,
  onItemClick,
  onItemContextMenu,
  onSearchSelect,
  onNavigate,
}: {
  items: AppEntry[];
  recentSearches: SearchHistoryEntry[];
  onItemClick: (item: AppEntry) => void;
  onItemContextMenu: (item: AppEntry, x: number, y: number) => void;
  onSearchSelect: (query: string) => void;
  onNavigate: (target: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const getDisplayName = useDisplayName();
  const { settings, patch } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
  const enabled = sanitizeHomeDashboardWidgets(settings.appearance.home_dashboard_widgets);
  const channels = useMemo(() => [
    ...(enabled.some((id) => id === "system.cpu" || id === "system.memory") ? ["stats" as const] : []),
    ...(enabled.includes("system.power") ? ["power" as const] : []),
    ...(enabled.includes("system.network") ? ["net" as const] : []),
  ], [enabled.join("|")]);
  const data = useIslandData(channels);
  const pinned = items.filter((item) => isEntryPinned(settings, metadataKeyForEntry(item))).slice(0, 12);
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const rate = (bytes: number) => {
    const value = Math.max(0, bytes);
    if (value >= 1024 * 1024) return `${number.format(value / 1024 / 1024)} MB/s`;
    if (value >= 1024) return `${number.format(value / 1024)} KB/s`;
    return `${number.format(value)} B/s`;
  };
  const memoryPressure = (value?: SystemStatsSnapshot["memoryPressure"]) => {
    switch (value) {
      case "normal": return t("launcher.home.memory.pressure.normal", "Normal pressure");
      case "warning": return t("launcher.home.memory.pressure.warning", "Elevated pressure");
      case "critical": return t("launcher.home.memory.pressure.critical", "Critical pressure");
      default: return t("launcher.home.memory.pressure.unknown", "Pressure unavailable");
    }
  };
  const providerFor = (source: "system.cpu" | "system.memory" | "system.power" | "system.network") => {
    const provider = homeWidgetProvider(source, plugins);
    return provider ? () => onNavigate(`plugin:${provider.id}`) : undefined;
  };

  return (
    <div className="qx-home-dashboard" data-qx-region="launcher-home" data-qx-region-initial="true">
      <div className="qx-home-dashboard-grid">
        <div className="qx-home-primary">
          {enabled.includes("launcher.pinned") && (
            <section className="qx-home-widget qx-home-pinned" data-widget-id="launcher.pinned">
              <header className="qx-home-widget-header">
                <span className="qx-home-widget-heading">
                  <Pin size={14} strokeWidth={2.1} aria-hidden="true" />
                  <span className="qx-home-widget-title">{t("launcher.home.pinned", "Pinned Entries")}</span>
                </span>
                <span className="qx-home-widget-header-actions">
                  <span className="qx-home-widget-count">{pinned.length}</span>
                  <LauncherHomePopover
                    entries={items}
                    homeWidgets={enabled}
                    widgetOptions={homeDashboardWidgetOptions(t)}
                    onToggleWidget={(id, enabledNext) => {
                      const widgets = enabledNext
                        ? [...enabled, id]
                        : enabled.filter((value) => value !== id);
                      if (widgets.length === 0) return;
                      patch("appearance", {
                        ...settings.appearance,
                        home_dashboard_widgets: widgets,
                      });
                    }}
                  />
                </span>
              </header>
              {pinned.length > 0 ? (
                <div className="qx-home-app-grid">
                  {pinned.map((item) => {
                    const label = getDisplayName(item);
                    return (
                      <button
                        key={item.path}
                        type="button"
                        className="qx-home-app"
                        onClick={() => onItemClick(item)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          onItemContextMenu(item, event.clientX, event.clientY);
                        }}
                        title={label}
                      >
                        <LauncherAppIcon item={item} label={label} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="qx-home-widget-empty">
                  <span>{t("launcher.home.pinned.empty", "No pinned entries")}</span>
                  <small>{t("launcher.home.pinned.hint", "Use the three-dot menu to add apps or modules.")}</small>
                </div>
              )}
            </section>
          )}

          <div className="qx-home-metrics">
            {enabled.includes("system.cpu") && (
              <MetricCard
                id="system.cpu"
                title="CPU"
                value={data.ready.stats && data.stats ? `${number.format(data.stats.cpu)}%` : "—"}
                detail={t("launcher.home.cpu.live", "Current utilization")}
                progress={data.stats?.cpu}
                icon={<Cpu size={17} strokeWidth={2} />}
                onClick={providerFor("system.cpu")}
              />
            )}
            {enabled.includes("system.memory") && (
              <MetricCard
                id="system.memory"
                title={t("launcher.home.memory", "Memory")}
                value={data.ready.stats && data.stats ? `${number.format(data.stats.memory)}%` : "—"}
                detail={data.stats
                  ? `${number.format(data.stats.memoryUsedGb)} / ${number.format(data.stats.memoryTotalGb)} GB · ${memoryPressure(data.stats.memoryPressure)}`
                  : t("launcher.home.loading", "Reading system data")}
                progress={data.stats?.memory}
                icon={<MemoryStick size={17} strokeWidth={2} />}
                onClick={providerFor("system.memory")}
              />
            )}
            {enabled.includes("system.power") && (
              <MetricCard
                id="system.power"
                title={t("launcher.home.power", "Power")}
                value={data.ready.power && data.power?.batteryLevel != null ? `${Math.round(data.power.batteryLevel)}%` : "—"}
                detail={data.power?.isCharging
                  ? t("launcher.home.power.charging", "Charging")
                  : data.power?.fullyCharged
                    ? t("launcher.home.power.full", "Fully charged")
                    : data.power?.source || t("launcher.home.loading", "Reading system data")}
                progress={data.power?.batteryLevel}
                icon={data.power?.isCharging ? <BatteryCharging size={17} strokeWidth={2} /> : <BatteryMedium size={17} strokeWidth={2} />}
                onClick={providerFor("system.power")}
              />
            )}
            {enabled.includes("system.network") && (
              <MetricCard
                id="system.network"
                title={t("launcher.home.network", "Network")}
                value={data.ready.net && data.net ? rate(data.net.downRate) : "—"}
                detail={data.net ? `${t("launcher.home.network.up", "Upload")} ${rate(data.net.upRate)}` : t("launcher.home.loading", "Reading system data")}
                icon={<Network size={17} strokeWidth={2} />}
                onClick={providerFor("system.network")}
              />
            )}
          </div>
        </div>

        <section className="qx-home-widget qx-home-recent-searches" data-widget-id="launcher.recent-searches">
          <header className="qx-home-widget-header">
            <span className="qx-home-widget-title">{t("launcher.recentSearches", "Recent Searches")}</span>
            <span className="qx-home-widget-count">{recentSearches.length}</span>
          </header>
          {recentSearches.length > 0 ? (
            <div className="qx-home-recent-search-list">
              {recentSearches.map((entry) => (
                <button
                  key={`home-search-${entry.id}`}
                  type="button"
                  className="qx-home-recent-search"
                  onClick={() => onSearchSelect(entry.query)}
                >
                  <Search size={14} strokeWidth={2} aria-hidden="true" />
                  <span>{entry.query}</span>
                  <time>{entry.timestamp}</time>
                </button>
              ))}
            </div>
          ) : (
            <div className="qx-home-widget-empty">
              <span>{t("launcher.recentSearches.empty", "No recent searches")}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

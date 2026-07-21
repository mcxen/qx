/**
 * Installed extension row — stable columns for list alignment.
 *
 * Grid:
 *   [ icon 44 ] [ title + subtitle 1fr ] [ chips ] [ trailing ]
 *
 * Chips / footer / trailing slots stay extensible without shifting title X.
 */
import type { ReactNode } from "react";
import type { InstalledPlugin } from "../../../plugin/types";
import PluginAssetImage from "./PluginAssetImage";
import { isBuiltin } from "./helpers";
import BetaBadge from "../../../components/BetaBadge";
import PluginBackgroundBadge, {
  usePluginBackgroundSummary,
} from "../../../components/PluginBackgroundBadge";
import { isBetaModule } from "../../catalog";
import { useLocale, useT } from "../../../i18n";
import { formatRelativeTime, formatTimestamp } from "../../../plugin/backgroundActivity";
import {
  localizePluginDescription,
  localizePluginName,
} from "../../../plugin/pluginLabels";
import { ChevronRight } from "lucide-react";

export type ExtensionCardBadgeTone = "neutral" | "accent" | "success" | "danger" | "warning";

/** Optional chip shown in the meta column (extensible surface for future states). */
export type ExtensionCardBadge = {
  id: string;
  label: string;
  tone?: ExtensionCardBadgeTone;
};

export type ExtensionCardProps = {
  plugin: InstalledPlugin;
  onOpen: () => void;
  /** Extra chips after built-in status chips. */
  badges?: ExtensionCardBadge[];
  /** Right-side slot (version, chevron, actions…). */
  trailing?: ReactNode;
  /** Optional footer under subtitle (progress, errors…). */
  footer?: ReactNode;
  className?: string;
};

function fillN(template: string, n: number): string {
  return template.replace(/\{n\}/g, String(n));
}

function relativeLastRun(
  ms: number | null | undefined,
  t: (key: string, fallback: string) => string,
): string | null {
  if (ms == null) return null;
  const rel = formatRelativeTime(ms);
  if (rel.kind === "just_now") return t("plugins.background.justNow", "Just now");
  if (rel.minutes != null && rel.kind === "past") {
    return fillN(t("plugins.background.minutesAgo", "{n}m ago"), rel.minutes);
  }
  if (rel.hours != null && rel.kind === "past") {
    return fillN(t("plugins.background.hoursAgo", "{n}h ago"), rel.hours);
  }
  if (rel.days != null && rel.kind === "past") {
    return fillN(t("plugins.background.daysAgo", "{n}d ago"), rel.days);
  }
  return formatTimestamp(ms) || null;
}

function StatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: ExtensionCardBadgeTone;
}) {
  return <span className={`qx-ext-chip is-${tone}`}>{label}</span>;
}

export default function InstalledModuleCard({
  plugin,
  onOpen,
  badges = [],
  trailing,
  footer,
  className = "",
}: ExtensionCardProps) {
  const t = useT();
  const locale = useLocale();
  const builtin = isBuiltin(plugin);
  const background = usePluginBackgroundSummary(plugin.enabled ? plugin.id : null);
  const beta = isBetaModule(plugin.id);
  const displayName = localizePluginName(plugin, t, locale);
  const displayDescription = localizePluginDescription(plugin, t, locale);

  const chips: ExtensionCardBadge[] = [];
  if (!plugin.enabled) {
    chips.push({
      id: "disabled",
      label: t("plugins.badge.disabled", "Disabled"),
      tone: "neutral",
    });
  } else if (builtin) {
    chips.push({
      id: "builtin",
      label: t("plugins.badge.builtin", "Built-in"),
      tone: "accent",
    });
  } else {
    chips.push({
      id: "version",
      label: `v${plugin.version || "0"}`,
      tone: "neutral",
    });
  }
  for (const badge of badges) {
    if (!chips.some((c) => c.id === badge.id)) chips.push(badge);
  }

  const lastRel = relativeLastRun(background?.lastRunAt, t);
  const subtitleParts: string[] = [];
  if (displayDescription) {
    subtitleParts.push(displayDescription);
  } else if (builtin) {
    subtitleParts.push(t("plugins.builtin.desc", "Core module"));
  } else if (plugin.author) {
    subtitleParts.push(plugin.author);
  }
  if (plugin.enabled && background?.isRunning) {
    subtitleParts.unshift(t("plugins.background.running", "Background running"));
  } else if (plugin.enabled && background?.hasBackground && lastRel) {
    subtitleParts.unshift(
      `${t("plugins.background.lastRun", "Last run")}: ${lastRel}`,
    );
  } else if (plugin.enabled && background?.hasBackground) {
    subtitleParts.unshift(t("plugins.background.scheduled", "Background scheduled"));
  }

  const subtitle = subtitleParts.filter(Boolean).join(" · ");
  const lastHint =
    background?.lastRunAt != null
      ? `${t("plugins.background.lastRun", "Last run")}: ${formatTimestamp(background.lastRunAt)}`
      : "";

  const hasChips =
    beta ||
    (plugin.enabled && Boolean(background?.hasBackground)) ||
    chips.length > 0;

  return (
    <button
      type="button"
      className={[
        "qx-ext-card",
        plugin.enabled ? "" : "is-disabled",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onOpen}
      title={lastHint || displayDescription || undefined}
      aria-label={`${displayName}. ${beta ? `${t("common.beta", "Beta")}. ` : ""}${subtitle}. ${t("plugins.openSettings", "Open settings")}.`}
    >
      <span className="qx-ext-card-icon-well" aria-hidden="true">
        <PluginAssetImage
          plugin={plugin}
          asset={plugin.manifest?.icon}
          className="qx-ext-card-icon"
          fallback={displayName}
        />
      </span>

      <span className="qx-ext-card-body">
        <span className="qx-ext-card-title">{displayName}</span>
        {subtitle ? (
          <span className="qx-ext-card-subtitle">{subtitle}</span>
        ) : null}
        {footer ? <span className="qx-ext-card-footer">{footer}</span> : null}
      </span>

      <span className="qx-ext-card-meta" aria-hidden={!hasChips}>
        {beta && <BetaBadge />}
        {plugin.enabled && background?.hasBackground && (
          <PluginBackgroundBadge pluginId={plugin.id} compact />
        )}
        {chips.map((chip) => (
          <StatusChip key={chip.id} label={chip.label} tone={chip.tone} />
        ))}
      </span>

      <span className="qx-ext-card-trailing">
        {trailing ?? (
          <ChevronRight
            className="qx-ext-card-chevron"
            size={16}
            strokeWidth={2}
            aria-hidden="true"
          />
        )}
      </span>
    </button>
  );
}

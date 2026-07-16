import { useMemo } from "react";
import { useT } from "../i18n";
import {
  formatRelativeTime,
  formatTimestamp,
  usePluginBackgroundStore,
  type PluginBackgroundJob,
  type PluginBackgroundSummary,
} from "../plugin/backgroundActivity";

function fillN(template: string, n: number): string {
  return template.replace(/\{n\}/g, String(n));
}

function relativeLabel(
  ms: number | null | undefined,
  t: (key: string, fallback: string) => string,
): string {
  const rel = formatRelativeTime(ms);
  if (rel.kind === "never") return t("plugins.background.never", "Never");
  if (rel.kind === "just_now") return t("plugins.background.justNow", "Just now");
  if (rel.minutes != null) {
    return rel.kind === "past"
      ? fillN(t("plugins.background.minutesAgo", "{n}m ago"), rel.minutes)
      : fillN(t("plugins.background.inMinutes", "in {n}m"), rel.minutes);
  }
  if (rel.hours != null) {
    return rel.kind === "past"
      ? fillN(t("plugins.background.hoursAgo", "{n}h ago"), rel.hours)
      : fillN(t("plugins.background.inHours", "in {n}h"), rel.hours);
  }
  if (rel.days != null) {
    return rel.kind === "past"
      ? fillN(t("plugins.background.daysAgo", "{n}d ago"), rel.days)
      : fillN(t("plugins.background.inDays", "in {n}d"), rel.days);
  }
  return formatTimestamp(ms);
}

function buildTooltip(
  summary: PluginBackgroundSummary,
  t: (key: string, fallback: string) => string,
): string {
  const lines: string[] = [
    summary.isRunning
      ? t("plugins.background.running", "Background running")
      : t("plugins.background.scheduled", "Background scheduled"),
  ];
  for (const job of summary.jobs) {
    const last = job.lastRunAt
      ? `${relativeLabel(job.lastRunAt, t)} · ${formatTimestamp(job.lastRunAt)}`
      : t("plugins.background.never", "Never");
    const next = job.nextRunAt
      ? `${relativeLabel(job.nextRunAt, t)} · ${formatTimestamp(job.nextRunAt)}`
      : "—";
    lines.push(
      `${job.commandTitle} (${job.interval})`,
      `  ${t("plugins.background.lastRun", "Last run")}: ${last}`,
      `  ${t("plugins.background.nextRun", "Next run")}: ${next}`,
    );
    if (job.lastError) {
      lines.push(`  ${t("plugins.background.lastError", "Last error")}: ${job.lastError}`);
    }
  }
  return lines.join("\n");
}

export function usePluginBackgroundSummary(pluginId: string | null | undefined): PluginBackgroundSummary | null {
  const revision = usePluginBackgroundStore((s) => s.revision);
  return useMemo(() => {
    if (!pluginId) return null;
    return usePluginBackgroundStore.getState().summarizePlugin(pluginId);
    // revision intentionally forces recompute after store updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, revision]);
}

export function usePluginBackgroundJob(
  pluginId: string | null | undefined,
  commandName: string | null | undefined,
): PluginBackgroundJob | undefined {
  const revision = usePluginBackgroundStore((s) => s.revision);
  return useMemo(() => {
    if (!pluginId || !commandName) return undefined;
    return usePluginBackgroundStore.getState().getJob(pluginId, commandName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, commandName, revision]);
}

/**
 * Compact badge for plugins/commands with no-view interval jobs.
 * Hover shows last / next execution times (and errors).
 */
export default function PluginBackgroundBadge({
  pluginId,
  commandName,
  className = "",
  compact = false,
}: {
  pluginId: string | null | undefined;
  /** When set, tooltip focuses that command; otherwise all plugin jobs. */
  commandName?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  const summary = usePluginBackgroundSummary(pluginId);
  const job = usePluginBackgroundJob(pluginId, commandName);

  if (!summary?.hasBackground) return null;
  if (commandName && !job) return null;

  const running = job ? job.state === "running" : summary.isRunning;
  const label = running
    ? t("plugins.background.badgeRunning", "Running")
    : t("plugins.background.badge", "Background");

  const tip = job
    ? buildTooltip(
        {
          ...summary,
          jobs: [job],
          isRunning: job.state === "running",
          lastRunAt: job.lastRunAt,
          nextRunAt: job.nextRunAt,
        },
        t,
      )
    : buildTooltip(summary, t);

  return (
    <span
      className={`qx-plugin-bg-badge${running ? " is-running" : ""}${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      title={tip}
      aria-label={tip.replace(/\n/g, "; ")}
    >
      <span className="qx-plugin-bg-badge-dot" aria-hidden="true" />
      <span className="qx-plugin-bg-badge-label">{label}</span>
    </span>
  );
}

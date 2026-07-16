import { useMemo } from "react";
import { useT } from "../i18n";
import {
  formatDurationMs,
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
      : summary.jobs.some((job) => job.lastOutcome === "error" || job.lastError)
        ? t("plugins.background.hasErrors", "Background · last run failed")
        : t("plugins.background.scheduled", "Background scheduled"),
  ];
  for (const job of summary.jobs) {
    const last = job.lastRunAt
      ? `${relativeLabel(job.lastRunAt, t)} · ${formatTimestamp(job.lastRunAt)}`
      : t("plugins.background.never", "Never");
    const next = job.nextRunAt
      ? `${relativeLabel(job.nextRunAt, t)} · ${formatTimestamp(job.nextRunAt)}`
      : "—";
    const duration =
      job.lastDurationMs != null ? ` · ${formatDurationMs(job.lastDurationMs)}` : "";
    lines.push(
      `${job.commandTitle} (${job.interval})`,
      `  ${t("plugins.background.lastRun", "Last run")}: ${last}${duration}`,
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
 * Semantic tone follows open-source status badge practice (running / success / error).
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
  const failed = job
    ? Boolean(job.lastOutcome === "error" || job.lastError)
    : summary.jobs.some((item) => item.lastOutcome === "error" || item.lastError);
  const ok = !running && !failed && (job ? job.lastOutcome === "success" : summary.jobs.some((item) => item.lastOutcome === "success"));

  const label = running
    ? t("plugins.background.badgeRunning", "Running")
    : failed
      ? t("plugins.background.badgeFailed", "Failed")
      : ok
        ? t("plugins.background.badgeOk", "OK")
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

  const toneClass = running
    ? " is-running"
    : failed
      ? " is-failed"
      : ok
        ? " is-ok"
        : "";

  return (
    <span
      className={`qx-plugin-bg-badge${toneClass}${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      title={tip}
      aria-label={tip.replace(/\n/g, "; ")}
    >
      <span className="qx-plugin-bg-badge-dot" aria-hidden="true" />
      <span className="qx-plugin-bg-badge-label">{label}</span>
    </span>
  );
}

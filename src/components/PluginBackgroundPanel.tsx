/**
 * Structured background-job panel (status + schedule + recent run log).
 *
 * Inspired by open-source status patterns (GitLab badges, PatternFly status,
 * GitHub Actions run lists): semantic status color, relative time primary,
 * absolute time secondary, compact activity rows with duration.
 */
import { useT } from "../i18n";
import {
  formatDurationMs,
  formatRelativeTime,
  formatTimestamp,
  type PluginBackgroundJob,
  type PluginBackgroundSummary,
} from "../plugin/backgroundActivity";
import { usePluginBackgroundSummary } from "./PluginBackgroundBadge";

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

function statusMeta(
  job: PluginBackgroundJob,
  t: (key: string, fallback: string) => string,
): { tone: "running" | "success" | "error" | "scheduled" | "idle"; label: string } {
  if (job.state === "running") {
    return { tone: "running", label: t("plugins.background.running", "Background running") };
  }
  if (job.lastOutcome === "error" || job.lastError) {
    return { tone: "error", label: t("plugins.background.failed", "Failed") };
  }
  if (job.lastOutcome === "success") {
    return { tone: "success", label: t("plugins.background.succeeded", "Succeeded") };
  }
  if (job.state === "scheduled") {
    return { tone: "scheduled", label: t("plugins.background.scheduled", "Background scheduled") };
  }
  return { tone: "idle", label: t("plugins.background.idle", "Idle") };
}

function JobCard({
  job,
  t,
}: {
  job: PluginBackgroundJob;
  t: (key: string, fallback: string) => string;
}) {
  const status = statusMeta(job, t);
  const history = job.history?.length
    ? job.history
    : job.lastRunAt != null
      ? [{
          at: job.lastRunAt,
          ok: job.lastOutcome !== "error",
          error: job.lastError || undefined,
          durationMs: job.lastDurationMs ?? undefined,
        }]
      : [];

  return (
    <div className={`qx-bg-job is-${status.tone}`}>
      <div className="qx-bg-job-head">
        <div className="qx-bg-job-title-row">
          <span className={`qx-bg-status is-${status.tone}`}>
            <span className="qx-bg-status-dot" aria-hidden="true" />
            <span>{status.label}</span>
          </span>
          <span className="qx-bg-interval" title={t("plugins.background.interval", "Interval {n}").replace("{n}", job.interval)}>
            {job.interval}
          </span>
        </div>
        <div className="qx-bg-job-name">{job.commandTitle}</div>
      </div>

      <div className="qx-bg-meta-grid">
        <div className="qx-bg-meta">
          <span className="qx-bg-meta-label">{t("plugins.background.lastRun", "Last run")}</span>
          <span className="qx-bg-meta-value" title={formatTimestamp(job.lastRunAt) || undefined}>
            {relativeLabel(job.lastRunAt, t)}
            {job.lastDurationMs != null && job.lastDurationMs >= 0
              ? ` · ${formatDurationMs(job.lastDurationMs)}`
              : ""}
          </span>
        </div>
        <div className="qx-bg-meta">
          <span className="qx-bg-meta-label">{t("plugins.background.nextRun", "Next run")}</span>
          <span className="qx-bg-meta-value" title={formatTimestamp(job.nextRunAt) || undefined}>
            {job.state === "running"
              ? t("plugins.background.runningNow", "In progress")
              : relativeLabel(job.nextRunAt, t)}
          </span>
        </div>
      </div>

      {job.lastError && (
        <div className="qx-bg-error" title={job.lastError}>
          {job.lastError}
        </div>
      )}

      {history.length > 0 && (
        <div className="qx-bg-history">
          <div className="qx-bg-history-title">
            {t("plugins.background.runLog", "Recent runs")}
          </div>
          <ul className="qx-bg-history-list">
            {history.slice(0, 8).map((run) => (
              <li
                key={`${run.at}-${run.ok ? "ok" : "err"}`}
                className={`qx-bg-history-row is-${run.ok ? "success" : "error"}`}
              >
                <span className="qx-bg-history-mark" aria-hidden="true" />
                <span className="qx-bg-history-main">
                  <span className="qx-bg-history-outcome">
                    {run.ok
                      ? t("plugins.background.succeeded", "Succeeded")
                      : t("plugins.background.failed", "Failed")}
                  </span>
                  <span className="qx-bg-history-time" title={formatTimestamp(run.at)}>
                    {relativeLabel(run.at, t)}
                    {run.durationMs != null ? ` · ${formatDurationMs(run.durationMs)}` : ""}
                  </span>
                </span>
                {run.error ? (
                  <span className="qx-bg-history-error" title={run.error}>
                    {run.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PluginBackgroundPanel({
  pluginId,
  summary: summaryProp,
}: {
  pluginId: string | null | undefined;
  /** Optional preloaded summary (avoids double store read). */
  summary?: PluginBackgroundSummary | null;
}) {
  const t = useT();
  const live = usePluginBackgroundSummary(pluginId);
  const summary = summaryProp ?? live;
  if (!summary?.hasBackground) return null;

  return (
    <div className="qx-bg-panel">
      <div className="qx-action-title">{t("plugins.background.section", "Background")}</div>
      <div className="qx-bg-jobs">
        {summary.jobs.map((job) => (
          <JobCard key={job.commandName} job={job} t={t} />
        ))}
      </div>
    </div>
  );
}

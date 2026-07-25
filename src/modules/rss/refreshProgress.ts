import type { BottomIslandContent } from "../../components/QxBottomIsland";
import {
  resolveActivityPercent,
  type QxContentActivity,
} from "../../types/contentActivity";
import type { RssRefreshProgress } from "./store";

type Translate = (key: string, fallback: string) => string;

export function rssRefreshActivity(
  progress: RssRefreshProgress | null,
  fallbackTitle: string | null | undefined,
  t: Translate,
): QxContentActivity {
  if (!progress) {
    return {
      kind: "refresh",
      state: "loading",
      label: t("rss.refresh.syncing", "Refreshing RSS"),
      detail: t("rss.refresh.preparing", "Preparing subscriptions…"),
    };
  }
  const phase = progress.phase === "saving"
    ? t("rss.refresh.saving", "Saving")
    : t("rss.refresh.fetching", "Fetching");
  const target = progress.feedTitle || fallbackTitle || "";
  return {
    kind: "refresh",
    state: progress.phase === "finished" ? "success" : "loading",
    targetId: progress.feedId,
    label: t("rss.refresh.syncing", "Refreshing RSS"),
    detail: `${phase}${target ? ` ${target}` : ""}`,
    completed: progress.completed,
    total: progress.total,
    failed: progress.failed,
  };
}

/** Map backend-observed RSS work into one shared Island presentation. */
export function buildRssRefreshIsland(
  progress: RssRefreshProgress | null,
  fallbackTitle: string | null | undefined,
  t: Translate,
): BottomIslandContent {
  const activity = rssRefreshActivity(progress, fallbackTitle, t);
  const counts = activity.total != null
    ? ` · ${activity.completed || 0}/${activity.total}`
    : "";
  const failure = activity.failed
    ? ` · ${activity.failed} ${t("rss.refresh.failed", "failed")}`
    : "";

  return {
    label: activity.label || t("rss.refresh.syncing", "Refreshing RSS"),
    detail: `${activity.detail || ""}${counts}${failure}`,
    progress: progress?.scope === "all" ? resolveActivityPercent(activity) : undefined,
    activity: progress?.scope === "feed" || !progress ? "wave" : undefined,
  };
}

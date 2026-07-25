import type { BottomIslandContent } from "../../components/QxBottomIsland";
import type { RssRefreshProgress } from "./store";

type Translate = (key: string, fallback: string) => string;

/** Map backend-observed RSS work into one shared Island presentation. */
export function buildRssRefreshIsland(
  progress: RssRefreshProgress | null,
  fallbackTitle: string | null | undefined,
  t: Translate,
): BottomIslandContent {
  if (!progress) {
    return {
      label: t("rss.refresh.syncing", "Refreshing RSS"),
      detail: t("rss.refresh.preparing", "Preparing subscriptions…"),
      activity: "wave",
    };
  }

  const phase = progress.phase === "saving"
    ? t("rss.refresh.saving", "Saving")
    : t("rss.refresh.fetching", "Fetching");
  const target = progress.feedTitle || fallbackTitle || "";
  const failure = progress.failed > 0
    ? ` · ${progress.failed} ${t("rss.refresh.failed", "failed")}`
    : "";

  return {
    label: t("rss.refresh.syncing", "Refreshing RSS"),
    detail: `${phase}${target ? ` ${target}` : ""} · ${progress.completed}/${progress.total}${failure}`,
    progress: progress.scope === "all" && progress.total > 0
      ? (progress.completed / progress.total) * 100
      : undefined,
    activity: progress.scope === "feed" ? "wave" : undefined,
  };
}

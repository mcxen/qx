import { useSettingsStore } from "./store";
import { Row, Toggle, SegmentedControl } from "../../components/ui";
import { useT } from "../../i18n";

export default function RssSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const r = settings.rss;

  return (
    <div className="qx-settings-page">
      <Row
        title={t("rss.offlineCache", "Offline Content Caching")}
        description={t("rss.offlineCache.desc", "Save full article content to local storage for offline reading. When disabled, only titles and summaries are stored.")}
      >
        <Toggle
          value={r.offline_cache_enabled}
          onChange={(v) => patch("rss", { ...r, offline_cache_enabled: v })}
        />
      </Row>
      <Row
        title={t("rss.maxArticles", "Max Articles Per Feed")}
        description={t("rss.maxArticles.desc", "Older non-starred articles are automatically pruned when the limit is reached.")}
      >
        <SegmentedControl
          value={String(r.max_articles_per_feed)}
          onChange={(v) => patch("rss", { ...r, max_articles_per_feed: parseInt(v) })}
          options={[
            { value: "100", label: "100" },
            { value: "500", label: "500" },
            { value: "1000", label: "1000" },
            { value: "0", label: t("rss.unlimited", "Unlimited") },
          ]}
        />
      </Row>
      <Row
        title={t("rss.bottomIslandMode", "Bottom Island Mode")}
        description={t("rss.bottomIslandMode.desc", "Choose what to display in the bottom status island while reading articles.")}
      >
        <SegmentedControl
          value={r.bottom_island_mode}
          onChange={(v) => patch("rss", { ...r, bottom_island_mode: v as "scroll" | "index" })}
          options={[
            { value: "scroll", label: t("rss.bottomIslandMode.scroll", "Reading Progress") },
            { value: "index", label: t("rss.bottomIslandMode.index", "Article Index") },
          ]}
        />
      </Row>
    </div>
  );
}

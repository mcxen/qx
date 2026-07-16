import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore } from "./store";
import { Row, Toggle, SegmentedControl, Select, Slider, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

const ANYFEEDER_HOME = "https://plink.anyfeeder.com/";

const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "system-ui", label: "System" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'New York', serif", label: "New York" },
  { value: "'Iowan Old Style', serif", label: "Iowan" },
  { value: "'Helvetica Neue', sans-serif", label: "Helvetica" },
  { value: "'SF Mono', ui-monospace, monospace", label: "SF Mono" },
];

export default function RssSettings() {
  const { settings, patch } = useSettingsStore();
  const t = useT();
  const r = settings.rss;
  const [cleanupMsg, setCleanupMsg] = useState("");

  const patchR = (partial: Partial<typeof r>) =>
    patch("rss", { ...r, ...partial });

  const clearRead = async () => {
    try {
      const count = await invoke<number>("rss_clear_read_articles");
      setCleanupMsg(`${count} read article${count !== 1 ? "s" : ""} cleared.`);
    } catch (e) {
      setCleanupMsg(String(e));
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Delete ALL articles? (Feeds will be kept.) This cannot be undone.")) return;
    try {
      const count = await invoke<number>("rss_clear_all_articles");
      setCleanupMsg(`${count} article${count !== 1 ? "s" : ""} deleted.`);
    } catch (e) {
      setCleanupMsg(String(e));
    }
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("rss.library.title", "Library & Storage")}>
        <Row
          title={t("rss.offlineCache", "Offline Content Caching")}
          description={t("rss.offlineCache.desc", "Save full article content to local storage for offline reading. When disabled, only titles and summaries are stored.")}
        >
          <Toggle
            value={r.offline_cache_enabled}
            onChange={(v) => patchR({ offline_cache_enabled: v })}
          />
        </Row>
        <Row
          title={t("rss.maxArticles", "Max Articles Per Feed")}
          description={t("rss.maxArticles.desc", "Older non-starred articles are automatically pruned when the limit is reached.")}
        >
          <SegmentedControl
            value={String(r.max_articles_per_feed)}
            onChange={(v) => patchR({ max_articles_per_feed: parseInt(v) })}
            options={[
              { value: "100", label: "100" },
              { value: "500", label: "500" },
              { value: "1000", label: "1000" },
              { value: "0", label: t("rss.unlimited", "Unlimited") },
            ]}
          />
        </Row>
        <Row
          title={t("rss.retentionDays", "Auto-Cleanup by Age")}
          description={t("rss.retentionDays.desc", "Articles older than this (by publish date) are deleted on each refresh. Starred articles are never deleted.")}
        >
          <SegmentedControl
            value={String(r.retention_days)}
            onChange={(v) => patchR({ retention_days: parseInt(v) })}
            options={[
              { value: "7", label: "7d" },
              { value: "14", label: "14d" },
              { value: "30", label: "30d" },
              { value: "60", label: "60d" },
              { value: "90", label: "90d" },
              { value: "0", label: t("rss.keepAll", "Keep All") },
            ]}
          />
        </Row>
        <Row
          title={t("rss.showFeedIcons", "Show Feed Icons")}
          description={t("rss.showFeedIcons.desc", "Display subscription source icons in the feed list. Disabling uses letter placeholders.")}
        >
          <Toggle
            value={r.show_feed_icons}
            onChange={(v) => patchR({ show_feed_icons: v })}
          />
        </Row>
        <Row
          title={t("rss.clearRead", "Clear Read Articles")}
          description={t("rss.clearRead.desc", "Delete all read, non-starred articles from the database.")}
        >
          <button className="qx-command-button" onClick={clearRead}>
            {t("rss.clearRead.action", "Clear Read")}
          </button>
        </Row>
        <Row
          title={t("rss.clearAll", "Clear All Articles")}
          description={t("rss.clearAll.desc", "Delete every article (feeds are kept). Use this to start fresh.")}
        >
          <button className="qx-command-button qx-danger-text" onClick={clearAll}>
            {t("rss.clearAll.action", "Clear All")}
          </button>
        </Row>
        {cleanupMsg && (
          <div className="qx-settings-muted" style={{ padding: "6px 0" }}>{cleanupMsg}</div>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("rss.reader.title", "Reader View")}>
        <Row
          title={t("rss.bottomIslandMode", "Bottom Island Mode")}
          description={t("rss.bottomIslandMode.desc", "Choose what to display in the bottom status island while reading articles.")}
        >
          <SegmentedControl
            value={r.bottom_island_mode}
            onChange={(v) => patchR({ bottom_island_mode: v as "scroll" | "index" })}
            options={[
              { value: "scroll", label: t("rss.bottomIslandMode.scroll", "Reading Progress") },
              { value: "index", label: t("rss.bottomIslandMode.index", "Article Index") },
            ]}
          />
        </Row>
        <Row
          title={t("rss.imageDisplayMode", "Image Display Mode")}
          description={t("rss.imageDisplayMode.desc", "Control how images appear in article detail view. Fixed size constrains width; Full-width fills the content column.")}
        >
          <SegmentedControl
            value={r.image_display_mode}
            onChange={(v) => patchR({ image_display_mode: v as "fixed" | "full" })}
            options={[
              { value: "full", label: t("rss.imageDisplayMode.full", "Full Width") },
              { value: "fixed", label: t("rss.imageDisplayMode.fixed", "Fixed Size") },
            ]}
          />
        </Row>
        {r.image_display_mode === "fixed" && (
          <Row
            title={t("rss.imageFixedWidth", "Fixed Image Width")}
            description={t("rss.imageFixedWidth.desc", "Maximum width in pixels for images when using fixed-size mode.")}
          >
            <Slider
              value={r.image_fixed_width}
              min={160}
              max={640}
              step={20}
              onChange={(v) => patchR({ image_fixed_width: v })}
              formatLabel={(v) => `${v}px`}
              ariaLabel={t("rss.imageFixedWidth", "Fixed Image Width")}
            />
          </Row>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("rss.typography.title", "Typography")}>
        <Row
          title={t("rss.articleFontSize", "Article Font Size")}
          description={t("rss.articleFontSize.desc", "Base font size for article content. Adjust for comfortable reading.")}
        >
          <Slider
            value={r.article_font_size}
            min={12}
            max={22}
            step={1}
            onChange={(v) => patchR({ article_font_size: v })}
            formatLabel={(v) => `${v}px`}
            ariaLabel={t("rss.articleFontSize", "Article Font Size")}
          />
        </Row>
        <Row
          title={t("rss.articleFontFamily", "Article Font")}
          description={t("rss.articleFontFamily.desc", "Choose a typeface for article content. System uses the OS default.")}
        >
          <Select
            value={r.article_font_family}
            onChange={(v) => patchR({ article_font_family: v })}
            options={FONT_OPTIONS}
          />
        </Row>
      </SettingsCard>

      <SettingsCard title={t("rss.about.title", "About RSS")}>
        <Row
          title={t("rss.about.defaults", "Starter subscriptions")}
          description={t(
            "rss.about.defaults.desc",
            "New installs include sample feeds in Tech, News, and Digest folders (IT Home, Expreview, Ruan Yifeng, Zaobao, Zhihu Daily, and several AnyFeeder sources). You can remove or regroup them anytime.",
          )}
        >
          <span className="qx-settings-muted" style={{ fontSize: 12 }}>
            {t("rss.about.defaults.folders", "科技 · 新闻 · 资讯")}
          </span>
        </Row>
        <Row
          title={t("rss.about.anyfeeder", "AnyFeeder")}
          description={t(
            "rss.about.anyfeeder.desc",
            "Several starter feeds use AnyFeeder (plink.anyfeeder.com), a public RSS bridge for sites that do not publish a native feed. Thanks to AnyFeeder for making these sources available.",
          )}
        >
          <button
            type="button"
            className="qx-command-button"
            onClick={() => void openUrl(ANYFEEDER_HOME)}
          >
            {t("rss.about.anyfeeder.open", "Open AnyFeeder")}
          </button>
        </Row>
        <Row
          title={t("rss.about.anyfeeder.guide", "How to add more")}
          description={t(
            "rss.about.anyfeeder.guide.desc",
            "Browse https://plink.anyfeeder.com/ for route paths, copy a full feed URL (https://plink.anyfeeder.com/…), then use RSS → Add Feed. Prefer official site RSS when available; use AnyFeeder only as a bridge.",
          )}
        >
          <button
            type="button"
            className="qx-command-button"
            onClick={() => {
              void navigator.clipboard?.writeText(ANYFEEDER_HOME).catch(() => {});
            }}
          >
            {t("rss.about.anyfeeder.copy", "Copy link")}
          </button>
        </Row>
      </SettingsCard>
    </div>
  );
}

import { useSettingsStore } from "./store";
import { Row, Toggle, SegmentedControl, Select, Slider, SettingsCard } from "../../components/ui";
import { useT } from "../../i18n";

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

  const patchR = (partial: Partial<typeof r>) =>
    patch("rss", { ...r, ...partial });

  return (
    <div className="qx-settings-page">
      <SettingsCard
        title={t("rss.library.title", "Library & Storage")}
        description={t("rss.library.desc", "Control article retention and feed list metadata.")}
      >
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
          title={t("rss.showFeedIcons", "Show Feed Icons")}
          description={t("rss.showFeedIcons.desc", "Display subscription source icons in the feed list. Disabling uses letter placeholders.")}
        >
          <Toggle
            value={r.show_feed_icons}
            onChange={(v) => patchR({ show_feed_icons: v })}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("rss.reader.title", "Reader View")}
        description={t("rss.reader.desc", "Tune article navigation, image sizing, and bottom island behavior.")}
      >
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
        title={t("rss.typography.title", "Typography")}
        description={t("rss.typography.desc", "Set the article reading typeface and base size.")}
      >
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
    </div>
  );
}

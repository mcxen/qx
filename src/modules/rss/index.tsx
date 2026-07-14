import { useEffect } from "react";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import { useRssStore } from "./store";
import RssPanel from "./RssPanel";
import ArticleList from "./ArticleList";

export default function RssReader() {
  const { view, loadFeeds, openFeed } = useRssStore();

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  // Deep launch from main search: __qx:launch → feed / commands.
  useEffect(() => {
    const launch = takePendingModuleLaunch("rss");
    if (!launch) return;
    if (launch.surface === "feed") {
      const feedId = Number(launch.params?.feedId);
      if (Number.isFinite(feedId) && feedId > 0) {
        void openFeed(feedId);
      }
      return;
    }
    // root / import-opml / add-feed land on feed list; panel owns dialogs via session flag.
    if (launch.surface === "import-opml" || launch.surface === "add-feed") {
      sessionStorage.setItem("qx.rss.pendingSurface", launch.surface);
    }
  }, [openFeed]);

  if (view === "detail" || view === "articles") return <ArticleList />;
  return <RssPanel />;
}

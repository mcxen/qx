import { useEffect } from "react";
import { takePendingModuleLaunch } from "../../search/moduleSurfaces";
import PzaiPanel from "./PzaiPanel";
import { usePzaiStore } from "./store";

export default function PzaiReader() {
  const { loadFeeds, openArticle, selectFeed } = usePzaiStore();

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    const launch = takePendingModuleLaunch("p-zai");
    if (!launch) return;
    if (launch.surface === "article") {
      const id = Number(launch.params?.articleId ?? launch.params?.id);
      if (Number.isFinite(id) && id > 0) void openArticle(id);
      return;
    }
    if (launch.surface === "feed") {
      const feedId = Number(launch.params?.feedId);
      if (Number.isFinite(feedId) && feedId > 0) void selectFeed(feedId);
    }
  }, [openArticle, selectFeed]);

  return <PzaiPanel />;
}
